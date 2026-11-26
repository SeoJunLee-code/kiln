// Makes the glTF models the examples use. They are generated, not downloaded, so their
// origin is this file: see examples/ASSETS.md. Run it again only to change a model.
//   node scripts/models.ts
//
// The three files are built differently on purpose, so that together they exercise the
// reader: a .glb with embedded textures; a .gltf with a .bin and .png files beside it,
// a node tree, interleaved vertices and three index widths; a .glb whose meshes share
// their vertex data and differ only in material.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { encodePng } from '../src/png.ts';

const OUT = fileURLToPath(new URL('../examples/', import.meta.url));

interface Shape { pos: number[]; normal?: number[]; uv?: number[]; index: number[] }

function sphere(radius: number, around: number, down: number): Shape {
  const s: Shape = { pos: [], normal: [], uv: [], index: [] };
  for (let j = 0; j <= down; j++) for (let i = 0; i <= around; i++) {
    const phi = (j / down) * Math.PI, theta = (i / around) * Math.PI * 2;
    const n = [Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta)];
    s.pos.push(n[0] * radius, n[1] * radius, n[2] * radius);
    s.normal!.push(...n);
    s.uv!.push(i / around, j / down);
  }
  for (let j = 0; j < down; j++) for (let i = 0; i < around; i++) {
    const a = j * (around + 1) + i, b = a + around + 1;
    // At a pole one of the two triangles has no area; it is left out.
    if (j > 0) s.index.push(a, a + 1, b);
    if (j < down - 1) s.index.push(a + 1, b + 1, b);
  }
  return s;
}

/** Upright, from y = 0 to y = height, with both ends closed. */
function cylinder(radius: number, height: number, around: number): Shape {
  const s: Shape = { pos: [], normal: [], uv: [], index: [] };
  for (let i = 0; i <= around; i++) {
    const t = (i / around) * Math.PI * 2, x = Math.cos(t), z = Math.sin(t);
    s.pos.push(x * radius, height, z * radius, x * radius, 0, z * radius);
    s.normal!.push(x, 0, z, x, 0, z);
    s.uv!.push((i / around) * 3, 0, (i / around) * 3, 1);
  }
  for (let i = 0; i < around; i++) s.index.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 2, i * 2 + 3, i * 2 + 1);
  for (const [y, ny] of [[height, 1], [0, -1]]) {
    const centre = s.pos.length / 3;
    s.pos.push(0, y, 0);
    s.normal!.push(0, ny, 0);
    s.uv!.push(0.5, 0.5);
    for (let i = 0; i <= around; i++) {
      const t = (i / around) * Math.PI * 2;
      s.pos.push(Math.cos(t) * radius, y, Math.sin(t) * radius);
      s.normal!.push(0, ny, 0);
      s.uv!.push(0.5 + Math.cos(t) / 2, 0.5 + Math.sin(t) / 2);
    }
    for (let i = 1; i <= around; i++) s.index.push(...(ny > 0 ? [centre, centre + i + 1, centre + i] : [centre, centre + i, centre + i + 1]));
  }
  return s;
}

/** A ring lying flat around the y axis. */
function torus(big: number, small: number, around: number, tube: number): Shape {
  const s: Shape = { pos: [], normal: [], uv: [], index: [] };
  for (let j = 0; j <= around; j++) for (let i = 0; i <= tube; i++) {
    const u = (j / around) * Math.PI * 2, v = (i / tube) * Math.PI * 2;
    const n = [Math.cos(v) * Math.cos(u), Math.sin(v), Math.cos(v) * Math.sin(u)];
    s.pos.push((big + small * Math.cos(v)) * Math.cos(u), small * Math.sin(v), (big + small * Math.cos(v)) * Math.sin(u));
    s.normal!.push(...n);
    s.uv!.push(j / around, i / tube);
  }
  for (let j = 0; j < around; j++) for (let i = 0; i < tube; i++) {
    const a = j * (tube + 1) + i, b = a + tube + 1;
    s.index.push(a, a + 1, b, a + 1, b + 1, b);
  }
  return s;
}

/** A cube from -half to half; every face shows the whole texture. */
function cube(half: number): Shape {
  const s: Shape = { pos: [], normal: [], uv: [], index: [] };
  const faces: [number[], number[], number[]][] = [
    [[1, 0, 0], [0, 0, -1], [0, 1, 0]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]], [[0, 1, 0], [1, 0, 0], [0, 0, -1]],
    [[0, -1, 0], [1, 0, 0], [0, 0, 1]], [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
  ];
  for (const [n, u, v] of faces) {
    const base = s.pos.length / 3;
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      s.pos.push(...[0, 1, 2].map((k) => (n[k] + u[k] * a + v[k] * b) * half));
      s.normal!.push(...n);
      s.uv!.push((a + 1) / 2, (1 - b) / 2);
    }
    s.index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return s;
}

