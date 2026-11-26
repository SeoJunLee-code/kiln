// What the player does in a real browser. These ran by hand before; here a headless
// Chrome does them on every push. Without a browser on the machine they are skipped.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { findChrome, launch } from '../src/chrome.ts';
import type { Browser } from '../src/chrome.ts';
import { GPU_SWITCHES, look, openPlayer } from '../src/look.ts';
import { compare, decodePng, encodePng, summarize } from '../src/png.ts';

const ex = (name: string): string => fileURLToPath(new URL(`../examples/${name}`, import.meta.url));
const skip = findChrome() ? false : 'no Chrome or Edge on this machine';
let browser: Browser;
before(async () => { if (!skip) browser = await launch({ args: GPU_SWITCHES }); });
after(async () => { if (!skip) await browser.close(); });

test('png: a picture survives encode and decode, and compare counts what changed', () => {
  const rgba = new Uint8Array(4 * 3 * 4);
  for (let i = 0; i < rgba.length; i++) rgba[i] = (i * 37) & 255;
  const a = { width: 4, height: 3, rgba };
  const b = decodePng(encodePng(a));
  assert.deepEqual([b.width, b.height, Array.from(b.rgba)], [4, 3, Array.from(rgba)]);
  assert.deepEqual(compare(a, b), { sameSize: true, changed: 0, worst: 0 });

  const moved = { width: 4, height: 3, rgba: rgba.slice() };
  moved.rgba[0] += 5;   // inside the tolerance
  moved.rgba[4] += 40;  // outside it
  assert.deepEqual(compare(a, moved), { sameSize: true, changed: 1 / 12, worst: 40 });
  assert.equal(compare(a, { width: 3, height: 4, rgba }).sameSize, false);

  const flat = { width: 2, height: 2, rgba: new Uint8Array(16).fill(20) };
  assert.equal(summarize(flat).box, null);
});

test('browser: every example replays to the same hash as headless', { skip }, async () => {
  for (const line of readFileSync(ex('HASHES'), 'utf8').trim().split('\n')) {
    const [, scene, tick, hash] = /^(\S+) tick=(\d+) hash=(\w+)/.exec(line)!;
    const player = await openPlayer(ex(scene), { inputFile: ex(scene.replace(/\.kiln$/, '.input')), browser });
    try {
      assert.equal(await player.page.eval(`kiln.runTo(${tick})`), hash, scene);
      assert.deepEqual(player.page.errors(), [], scene);
    } finally { await player.close(); }
  }
});

test('browser: a 2D scene is drawn, and look reports what is in the frame', { skip }, async () => {
  const seen = await look(ex('maze.kiln'), { browser });
  const s = summarize(seen.picture);
  assert.equal(seen.renderer, '2d');
  assert.ok(s.drawn > 0.1 && s.drawn < 0.9, `drawn ${s.drawn}`);
  assert.ok(s.colors >= 4, `colors ${s.colors}`);
  assert.deepEqual(seen.errors, []);
});

test('browser: WebGPU is the 3D renderer when the browser has it, and draws what WebGL2 draws', { skip }, async () => {
  const at = { tick: 120, inputFile: ex('arena3d.input'), browser };
  const chosen = await look(ex('arena3d.kiln'), at);
  const gl = await look(ex('arena3d.kiln'), { ...at, query: 'renderer=webgl2' });
  assert.equal(gl.renderer, 'webgl2');
  assert.deepEqual(gl.errors, []);
  if (chosen.renderer !== 'webgpu') return; // this browser has no WebGPU; the fallback was just checked
  assert.deepEqual(chosen.errors, []);
  // Same scene, same camera, same lighting model: only edge pixels may differ.
  const d = compare(gl.picture, chosen.picture);
  assert.ok(d.sameSize && d.changed < 0.01, `WebGPU differs from WebGL2 in ${(d.changed * 100).toFixed(2)}% of pixels`);
});

