// Browser player. It runs the same simulation modules as the headless CLI and only
// adds drawing and keyboard input. Floats appear here for drawing, never in the simulation.
import { makeRenderer3 } from './gl.ts';
import type { Box3, Renderer3 } from './gl.ts';
import { makeApi } from '../src/api.ts';
import { evalTick, parseExpects } from '../src/expect.ts';
import type { Expect } from '../src/expect.ts';
import { ONE } from '../src/fx.ts';
import type { Mods } from '../src/run.ts';
import { parseScene } from '../src/scene.ts';
import { hash, parseInput, step, tileRows } from '../src/sim.ts';
import type { InputScript } from '../src/sim.ts';
import type { World } from '../src/world.ts';

const KEYS: Record<string, string> = {
  ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
  a: 'left', d: 'right', w: 'up', s: 'down', z: 'a', ' ': 'a', x: 'b',
};
const $ = (id: string): HTMLElement => document.getElementById(id)!;
const canvas = $('view') as HTMLCanvasElement;
const g = canvas.getContext('2d')!;
const canvas3 = $('view3d') as HTMLCanvasElement;
// Created on first use, so 2D scenes never ask for a WebGL context.
let gl3: Renderer3 | null | undefined;

// CSS color name -> rgb 0..1, resolved by the browser and cached.
const rgbCache = new Map<string, number[]>();
const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
const rgb = (css: string): number[] => {
  let c = rgbCache.get(css);
  if (!c) {
    probe.clearRect(0, 0, 1, 1);
    probe.fillStyle = '#d7dbe2';
    probe.fillStyle = css;
    probe.fillRect(0, 0, 1, 1);
    const d = probe.getImageData(0, 0, 1, 1).data;
    rgbCache.set(css, (c = [d[0] / 255, d[1] / 255, d[2] / 255]));
  }
  return c;
};

let world: World, expects: Expect[], script: InputScript;
let log: string[] = [];
// Keys held right now. Tracked here because world.pressed only changes on the next tick.
const held = new Set<string>();
// Everything is fetched relative to the page, so the same files work from the dev server
// and from a built folder under any path on a static host.
const GAME = new URL('game/', location.href);
// Image cache by path. An image that fails to load falls back to the colored box.
const images = new Map<string, HTMLImageElement>();
const image = (path: string): HTMLImageElement | null => {
  let im = images.get(path);
  if (!im) {
    im = new Image();
    im.src = new URL(path, GAME).href;
    images.set(path, im);
  }
  return im.complete && im.naturalWidth > 0 ? im : null;
};
let paused = false;
let bounds = { x: 0, y: 0, w: 1, h: 1 };

