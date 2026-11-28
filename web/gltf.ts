// glTF 2.0 reader: .glb, or .gltf with its .bin and image files. No dependencies.
// It reads what a static model needs (the node tree, triangle meshes, metallic-roughness
// materials and their textures) and says in `warnings` what it left out. Nothing here
// touches the GPU or the page, so it also runs under Node for `check` and the tests.
// Floats only: none of this reaches the simulation.

export interface Material {
  /** Base color factor, RGBA. */
  color: number[];
  metallic: number;
  roughness: number;
  emissive: number[];
  /** Indices into Model.textures, or -1. */
  colorTex: number;
  surfaceTex: number;
  normalTex: number;
  occlusionTex: number;
  emissiveTex: number;
  normalScale: number;
  occlusionStrength: number;
  /** Alpha below this is not drawn (alphaMode MASK); 0 draws everything. */
  cutoff: number;
  doubleSided: boolean;
}
export interface Image { mime: string; bytes: Uint8Array }
export type Wrap = 'repeat' | 'clamp-to-edge' | 'mirror-repeat';
export interface Texture { image: number; wrapS: Wrap; wrapT: Wrap; smooth: boolean }
/** Triangles of one material: per vertex position (3), normal (3), uv (2). */
export interface Part { data: Float32Array; material: number }
export interface Model {
  parts: Part[];
  materials: Material[];
  textures: Texture[];
  images: Image[];
  triangles: number;
  /** Size of the model before it was fitted to the unit cube, in its own units. */
  size: number[];
  warnings: string[];
}

const GLB = 0x46546c67, CHUNK_JSON = 0x4e4f534a, CHUNK_BIN = 0x004e4942;
export const isGlb = (bytes: Uint8Array): boolean => bytes.length >= 12 && new DataView(bytes.buffer, bytes.byteOffset).getUint32(0, true) === GLB;

/** The JSON and the binary chunk of a .glb file. */
export function splitGlb(bytes: Uint8Array): { json: any; bin?: Uint8Array } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (!isGlb(bytes)) throw new Error('not a .glb file (wrong magic)');
  if (view.getUint32(4, true) !== 2) throw new Error(`glb version ${view.getUint32(4, true)} is not supported (only 2)`);
  const end = Math.min(view.getUint32(8, true), bytes.byteLength);
  let json: any, bin: Uint8Array | undefined;
  for (let at = 12; at + 8 <= end;) {
    const length = view.getUint32(at, true), type = view.getUint32(at + 4, true);
    const chunk = bytes.subarray(at + 8, at + 8 + length);
    if (chunk.length < length) throw new Error('glb is cut short');
    if (type === CHUNK_JSON) json = JSON.parse(new TextDecoder().decode(chunk));
    else if (type === CHUNK_BIN && !bin) bin = chunk;
    at += 8 + length + ((4 - (length % 4)) % 4);
  }
  if (!json) throw new Error('glb has no JSON chunk');
  return { json, bin };
}

const dataUri = (uri: string): Image | null => {
  const m = /^data:([^;,]*)(;base64)?,/.exec(uri);
  if (!m) return null;
  const text = uri.slice(m[0].length), raw = m[2] ? atob(text) : decodeURIComponent(text);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return { mime: m[1], bytes };
};
const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };

/**
 * Read a model from the bytes of a .glb or .gltf file. `fetchFile` is asked for each file
 * the model refers to by relative path (buffers and images); it rejects when one is missing.
 */
