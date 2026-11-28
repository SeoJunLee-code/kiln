// Browser player. It runs the same simulation modules as the headless CLI and only
// adds drawing and keyboard input. Floats appear here for drawing, never in the simulation.
import type { Sounds } from './audio.ts';
import type { View3 } from './view3.ts';
import { makeApi } from '../src/api.ts';
import { evalTick, parseExpects } from '../src/expect.ts';
import type { Expect } from '../src/expect.ts';
import { ONE } from '../src/fx.ts';
import { freeLink, loadBackend, physicsOf } from '../src/physics.ts';
import type { Mods } from '../src/run.ts';
import { kept, paintOf, parseScene, take } from '../src/scene.ts';
import { frameOf, hash, parseInput, step, tileRows } from '../src/sim.ts';
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
// The 3D renderer, asked for on first use so 2D scenes never touch the GPU. WebGPU is
// preferred and WebGL2 is the fallback; ?renderer=webgl2 or ?renderer=webgpu picks one.
// Starting WebGPU takes a moment, so the 2D view shows until the renderer is there.
// The renderers and the glTF reader are parts: fetched when a scene first needs one, and
// left out of a built game that never does (src/build.ts decides). One that is asked for
// and is not there is an error a check will see.
const part = <T>(module: Promise<T>): Promise<T | null> => module.catch((e) => {
  console.error(`engine part missing from this build: ${(e as Error).message}`);
  return null;
});
// The 3D view (renderers, model reader, mesh files) is a part: fetched when a scene first has an eye.
let view3: View3 | null | undefined;
let view3Asked = false;
const wantView3 = (): void => {
  if (view3Asked) return;
  view3Asked = true;
  loading.push(part(import('./view3.ts')).then(async (m) => { view3 = await m?.makeView3(canvas3, GAME, loading, part); }));
};

// Assets still on their way. A picture taken for a check waits for these, so it never
// shows the fallback box of a mesh or image that simply had not arrived yet.
const loading: Promise<unknown>[] = [];
let world: World, expects: Expect[], script: InputScript;
let log: string[] = [];
// The last tick of `log`: after a rewind it lies ahead, and a new press drops what follows.
let ahead = 0;
// The supervisor's panel, called after each draw; only `play` has it (see inspect.ts).
let panel: (() => void) | undefined;
// Keys held right now. Tracked here because world.pressed only changes on the next tick.
const held = new Set<string>();
// What the gamepads held when last asked.
let padWas: Record<string, boolean> = {};
// Everything is fetched relative to the page, so the same files work from the dev server
// and from a built folder under any path on a static host.
const GAME = new URL('game/', location.href);
// Image cache by path. An image that fails to load falls back to the colored box.
const images = new Map<string, HTMLImageElement>();
const image = (path: string): HTMLImageElement | null => {
  let im = images.get(path);
  if (!im) {
    const made = (im = new Image());
    loading.push(new Promise<void>((done) => { made.onload = made.onerror = () => done(); }));
    im.src = new URL(path, GAME).href;
    images.set(path, im);
  }
  return im.complete && im.naturalWidth > 0 ? im : null;
};
// ?paused starts stopped at tick 0, so a check can step to an exact tick itself.
let paused = new URLSearchParams(location.search).has('paused');
// Events already reacted to (sound, scene change).
let heard = 0, leaving = false, muted = false, beeps = 0;
let audio: AudioContext | null = null;
// Samples and music, for a scene with a `sound` component: it then has no tones.
let sounds: Sounds | null | undefined, tuned = false;

