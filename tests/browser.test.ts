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

test('browser: a gamepad becomes input: d-pad, stick past half way, buttons a and b', { skip }, async () => {
  const player = await openPlayer(ex('maze.kiln'), { browser });
  try {
    const log = await player.page.eval<string>(`(() => {
      // A pad in the standard layout; the test moves its stick and presses its buttons.
      const pad = { axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false })) };
      navigator.getGamepads = () => [null, pad];
      kiln.runTo(1);
      pad.buttons[15].pressed = true;
      kiln.runTo(5);
      pad.buttons[15].pressed = false;
      pad.axes[0] = 0.4;
      kiln.runTo(8);
      pad.axes[0] = -0.9;
      pad.axes[1] = 0.7;
      pad.buttons[0].pressed = true;
      kiln.runTo(12);
      pad.axes[0] = pad.axes[1] = 0;
      pad.buttons[0].pressed = false;
      pad.buttons[1].pressed = true;
      kiln.runTo(15);
      pad.buttons[12].pressed = true;
      navigator.getGamepads = () => [];
      kiln.runTo(20);
      return kiln.inputLog();
    })()`);
    assert.equal(log, ['1 right down', '5 right up', '8 left down', '8 down down', '8 a down', '12 left up', '12 down up', '12 a up', '12 b down', '15 b up'].join('\n'));
    // What the pad did replays headless to the hash the player reached.
    const live = await player.page.eval<string>('kiln.hash()');
    const { run } = await import('../src/run.ts');
    assert.equal(live, run(readFileSync(ex('maze.kiln'), 'utf8'), { input: `${log}\n`, ticks: 20 }).hash);
  } finally { await player.close(); }
});

test('browser: a scene with sound plays its samples on their events and loops its music', { skip }, async () => {
  const player = await openPlayer(ex('level1.kiln'), { inputFile: ex('level1.input'), browser });
  try {
    // Nothing sounds before a key; the key starts the music, and events start their samples.
    const heard = await player.page.eval<{ before: string[]; woke: string[]; after: string[]; events: string[] }>(`(async () => {
      const before = await kiln.sounds();
      dispatchEvent(new KeyboardEvent('keydown', { key: 'q' }));
      const woke = [...await kiln.sounds()];
      kiln.runTo(200);
      return { before, woke, after: await kiln.sounds(), events: kiln.world.events.map((e) => e.name) };
    })()`);
    assert.deepEqual(heard.before, []);
    assert.deepEqual(heard.woke, ['tune.wav']);
    assert.deepEqual(heard.events, ['coin', 'coin', 'stairs', 'load']);
    assert.deepEqual(heard.after, ['tune.wav', 'coin.wav', 'coin.wav', 'door.wav']);
    assert.deepEqual(player.page.errors(), []);

    // What comes out, rendered to a buffer instead of a speaker: the peak of each stretch of time.
    const mix = (c: string, act = ''): Promise<number[]> => player.page.eval<number[]>(`(async () => {
      const { makeSounds } = await import('/engine/web/audio.ts');
      const ctx = new OfflineAudioContext(1, 24000, 8000);
      const s = makeSounds(ctx, new URL('game/', location.href), ${c});
      await s.ready;
      s.play('coin');
      s.play('nothing');
      ${act}
      const data = (await ctx.startRendering()).getChannelData(0);
      const peak = (from, to) => Math.round(100 * data.slice(from * 8000, to * 8000).reduce((m, v) => Math.max(m, Math.abs(v)), 0));
      return [peak(0, 0.2), peak(0.25, 1), peak(2.05, 2.5)];
    })()`);
    // coin.wav peaks near 90/128 and lasts 0.2 s; tune.wav peaks near 50/128, lasts 2 s and loops.
    const [sample, tail, later] = await mix(`{ on: 'coin:coin.wav', music: '', vol: 65536, mvol: 65536 }`);
    assert.ok(sample > 55 && sample <= 71, `sample peak ${sample}`);
    assert.deepEqual([tail, later], [0, 0]);
    const half = await mix(`{ on: 'coin:coin.wav', music: '', vol: 32768, mvol: 65536 }`);
    assert.ok(Math.abs(half[0] * 2 - sample) <= 2, `vol=0.5 gives ${half[0]} against ${sample}`);
    const tune = await mix(`{ on: '', music: 'tune.wav', vol: 65536, mvol: 65536 }`);
    assert.ok(tune[1] > 25 && tune[1] <= 40 && tune[2] > 25, `music peaks ${tune}, the last one after its first pass`);
    assert.deepEqual(await mix(`{ on: 'coin:coin.wav', music: 'tune.wav', vol: 65536, mvol: 0 }`), [sample, 0, 0]);
    assert.deepEqual(await mix(`{ on: 'coin:coin.wav', music: 'tune.wav', vol: 65536, mvol: 65536 }`, 's.mute(true);'), [0, 0, 0]);
    // A file that is not there is reported and silent; the rest plays.
    assert.deepEqual(await mix(`{ on: 'coin:coin.wav,nothing:nope.wav', music: '', vol: 65536, mvol: 65536 }`), [sample, 0, 0]);
    assert.match(player.page.errors().join('\n'), /sound nope\.wav: 404/);
  } finally { await player.close(); }

  // A scene without sound keeps the tones and never asks for the part.
  const plain = await openPlayer(ex('maze.kiln'), { browser });
  try {
    assert.deepEqual(await plain.page.eval<string[]>(`(async () => { dispatchEvent(new KeyboardEvent('keydown', { key: 'q' })); return [...await kiln.sounds(), ...performance.getEntriesByType('resource').map((r) => r.name).filter((n) => n.includes('audio'))]; })()`), []);
  } finally { await plain.close(); }
});

