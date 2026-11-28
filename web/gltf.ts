// glTF 2.0 reader: .glb, or .gltf with its .bin and image files. No dependencies.
// It reads the node tree, triangle meshes, metallic-roughness materials and their textures,
// skins and animations, and says in `warnings` what it left out. Nothing here
// touches the GPU or the page, so it also runs under Node for `check` and the tests.
// Floats only: none of this reaches the simulation.
import { ONE } from '../src/fx.ts';
import type { Comp } from '../src/world.ts';

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
/** One primitive of one node: its vertices as the file has them, and where they go. */
interface Piece {
  node: number;
  /** Index into Rig.skins, or -1. */
  skin: number;
  /** Which part it goes into, and at which vertex of it. */
  part: number;
  at: number;
  /** Per vertex: position, normal (empty: the face's own is used), uv, and for a skin 4 joints and 4 weights. */
  position: Float64Array;
  normal: Float64Array;
  uv: Float64Array;
  joints: Float64Array;
  weights: Float64Array;
  /** Three vertex numbers per triangle, in the order they are drawn. */
  corners: number[];
}
export interface Channel { node: number; path: 'translation' | 'rotation' | 'scale'; times: Float64Array; values: Float64Array; blend: string }
export interface Clip { name: string; duration: number; channels: Channel[] }
interface Node { parent: number; t: number[]; r: number[]; s: number[]; matrix?: number[] }
/** What it takes to pose a model that moves. */
export interface Rig {
  nodes: Node[];
  /** Node numbers with every parent before its children. */
  order: number[];
  skins: { joints: number[]; inverse: Float64Array }[];
  pieces: Piece[];
  /** The corner of the rest pose's box: posed frames are fitted to the same box, so they may reach outside it. */
  lo: number[];
}
export interface Model {
  parts: Part[];
  materials: Material[];
  textures: Texture[];
  images: Image[];
  triangles: number;
  /** Size of the model before it was fitted to the unit cube, in its own units. */
  size: number[];
  warnings: string[];
  /** The animations, by name, for `poseModel`. */
  clips: Clip[];
  rig: Rig;
  /**
   * The vertex buffers of the poses a renderer has on screen. It is a method so that the
   * renderers, which a game without models ships too, carry none of this.
   */
  poses<T>(make: () => T, write: (into: T, data: Float32Array[]) => void): Poses<T>;
}

export interface Poses<T> {
  /**
   * The buffers for a `clip` component seen at a tick, or nothing when the model has no such
   * animation. Whoever shows the same moment of the same animation gets the same ones.
   */
  of(clip: Comp, tick: number, hz: number): T | undefined;
  /** End of a frame: buffers no one asked for in it are written over by later poses. */
  sweep(): void;
}