/** Eight flat faces and no normals of its own: the reader has to work them out. */
function octahedron(): Shape {
  return { pos: [0, 1, 0, 0, -1, 0, 1, 0, 0, -1, 0, 0, 0, 0, 1, 0, 0, -1], index: [0, 4, 2, 0, 2, 5, 0, 5, 3, 0, 3, 4, 1, 2, 4, 1, 5, 2, 1, 3, 5, 1, 4, 3] };
}

/** Collects binary data and the JSON that describes it. */
class Gltf {
  json: any = { asset: { version: '2.0', generator: 'kiln scripts/models.ts' }, scene: 0, scenes: [{ nodes: [] }], nodes: [], meshes: [], materials: [], accessors: [], bufferViews: [], buffers: [] };
  chunks: Buffer[] = [];
  length = 0;

  view(bytes: Buffer, extra: object = {}): number {
    const pad = (4 - (this.length % 4)) % 4;
    if (pad) { this.chunks.push(Buffer.alloc(pad)); this.length += pad; }
    this.json.bufferViews.push({ buffer: 0, byteOffset: this.length, byteLength: bytes.length, ...extra });
    this.chunks.push(bytes);
    this.length += bytes.length;
    return this.json.bufferViews.length - 1;
  }

  floats(values: number[], type: string, bounds = false): number {
    const size = type === 'VEC3' ? 3 : 2, view = this.view(Buffer.from(new Float32Array(values).buffer), { target: 34962 });
    return this.accessor({ bufferView: view, componentType: 5126, count: values.length / size, type }, bounds ? values : undefined);
  }

  accessor(a: any, positions?: number[]): number {
    if (positions) {
      a.min = [0, 1, 2].map((k) => Math.min(...positions.filter((_, i) => i % 3 === k)));
      a.max = [0, 1, 2].map((k) => Math.max(...positions.filter((_, i) => i % 3 === k)));
    }
    this.json.accessors.push(a);
    return this.json.accessors.length - 1;
  }

  /** Indices, in the width asked for: 1, 2 or 4 bytes. */
  indices(values: number[], bytes: number): number {
    const data = bytes === 1 ? Uint8Array.from(values) : bytes === 2 ? Uint16Array.from(values) : Uint32Array.from(values);
    const view = this.view(Buffer.from(data.buffer), { target: 34963 });
    return this.accessor({ bufferView: view, componentType: bytes === 1 ? 5121 : bytes === 2 ? 5123 : 5125, count: values.length, type: 'SCALAR' });
  }

  /** Vertex attributes for a shape, each in its own buffer view. */
  attributes(s: Shape): Record<string, number> {
    const out: Record<string, number> = { POSITION: this.floats(s.pos, 'VEC3', true) };
    if (s.normal) out.NORMAL = this.floats(s.normal, 'VEC3');
    if (s.uv) out.TEXCOORD_0 = this.floats(s.uv, 'VEC2');
    return out;
  }

  /** The same, but position, normal and uv woven into one view with a stride. */
  interleaved(s: Shape): Record<string, number> {
    const count = s.pos.length / 3, data = new Float32Array(count * 8);
    for (let i = 0; i < count; i++) data.set([...s.pos.slice(i * 3, i * 3 + 3), ...s.normal!.slice(i * 3, i * 3 + 3), ...s.uv!.slice(i * 2, i * 2 + 2)], i * 8);
    const view = this.view(Buffer.from(data.buffer), { byteStride: 32, target: 34962 });
    return {
      POSITION: this.accessor({ bufferView: view, byteOffset: 0, componentType: 5126, count, type: 'VEC3' }, s.pos),
      NORMAL: this.accessor({ bufferView: view, byteOffset: 12, componentType: 5126, count, type: 'VEC3' }),
      TEXCOORD_0: this.accessor({ bufferView: view, byteOffset: 24, componentType: 5126, count, type: 'VEC2' }),
    };
  }

  mesh(attributes: Record<string, number>, indices: number, material: number): number {
    this.json.meshes.push({ primitives: [{ attributes, indices, material }] });
    return this.json.meshes.length - 1;
  }

  node(n: object, root = true): number {
    this.json.nodes.push(n);
    if (root) this.json.scenes[0].nodes.push(this.json.nodes.length - 1);
    return this.json.nodes.length - 1;
  }

  material(m: object): number {
    this.json.materials.push(m);
    return this.json.materials.length - 1;
  }