// Checks take their pictures from a texture. This one covers what a player sees instead:
// the WebGPU canvas itself has to show that same frame.
const noCanvas = process.platform === 'linux' && 'presenting a WebGPU canvas loses the device under software rendering on Linux';
test('browser: the WebGPU canvas shows the frame that checks read', { skip: skip || noCanvas }, async () => {
  const player = await openPlayer(ex('arena3d.kiln'), { inputFile: ex('arena3d.input'), browser, onscreen: true, query: 'renderer=webgpu' });
  try {
    const shots = await player.page.eval<{ renderer: string; canvas: string; read: string }>(`(async () => {
      const first = await kiln.shot();
      kiln.runTo(120);
      const canvas = document.getElementById('view3d').toDataURL('image/png');
      return { renderer: first.renderer, canvas, read: (await kiln.shot()).png };
    })()`);
    if (shots.renderer !== 'webgpu') return; // no WebGPU here
    const png = (url: string) => decodePng(Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
    const d = compare(png(shots.canvas), png(shots.read));
    assert.ok(d.sameSize && d.changed < 0.001, `canvas and texture differ in ${(d.changed * 100).toFixed(2)}% of pixels`);
    assert.deepEqual(player.page.errors(), []);
  } finally { await player.close(); }
});

for (const renderer of ['webgl2', 'webgpu']) test(`browser: a 3D scene is drawn by ${renderer}, with its meshes`, { skip }, async () => {
  const seen = await look(ex('arena3d.kiln'), { browser, query: `renderer=${renderer}` });
  // Asking for a renderer the browser lacks leaves the 2D view; nothing to check then.
  if (seen.renderer !== renderer) return;
  assert.ok(summarize(seen.picture).drawn > 0.1);
  assert.deepEqual(seen.errors, []);

  // A mesh that fails to draw falls back to its box. The gem and the spire are meshes and
  // are in view by tick 120 of the recorded run, so the frame has to change without them.
  const player = await openPlayer(ex('arena3d.kiln'), { inputFile: ex('arena3d.input'), browser, query: `renderer=${renderer}` });
  try {
    const shots = await player.page.eval<{ mesh: string; box: string }>(`(async () => {
      kiln.runTo(120);
      const mesh = (await kiln.shot()).png;
      for (const id of kiln.world.query('sprite')) kiln.world.get(id, 'sprite').mesh = '';
      return { mesh, box: (await kiln.shot()).png };
    })()`);
    const png = (url: string) => decodePng(Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
    assert.ok(compare(png(shots.mesh), png(shots.box)).changed > 0.001, 'meshes made no difference to the frame');
  } finally { await player.close(); }
});

test('browser: labels are drawn', { skip }, async () => {
  const player = await openPlayer(ex('level1.kiln'), { browser });
  try {
    const shots = await player.page.eval<{ on: string; off: string }>(`(async () => {
      const on = (await kiln.shot()).png;
      for (const id of kiln.world.query('label')) kiln.world.get(id, 'label').text = '';
      return { on, off: (await kiln.shot()).png };
    })()`);
    const png = (url: string) => decodePng(Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
    assert.ok(compare(png(shots.on), png(shots.off)).changed > 0.001, 'labels made no difference to the frame');
  } finally { await player.close(); }
});

test('browser: touch buttons become input, and each event asks for a tone', { skip }, async () => {
  const player = await openPlayer(ex('maze.kiln'), { browser, query: 'pad' });
  try {
    const log = await player.page.eval<string>(`(() => {
      const button = document.querySelector('#pad button[data-action="right"]');
      if (document.getElementById('pad').hidden || !button) return 'pad is hidden';
      button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      kiln.runTo(5);
      button.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      return kiln.inputLog();
    })()`);
    assert.equal(log, '0 right down\n5 right up');
  } finally { await player.close(); }

  const replay = await openPlayer(ex('level1.kiln'), { inputFile: ex('level1.input'), browser });
  try {
    const counts = await replay.page.eval<{ beeps: number; events: number }>(`(() => { kiln.runTo(600); return { beeps: kiln.beeps(), events: kiln.world.events.length }; })()`);
    assert.ok(counts.events > 0, 'the replay raised no events');
    assert.equal(counts.beeps, counts.events);
  } finally { await replay.close(); }
});

test('mcp: look answers with a line of text and the picture itself', { skip }, async () => {
  const child = spawn(process.execPath, [fileURLToPath(new URL('../src/cli.ts', import.meta.url)), 'mcp'], { stdio: ['pipe', 'pipe', 'inherit'] });
  try {
    const reply = new Promise<any>((done) => {
      let seen = '';
      child.stdout.on('data', (chunk) => {
        seen += chunk;
        const end = seen.indexOf('\n');
        if (end >= 0) done(JSON.parse(seen.slice(0, end)));
      });
    });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'kiln', arguments: { cmd: 'look', file: ex('maze.kiln'), ticks: 10 } } }) + '\n');
    const { result } = await reply;
    assert.match(result.content[0].text, /^ok look maze\.kiln tick=10 hash=\w+ renderer=2d size=\d+x\d+\ndrawn /);
    assert.equal(result.content[1].mimeType, 'image/png');
    assert.ok(decodePng(Buffer.from(result.content[1].data, 'base64')).width > 100);
  } finally { child.kill(); }
});

test('browser: a load trigger opens the next level', { skip }, async () => {
  const player = await openPlayer(ex('level1.kiln'), { inputFile: ex('level1.input'), browser });
  try {
    await player.page.eval('kiln.runTo(600)');
    let where = '';
    for (let i = 0; i < 50 && !where.includes('level2.kiln'); i++) {
      await new Promise((r) => setTimeout(r, 100));
      try { where = await player.page.eval<string>('location.search'); } catch { /* the page is navigating */ }
    }
    assert.match(where, /scene=level2\.kiln/);
  } finally { await player.close(); }
});