/** A short tone per event; the pitch comes from the event name, so each kind sounds the same every time. */
const beep = (name: string): void => {
  beeps++;
  if (muted || !audio || tuned) return void sounds?.play(name);
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const osc = audio.createOscillator(), gain = audio.createGain(), t = audio.currentTime;
  osc.type = 'triangle';
  osc.frequency.value = 330 * 2 ** ((h % 13) / 12);
  gain.gain.setValueAtTime(0.12, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
  osc.connect(gain).connect(audio.destination);
  osc.start(t);
  osc.stop(t + 0.2);
};
let bounds = { x: 0, y: 0, w: 1, h: 1 };

try {
  const cfg = await (await fetch('config.json')).json();
  // ?scene=NAME opens another scene from the same folder (live input only).
  const asked = new URLSearchParams(location.search), other = asked.get('scene');
  // What the scene before this one handed over (see `keep`); a restart starts from it again.
  const handed = asked.get('keep');
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

  await loadBackend(physicsOf(sceneText), cfg.scene);

  const reset = (): void => {
    if (world) freeLink(world);
    const s = parseScene(sceneText, cfg.scene);
    world = s.world;
    if (handed) take(world, handed);
    world.pre = mods.pre;
    world.post = mods.post;
    expects = parseExpects(s.expects, world, cfg.scene);
    script = replay === null ? new Map() : parseInput(replay, 'input');
    log = [];
    ahead = 0;
    held.clear();
    tuned = world.query('sound').length > 0;
    padWas = {};
    heard = 0;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const id of world.query('pos', 'box')) {
      const p = world.get(id, 'pos')!, b = world.get(id, 'box')!;
      x0 = Math.min(x0, p.x as number); y0 = Math.min(y0, p.y as number);
      x1 = Math.max(x1, (p.x as number) + (b.w as number)); y1 = Math.max(y1, (p.y as number) + (b.h as number));
    }
    for (const m of world.query('tiles', 'pos').filter((i) => world.get(i, 'tiles')!.plane === 'xy')) {
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
    for (; heard < world.events.length; heard++) {
      const ev = world.events[heard];
      beep(ev.name);
      // A trigger with load:FILE asks for the next scene; give the player a moment to see why.
      if (ev.name === 'load' && !leaving) {
        leaving = true;
        // Taken now, at the tick the scene ends, as the headless run does; the game goes on a moment longer.
        const k = kept(world);
        setTimeout(() => { location.search = `?scene=${encodeURIComponent(ev.a)}${k && `&keep=${encodeURIComponent(k)}`}`; }, 600);
      }
    }
  };

  // Browsers only allow sound after a key or click, so that is when it starts.
  const wake = (): void => {
    if (audio) return;
    audio = new AudioContext();
    const id = world.query('sound')[0];
    if (id !== undefined) loading.push(part(import('./audio.ts')).then((m) => { sounds = m?.makeSounds(audio!, GAME, world.get(id, 'sound')!); return sounds?.ready; }));
  };

  const press = (action: string, down: boolean): void => {
    // A tap on a button (tap:NAME) is not held: every one counts.
    const tap = action[3] === ':';
    if (replay !== null || (!tap && held.has(action) === down)) return;
    if (ahead > world.tick) {
      log = log.filter((l) => parseInt(l) < world.tick);
      for (const t of script.keys()) if (t >= world.tick) script.delete(t);
    }
    ahead = world.tick;
    if (tap) log.push(`${world.tick} ${action.slice(4)} tap`);
    else {
      if (down) held.add(action);
      else held.delete(action);
      log.push(`${world.tick} ${action} ${down ? 'down' : 'up'}`);
    }
    if (!script.has(world.tick)) script.set(world.tick, []);
    script.get(world.tick)!.push([action, down]);
  };

  // The 2D view as last drawn: its size, the pixels of one unit, and where the world's origin is.
  let cw = 1, ch = 1, scale = 1, ox = 0, oy = 0;
  /** Where an entity is on the screen: left, top, width, height, and the pixels of one of its units. */
  const rect = (id: number): number[] => {
    const n = (c: string, f: string): number => ((world.get(id, c)?.[f] as number) ?? 0) / ONE;
    const where = world.get(id, 'pin')?.where as string | undefined;
    if (where === undefined) return [n('pos', 'x') * scale + ox, n('pos', 'y') * scale + oy, n('box', 'w') * scale, n('box', 'h') * scale, scale];
    // A pinned entity is placed against the edges of the view, in units the camera does not change.
    const u = Math.min(cw, ch) / 12, w = n('box', 'w') * u, h = n('box', 'h') * u;
    const side = (lo: string, hi: string): number => (where.includes(lo) ? 0 : where.includes(hi) ? 1 : 0.5);
    return [(cw - w) * side('left', 'right') + n('pin', 'dx') * u, (ch - h) * side('top', 'bottom') + n('pin', 'dy') * u, w, h, u];
  };

  // Gamepads in the standard layout: the d-pad or the left stick past half way, button 0 is a
  // and button 1 is b. Asked once a frame; only a change is passed on, as a key would be.
  const pads = (): void => {
    const now: Record<string, boolean> = {};
    for (const p of navigator.getGamepads?.() ?? []) {
      if (!p) continue;
      const b = (i: number): boolean => !!p.buttons[i]?.pressed, [x, y] = p.axes;
      now.left ||= b(14) || x < -0.5;
      now.right ||= b(15) || x > 0.5;
      now.up ||= b(12) || y < -0.5;
      now.down ||= b(13) || y > 0.5;
      now.a ||= b(0);
      now.b ||= b(1);
    }
    for (const k of ['left', 'right', 'up', 'down', 'a', 'b']) {
      if (!now[k] === !padWas[k]) continue;
      if ((padWas[k] = !!now[k])) wake();
      press(k, padWas[k]);
    }
  };

  const draw = (): void => {
    const eyeId = world.query('eye', 'pos')[0];
    if (eyeId !== undefined) wantView3();
    const use3 = eyeId !== undefined && !!view3;
    canvas3.hidden = !use3;
    canvas.hidden = use3;
    if (use3) return view3!.draw(world, eyeId);
    const dpr = window.devicePixelRatio || 1;
    cw = canvas.clientWidth;
    ch = canvas.clientHeight;
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
    scale = Math.min(cw / vw, ch / vh);
    ox = (cw - vw * scale) / 2 - vx * scale;
    oy = (ch - vh * scale) / 2 - vy * scale;
    for (const m of world.query('tiles', 'pos').filter((i) => world.get(i, 'tiles')!.plane === 'xy')) {
      const t = world.get(m, 'tiles')!, p = world.get(m, 'pos')!;
      const size = ((t.size as number) / ONE) * scale;
      const paint = paintOf(t.paint as string);
      tileRows(t).forEach((row, r) => {
        for (let c = 0; c < row.length; c++) {
          // A painted character has its own color or image; that goes for '.' too, otherwise empty.
          const how = paint.get(row[c]), im = how?.[1] ? image(how[1]) : null;
          if (row[c] === '.' && !how) continue;
          const x = ((p.x as number) / ONE) * scale + ox + c * size, y = ((p.y as number) / ONE) * scale + oy + r * size;
          g.fillStyle = how?.[0] || ((t.solid as string).includes(row[c]) ? '#3a404b' : '#59616e');
          // Overdraw by a fraction of a pixel so neighbouring cells leave no seams.
          if (im) g.drawImage(im, x, y, size + 0.5, size + 0.5);
          else g.fillRect(x, y, size + 0.5, size + 0.5);
        }
      });
    }
    // Pinned entities are the screen's own layer, over the world.
    const placed = (id: number): boolean => world.has(id, 'pos') || world.has(id, 'pin');
    const layer = (id: number): number => (world.has(id, 'pin') ? 3 : world.has(id, 'solid') ? 0 : world.has(id, 'vel') ? 2 : 1);
    for (const id of world.query('box').filter(placed).sort((a, b) => layer(a) - layer(b) || a - b)) {
      const sp = world.get(id, 'sprite'), [x, y, w, h] = rect(id);
      const color = (sp?.color as string) ?? 'white';
      g.fillStyle = (world.has(id, 'solid') || world.has(id, 'button')) && color === 'white' ? '#3a404b' : color === 'white' ? '#d7dbe2' : color;
      const im = sp?.image ? image(sp.image as string) : null;
      // In 2D only a turn about z shows; it goes around the box's centre.
      const r = world.get(id, 'rot'), turn = r && r.axis === 'z' ? ((r.angle as number) / ONE) * (Math.PI / 180) : 0;
      // A sheet of frames shows one of them, mirrored when the entity looks left.
      const an = im && world.get(id, 'anim'), flip = an && an.face === -1;
      if (turn || an) {
        g.save();
        g.translate(x + w / 2, y + h / 2);
        g.rotate(turn);
        if (flip) g.scale(-1, 1);
        g.translate(-(x + w / 2), -(y + h / 2));
      }
      if (an) {
        // The whole sheet is drawn behind a window one frame wide. (A source rectangle
        // would be shorter, but an SVG without its own size does not take one reliably.)
        g.beginPath();
        g.rect(x, y, w, h);
        g.clip();
        g.drawImage(im!, x - frameOf(world, id) * w, y, Math.max(1, an.frames as number) * w, h);
      } else if (im) g.drawImage(im, x, y, w, h);
      else {
        g.fillRect(x, y, w, h);
        if (sp?.glyph) {
          g.fillStyle = '#14161a';
          g.font = `600 ${Math.min(w, h) * 0.7}px ui-monospace, Consolas, monospace`;
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText(sp.glyph as string, x + w / 2, y + h / 2);
        }
      }
      if (turn || an) g.restore();
    }
    for (const id of world.query('label').filter(placed)) {
      const l = world.get(id, 'label')!, [x, y, w, h, u] = rect(id);
      // Above the box; inside it on a button; and a pinned label with no box sits at its place on the screen.
      const where = world.has(id, 'box') ? '' : (world.get(id, 'pin')?.where as string) ?? '', mid = where || world.has(id, 'button');
      g.fillStyle = l.color === 'white' ? '#d7dbe2' : (l.color as string);
      g.font = `600 ${Math.max(11, u * 0.42)}px ui-monospace, Consolas, monospace`;
      g.textAlign = where.includes('left') ? 'left' : where.includes('right') ? 'right' : 'center';
      g.textBaseline = !mid ? 'bottom' : where.includes('top') ? 'top' : where.includes('bottom') ? 'bottom' : 'middle';
      g.fillText((l.text as string).replace(/_/g, ' ').replace('%', `${world.get(id, 'tally')?.n ?? '%'}`), x + w / 2, mid ? y + h / 2 : y - 3);
    }
  };

  // To any tick, back or forward, silently and paused. Going back runs again from the start
  // with the same input, which gives the same states. It stops where a scene is loaded.
  const seek = (t: number): void => {
    paused = true;
    if (t < world.tick) {
      const was = log, last = ahead;
      reset();
      log = was;
      ahead = last;
      if (replay === null) script = parseInput(was.join('\n'), 'input');
    }
    const over = (): boolean => world.events.some((e) => e.name === 'load' && !!e.a);
    while (world.tick < t && !over()) { step(world, script); evalTick(world, expects); }
    heard = world.events.length;
    draw();
    hud();
  };

  const hud = (): void => {
    panel?.();
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
    if (e.key === 'm' || e.key === 'M') return void sounds?.mute((muted = !muted));
    wake();
    const a = KEYS[e.key];
    if (a) { e.preventDefault(); press(a, true); }
  });
  addEventListener('keyup', (e) => { const a = KEYS[e.key]; if (a) press(a, false); });
  // A click or tap on a button's box, as drawn, is input like a key: recorded and replayed.
  canvas.addEventListener('pointerdown', (e) => {
    for (const id of world.query('button', 'box')) {
      const [x, y, w, h] = rect(id);
      if (e.offsetX >= x && e.offsetX < x + w && e.offsetY >= y && e.offsetY < y + h) { wake(); press(`tap:${world.names[id]}`, true); }
    }
  });
  // Touch controls: shown where the main pointer is a finger (or with ?pad=1 to try them).
  const pad = $('pad');
  pad.hidden = !(matchMedia('(pointer: coarse)').matches || new URLSearchParams(location.search).has('pad'));
  for (const b of pad.querySelectorAll<HTMLButtonElement>('button')) {
    const action = b.dataset.action!;
    const set = (down: boolean) => (e: Event): void => {
      e.preventDefault();
      if (down) wake();
      b.classList.toggle('on', down);
      press(action, down);
    };
    b.addEventListener('pointerdown', set(true));
    for (const up of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(up, set(false));
  }

  $('restart').onclick = reset;
  $('pause').onclick = () => void (paused = !paused);
  $('copy').onclick = () => navigator.clipboard.writeText(log.join('\n') + '\n');

  // Fixed-step loop: wall-clock time only decides how many ticks to run, never what a tick does.
  let last = performance.now(), acc = 0;
  const frame = (now: number): void => {
    acc += Math.min(now - last, 250);
    last = now;
    const dt = 1000 / world.hz;
    pads();
    while (acc >= dt) { acc -= dt; if (!paused) tick(); }
    draw();
    hud();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  if (!cfg.built) panel = (await part(import('./inspect.ts')))?.inspect({ world: () => world, seek, rect, canvas });

  // For inspection and automated checks from the console.
  Object.assign(window, {
    kiln: {
      get world() { return world; },
      hash: () => hash(world),
      reset,
      seek,
      /** Step synchronously until the given tick (ignores pause). */
      runTo: (t: number) => { paused = true; pads(); while (world.tick < t) tick(); draw(); hud(); return hash(world); },
      inputLog: () => log.join('\n'),
      beeps: () => beeps,
      /** Sound files started so far, once they have all arrived. */
      sounds: async () => { await Promise.all(loading); return sounds?.played ?? []; },
      /** The game view as a PNG data URL, once every asset the frame asks for has arrived. */
      shot: async () => {
        draw();
        // Arriving assets can ask for more, so wait until a draw adds nothing new.
        for (let seen = -1; seen !== loading.length;) { seen = loading.length; await Promise.all(loading); draw(); }
        const use3 = !canvas3.hidden;
        const pixels = use3 ? await view3!.read?.() : null;
        if (pixels) {
          const copy = document.createElement('canvas');
          copy.width = pixels.width;
          copy.height = pixels.height;
          copy.getContext('2d')!.putImageData(new ImageData(pixels.rgba, pixels.width, pixels.height), 0, 0);
          return { renderer: view3!.name, png: copy.toDataURL('image/png') };
        }
        return { renderer: use3 ? view3!.name : '2d', png: (use3 ? canvas3 : canvas).toDataURL('image/png') };
      },
      expects: () => expects.map((e) => `${e.ok === undefined ? 'open' : e.ok ? 'pass' : 'FAIL'} ${e.text}`),
    },
  });
} catch (e) {
  $('error').textContent = (e as Error).message;
  throw e;
}
