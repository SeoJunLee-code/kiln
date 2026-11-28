// The glTF reader, without a browser: containers, accessors, the node tree, materials,
// and what it reports instead of silently dropping.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build, sidecars } from '../src/build.ts';
import { command } from '../src/commands.ts';
import { serve } from '../src/serve.ts';
import { buildModel, loadGltf, poseModel, splitGlb } from '../web/gltf.ts';
import type { Model } from '../web/gltf.ts';

const ex = (name: string): string => fileURLToPath(new URL(`../examples/${name}`, import.meta.url));
const none = async (): Promise<Uint8Array> => { throw new Error('no files here'); };
const f32 = (...v: number[]): Uint8Array => new Uint8Array(new Float32Array(v).buffer);
const b64 = (bytes: Uint8Array): string => `data:application/octet-stream;base64,${Buffer.from(bytes).toString('base64')}`;
const join4 = (...parts: Uint8Array[]): Uint8Array => {
  const out: number[] = [];
  for (const p of parts) { out.push(...p); while (out.length % 4) out.push(0); }
  return new Uint8Array(out);
};
/** Corner k (0..2) of triangle t of a part: position, normal, uv. */
const corner = (m: Model, part: number, t: number, k: number): { p: number[]; n: number[]; uv: number[] } => {
  const d = m.parts[part].data, at = (t * 3 + k) * 8, r = (x: number): number => +x.toFixed(4) + 0;
  return { p: [d[at], d[at + 1], d[at + 2]].map(r), n: [d[at + 3], d[at + 4], d[at + 5]].map(r), uv: [d[at + 6], d[at + 7]].map(r) };
};
/** How many corners have a normal that disagrees with the side their triangle faces. */
const insideOut = (m: Model): number => {
  let bad = 0;
  for (const part of m.parts) for (let t = 0; t < part.data.length; t += 24) {
    const v = (k: number, o: number): number[] => [...part.data.subarray(t + k * 8 + o, t + k * 8 + o + 3)];
    const a = v(0, 0), e1 = v(1, 0).map((x, i) => x - a[i]), e2 = v(2, 0).map((x, i) => x - a[i]);
    const face = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    if (Math.hypot(...face) < 1e-9) continue; // a triangle with no area faces nowhere
    for (let k = 0; k < 3; k++) if (face.reduce((s, x, i) => s + x * v(k, 3)[i], 0) <= 0) bad++;
  }
  return bad;
};

// One triangle in the x/y plane, facing +z, two units wide and four tall.
const TRI = f32(0, 0, 0, 2, 0, 0, 0, 4, 0);
const triJson = (extra: object = {}): any => ({
  asset: { version: '2.0' },
  buffers: [{ byteLength: 36 }],
  bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
  accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
  nodes: [{ mesh: 0 }],
  ...extra,
});

test('gltf: a model is fitted to the unit cube with y turned downward, and keeps facing outward', () => {
  const m = buildModel(triJson(), [TRI], []);
  assert.equal(m.triangles, 1);
  assert.deepEqual(m.size, [2, 4, 0]);
  // glTF's y is up; the simulation's is down. The top corner (y = 4) lands at y = 0.
  // The flat axis sits in the middle. Two corners swap so the triangle still faces +z.
  assert.deepEqual([0, 1, 2].map((k) => corner(m, 0, 0, k).p), [[0, 1, 0.5], [0, 0, 0.5], [1, 1, 0.5]]);
  assert.deepEqual(corner(m, 0, 0, 0).n, [0, 0, 1]);
  assert.equal(insideOut(m), 0);
  assert.deepEqual(m.warnings, []);
  // No material in the file: the glTF default is supplied.
  assert.equal(m.materials.length, 1);
  assert.deepEqual([m.materials[0].color, m.materials[0].metallic, m.materials[0].roughness, m.materials[0].colorTex], [[1, 1, 1, 1], 1, 1, -1]);
});