test('browser: rotation changes what is drawn, in 2D and by WebGPU', { skip }, async () => {
  for (const [scene, query, renderer] of [['windmill', '', '2d'], ['orrery3d', 'renderer=webgpu', 'webgpu']]) {
    const player = await openPlayer(ex(`${scene}.kiln`), { inputFile: ex(`${scene}.input`), browser, query });
    try {
      const shots = await player.page.eval<{ renderer: string; turned: string; flat: string }>(`(async () => {
        kiln.runTo(100);
        const first = await kiln.shot();
        for (const c of ['rot', 'quat']) for (const id of kiln.world.query(c)) kiln.world.comps.get(c).delete(id);
        return { renderer: first.renderer, turned: first.png, flat: (await kiln.shot()).png };
      })()`);
      if (shots.renderer !== renderer) continue; // no WebGPU in this browser
      const png = (url: string) => decodePng(Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
      assert.ok(compare(png(shots.turned), png(shots.flat)).changed > 0.01, `${scene}: turning made no difference to the frame`);
      assert.deepEqual(player.page.errors(), [], scene);
    } finally { await player.close(); }
  }
});

test('browser: glTF models are drawn by WebGPU with their materials, and as boxes by WebGL2', { skip }, async () => {
  const at = { tick: 10, inputFile: ex('gallery3d.input'), browser };
  const boxes = await look(ex('gallery3d.kiln'), { ...at, query: 'renderer=webgl2' });
  assert.equal(boxes.renderer, 'webgl2');
  assert.deepEqual(boxes.errors, []);
  const player = await openPlayer(ex('gallery3d.kiln'), { ...at, query: 'renderer=webgpu' });
  try {
    const shots = await player.page.eval<{ renderer: string; models: string; plain: string }>(`(async () => {
      kiln.runTo(10);
      const first = await kiln.shot();
      for (const id of kiln.world.query('sprite')) kiln.world.get(id, 'sprite').mesh = '';
      return { renderer: first.renderer, models: first.png, plain: (await kiln.shot()).png };
    })()`);
    if (shots.renderer !== 'webgpu') return; // no WebGPU in this browser
    assert.deepEqual(player.page.errors(), []);
    const png = (url: string) => decodePng(Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
    const models = png(shots.models), plain = png(shots.plain);
    assert.ok(compare(models, plain).changed > 0.03, 'the models made no difference to the frame');
    // Textures and highlights give many more distinct colors than flat-shaded boxes have.
    assert.ok(summarize(models).colors > summarize(plain).colors * 2, `colors ${summarize(models).colors} with models, ${summarize(plain).colors} without`);
  } finally { await player.close(); }
});

test('browser: a built folder plays a physics scene and a glTF scene from a plain static host', { skip }, async () => {
  const { build } = await import('../src/build.ts');
  const { run } = await import('../src/run.ts');
  const { loadBackend } = await import('../src/physics.ts');
  const { createServer } = await import('node:http');
  const { existsSync, mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join, extname } = await import('node:path');
  if (!existsSync(ex('../backends/rapier/node_modules'))) return; // the optional backend is not installed
  const out = mkdtempSync(join(tmpdir(), 'kiln-site-'));
  build(ex('tumble3d.kiln'), out);
  // A host that knows nothing about Kiln: files by extension, under a sub-path as on a project page.
  const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url!, 'http://x').pathname).replace(/^\/site\//, '').replace(/\.\./g, '') || 'index.html';
    try {
      const body = readFileSync(join(out, path));
      res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' });
      res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const port = (server.address() as import('node:net').AddressInfo).port;
  try {
    await loadBackend('rapier');
    for (const scene of ['tumble3d.kiln', 'gallery3d.kiln']) {
      const page = await browser.open(`http://127.0.0.1:${port}/site/?paused&offscreen&scene=${scene}`, { width: 960, height: 600 });
      const got = await page.eval<{ hash: string; renderer: string }>(`(async () => {
        for (let i = 0; i < 500 && !window.kiln; i++) await new Promise((r) => setTimeout(r, 20));
        const hash = kiln.runTo(90);
        return { hash, renderer: (await kiln.shot()).renderer };
      })()`);
      // No recorded input in a built folder, so the comparison is with a headless run that presses nothing.
      assert.equal(got.hash, run(readFileSync(ex(scene), 'utf8'), { ticks: 90 }).hash, scene);
      assert.deepEqual(page.errors(), [], scene);
    }
  } finally { server.close(); server.closeAllConnections(); }
});