test('browser: pinned entities keep their place on the screen, and a click on a button is input', { skip }, async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { run } = await import('../src/run.ts');
  const dir = mkdtempSync(join(tmpdir(), 'kiln-ui-'));
  // A hero the camera follows, a button in the world next to it, and three pinned boxes.
  const scene = `world hz=60
entity hero
  pos 0 0
  box 1 1
  vel 3 0
  sprite color=#ffffff
  camera 10 6
entity sign
  pos 2 -2
  box 2 1
  sprite color=#ffff00
  button sign
entity tl
  pin top-left 0.5 0.5
  box 2 1
  sprite color=#ff0000
entity br
  pin bottom-right -0.5 -0.5
  box 2 1
  sprite color=#0000ff
entity go
  pin center 0 3
  box 4 1.2
  sprite color=#00ff00
  button go despawn:tl
`;
  writeFileSync(join(dir, 's.kiln'), scene);
  // In the page: the color in the middle of a rectangle given in pinned units from a corner of the view.
  const probe = `
    const view = document.getElementById('view'), cw = view.clientWidth, ch = view.clientHeight, u = Math.min(cw, ch) / 12;
    const dpr = devicePixelRatio || 1, g = view.getContext('2d');
    const color = (x, y) => [...g.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data].slice(0, 3).join();
    const places = { tl: [0.5 * u + u, 0.5 * u + u / 2], br: [cw - 0.5 * u - u, ch - 0.5 * u - u / 2], go: [cw / 2, ch / 2 + 3 * u] };
    const click = (x, y) => view.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: view.getBoundingClientRect().left + x, clientY: view.getBoundingClientRect().top + y }));
    const seen = () => Object.fromEntries(Object.entries(places).map(([k, [x, y]]) => [k, color(x, y)]));`;
  const all = { tl: '255,0,0', br: '0,0,255', go: '0,255,0' };
  for (const [width, height] of [[960, 600], [420, 800]]) {
    const player = await openPlayer(join(dir, 's.kiln'), { browser, width, height });
    try {
      const r = await player.page.eval<{ size: number[]; at0: object; at40: object; edge: string; log: string; after: object; hash: string }>(`(() => {${probe}
        kiln.runTo(0);
        const at0 = seen();
        // The camera goes with the hero; the pinned boxes stay.
        kiln.runTo(40);
        const at40 = seen(), edge = color(places.go[0] - 2 * u - 4, places.go[1]);
        // Beside the button: nothing. On it: a tap. On the one in the world, which the camera shows left of the middle now: a tap too.
        click(places.go[0] - 2 * u - 4, places.go[1]);
        click(...places.go);
        const s = Math.min(cw / 10, ch / 6);
        click(cw / 2 + 0.5 * s, ch / 2 - 2 * s);
        kiln.runTo(42);
        return { size: [cw, ch], at0, at40, edge, log: kiln.inputLog(), after: seen(), hash: kiln.hash() };
      })()`);
      const where = `${width}x${height} (view ${r.size})`;
      assert.deepEqual(r.at0, all, where);
      assert.deepEqual(r.at40, all, where);
      assert.notEqual(r.edge, all.go, where);
      assert.equal(r.log, '40 go tap\n40 sign tap', where);
      // The button's action took the red box away; the recorded taps replay headless to the same hash.
      assert.deepEqual(r.after, { ...all, tl: '20,22,26' }, where);
      const replay = run(scene, { input: `${r.log}\n`, ticks: 42 });
      assert.equal(r.hash, replay.hash, where);
      assert.deepEqual(replay.world.events.map((e) => `${e.tick} ${e.name}`), ['41 sign', '41 go']);
    } finally { await player.close(); }
  }

  // The title screen: its label is inside the button, and the key the button names presses it.
  const title = await openPlayer(ex('title.kiln'), { browser });
  try {
    const t = await title.page.eval<{ teal: number; ink: number; events: string[] }>(`(() => {${probe}
      kiln.runTo(0);
      // Inside the button's box: mostly its color, and some pixels of the label's.
      const box = g.getImageData(Math.round((cw / 2 - 2 * u) * dpr), Math.round((ch / 2 - 0.6 * u) * dpr), Math.round(4 * u * dpr), Math.round(1.2 * u * dpr)).data;
      let teal = 0, ink = 0;
      for (let i = 0; i < box.length; i += 4) { if (box[i] === 0 && box[i + 1] === 128 && box[i + 2] === 128) teal++; else if (box[i] > 180 && box[i + 1] > 180 && box[i + 2] > 180) ink++; }
      dispatchEvent(new KeyboardEvent('keydown', { key: 'z' }));
      kiln.runTo(1);
      return { teal: teal / (box.length / 4), ink, events: kiln.world.events.map((e) => e.name + ' ' + e.a) };
    })()`);
    assert.ok(t.teal > 0.8 && t.ink > 20, `button: ${t.teal} of it is its color, ${t.ink} label pixels`);
    assert.deepEqual(t.events, ['start start', 'load level1.kiln']);
  } finally { await title.close(); }
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

test('mcp: look draws scene text too, and leaves no file behind', { skip }, async () => {
  const child = spawn(process.execPath, [fileURLToPath(new URL('../src/cli.ts', import.meta.url)), 'mcp'], { stdio: ['pipe', 'pipe', 'inherit'] });
  try {
    const reply = new Promise<any>((done) => {
      let seen = '';
      child.stdout.on('data', (chunk) => {
        seen += chunk;
        const end = seen.indexOf(String.fromCharCode(10));
        if (end >= 0) done(JSON.parse(seen.slice(0, end)));
      });
    });
    const scene = ['world hz=60', 'entity a', '  pos 1 1', '  box 2 2'].join(String.fromCharCode(10));
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'kiln', arguments: { cmd: 'look', scene } } }) + String.fromCharCode(10));
    const { result } = await reply;
    assert.match(result.content[0].text, /^ok look scene.kiln tick=0 /);
    assert.equal(result.content[1].mimeType, 'image/png');
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