function posesOf<T>(model: Model, make: () => T, write: (into: T, data: Float32Array[]) => void): Poses<T> {
  const out = model.parts.map((p) => new Float32Array(p.data.length)), free: T[] = [];
  let before = new Map<string, T>(), now = new Map<string, T>();
  return {
    of(clip, tick, hz) {
      // The time comes from the tick alone, so a replay draws the same frames.
      const seconds = ((tick - (clip.from as number)) / hz) * ((clip.speed as number) / ONE);
      const key = [clip.name, seconds, clip.loop].join('\n');
      let got = now.get(key) ?? before.get(key);
      if (got === undefined) {
        if (!poseModel(model, clip.name as string, seconds, !!clip.loop, out)) return undefined;
        write((got = free.pop() ?? make()), out.filter((d) => d.length));
      }
      before.delete(key);
      now.set(key, got);
      return got;
    },
    sweep() {
      free.push(...before.values());
      before = now;
      now = new Map();
    },
  };
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

  const nodes: Node[] = (json.nodes ?? []).map((n: any): Node => ({
    parent: -1, t: n.translation ?? [0, 0, 0], r: n.rotation ?? [0, 0, 0, 1], s: n.scale ?? [1, 1, 1], ...(n.matrix ? { matrix: n.matrix } : {}),
  }));
  const skins = (json.skins ?? []).map((k: any) => {
    const joints: number[] = k.joints ?? [];
    const inverse = k.inverseBindMatrices === undefined ? Float64Array.from(joints.flatMap(() => IDENTITY)) : accessor(k.inverseBindMatrices).data;
    return { joints, inverse };
  });

  // The scene the file names, or else every node that is nobody's child.
  const children = new Set<number>((json.nodes ?? []).flatMap((nd: any) => nd.children ?? []));
  const roots: number[] = json.scenes?.[json.scene ?? 0]?.nodes ?? (json.nodes ?? []).map((_: any, i: number) => i).filter((i: number) => !children.has(i));
  const order: number[] = [], drawn: number[] = [];
  const seen = new Set<number>();
  const visit = (index: number, parent: number): void => {
    if (!nodes[index] || seen.has(index)) return;
    seen.add(index);
    nodes[index].parent = parent;
    order.push(index);
    drawn.push(index);
    for (const child of json.nodes[index].children ?? []) visit(child, index);
  };
  for (const r of roots) visit(r, -1);
  // A skin may name joints that hang outside the scene; they are posed too, but nothing there is drawn.
  const outside = (index: number): void => {
    if (!nodes[index] || seen.has(index)) return;
    const parent = (json.nodes ?? []).findIndex((n: any) => n.children?.includes(index));
    if (parent >= 0) outside(parent);
    if (seen.has(index)) return;
    seen.add(index);
    nodes[index].parent = parent;
    order.push(index);
  };
  for (const k of skins) for (const j of k.joints) outside(j);

  const rest = worldMatrices(nodes, order, null);
  const pieces: Piece[] = [];
  const count = new Map<number, number>();
  for (const index of drawn) {
    const node = json.nodes[index];
    for (const prim of json.meshes?.[node.mesh]?.primitives ?? []) {
      if (prim.attributes?.POSITION === undefined) continue;
      const mode = prim.mode ?? 4;
      if (mode < 4) { warn('points and lines are not drawn'); continue; }
      const pos = accessor(prim.attributes.POSITION);
      const values = (name: string): Float64Array => (prim.attributes[name] === undefined ? new Float64Array(0) : accessor(prim.attributes[name]).data);
      const list = prim.indices === undefined ? Float64Array.from({ length: pos.count }, (_, i) => i) : accessor(prim.indices).data;
      if (prim.targets?.length) warn('morph targets are ignored');
      if (prim.attributes.JOINTS_1 !== undefined) warn('only the first four joints of a vertex are used');
      const joints = values('JOINTS_0'), weights = values('WEIGHTS_0');
      const skin = node.skin !== undefined && skins[node.skin] && joints.length && weights.length ? node.skin : -1;
      // Every mode becomes a list of triangles.
      const tris: number[] = [];
      if (mode === 4) for (let i = 0; i + 2 < list.length; i += 3) tris.push(list[i], list[i + 1], list[i + 2]);
      else if (mode === 5) for (let i = 0; i + 2 < list.length; i++) tris.push(list[i], list[i + 1 + (i % 2)], list[i + 2 - (i % 2)]);
      else for (let i = 1; i + 1 < list.length; i++) tris.push(list[0], list[i], list[i + 1]);
      // The mirrored y below turns triangles inside out, and so does a mirroring transform:
      // two corners are swapped once for each, here, so posing does not have to.
      const mirrored = skin < 0 && normalMatrix(rest[index]).det < 0;
      const corners: number[] = [];
      for (let t = 0; t + 2 < tris.length; t += 3) {
        const a = tris[t], b = tris[t + 1], c = tris[t + 2];
        if (!(a < pos.count && b < pos.count && c < pos.count)) continue;
        corners.push(a, mirrored ? b : c, mirrored ? c : b);
      }
      const material = prim.material ?? plain;
      const at = count.get(material) ?? 0;
      count.set(material, at + corners.length);
      pieces.push({ node: index, skin, part: material, at, position: pos.data, normal: values('NORMAL'), uv: values('TEXCOORD_0'), joints, weights, corners });
    }
  }
  const used = [...count.keys()].sort((a, b) => a - b);
  for (const p of pieces) p.part = used.indexOf(p.part);
  const rig: Rig = { nodes, order, skins, pieces, lo: [0, 0, 0] };

  // Fit to the unit cube, the way an OBJ mesh is: the entity's box then gives the size.
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const piece of pieces) {
    const [p] = place(rig, piece, rest);
    for (const c of piece.corners) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], p[c * 3 + a]); hi[a] = Math.max(hi[a], p[c * 3 + a]); }
  }
  const size = [0, 1, 2].map((a) => (hi[a] > lo[a] ? hi[a] - lo[a] : 0));
  // A flat axis sits in the middle.
  rig.lo = size.map((x, a) => (x ? lo[a] : lo[a] - 0.5));
  const parts: Part[] = used.map((material) => ({ data: new Float32Array(count.get(material)! * 8), material }));
  fill(rig, size, rest, parts.map((p) => p.data));
  const triangles = parts.reduce((n, p) => n + p.data.length / 24, 0);

  const clips: Clip[] = (json.animations ?? []).map((a: any, i: number): Clip => {
    const channels: Channel[] = [];
    for (const c of a.channels ?? []) {
      const path = c.target?.path, sampler = a.samplers?.[c.sampler];
      if (path === 'weights') { warn('morph target animation is ignored'); continue; }
      if (!sampler || !nodes[c.target?.node] || !['translation', 'rotation', 'scale'].includes(path)) continue;
      if (nodes[c.target.node].matrix) { warn('a node with a matrix cannot be animated'); continue; }
      channels.push({ node: c.target.node, path, times: accessor(sampler.input).data, values: accessor(sampler.output).data, blend: sampler.interpolation ?? 'LINEAR' });
    }
    return { name: a.name || String(i), duration: Math.max(0, ...channels.map((c) => c.times[c.times.length - 1] ?? 0)), channels };
  });
  if (parts.some((p) => p.material === plain)) {
    materials.push({ color: [1, 1, 1, 1], metallic: 1, roughness: 1, emissive: [0, 0, 0], colorTex: -1, surfaceTex: -1, normalTex: -1, occlusionTex: -1, emissiveTex: -1, normalScale: 1, occlusionStrength: 1, cutoff: 0, doubleSided: false });
  }
  if (!triangles) warn('has no triangles to draw');
  const model: Model = { parts, materials, textures, images, triangles, size, warnings, clips, rig, poses: (make, write) => posesOf(model, make, write) };
  return model;
}