test('gltf: the same model is read from .glb, from a data URI, and from a file beside the .gltf', async () => {
  const text = Buffer.from(JSON.stringify(triJson()).padEnd(Math.ceil(JSON.stringify(triJson()).length / 4) * 4));
  const head = new Uint32Array([0x46546c67, 2, 12 + 8 + text.length + 8 + 36]);
  const glb = new Uint8Array(Buffer.concat([Buffer.from(head.buffer), Buffer.from(new Uint32Array([text.length, 0x4e4f534a]).buffer), text, Buffer.from(new Uint32Array([36, 0x004e4942]).buffer), Buffer.from(TRI)]));
  assert.deepEqual(splitGlb(glb).json.asset, { version: '2.0' });
  const bytes = (j: any): Uint8Array => new TextEncoder().encode(JSON.stringify(j));
  const inline = triJson(), beside = triJson();
  inline.buffers[0].uri = b64(TRI);
  beside.buffers[0].uri = 'tri.bin';
  const want = Array.from((await loadGltf(glb, none)).parts[0].data);
  assert.deepEqual(Array.from((await loadGltf(bytes(inline), none)).parts[0].data), want);
  assert.deepEqual(Array.from((await loadGltf(bytes(beside), async (uri) => { assert.equal(uri, 'tri.bin'); return TRI; })).parts[0].data), want);

  // What cannot be read says why.
  await assert.rejects(loadGltf(bytes(beside), none), /buffer 'tri\.bin' is missing/);
  await assert.rejects(loadGltf(new TextEncoder().encode('v 0 0 0'), none), /not valid glTF JSON/);
  await assert.rejects(loadGltf(bytes({ asset: { version: '1.0' } }), none), /version 1\.0 is not supported/);
  await assert.rejects(loadGltf(glb.subarray(0, glb.length - 8), none), /cut short/);
  const short = triJson();
  short.accessors[0].count = 4;
  assert.throws(() => buildModel(short, [TRI], []), /reads past the end/);
});

test('gltf: node transforms nest, and a mirrored node does not turn its triangles inside out', () => {
  // A parent that doubles and moves; a child that turns a quarter about z and mirrors x.
  const s = Math.SQRT1_2;
  const json = triJson({
    nodes: [{ children: [1], scale: [2, 2, 2], translation: [10, 0, 0] }, { mesh: 0, rotation: [0, 0, s, s] }, { mesh: 0, scale: [-1, 1, 1], translation: [0, 0, 5] }],
    scenes: [{ nodes: [0, 2] }],
  });
  json.accessors.push({ bufferView: 1, componentType: 5126, count: 3, type: 'VEC3' });
  json.bufferViews.push({ buffer: 0, byteOffset: 36, byteLength: 36 });
  json.meshes[0].primitives[0].attributes.NORMAL = 1;
  const m = buildModel(json, [join4(TRI, f32(0, 0, 1, 0, 0, 1, 0, 0, 1))], []);
  assert.equal(m.triangles, 2);
  // Turned and doubled, the first triangle spans x 2..10 (it now points along -x and +y);
  // the mirrored one spans x -2..0 at z 5.
  assert.deepEqual(m.size.map((x) => +x.toFixed(6)), [12, 4, 5]);
  assert.equal(insideOut(m), 0);
  assert.deepEqual([corner(m, 0, 0, 0).n, corner(m, 0, 1, 0).n], [[0, 0, 1], [0, 0, 1]]);
});