test('browser: the next level starts with what the last one kept, at the same hash as --follow', { skip }, async () => {
  const { run } = await import('../src/run.ts');
  const one = run(readFileSync(ex('level1.kiln'), 'utf8'), { input: readFileSync(ex('level1.input'), 'utf8') });
  const two = run(readFileSync(ex('level2.kiln'), 'utf8'), { kept: one.kept, ticks: 600 });
  const player = await openPlayer(ex('level1.kiln'), { inputFile: ex('level1.input'), browser });
  try {
    // Past the load event: the score must be the one from that tick, whatever happens after it.
    await player.page.eval('kiln.runTo(600)');
    let ready = false;
    for (let i = 0; i < 80 && !ready; i++) {
      await new Promise((r) => setTimeout(r, 100));
      try { ready = await player.page.eval<boolean>('location.search.includes("level2.kiln") && typeof kiln === "object"'); } catch { /* the page is navigating */ }
    }
    assert.ok(ready, 'level2 did not open');
    assert.equal(new URLSearchParams(await player.page.eval<string>('location.search')).get('keep'), one.kept);
    const score = 'kiln.world.get(kiln.world.ids.get("score"), "tally").n';
    assert.equal(await player.page.eval<number>(score), 2);
    assert.equal(await player.page.eval<string>('kiln.runTo(600)'), two.hash);
    // Starting the level again starts from what was handed over, not from the file.
    await player.page.eval('kiln.reset()');
    assert.equal(await player.page.eval<number>(score), 2);
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

test('browser: clip poses a model by the tick: it moves, comes round, and the same moment looks the same', { skip }, async () => {
  const player = await openPlayer(ex('rig3d.kiln'), { browser, query: 'renderer=webgpu' });
  try {
    const shots = await player.page.eval<{ renderer: string; a: string; b: string; again: string; still: string }>(`(async () => {
      // The flag of 'signal' takes four seconds to come round; the two reeds take one.
      kiln.world.despawn(kiln.world.match('signal')[0]);
      kiln.runTo(75);
      const a = await kiln.shot();
      kiln.runTo(90);
      const b = (await kiln.shot()).png;
      kiln.runTo(315);
      const again = (await kiln.shot()).png;
      for (const id of kiln.world.query('clip')) kiln.world.comps.get('clip').delete(id);
      return { renderer: a.renderer, a: a.png, b, again, still: (await kiln.shot()).png };
    })()`);
    if (shots.renderer !== 'webgpu') return; // no WebGPU in this browser
    assert.deepEqual(player.page.errors(), []);
    const png = (url: string) => decodePng(Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
    assert.ok(compare(png(shots.a), png(shots.b)).changed > 0.005, 'the animation did not move');
    // The walker has stopped by tick 40, and 315 is four periods of the reeds after 75.
    assert.ok(compare(png(shots.a), png(shots.again)).changed < 0.001, 'the same moment of the animation looks the same');
    assert.ok(compare(png(shots.again), png(shots.still)).changed > 0.005, 'without clip the model is at rest');
  } finally { await player.close(); }
});

test('browser: lights are seen by WebGPU, on the plain material and on a model', { skip }, async () => {
  const player = await openPlayer(ex('lamps3d.kiln'), { inputFile: ex('lamps3d.input'), browser, query: 'renderer=webgpu' });
  try {
    const shots = await player.page.eval<{ renderer: string; lit: string; dark: string; moved: string }>(`(async () => {
      kiln.runTo(90);
      const lit = await kiln.shot();
      kiln.runTo(150);
      const moved = (await kiln.shot()).png;
      for (const id of kiln.world.query('light')) kiln.world.comps.get('light').delete(id);
      return { renderer: lit.renderer, lit: lit.png, moved, dark: (await kiln.shot()).png };
    })()`);
    if (shots.renderer !== 'webgpu') return; // no WebGPU in this browser
    assert.deepEqual(player.page.errors(), []);
    const png = (url: string) => decodePng(Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
    assert.ok(compare(png(shots.moved), png(shots.dark)).changed > 0.1, 'the lights made no difference to the frame');
    assert.ok(compare(png(shots.lit), png(shots.moved)).changed > 0.02, 'the walking light did not move');
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

test('browser: an animated sprite shows the frame of its tick, mirrored when it looks left', { skip }, async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'kiln-anim-'));
  // Four frames of one color each, except frame 1: green on its left half, blue on its right.
  writeFileSync(join(dir, 'sheet.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 10">
<rect x="0" width="10" height="10" fill="#ff0000"/><rect x="10" width="5" height="10" fill="#00ff00"/><rect x="15" width="5" height="10" fill="#0000ff"/>
<rect x="20" width="10" height="10" fill="#ffff00"/><rect x="30" width="10" height="10" fill="#ff00ff"/></svg>`);
  writeFileSync(join(dir, 's.kiln'), 'world hz=60\nentity hero\n  pos 5 0\n  box 2 2\n  vel\n  ctrl 2\n  sprite @ white sheet.svg\n  anim 4 fps=10 idle=1\nentity floor\n  pos 0 2\n  box 12 1\n  solid\n');
  writeFileSync(join(dir, 's.input'), '0 right down\n30 right up\n30 left down\n60 left up\n');
  const player = await openPlayer(join(dir, 's.kiln'), { inputFile: join(dir, 's.input'), browser, query: 'paused' });
  try {
    const ticks = [0, 6, 12, 18, 36, 70];
    const shots = await player.page.eval<string[]>(`(async () => {
      const out = [];
      for (const t of ${JSON.stringify(ticks)}) { kiln.runTo(t); out.push((await kiln.shot()).png); }
      return out;
    })()`);
    const COLORS: Record<string, number[]> = { red: [255, 0, 0], green: [0, 255, 0], blue: [0, 0, 255], yellow: [255, 255, 0], magenta: [255, 0, 255] };
    // For each frame color: how many pixels have it, and where their middle is from left to right.
    const read = (url: string): Record<string, { n: number; x: number }> => {
      const p = decodePng(Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
      const out: Record<string, { n: number; x: number }> = {};
      for (const [name, [r, g, b]] of Object.entries(COLORS)) {
        let n = 0, sum = 0;
        for (let i = 0; i < p.rgba.length; i += 4) if (Math.abs(p.rgba[i] - r) < 8 && Math.abs(p.rgba[i + 1] - g) < 8 && Math.abs(p.rgba[i + 2] - b) < 8) { n++; sum += (i / 4) % p.width; }
        out[name] = { n, x: n ? sum / n : 0 };
      }
      return out;
    };
    const got = shots.map(read);
    const only = (i: number, ...names: string[]): void => {
      for (const name of Object.keys(COLORS)) assert.equal(got[i][name].n > 100, names.includes(name), `tick ${ticks[i]}: ${name} covers ${got[i][name].n} pixels`);
    };
    only(0, 'red');             // standing
    only(1, 'yellow');          // walking: frames 1..3, one every 6 ticks
    only(2, 'magenta');
    only(3, 'green', 'blue');
    assert.ok(got[3].green.x < got[3].blue.x, 'looking right, the frame is drawn as it is in the sheet');
    only(4, 'green', 'blue');
    assert.ok(got[4].green.x > got[4].blue.x, 'looking left, the frame is mirrored');
    only(5, 'red');             // standing again
    // One frame is a quarter of the sheet: its two halves take the same room.
    assert.ok(Math.abs(got[3].green.n - got[3].blue.n) < 0.05 * got[3].green.n, `green ${got[3].green.n}, blue ${got[3].blue.n}`);
  } finally { await player.close(); }
});

test('browser: a built game with navigation walks the same way as headless', { skip }, async () => {
  const { build } = await import('../src/build.ts');
  const { run } = await import('../src/run.ts');
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'kiln-game-')), out = mkdtempSync(join(tmpdir(), 'kiln-site-'));
  const text = 'entity wall\n  pos 3 0\n  box 1 4\n  solid\nentity a\n  pos 0 0\n  box 0.8 0.8\n  vel\n  nav b 3\nentity b\n  pos 6 0\n  box 0.8 0.8\n';
  writeFileSync(join(dir, 'walk.kiln'), text);
  assert.deepEqual(build(join(dir, 'walk.kiln'), out).parts, ['nav']);
  const site = await host(out);
  try {
    const page = await browser.open(`${site.url}?paused&offscreen&scene=walk.kiln`, { width: 960, height: 600 });
    const got = await page.eval<{ hash: string }>(PLAY);
    assert.equal(got.hash, run(text, { ticks: 90 }).hash);
    assert.deepEqual(page.errors(), []);
  } finally { site.close(); }
});