/** Where each node is in the model's own space, in a pose (or at rest). */
function worldMatrices(nodes: Node[], order: number[], pose: Map<number, Partial<Node>> | null): Mat[] {
  const out: Mat[] = nodes.map(() => IDENTITY);
  for (const i of order) {
    const n = nodes[i], p = pose?.get(i);
    const local = localMatrix(p ? { translation: p.t ?? n.t, rotation: p.r ?? n.r, scale: p.s ?? n.s } : { matrix: n.matrix, translation: n.t, rotation: n.r, scale: n.s });
    out[i] = n.parent < 0 ? local : mulMat(out[n.parent], local);
  }
  return out;
}

/** A piece's vertices and normals where the nodes, or its joints, put them. */
function place(rig: Rig, piece: Piece, world: Mat[]): [Float64Array, Float64Array] {
  const n = piece.position.length / 3;
  const position = new Float64Array(n * 3), normal = new Float64Array(piece.normal.length ? n * 3 : 0);
  const skin = piece.skin < 0 ? null : rig.skins[piece.skin];
  // A skinned mesh is put in place by its joints alone; its own node does not count.
  const joint = skin?.joints.map((j, k) => mulMat(world[j] ?? IDENTITY, Array.from(skin.inverse.subarray(k * 16, k * 16 + 16))));
  const blended = new Array<number>(16);
  let m = world[piece.node], turn = normalMatrix(m);
  for (let v = 0; v < n; v++) {
    if (joint) {
      let total = 0;
      for (let k = 0; k < 4; k++) total += piece.weights[v * 4 + k];
      blended.fill(0);
      for (let k = 0; k < 4; k++) {
        const w = piece.weights[v * 4 + k] / (total || 1), j = joint[piece.joints[v * 4 + k]] ?? IDENTITY;
        if (w) for (let e = 0; e < 16; e++) blended[e] += w * j[e];
      }
      m = total ? blended : IDENTITY;
      if (normal.length) turn = normalMatrix(m);
    }
    const x = piece.position[v * 3], y = piece.position[v * 3 + 1], z = piece.position[v * 3 + 2];
    for (let a = 0; a < 3; a++) position[v * 3 + a] = m[a] * x + m[4 + a] * y + m[8 + a] * z + m[12 + a];
    if (normal.length) {
      const nx = piece.normal[v * 3], ny = piece.normal[v * 3 + 1], nz = piece.normal[v * 3 + 2], sign = turn.det < 0 ? -1 : 1;
      for (let a = 0; a < 3; a++) normal[v * 3 + a] = sign * (turn.n[a] * nx + turn.n[3 + a] * ny + turn.n[6 + a] * nz);
    }
  }
  return [position, normal];
}

/**
 * Write the parts' vertices for one pose, fitted to the unit cube of the rest pose. glTF has
 * y up and the simulation has y down, so y is mirrored here.
 */