test('gltf: strides, index widths, normalized integers, strips and fans', () => {
  // A unit square as 4 vertices woven with uv (stride 20), uv as normalized 16-bit after the floats.
  const quad = new Uint8Array(4 * 20), view = new DataView(quad.buffer);
  [[0, 0], [1, 0], [0, 1], [1, 1]].forEach(([x, y], i) => {
    view.setFloat32(i * 20, x, true);
    view.setFloat32(i * 20 + 4, y, true);
    view.setUint16(i * 20 + 12, x * 65535, true);
    view.setUint16(i * 20 + 14, y * 65535, true);
  });
  const build = (mode: number, indices: number[] | null, width = 1): Model => {
    const idx = indices && (width === 1 ? new Uint8Array(indices) : width === 2 ? new Uint8Array(new Uint16Array(indices).buffer) : new Uint8Array(new Uint32Array(indices).buffer));
    return buildModel({
      asset: { version: '2.0' },
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 80, byteStride: 20 }, { buffer: 0, byteOffset: 80, byteLength: idx?.length ?? 0 }],
      accessors: [
        { bufferView: 0, byteOffset: 0, componentType: 5126, count: 4, type: 'VEC3' },
        { bufferView: 0, byteOffset: 12, componentType: 5123, normalized: true, count: 4, type: 'VEC2' },
        { bufferView: 1, componentType: width === 1 ? 5121 : width === 2 ? 5123 : 5125, count: indices?.length ?? 0, type: 'SCALAR' },
      ],
      meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, mode, ...(indices ? { indices: 2 } : {}) }] }],
      nodes: [{ mesh: 0 }],
    }, [join4(quad, idx ?? new Uint8Array(0))], []);
  };
  for (const width of [1, 2, 4]) {
    const m = build(4, [0, 1, 2, 2, 1, 3], width);
    assert.equal(m.triangles, 2, `indices of ${width} bytes`);
    assert.equal(insideOut(m), 0);
    // The corner at (1, 1) carries uv (1, 1), read from the 16-bit pair.
    const corners = [0, 1].flatMap((t) => [0, 1, 2].map((k) => corner(m, 0, t, k)));
    assert.deepEqual(corners.find((c) => c.p[0] === 1 && c.p[1] === 0)!.uv, [1, 1]);
  }
  const strip = build(5, null), fan = build(6, [0, 1, 3, 2]);
  assert.deepEqual([strip.triangles, fan.triangles, insideOut(strip), insideOut(fan)], [2, 2, 0, 0]);
  assert.deepEqual(build(1, null).warnings, ['points and lines are not drawn', 'has no triangles to draw']);
});

test('gltf: materials keep their factors and textures, and what is left out is said', () => {
  const png = new Uint8Array([1, 2, 3]);
  const m = buildModel(triJson({
    extensionsUsed: ['KHR_materials_clearcoat', 'KHR_draco_mesh_compression'], extensionsRequired: ['KHR_draco_mesh_compression'],
    images: [{ uri: 'a.png' }],
    samplers: [{ wrapS: 33071, wrapT: 33648, magFilter: 9728 }],
    textures: [{ source: 0, sampler: 0 }, { source: 7 }],
    materials: [{
      pbrMetallicRoughness: { baseColorFactor: [0.5, 0.25, 1, 1], metallicFactor: 0.2, roughnessFactor: 0.7, baseColorTexture: { index: 0 }, metallicRoughnessTexture: { index: 1 } },
      normalTexture: { index: 0, scale: 2 }, emissiveFactor: [1, 0, 0], alphaMode: 'MASK',
    }, { alphaMode: 'BLEND' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }, { attributes: { POSITION: 0 }, material: 1 }] }],
  }), [TRI], [{ mime: 'image/png', bytes: png }]);
  const a = m.materials[0];
  assert.deepEqual([a.color, a.metallic, a.roughness, a.emissive, a.cutoff, a.normalScale], [[0.5, 0.25, 1, 1], 0.2, 0.7, [1, 0, 0], 0.5, 2]);
  // The second texture points at an image that is not there, so that slot is empty.
  assert.deepEqual([a.colorTex, a.normalTex, a.surfaceTex, a.occlusionTex], [0, 0, -1, -1]);
  assert.deepEqual(m.textures[0], { image: 0, wrapS: 'clamp-to-edge', wrapT: 'mirror-repeat', smooth: false });
  assert.deepEqual(m.parts.map((p) => p.material), [0, 1]);
  assert.deepEqual(m.warnings, [
    'requires extension KHR_draco_mesh_compression, which is not supported: the model may be wrong or empty',
    'uses extension KHR_materials_clearcoat, which is ignored',
    'a metallic-roughness texture has no image this reader can use',
    'alphaMode BLEND is drawn opaque',
  ]);
});

