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

test('browser: painted tiles are drawn in their colors and images, in 2D and as colors in 3D', { skip }, async () => {
  const png = (url: string) => decodePng(Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
  // Share of the picture within a little of one color.
  const share = (p: { width: number; height: number; rgba: Uint8Array }, [r, g, b]: number[]): number => {
    let n = 0;
    for (let i = 0; i < p.rgba.length; i += 4) if (Math.abs(p.rgba[i] - r) < 6 && Math.abs(p.rgba[i + 1] - g) < 6 && Math.abs(p.rgba[i + 2] - b) < 6) n++;
    return n / (p.width * p.height);
  };
  const seen = await look(ex('garden.kiln'), { browser });
  assert.deepEqual(seen.errors, []);
  // The map is 12 cells wide: 8 of them are water (steelblue), 2 bridge (peru), 34 hedge, and 40 grass
  // (an image, mostly one green), four of those under the hero and the flowers.
  const box = summarize(seen.picture).box!, cell = ((box.x1 - box.x0 + 1) / 12) ** 2 / (seen.picture.width * seen.picture.height);
  for (const [name, color, cells] of [['water', [70, 130, 180], 8], ['bridge', [205, 133, 63], 2], ['hedge', [0x2f, 0x6f, 0x4f], 34], ['grass', [0x3f, 0x8f, 0x4a], 35]] as const) {
    const got = share(seen.picture, [...color]) / cell;
    assert.ok(got > cells * 0.9 && got < cells * 1.1, `${name}: ${got.toFixed(1)} cells of its color, expected about ${cells}`);
  }
  assert.equal(share(seen.picture, [0x3a, 0x40, 0x4b]), 0, 'a cell kept the unpainted wall color');

  for (const renderer of ['webgl2', 'webgpu']) {
    const player = await openPlayer(ex('crypt3d.kiln'), { browser, query: `renderer=${renderer}` });
    try {
      const shots = await player.page.eval<{ renderer: string; plain: string; red: string }>(`(async () => {
        const plain = await kiln.shot();
        for (const id of kiln.world.query('tiles')) kiln.world.get(id, 'tiles').paint = '#:red';
        return { renderer: plain.renderer, plain: plain.png, red: (await kiln.shot()).png };
      })()`);
      if (shots.renderer !== renderer) continue; // this browser lacks it
      const plain = png(shots.plain), red = png(shots.red);
      const reddish = (p: typeof red): number => {
        let n = 0;
        for (let i = 0; i < p.rgba.length; i += 4) if (p.rgba[i] > 90 && p.rgba[i] > 3 * p.rgba[i + 1] && p.rgba[i] > 3 * p.rgba[i + 2]) n++;
        return n / (p.width * p.height);
      };
      assert.ok(reddish(red) > 0.05 && reddish(plain) < 0.005, `${renderer}: red walls cover ${reddish(red).toFixed(3)} of the frame (unpainted ${reddish(plain).toFixed(3)})`);
    } finally { await player.close(); }
  }
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

// A host that knows nothing about Kiln: files by extension, under a sub-path as on a project page.
async function host(out: string): Promise<{ url: string; close: () => void }> {
  const { createServer } = await import('node:http');
  const { join, extname } = await import('node:path');
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
  return { url: `http://127.0.0.1:${port}/site/`, close: () => { server.close(); server.closeAllConnections(); } };
}
// Run a built scene to tick 90 with nothing pressed (a built folder has no recorded input).
const PLAY = `(async () => {
  for (let i = 0; i < 500 && !window.kiln; i++) await new Promise((r) => setTimeout(r, 20));
  const hash = kiln.runTo(90);
  return { hash, renderer: (await kiln.shot()).renderer };
})()`;

test('browser: a built folder plays a physics scene and a glTF scene from a plain static host', { skip }, async () => {
  const { build } = await import('../src/build.ts');
  const { run } = await import('../src/run.ts');
  const { loadBackend } = await import('../src/physics.ts');
  const { existsSync, mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  if (!existsSync(ex('../backends/rapier/node_modules'))) return; // the optional backend is not installed
  const out = mkdtempSync(join(tmpdir(), 'kiln-site-'));
  build(ex('tumble3d.kiln'), out);
  const site = await host(out);
  try {
    await loadBackend('rapier');
    for (const scene of ['tumble3d.kiln', 'gallery3d.kiln']) {
      const page = await browser.open(`${site.url}?paused&offscreen&scene=${scene}`, { width: 960, height: 600 });
      const got = await page.eval<{ hash: string; renderer: string }>(PLAY);
      assert.equal(got.hash, run(readFileSync(ex(scene), 'utf8'), { ticks: 90 }).hash, scene);
      assert.deepEqual(page.errors(), [], scene);
    }
  } finally { site.close(); }
});

// Rules 2 and 4 of docs/EDITIONS.md together: a game is built with only the parts it uses,
// and what is left out changes nothing it computes. A part that a scene asks for and the
// build does not have is reported, not skipped in silence.
test('browser: Lite games built without the parts they do not use reach the same hash', { skip }, async () => {
  const { build } = await import('../src/build.ts');
  const { run } = await import('../src/run.ts');
  const { copyFileSync, existsSync, mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const game = (files: string[]): string => {
    const dir = mkdtempSync(join(tmpdir(), 'kiln-game-'));
    for (const f of files) copyFileSync(ex(f), join(dir, f));
    return dir;
  };
  const flat = game(['platformer.kiln', 'arena3d.kiln', 'gem.obj']), flatOut = mkdtempSync(join(tmpdir(), 'kiln-site-'));
  // Built from a folder whose only scene with `eye` is hidden from the build, so the 3D scene meets a build with no renderer.
  const two = game(['platformer.kiln']), twoOut = mkdtempSync(join(tmpdir(), 'kiln-site-'));
  assert.deepEqual(build(join(two, 'platformer.kiln'), twoOut).parts, []);
  assert.ok(!existsSync(join(twoOut, 'engine/web/gl.js')) && !existsSync(join(twoOut, 'engine/web/gpu.js')) && !existsSync(join(twoOut, 'engine/web/gltf.js')));
  copyFileSync(ex('arena3d.kiln'), join(twoOut, 'game/arena3d.kiln'));
  assert.deepEqual(build(join(flat, 'platformer.kiln'), flatOut).parts, ['3d']);
  assert.ok(!existsSync(join(flatOut, 'engine/web/gltf.js')));

  const bare = await host(twoOut), full = await host(flatOut);
  try {
    const open = async (url: string, scene: string) => {
      const page = await browser.open(`${url}?paused&offscreen&scene=${scene}`, { width: 960, height: 600 });
      return { page, got: await page.eval<{ hash: string; renderer: string }>(PLAY) };
    };
    const want = (scene: string): string => run(readFileSync(ex(scene), 'utf8'), { ticks: 90 }).hash;

    const p2 = await open(bare.url, 'platformer.kiln');
    assert.deepEqual([p2.got.hash, p2.got.renderer], [want('platformer.kiln'), '2d']);
    assert.deepEqual(p2.page.errors(), []);

    const p3 = await open(full.url, 'arena3d.kiln');
    assert.equal(p3.got.hash, want('arena3d.kiln'));
    assert.notEqual(p3.got.renderer, '2d', 'the 3D scene was not drawn in 3D');
    assert.deepEqual(p3.page.errors(), []);

    // The state is still right without the renderer; the picture is the 2D view and the page says why.
    const missing = await open(bare.url, 'arena3d.kiln');
    assert.deepEqual([missing.got.hash, missing.got.renderer], [want('arena3d.kiln'), '2d']);
    assert.ok(missing.page.errors().some((e) => e.includes('engine part missing from this build')), `errors: ${missing.page.errors().join(' | ')}`);
  } finally { bare.close(); full.close(); }
});