  /** A texture whose image is a file beside the .gltf, or with `embed` a view into the buffer. */
  texture(png: Buffer, uri: string | null): number {
    this.json.images ??= [];
    this.json.textures ??= [];
    this.json.samplers ??= [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }];
    this.json.images.push(uri ? { uri } : { bufferView: this.view(png), mimeType: 'image/png' });
    this.json.textures.push({ source: this.json.images.length - 1, sampler: 0 });
    return this.json.textures.length - 1;
  }

  bin(): Buffer {
    const pad = (4 - (this.length % 4)) % 4;
    return Buffer.concat([...this.chunks, Buffer.alloc(pad)]);
  }

  /** One .glb file: header, JSON chunk padded with spaces, binary chunk. */
  glb(): Buffer {
    const bin = this.bin();
    this.json.buffers = [{ byteLength: bin.length }];
    let text = Buffer.from(JSON.stringify(this.json));
    text = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 0x20)]);
    const head = Buffer.alloc(12), jsonHead = Buffer.alloc(8), binHead = Buffer.alloc(8);
    head.writeUInt32LE(0x46546c67, 0);
    head.writeUInt32LE(2, 4);
    head.writeUInt32LE(12 + 8 + text.length + 8 + bin.length, 8);
    jsonHead.writeUInt32LE(text.length, 0);
    jsonHead.writeUInt32LE(0x4e4f534a, 4);
    binHead.writeUInt32LE(bin.length, 0);
    binHead.writeUInt32LE(0x004e4942, 4);
    return Buffer.concat([head, jsonHead, text, binHead, bin]);
  }
}

// --- textures: plain integer patterns, so the files come out the same every time ---
const SIZE = 64;
function picture(pixel: (x: number, y: number) => number[]): Buffer {
  const rgba = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) rgba.set([...pixel(x, y), 255].slice(0, 4), (y * SIZE + x) * 4);
  return encodePng({ width: SIZE, height: SIZE, rgba });
}
/** A small repeatable number 0..255 for a cell, in place of randomness. */
const speck = (a: number, b: number): number => (Math.imul(a * 73856093 ^ b * 19349663, 2654435761) >>> 24);

// Crate: planks inside a darker frame, with a steel bracket in each corner.
const frame = (x: number, y: number): boolean => Math.min(x, y, SIZE - 1 - x, SIZE - 1 - y) < 6;
const bracket = (x: number, y: number): boolean => Math.min(x, SIZE - 1 - x) < 13 && Math.min(y, SIZE - 1 - y) < 13;
const gap = (x: number, y: number): boolean => !frame(x, y) && (y - 6) % 13 === 0;
const crateColor = picture((x, y) => {
  if (bracket(x, y)) return [150, 155, 165];
  if (gap(x, y)) return [58, 38, 22];
  const tone = speck(x >> 2, Math.floor((y - 6) / 13)) % 24;
  return frame(x, y) ? [104 + (tone >> 1), 68, 36] : [164 + tone, 116 + (tone >> 1), 62];
});
// Occlusion in red, roughness in green, metallic in blue: one image for three jobs.
const crateSurface = picture((x, y) => (bracket(x, y) ? [255, 90, 255] : [gap(x, y) ? 120 : 255, frame(x, y) ? 190 : 225, 0]));

// Stone: three courses of blocks, each a slightly different grey, with mortar between.
const course = (y: number): number => y >> 4, block = (x: number, y: number): number => ((x + (course(y) % 2) * 16) % SIZE) >> 5;
const mortar = (x: number, y: number): boolean => y % 16 === 0 || (x + (course(y) % 2) * 16) % 32 === 0;
const height = (x: number, y: number): number => (mortar(x & 63, y & 63) ? 0 : 1);
const stoneColor = picture((x, y) => {
  if (mortar(x, y)) return [70, 68, 64];
  const tone = speck(block(x, y), course(y)) % 40 + (speck(x, y) % 8);
  return [128 + tone, 124 + tone, 114 + tone];
});
// The mortar lines are pressed in: the normal leans away from them.
const stoneNormal = picture((x, y) => {
  const dx = height(x + 1, y) - height(x - 1, y), dy = height(x, y + 1) - height(x, y - 1), l = Math.hypot(dx, dy, 1.4);
  return [Math.round((-dx / l) * 127 + 128), Math.round((-dy / l) * 127 + 128), Math.round((1.4 / l) * 127 + 128)];
});