export async function loadGltf(bytes: Uint8Array, fetchFile: (uri: string) => Promise<Uint8Array>): Promise<Model> {
  let json: any, bin: Uint8Array | undefined;
  if (isGlb(bytes)) ({ json, bin } = splitGlb(bytes));
  else {
    try { json = JSON.parse(new TextDecoder().decode(bytes)); } catch (e) { throw new Error(`not valid glTF JSON: ${(e as Error).message}`); }
  }
  if (!json || typeof json !== 'object' || !json.asset) throw new Error('not a glTF file (no asset entry)');
  if (!String(json.asset.version ?? '').startsWith('2')) throw new Error(`glTF version ${json.asset.version} is not supported (only 2.x)`);
  const need = async (uri: string, what: string): Promise<Uint8Array> => {
    try { return await fetchFile(decodeURIComponent(uri)); } catch { throw new Error(`${what} '${uri}' is missing`); }
  };
  const buffers = await Promise.all((json.buffers ?? []).map(async (b: any, i: number): Promise<Uint8Array> => {
    if (b.uri === undefined) {
      if (i === 0 && bin) return bin;
      throw new Error(`buffer ${i} has no data`);
    }
    return dataUri(b.uri)?.bytes ?? need(b.uri, 'buffer');
  }));
  const images = await Promise.all((json.images ?? []).map(async (im: any, i: number): Promise<Image> => {
    if (im.bufferView !== undefined) {
      const v = json.bufferViews?.[im.bufferView], buf = buffers[v?.buffer];
      if (!v || !buf) throw new Error(`image ${i} points at a missing buffer view`);
      return { mime: im.mimeType ?? 'image/png', bytes: buf.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength) };
    }
    if (im.uri === undefined) throw new Error(`image ${i} has no data`);
    const inline = dataUri(im.uri);
    if (inline) return { mime: im.mimeType ?? inline.mime, bytes: inline.bytes };
    return { mime: im.mimeType ?? MIME[im.uri.slice(im.uri.lastIndexOf('.') + 1).toLowerCase()] ?? 'image/png', bytes: await need(im.uri, 'image') };
  }));
  return buildModel(json, buffers, images);
}

// --- matrices: column-major arrays of 16, as in mesh.ts ---
type Mat = number[];
const IDENTITY: Mat = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mulMat(a: Mat, b: Mat): Mat {
  const out = new Array<number>(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    out[c * 4 + r] = s;
  }
  return out;
}
/** A node's own transform: its matrix, or translation * rotation * scale. */
function localMatrix(node: any): Mat {
  if (node.matrix) return node.matrix as Mat;
  const [x, y, z, w] = (node.rotation as number[] | undefined) ?? [0, 0, 0, 1];
  const [sx, sy, sz] = (node.scale as number[] | undefined) ?? [1, 1, 1];
  const [tx, ty, tz] = (node.translation as number[] | undefined) ?? [0, 0, 0];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}
/**
 * What normals are multiplied by under matrix m: the cofactors of its upper 3x3. That is
 * the inverse transpose times the determinant, so it stays right under uneven scale and
 * under mirroring, and needs no division.
 */
function normalMatrix(m: Mat): { n: number[]; det: number } {
  const [a, b, c, , d, e, f, , g, h, i] = m;
  const n = [e * i - f * h, f * g - d * i, d * h - e * g, c * h - b * i, a * i - c * g, b * g - a * h, b * f - c * e, c * d - a * f, a * e - b * d];
  return { n, det: a * n[0] + b * n[1] + c * n[2] };
}

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const BYTES: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };

/** Build the model from parsed JSON and the buffers and images it refers to, already loaded. */
export function buildModel(json: any, buffers: Uint8Array[], images: Image[]): Model {
  const warnings: string[] = [];
  const warn = (w: string): void => { if (!warnings.includes(w)) warnings.push(w); };
  for (const e of json.extensionsRequired ?? []) warn(`requires extension ${e}, which is not supported: the model may be wrong or empty`);
  // Extensions that say something about the file and change nothing in the picture.
  for (const e of json.extensionsUsed ?? []) if (e !== 'GODOT_single_root' && !(json.extensionsRequired ?? []).includes(e)) warn(`uses extension ${e}, which is ignored`);
  if (json.animations?.length) warn('animations are not played');
  if (json.skins?.length) warn('skins are ignored: the model is drawn in its bind pose');

  /** An accessor's values as plain numbers, `size` per element. */
  const accessor = (index: number): { data: Float64Array; size: number; count: number } => {
    const a = json.accessors?.[index];
    if (!a) throw new Error(`accessor ${index} does not exist`);
    const size = COMPONENTS[a.type], bytes = BYTES[a.componentType];
    if (!size || !bytes) throw new Error(`accessor ${index} has an unknown type`);
    const data = new Float64Array(a.count * size);
    if (a.sparse) warn('sparse accessors are read without their sparse part');
    if (a.bufferView === undefined) return { data, size, count: a.count };
    const v = json.bufferViews?.[a.bufferView], buf = buffers[v?.buffer];
    if (!v || !buf) throw new Error(`accessor ${index} points at a missing buffer view`);
    const start = (v.byteOffset ?? 0) + (a.byteOffset ?? 0), stride = v.byteStride || bytes * size;
    if (start + (a.count - 1) * stride + bytes * size > buf.byteLength) throw new Error(`accessor ${index} reads past the end of its buffer`);
    const view = new DataView(buf.buffer, buf.byteOffset + start);
    const t = a.componentType;
    for (let i = 0; i < a.count; i++) for (let c = 0; c < size; c++) {
      const at = i * stride + c * bytes;
      let x = t === 5126 ? view.getFloat32(at, true) : t === 5125 ? view.getUint32(at, true) : t === 5123 ? view.getUint16(at, true)
        : t === 5122 ? view.getInt16(at, true) : t === 5121 ? view.getUint8(at) : view.getInt8(at);
      if (a.normalized) x = t === 5121 ? x / 255 : t === 5123 ? x / 65535 : t === 5120 ? Math.max(x / 127, -1) : t === 5122 ? Math.max(x / 32767, -1) : x;
      data[i * size + c] = x;
    }
    return { data, size, count: a.count };
  };

  const texIndex = (info: any, what: string): number => {
    if (!info || info.index === undefined) return -1;
    if (info.texCoord) warn(`${what} uses a second set of texture coordinates, which is ignored`);
    const source = json.textures?.[info.index]?.source;
    if (source === undefined || !images[source]) { warn(`${what} has no image this reader can use`); return -1; }
    return info.index;
  };
  const materials: Material[] = (json.materials ?? []).map((m: any): Material => {
    const p = m.pbrMetallicRoughness ?? {};
    if (m.alphaMode === 'BLEND') warn('alphaMode BLEND is drawn opaque');
    return {
      color: p.baseColorFactor ?? [1, 1, 1, 1], metallic: p.metallicFactor ?? 1, roughness: p.roughnessFactor ?? 1,
      emissive: m.emissiveFactor ?? [0, 0, 0],
      colorTex: texIndex(p.baseColorTexture, 'a base color texture'), surfaceTex: texIndex(p.metallicRoughnessTexture, 'a metallic-roughness texture'),
      normalTex: texIndex(m.normalTexture, 'a normal texture'), occlusionTex: texIndex(m.occlusionTexture, 'an occlusion texture'),
      emissiveTex: texIndex(m.emissiveTexture, 'an emissive texture'),
      normalScale: m.normalTexture?.scale ?? 1, occlusionStrength: m.occlusionTexture?.strength ?? 1,
      cutoff: m.alphaMode === 'MASK' ? m.alphaCutoff ?? 0.5 : 0, doubleSided: !!m.doubleSided,
    };
  });
  // What a primitive without a material gets: the glTF default.
  const plain = materials.length;
  const wrap = (code: number | undefined): Wrap => (code === 33071 ? 'clamp-to-edge' : code === 33648 ? 'mirror-repeat' : 'repeat');
  const textures: Texture[] = (json.textures ?? []).map((t: any): Texture => {
    const s = json.samplers?.[t.sampler] ?? {};
    return { image: t.source ?? -1, wrapS: wrap(s.wrapS), wrapT: wrap(s.wrapT), smooth: s.magFilter !== 9728 };
  });

  // Vertices per material, in the model's own space, as they come out of the node tree.
  const soup = new Map<number, number[]>();
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const visit = (index: number, parent: Mat, seen: Set<number>): void => {
    const node = json.nodes?.[index];
    if (!node || seen.has(index)) return;
    seen.add(index);
    const m = mulMat(parent, localMatrix(node));
    for (const prim of json.meshes?.[node.mesh]?.primitives ?? []) {
      if (prim.attributes?.POSITION === undefined) continue;
      const mode = prim.mode ?? 4;
      if (mode < 4) { warn('points and lines are not drawn'); continue; }
      const pos = accessor(prim.attributes.POSITION);
      const nor = prim.attributes.NORMAL === undefined ? null : accessor(prim.attributes.NORMAL);
      const uv = prim.attributes.TEXCOORD_0 === undefined ? null : accessor(prim.attributes.TEXCOORD_0);
      const order = prim.indices === undefined ? Float64Array.from({ length: pos.count }, (_, i) => i) : accessor(prim.indices).data;
      if (prim.targets?.length) warn('morph targets are ignored');
      // Every mode becomes a list of triangles.
      const tris: number[] = [];
      if (mode === 4) for (let i = 0; i + 2 < order.length; i += 3) tris.push(order[i], order[i + 1], order[i + 2]);
      else if (mode === 5) for (let i = 0; i + 2 < order.length; i++) tris.push(order[i], order[i + 1 + (i % 2)], order[i + 2 - (i % 2)]);
      else for (let i = 1; i + 1 < order.length; i++) tris.push(order[0], order[i], order[i + 1]);

      const { n, det } = normalMatrix(m);
      let out = soup.get(prim.material ?? plain);
      if (!out) soup.set(prim.material ?? plain, (out = []));
      for (let t = 0; t + 2 < tris.length; t += 3) {
        // A mirroring transform turns triangles inside out; swapping two corners undoes that.
        const corner = det < 0 ? [tris[t], tris[t + 2], tris[t + 1]] : [tris[t], tris[t + 1], tris[t + 2]];
        if (corner.some((c) => !(c < pos.count))) continue;
        const p = corner.map((c) => {
          const x = pos.data[c * 3], y = pos.data[c * 3 + 1], z = pos.data[c * 3 + 2];
          return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
        });
        const e1 = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]], e2 = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
        const flat = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        corner.forEach((c, k) => {
          let normal = flat;
          if (nor) {
            const x = nor.data[c * 3], y = nor.data[c * 3 + 1], z = nor.data[c * 3 + 2];
            normal = [n[0] * x + n[3] * y + n[6] * z, n[1] * x + n[4] * y + n[7] * z, n[2] * x + n[5] * y + n[8] * z];
            if (det < 0) normal = normal.map((v) => -v);
          }
          out!.push(...p[k], ...normal, uv ? uv.data[c * 2] : 0, uv ? uv.data[c * 2 + 1] : 0);
          for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], p[k][a]); hi[a] = Math.max(hi[a], p[k][a]); }
        });
      }
    }
    for (const child of node.children ?? []) visit(child, m, seen);
  };
  // The scene the file names, or else every node that is nobody's child.
  const children = new Set<number>((json.nodes ?? []).flatMap((nd: any) => nd.children ?? []));
  const roots: number[] = json.scenes?.[json.scene ?? 0]?.nodes ?? (json.nodes ?? []).map((_: any, i: number) => i).filter((i: number) => !children.has(i));
  const seen = new Set<number>();
  for (const r of roots) visit(r, IDENTITY, seen);

  // Fit to the unit cube, the way an OBJ mesh is: the entity's box then gives the size.
  // glTF has y up and the simulation has y down, so y is mirrored and the winding swapped back.
  const size = [0, 1, 2].map((a) => (hi[a] > lo[a] ? hi[a] - lo[a] : 0));
  const parts: Part[] = [];
  let triangles = 0;
  for (const [material, v] of [...soup].sort((a, b) => a[0] - b[0])) {
    const data = new Float32Array(v.length);
    for (let t = 0; t < v.length; t += 24) for (let k = 0; k < 3; k++) {
      const from = t + [0, 2, 1][k] * 8, to = t + k * 8;
      for (let a = 0; a < 3; a++) {
        const u = size[a] ? (v[from + a] - lo[a]) / size[a] : 0.5;
        data[to + a] = a === 1 ? 1 - u : u;
      }
      // Normals go through the inverse of that stretch, and the same mirror.
      const nx = v[from + 3] * (size[0] || 1), ny = -v[from + 4] * (size[1] || 1), nz = v[from + 5] * (size[2] || 1), l = Math.hypot(nx, ny, nz) || 1;
      data[to + 3] = nx / l; data[to + 4] = ny / l; data[to + 5] = nz / l;
      data[to + 6] = v[from + 6]; data[to + 7] = v[from + 7];
    }
    parts.push({ data, material });
    triangles += v.length / 24;
  }
  if (parts.some((p) => p.material === plain)) {
    materials.push({ color: [1, 1, 1, 1], metallic: 1, roughness: 1, emissive: [0, 0, 0], colorTex: -1, surfaceTex: -1, normalTex: -1, occlusionTex: -1, emissiveTex: -1, normalScale: 1, occlusionStrength: 1, cutoff: 0, doubleSided: false });
  }
  if (!triangles) warn('has no triangles to draw');
  return { parts, materials, textures, images, triangles, size, warnings };
}