function fill(rig: Rig, size: number[], world: Mat[], out: Float32Array[]): void {
  for (const piece of rig.pieces) {
    const [p, n] = place(rig, piece, world), data = out[piece.part];
    for (let t = 0; t < piece.corners.length; t += 3) {
      let flat: number[] | null = null;
      if (!n.length) {
        const at = (k: number, a: number): number => p[piece.corners[t + k] * 3 + a];
        // The corners are already swapped for drawing, so the edges are taken the other way round.
        const e1 = [0, 1, 2].map((a) => at(2, a) - at(0, a)), e2 = [0, 1, 2].map((a) => at(1, a) - at(0, a));
        flat = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      }
      for (let k = 0; k < 3; k++) {
        const c = piece.corners[t + k], to = (piece.at + t + k) * 8;
        for (let a = 0; a < 3; a++) {
          const u = size[a] ? (p[c * 3 + a] - rig.lo[a]) / size[a] : p[c * 3 + a] - rig.lo[a];
          data[to + a] = a === 1 ? 1 - u : u;
        }
        // Normals go through the inverse of that stretch, and the same mirror.
        const nx = (flat ? flat[0] : n[c * 3]) * (size[0] || 1), ny = -(flat ? flat[1] : n[c * 3 + 1]) * (size[1] || 1), nz = (flat ? flat[2] : n[c * 3 + 2]) * (size[2] || 1);
        const l = Math.hypot(nx, ny, nz) || 1;
        data[to + 3] = nx / l; data[to + 4] = ny / l; data[to + 5] = nz / l;
        data[to + 6] = piece.uv.length ? piece.uv[c * 2] : 0; data[to + 7] = piece.uv.length ? piece.uv[c * 2 + 1] : 0;
      }
    }
  }
}

function slerp(a: number[], b: number[], t: number): number[] {
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const sign = dot < 0 ? -1 : 1;
  dot *= sign;
  const angle = Math.acos(Math.min(1, dot)), s = Math.sin(angle);
  const ka = s > 1e-6 ? Math.sin((1 - t) * angle) / s : 1 - t, kb = (s > 1e-6 ? Math.sin(t * angle) / s : t) * sign;
  return a.map((x, i) => x * ka + b[i] * kb);
}

/** A channel's value at a time in seconds: held before its first key and after its last. */
function sample(c: Channel, time: number): number[] {
  const width = c.path === 'rotation' ? 4 : 3, cubic = c.blend === 'CUBICSPLINE', step = cubic ? width * 3 : width;
  // A cubic key is three values: the tangent coming in, the value, the tangent going out.
  const key = (i: number, part = cubic ? 1 : 0): number[] => Array.from(c.values.subarray(i * step + part * width, i * step + part * width + width));
  const unit = (v: number[]): number[] => {
    if (width !== 4) return v;
    const l = Math.hypot(...v) || 1;
    return v.map((x) => x / l);
  };
  const last = c.times.length - 1;
  if (last === 0 || time <= c.times[0]) return unit(key(0));
  if (time >= c.times[last]) return unit(key(last));
  let i = 0;
  while (c.times[i + 1] <= time) i++;
  const gap = c.times[i + 1] - c.times[i], t = (time - c.times[i]) / gap;
  if (c.blend === 'STEP') return unit(key(i));
  const p0 = key(i), p1 = key(i + 1);
  if (!cubic) return unit(width === 4 ? slerp(p0, p1, t) : p0.map((x, a) => x + (p1[a] - x) * t));
  const m0 = key(i, 2), m1 = key(i + 1, 0), t2 = t * t, t3 = t2 * t;
  return unit(p0.map((x, a) => (2 * t3 - 3 * t2 + 1) * x + (t3 - 2 * t2 + t) * gap * m0[a] + (3 * t2 - 2 * t3) * p1[a] + (t3 - t2) * gap * m1[a]));
}

/**
 * The parts' vertices `seconds` into an animation, written into `out` (one array per part,
 * sized like its data). Looping wraps; otherwise the last frame is held. False when the
 * model has no animation of that name, and then `out` is left alone.
 */
export function poseModel(model: Model, name: string, seconds: number, loop: boolean, out: Float32Array[]): boolean {
  const clip = model.clips.find((c) => c.name === name);
  if (!clip) return false;
  const time = loop && clip.duration > 0 ? ((seconds % clip.duration) + clip.duration) % clip.duration : Math.min(Math.max(seconds, 0), clip.duration);
  const pose = new Map<number, Partial<Node>>();
  for (const c of clip.channels) {
    let p = pose.get(c.node);
    if (!p) pose.set(c.node, (p = {}));
    p[c.path === 'translation' ? 't' : c.path === 'rotation' ? 'r' : 's'] = sample(c, time);
  }
  fill(model.rig, model.size, worldMatrices(model.rig.nodes, model.rig.order, pose), out);
  return true;
}