// --- crate.glb ---
{
  const g = new Gltf(), shape = cube(0.5);
  const color = g.texture(crateColor, null), surface = g.texture(crateSurface, null);
  const material = g.material({
    name: 'crate',
    pbrMetallicRoughness: { baseColorTexture: { index: color }, metallicRoughnessTexture: { index: surface }, metallicFactor: 1, roughnessFactor: 1 },
    occlusionTexture: { index: surface, strength: 0.8 },
  });
  g.node({ name: 'crate', mesh: g.mesh(g.attributes(shape), g.indices(shape.index, 2), material) });
  writeFileSync(OUT + 'crate.glb', g.glb());
}

// --- totem.gltf + totem.bin + totem.png + totem_n.png ---
{
  const g = new Gltf();
  const stone = g.material({
    name: 'stone',
    pbrMetallicRoughness: { baseColorTexture: { index: g.texture(stoneColor, 'totem.png') }, metallicFactor: 0, roughnessFactor: 0.9 },
    normalTexture: { index: g.texture(stoneNormal, 'totem_n.png'), scale: 1 },
  });
  const gold = g.material({ name: 'gold', pbrMetallicRoughness: { baseColorFactor: [1, 0.77, 0.34, 1], metallicFactor: 1, roughnessFactor: 0.3 } });
  const glaze = g.material({ name: 'glaze', pbrMetallicRoughness: { baseColorFactor: [0.1, 0.3, 0.8, 1], metallicFactor: 0, roughnessFactor: 0.15 } });
  const ember = g.material({ name: 'ember', pbrMetallicRoughness: { baseColorFactor: [0.2, 0.05, 0.02, 1], metallicFactor: 0, roughnessFactor: 0.6 }, emissiveFactor: [1, 0.45, 0.1] });

  const pillar = cylinder(0.6, 1, 24), ball = sphere(0.45, 24, 16), ring = torus(0.75, 0.08, 32, 10), gem = octahedron();
  const tilt = (25 * Math.PI) / 360, turn = (20 * Math.PI) / 360;
  const children = [
    g.node({ name: 'pillar', mesh: g.mesh(g.interleaved(pillar), g.indices(pillar.index, 2), stone) }, false),
    g.node({ name: 'orb', translation: [0, 1.55, 0], mesh: g.mesh(g.attributes(ball), g.indices(ball.index, 2), gold) }, false),
    // Tilted, and stretched along one axis only: normals have to follow.
    g.node({ name: 'ring', translation: [0, 1.55, 0], rotation: [Math.sin(tilt), 0, 0, Math.cos(tilt)], scale: [1, 1, 1.3], mesh: g.mesh(g.attributes(ring), g.indices(ring.index, 4), glaze) }, false),
    // Placed by a matrix instead of translation and scale.
    g.node({ name: 'ember', matrix: [0.22, 0, 0, 0, 0, 0.3, 0, 0, 0, 0, 0.22, 0, 0, 2.45, 0, 1], mesh: g.mesh(g.attributes(gem), g.indices(gem.index, 1), ember) }, false),
  ];
  g.node({ name: 'totem', rotation: [0, Math.sin(turn), 0, Math.cos(turn)], children });
  const bin = g.bin();
  g.json.buffers = [{ uri: 'totem.bin', byteLength: bin.length }];
  writeFileSync(OUT + 'totem.gltf', JSON.stringify(g.json, null, 1) + '\n');
  writeFileSync(OUT + 'totem.bin', bin);
  writeFileSync(OUT + 'totem.png', stoneColor);
  writeFileSync(OUT + 'totem_n.png', stoneNormal);
}

// --- orbs.glb: one sphere's data, five materials from rough plastic to polished metal ---
{
  const g = new Gltf(), ball = sphere(0.5, 32, 20);
  const attributes = g.attributes(ball), indices = g.indices(ball.index, 2);
  const looks: [string, number[], number, number][] = [
    ['chalk', [0.7, 0.05, 0.04, 1], 0, 0.9], ['plastic', [0.7, 0.05, 0.04, 1], 0, 0.35], ['lacquer', [0.7, 0.05, 0.04, 1], 0, 0.08],
    ['brushed', [0.9, 0.9, 0.92, 1], 1, 0.55], ['chrome', [0.9, 0.9, 0.92, 1], 1, 0.12],
  ];
  looks.forEach(([name, baseColorFactor, metallicFactor, roughnessFactor], i) => {
    const material = g.material({ name, pbrMetallicRoughness: { baseColorFactor, metallicFactor, roughnessFactor } });
    g.node({ name, translation: [i * 1.25, 0, 0], mesh: g.mesh(attributes, indices, material) });
  });
  writeFileSync(OUT + 'orbs.glb', g.glb());
}
console.log('ok wrote crate.glb totem.gltf totem.bin totem.png totem_n.png orbs.glb');