try {
  const cfg = await (await fetch('config.json')).json();
  // ?scene=NAME opens another scene from the same folder (live input only).
  const other = new URLSearchParams(location.search).get('scene');
  if (other) Object.assign(cfg, { scene: other, input: false });
  const sceneRes = await fetch(new URL(cfg.scene, GAME));
  if (!sceneRes.ok) throw new Error(`E K001 cannot read scene '${cfg.scene}'`);
  const sceneText = await sceneRes.text();
  const replay: string | null = cfg.input ? await (await fetch('input')).text() : null;
  const mods: Mods = { pre: [], post: [] };
  const api = makeApi(mods);
  for (const m of sceneText.matchAll(/^use\s+(\S+)\s*$/gm)) {
    // A built folder holds scripts as .js.
    (await import(new URL(cfg.built ? m[1].replace(/\.ts$/, '.js') : m[1], GAME).href)).default(api);
  }

  const reset = (): void => {
    const s = parseScene(sceneText, cfg.scene);
    world = s.world;
    world.pre = mods.pre;
    world.post = mods.post;
    expects = parseExpects(s.expects, world, cfg.scene);
    script = replay === null ? new Map() : parseInput(replay, 'input');
    log = [];
    held.clear();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const id of world.query('pos', 'box')) {
      const p = world.get(id, 'pos')!, b = world.get(id, 'box')!;
      x0 = Math.min(x0, p.x as number); y0 = Math.min(y0, p.y as number);
      x1 = Math.max(x1, (p.x as number) + (b.w as number)); y1 = Math.max(y1, (p.y as number) + (b.h as number));
    }
    for (const m of world.query('tiles', 'pos')) {
      const t = world.get(m, 'tiles')!, p = world.get(m, 'pos')!, rows = tileRows(t);
      x0 = Math.min(x0, p.x as number); y0 = Math.min(y0, p.y as number);
      x1 = Math.max(x1, (p.x as number) + Math.max(...rows.map((r) => r.length)) * (t.size as number));
      y1 = Math.max(y1, (p.y as number) + rows.length * (t.size as number));
    }
    if (x0 <= x1) bounds = { x: x0 / ONE - 0.5, y: y0 / ONE - 0.5, w: (x1 - x0) / ONE + 1, h: (y1 - y0) / ONE + 1 };
    evalTick(world, expects);
  };

  const tick = (): void => {
    step(world, script);
    evalTick(world, expects);
  };

  const press = (action: string, down: boolean): void => {
    if (replay !== null || held.has(action) === down) return;
    if (down) held.add(action);
    else held.delete(action);
    if (!script.has(world.tick)) script.set(world.tick, []);
    script.get(world.tick)!.push([action, down]);
    log.push(`${world.tick} ${action} ${down ? 'down' : 'up'}`);
  };

  const draw3 = (eyeId: number): void => {
    const boxes: Box3[] = [];
    const u = (n: number | string): number => (n as number) / ONE;
    for (const m of world.query('tiles', 'pos')) {
      const t = world.get(m, 'tiles')!, p = world.get(m, 'pos')!, size = u(t.size);
      tileRows(t).forEach((row, r) => {
        for (let c = 0; c < row.length; c++) {
          if (row[c] === '.') continue;
          boxes.push({ p: [u(p.x) + c * size, u(p.y) + r * size, u(p.z)], s: [size, size, u(t.depth)], color: rgb((t.solid as string).includes(row[c]) ? '#59616e' : '#7a8494') });
        }
      });
    }
    for (const id of world.query('pos', 'box')) {
      const p = world.get(id, 'pos')!, b = world.get(id, 'box')!, color = (world.get(id, 'sprite')?.color as string) ?? 'white';
      boxes.push({ p: [u(p.x), u(p.y), u(p.z)], s: [u(b.w), u(b.h), u(b.d)], color: rgb(color === 'white' ? (world.has(id, 'solid') ? '#59616e' : '#d7dbe2') : color) });
    }
    const e = world.get(eyeId, 'eye')!, p = world.get(eyeId, 'pos')!, b = world.get(eyeId, 'box');
    const target = [u(p.x) + u(b?.w ?? 0) / 2, u(p.y) + u(b?.h ?? 0) / 2, u(p.z) + u(b?.d ?? 0) / 2];
    gl3!.draw(boxes, [target[0] + u(e.x), target[1] + u(e.y), target[2] + u(e.z)], target, e.fov as number);
  };

  const draw = (): void => {
    const eyeId = world.query('eye', 'pos')[0];
    if (eyeId !== undefined && gl3 === undefined) gl3 = makeRenderer3(canvas3);
    const use3 = eyeId !== undefined && !!gl3;
    canvas3.hidden = !use3;
    canvas.hidden = use3;
    if (use3) return draw3(eyeId);
    const dpr = window.devicePixelRatio || 1;
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#14161a';
    g.fillRect(0, 0, cw, ch);
    // With a camera entity the view is centred on it; otherwise the whole scene is fitted.
    let vw = bounds.w, vh = bounds.h, vx = bounds.x, vy = bounds.y;
    const cam = world.query('camera', 'pos')[0];
    if (cam !== undefined) {
      const c = world.get(cam, 'camera')!, cp = world.get(cam, 'pos')!, cb = world.get(cam, 'box');
      vw = (c.w as number) / ONE; vh = (c.h as number) / ONE;
      vx = ((cp.x as number) + ((cb?.w as number) ?? 0) / 2) / ONE - vw / 2;
      vy = ((cp.y as number) + ((cb?.h as number) ?? 0) / 2) / ONE - vh / 2;
    }
    const scale = Math.min(cw / vw, ch / vh);
    const ox = (cw - vw * scale) / 2 - vx * scale, oy = (ch - vh * scale) / 2 - vy * scale;
    for (const m of world.query('tiles', 'pos')) {
      const t = world.get(m, 'tiles')!, p = world.get(m, 'pos')!;
      const size = ((t.size as number) / ONE) * scale;
      tileRows(t).forEach((row, r) => {
        for (let c = 0; c < row.length; c++) {
          if (row[c] === '.') continue;
          g.fillStyle = (t.solid as string).includes(row[c]) ? '#3a404b' : '#59616e';
          // Overdraw by a fraction of a pixel so neighbouring cells leave no seams.
          g.fillRect(((p.x as number) / ONE) * scale + ox + c * size, ((p.y as number) / ONE) * scale + oy + r * size, size + 0.5, size + 0.5);
        }
      });
    }
    const layer = (id: number): number => (world.has(id, 'solid') ? 0 : world.has(id, 'vel') ? 2 : 1);
    for (const id of world.query('pos', 'box').sort((a, b) => layer(a) - layer(b) || a - b)) {
      const p = world.get(id, 'pos')!, b = world.get(id, 'box')!, sp = world.get(id, 'sprite');
      const x = ((p.x as number) / ONE) * scale + ox, y = ((p.y as number) / ONE) * scale + oy;
      const w = ((b.w as number) / ONE) * scale, h = ((b.h as number) / ONE) * scale;
      const color = (sp?.color as string) ?? 'white';
      g.fillStyle = world.has(id, 'solid') && color === 'white' ? '#3a404b' : color === 'white' ? '#d7dbe2' : color;
      const im = sp?.image ? image(sp.image as string) : null;
      if (im) { g.drawImage(im, x, y, w, h); continue; }
      g.fillRect(x, y, w, h);
      if (sp?.glyph) {
        g.fillStyle = '#14161a';
        g.font = `600 ${Math.min(w, h) * 0.7}px ui-monospace, Consolas, monospace`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(sp.glyph as string, x + w / 2, y + h / 2);
      }
    }
  };

  const hud = (): void => {
    $('state').textContent = `scene ${cfg.scene}\nmode  ${replay === null ? 'live input' : 'replaying input script'}${paused ? ' (paused)' : ''}\ntick  ${world.tick}\nhash  ${hash(world)}`;
    const ex = $('expects');
    ex.replaceChildren(...expects.map((e) => {
      const d = document.createElement('div');
      d.className = e.ok === undefined ? 'open' : e.ok ? 'pass' : 'fail';
      d.textContent = `${e.ok === undefined ? '....' : e.ok ? 'pass' : 'FAIL'} ${e.text}${e.ok === undefined || !e.note ? '' : ` -- ${e.note}`}`;
      return d;
    }));
    if (!expects.length) ex.textContent = '(scene has no expect lines)';
    $('events').textContent = world.events.slice(-8).map((e) => `${e.tick} ${e.name} ${e.a} ${e.b}`).join('\n') || '(none yet)';
  };

  if (cfg.scenes?.length > 1) {
    const pick = $('scenes') as HTMLSelectElement;
    for (const name of cfg.scenes) pick.add(new Option(name.replace(/\.kiln$/, ''), name, false, name === cfg.scene));
    pick.onchange = () => { location.search = `?scene=${encodeURIComponent(pick.value)}`; };
    $('scenes-label').hidden = false;
  }

  reset();
  addEventListener('keydown', (e) => {
    if (e.key === 'r' || e.key === 'R') return reset();
    if (e.key === 'p' || e.key === 'P') return void (paused = !paused);
    const a = KEYS[e.key];
    if (a) { e.preventDefault(); press(a, true); }
  });
  addEventListener('keyup', (e) => { const a = KEYS[e.key]; if (a) press(a, false); });
  $('restart').onclick = reset;
  $('pause').onclick = () => void (paused = !paused);
  $('copy').onclick = () => navigator.clipboard.writeText(log.join('\n') + '\n');

  // Fixed-step loop: wall-clock time only decides how many ticks to run, never what a tick does.
  let last = performance.now(), acc = 0;
  const frame = (now: number): void => {
    acc += Math.min(now - last, 250);
    last = now;
    const dt = 1000 / world.hz;
    while (acc >= dt) { acc -= dt; if (!paused) tick(); }
    draw();
    hud();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // For inspection and automated checks from the console.
  Object.assign(window, {
    kiln: {
      get world() { return world; },
      hash: () => hash(world),
      reset,
      /** Step synchronously until the given tick (ignores pause). */
      runTo: (t: number) => { paused = true; while (world.tick < t) tick(); draw(); hud(); return hash(world); },
      inputLog: () => log.join('\n'),
      expects: () => expects.map((e) => `${e.ok === undefined ? 'open' : e.ok ? 'pass' : 'FAIL'} ${e.text}`),
    },
  });
} catch (e) {
  $('error').textContent = (e as Error).message;
  throw e;
}