test('gltf: the example models load whole, with nothing left out', async () => {
  const load = (name: string): Promise<Model> => loadGltf(new Uint8Array(readFileSync(ex(name))), async (uri) => new Uint8Array(readFileSync(ex(uri))));
  const crate = await load('crate.glb'), totem = await load('totem.gltf'), orbs = await load('orbs.glb');
  for (const [name, m] of [['crate', crate], ['totem', totem], ['orbs', orbs]] as const) {
    assert.deepEqual(m.warnings, [], name);
    assert.equal(insideOut(m), 0, name);
  }
  assert.deepEqual([crate.triangles, crate.parts.length, crate.images.length, crate.size], [12, 1, 2, [1, 1, 1]]);
  // One image does three jobs in the crate: occlusion, roughness and metallic.
  assert.deepEqual([crate.materials[0].colorTex, crate.materials[0].surfaceTex, crate.materials[0].occlusionTex, crate.materials[0].occlusionStrength], [0, 1, 1, 0.8]);
  // The totem is four nodes under a turned parent: woven vertices, three index widths, a matrix, no normals on the ember.
  assert.deepEqual([totem.triangles, totem.parts.length, totem.images.length], [1464, 4, 2]);
  assert.deepEqual([totem.materials[0].normalTex, totem.materials[3].emissive], [1, [1, 0.45, 0.1]]);
  assert.ok(Math.abs(totem.size[1] - 2.75) < 1e-6, `totem height ${totem.size[1]}`);
  // Five spheres share one set of vertices and differ only in material.
  assert.deepEqual([orbs.triangles, orbs.parts.length, orbs.size.map((x) => +x.toFixed(4))], [6080, 5, [6, 1, 1]]);
  assert.deepEqual(orbs.materials.map((x) => [x.metallic, x.roughness]), [[0, 0.9], [0, 0.35], [0, 0.08], [1, 0.55], [1, 0.12]]);
});

test('check: a model that cannot be read, or loses something, is a warning', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kiln-gltf-'));
  const scene = (mesh: string): string => `entity a\n  pos 0 0 0\n  box 1 1 1\n  vel\n  ctrl 3\n  eye 0 -3 4\n  sprite mesh=${mesh}\n  trigger a go\nexpect event go by 9\n`;
  const beside = triJson({ materials: [{ alphaMode: 'BLEND' }], meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }] });
  beside.buffers[0].uri = 'gone.bin';
  writeFileSync(join(dir, 'broken.gltf'), JSON.stringify(beside));
  writeFileSync(join(dir, 'broken.kiln'), scene('broken.gltf'));
  const broken = await command('check', { file: join(dir, 'broken.kiln') });
  assert.match(broken.text, /^W K315 .*mesh 'broken\.gltf' cannot be read: buffer 'gone\.bin' is missing$/m);

  beside.buffers[0].uri = b64(TRI);
  writeFileSync(join(dir, 'partly.gltf'), JSON.stringify(beside));
  writeFileSync(join(dir, 'partly.kiln'), scene('partly.gltf'));
  const partly = await command('check', { file: join(dir, 'partly.kiln') });
  assert.match(partly.text, /^W K315 .*mesh 'partly\.gltf': alphaMode BLEND is drawn opaque$/m);
  assert.match(partly.text, /warnings=1$/m);
});

// Files another tool wrote: Godot's exporter, run on scripts/godot/export.gd.
const godot = (name: string): string => ex(`godot/${name}`);
const beside = async (uri: string): Promise<Uint8Array> => new Uint8Array(readFileSync(godot(uri)));

test('gltf: files exported by Godot load, with the texture from its subfolder', async () => {
  const props = await loadGltf(new Uint8Array(readFileSync(godot('props.gltf'))), beside);
  assert.equal(props.triangles, 268);
  assert.equal(props.materials.length, 3);
  assert.equal(props.images.length, 1);
  assert.equal(props.materials[0].colorTex, 0);
  // The mirrored spike keeps facing outward like the rest.
  assert.equal(insideOut(props), 0);
  assert.deepEqual(props.warnings, []);
  const bend = await loadGltf(new Uint8Array(readFileSync(ex('bend.glb'))), none);
  assert.equal(bend.triangles, 48);
  assert.equal(insideOut(bend), 0);
});

test('gltf: what a model names beside itself is built and served; nothing else in a subfolder is', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kiln-side-'));
  mkdirSync(join(dir, 'textures'));
  for (const f of ['props.gltf', 'props0.bin', 'textures/_albedo.png']) writeFileSync(join(dir, f), readFileSync(godot(f)));
  writeFileSync(join(dir, 'textures', 'other.png'), 'not named by the model');
  writeFileSync(join(dir, 'scene.kiln'), 'world hz=60\n\nentity cam\n  pos 0 0 0\n  box 1 1 1\n  eye 0 -2 4\n\nentity thing\n  pos 2 0 0\n  box 1 1 1\n  sprite mesh=props.gltf\n');
  const out = join(dir, 'out');
  const { written } = build(join(dir, 'scene.kiln'), out);
  assert.ok(written.includes('game/textures/_albedo.png'));
  assert.ok(!written.includes('game/textures/other.png'));
  const server = await serve(join(dir, 'scene.kiln'), undefined, 0);
  try {
    const get = async (path: string): Promise<number> => (await fetch(`http://127.0.0.1:${server.port}/game/${path}`)).status;
    assert.equal(await get('textures%2F_albedo.png'), 200);
    assert.equal(await get('textures/_albedo.png'), 200);
    assert.equal(await get('textures/other.png'), 403);
  } finally { server.close(); }
  assert.deepEqual(sidecars('a.gltf', new TextEncoder().encode(JSON.stringify({ buffers: [{ uri: '../out.bin' }, { uri: '.hidden/x.bin' }, { uri: 'file:x.bin' }], images: [{ uri: 'notes.txt' }, { uri: 'ok%20one.png' }] }))),
    { files: ['ok one.png'], refused: ['../out.bin', '.hidden/x.bin', 'file:x.bin', 'notes.txt'] });
});

// Where the vertices of a posed model are, as [x, y] of the fitted cube, for the part that
// was the given material; y points down, so the top of the model is y = 0.
const posed = (m: Model, clip: string, seconds: number, loop = true): Float32Array[] => {
  const out = m.parts.map((p) => new Float32Array(p.data.length));
  assert.ok(poseModel(m, clip, seconds, loop, out), clip);
  return out;
};
const range = (data: Float32Array, axis: number, of: (y: number) => boolean = () => true): number[] => {
  const v: number[] = [];
  for (let i = 0; i < data.length; i += 8) if (of(data[i + 1])) v.push(data[i + axis]);
  return [Math.min(...v), Math.max(...v)].map((x) => +x.toFixed(3) + 0);
};

test('gltf: a skin bends and a node moves as the animations say, and the rest pose is what loads', async () => {
  const m = await loadGltf(new Uint8Array(readFileSync(ex('bend.glb'))), none);
  assert.deepEqual(m.clips.map((c) => [c.name, c.duration]), [['bend', 1], ['wave', 2]]);
  assert.deepEqual(m.warnings, []);
  // The bar is the first part (blue), the flag the second.
  const bar = m.parts[0].data;
  // At time 0 both animations are the rest pose.
  assert.deepEqual([...posed(m, 'bend', 0)[0]].map((x) => +x.toFixed(4) + 0), [...bar].map((x) => +x.toFixed(4) + 0));
  // A quarter in, the upper bone has turned: the top of the bar leans to one side, the foot has not moved.
  const [lean] = [posed(m, 'bend', 0.25)[0]];
  const foot = (y: number): boolean => y > 0.999;
  assert.deepEqual(range(lean, 0, foot), range(bar, 0, foot));
  assert.ok(range(lean, 0)[0] < range(bar, 0)[0] - 0.2, `leans left: ${range(lean, 0)} from ${range(bar, 0)}`);
  // Three quarters in it leans the other way, and a second later it is where it was.
  assert.ok(range(posed(m, 'bend', 0.75)[0], 0)[1] > range(bar, 0)[1] + 0.2);
  assert.deepEqual(posed(m, 'bend', 1.25)[0], posed(m, 'bend', 0.25)[0]);
  // Normals stay unit length through the bend.
  for (let i = 0; i < lean.length; i += 8) assert.ok(Math.abs(Math.hypot(lean[i + 3], lean[i + 4], lean[i + 5]) - 1) < 1e-4);
  // The flag rises by 1.2 of the model's 2 units of height in the first second; the cube was fitted to the rest pose.
  const rise = range(m.parts[1].data, 1)[0] - range(posed(m, 'wave', 1)[1], 1)[0];
  assert.ok(Math.abs(rise - 1.2 / m.size[1]) < 1e-4, `rise ${rise}`);
  // Without looping the last frame is held; looping, 2 seconds is the start again.
  assert.deepEqual(posed(m, 'wave', 9, false)[1], posed(m, 'wave', 2, false)[1]);
  assert.deepEqual(posed(m, 'wave', 3)[1], posed(m, 'wave', 1)[1]);
  assert.equal(poseModel(m, 'dance', 0, true, []), false);
});

test('gltf: step and cubic keys', () => {
  // One triangle moved along x by an animation on its node: keys at 0 and 1 s, at x = 0 and 2.
  const move = (interpolation: string, values: number[]): Model => {
    const times = f32(0, 1), out = f32(...values);
    return buildModel(triJson({
      buffers: [{ byteLength: 36 }, { byteLength: 8 }, { byteLength: out.length }],
      bufferViews: [{ buffer: 0, byteLength: 36 }, { buffer: 1, byteLength: 8 }, { buffer: 2, byteLength: out.length }],
      accessors: [
        { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
        { bufferView: 1, componentType: 5126, count: 2, type: 'SCALAR' },
        { bufferView: 2, componentType: 5126, count: values.length / 3, type: 'VEC3' },
      ],
      animations: [{ samplers: [{ input: 1, output: 2, interpolation }], channels: [{ sampler: 0, target: { node: 0, path: 'translation' } }] }],
    }), [TRI, times, out], []);
  };
  // The model is 2 wide, so a move of 2 is 1 in the fitted cube.
  const left = (m: Model, seconds: number): number => range(posed(m, '0', seconds, false)[0], 0)[0];
  const line = move('LINEAR', [0, 0, 0, 2, 0, 0]), step = move('STEP', [0, 0, 0, 2, 0, 0]);
  assert.deepEqual([left(line, 0.25), left(step, 0.25), left(step, 1)], [0.25, 0, 1]);
  // Cubic with flat tangents is the smooth step: 3t^2 - 2t^3.
  const cubic = move('CUBICSPLINE', [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0]);
  assert.deepEqual([left(cubic, 0.25), left(cubic, 0.5)], [0.156, 0.5]);
});

test('check: a clip the model does not have is said', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kiln-clip-'));
  writeFileSync(join(dir, 'bend.glb'), readFileSync(ex('bend.glb')));
  const scene = (clip: string, mesh = ' mesh=bend.glb'): string => `entity a\n  pos 0 0 0\n  box 1 2 1\n  eye 0 -3 4\n  sprite${mesh}\n  clip ${clip}\n`;
  const run = async (text: string): Promise<string> => {
    writeFileSync(join(dir, 's.kiln'), text);
    return (await command('check', { file: join(dir, 's.kiln') })).text;
  };
  const fine = await run(scene('wave'));
  assert.match(fine, /edition=standard/);
  assert.doesNotMatch(fine, /K315/);
  assert.match(await run(scene('dance')), /^W K315 .*mesh 'bend\.glb' has no animation 'dance' \(it has: bend, wave\)$/m);
  assert.match(await run(scene('wave', '')), /^W K315 .*'clip' on 'a' needs a glTF mesh$/m);
});
