import { ONE, fmtFx } from './fx.ts';
import { evalTick, finish, lastTick, parseExpects } from './expect.ts';
import type { Expect } from './expect.ts';
import { KilnFail, kept, parseScene, suggest, take } from './scene.ts';
import type { RawExpect } from './scene.ts';
import { hash, parseInput, step, tileAt, tileRows } from './sim.ts';
import type { System, World } from './world.ts';

export interface RunResult {
  world: World; hash: string; expects: Expect[]; ok: boolean; uses: string[];
  /** the scene a trigger's load:FILE asked for; the run stopped at that tick */
  load?: string;
  /** with `load`: what the `keep` entities hand to that scene (see scene.ts) */
  kept?: string;
  /** the file the expects came from: the scene, or an input file that carries its own */
  from: string;
}
export interface Mods { pre: System[]; post: System[] }

/**
 * An input file may carry `expect` lines of its own. They replace the scene's, so one scene
 * can be checked for several things without copying it. The lines are blanked, not removed,
 * so the input's line numbers stay true.
 */
export function splitInput(text: string): { input: string; expects: RawExpect[] } {
  const expects: RawExpect[] = [];
  const input = text.split(/\r?\n/).map((l, i) => {
    const m = /^\s*expect\s+(.*?)\s*$/.exec(l);
    if (m) expects.push({ line: i + 1, text: m[1].split(/\s+/).join(' ') });
    return m ? '' : l;
  }).join('\n');
  return { input, expects };
}

/**
 * Load a scene, run it headless, and evaluate its `expect` lines.
 * A scene is over at the tick a trigger loads another one: the run stops there, as the player does.
 */
export function run(sceneText: string, opts: { input?: string; ticks?: number; file?: string; inputFile?: string; mods?: Mods; kept?: string } = {}): RunResult {
  const { world, expects: raw, uses } = parseScene(sceneText, opts.file);
  if (opts.kept) take(world, opts.kept);
  if (opts.mods) { world.pre = opts.mods.pre; world.post = opts.mods.post; }
  const own = opts.input === undefined ? undefined : splitInput(opts.input);
  const from = own?.expects.length ? opts.inputFile ?? 'input' : opts.file ?? 'scene';
  const expects = parseExpects(own?.expects.length ? own.expects : raw, world, from);
  const script = own && parseInput(own.input, opts.inputFile);
  // A tap on something that is not a button would do nothing, silently.
  for (const [action] of [...script?.values() ?? []].flat()) {
    const name = action[3] === ':' ? action.slice(4) : '';
    if (name && world.match(name).every((id) => !world.has(id, 'button'))) {
      const buttons = world.query('button').map((id) => world.names[id]!);
      throw new KilnFail([{ code: 'K201', file: opts.inputFile ?? 'input', line: 0, msg: `input taps '${name}', which is not an entity with 'button'`, hint: suggest(name, buttons) ?? (buttons.length ? `buttons: ${buttons.join(' ')}` : 'the scene has no button') }]);
    }
  }
  const end = world.tick + (opts.ticks ?? Math.max(lastTick(expects) - world.tick, 0));
  evalTick(world, expects);
  let load: string | undefined;
  while (world.tick < end && load === undefined) {
    const heard = world.events.length;
    step(world, script);
    evalTick(world, expects);
    for (let i = heard; i < world.events.length && load === undefined; i++) if (world.events[i].name === 'load' && world.events[i].a) load = world.events[i].a;
  }
  finish(expects, world, load);
  return { world, hash: hash(world), expects, ok: expects.every((e) => e.ok), uses, load, kept: load === undefined ? undefined : kept(world), from };
}

/**
 * ASCII picture of the world, one character per world unit. Cheap for an agent to read.
 * plane 'xy' looks along z (the 2D view); 'xz' looks down from above (the floor plan of a 3D scene).
 */
export function view(w: World, plane: 'xy' | 'xz' = 'xy', maxW = 100, maxH = 50): string {
  const V = plane === 'xy' ? 'y' : 'z', H = plane === 'xy' ? 'h' : 'd';
  const items = w.query('pos', 'box');
  const maps = w.query('tiles', 'pos').filter((m) => w.get(m, 'tiles')!.plane === plane);
  if (!items.length && !maps.length) return '(nothing with pos+box or tiles)\n';
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const m of maps) {
    const t = w.get(m, 'tiles')!, p = w.get(m, 'pos')!, rows = tileRows(t);
    x0 = Math.min(x0, Math.floor((p.x as number) / ONE));
    y0 = Math.min(y0, Math.floor((p[V] as number) / ONE));
    x1 = Math.max(x1, Math.ceil(((p.x as number) + Math.max(...rows.map((r) => r.length)) * (t.size as number)) / ONE));
    y1 = Math.max(y1, Math.ceil(((p[V] as number) + rows.length * (t.size as number)) / ONE));
  }
  for (const id of items) {
    const p = w.get(id, 'pos')!, b = w.get(id, 'box')!;
    x0 = Math.min(x0, Math.floor((p.x as number) / ONE));
    y0 = Math.min(y0, Math.floor((p[V] as number) / ONE));
    x1 = Math.max(x1, Math.ceil(((p.x as number) + (b.w as number)) / ONE));
    y1 = Math.max(y1, Math.ceil(((p[V] as number) + (b[H] as number)) / ONE));
  }
  const cols = Math.min(x1 - x0, maxW), rows = Math.min(y1 - y0, maxH);
  const grid = Array.from({ length: rows }, () => Array<string>(cols).fill('.'));
  // Draw order: solids, then static things, then movers, so the things that move stay visible.
  // Seen from above, height decides first: whatever is higher (smaller y) covers what is below.
  const layer = (id: number): number => (w.has(id, 'solid') ? 0 : w.has(id, 'vel') ? 2 : 1);
  // Seen from above, a solid that lies under the feet of whatever moves is ground, not a wall.
  const walkers = plane === 'xz' ? items.filter((id) => w.has(id, 'vel') && !w.has(id, 'solid')) : [];
  const feet = walkers.length ? Math.max(...walkers.map((id) => (w.get(id, 'pos')!.y as number) + (w.get(id, 'box')!.h as number))) : Infinity;
  const height = (id: number): number => (plane === 'xz' ? -(w.get(id, 'pos')!.y as number) : 0);
  const order = [...items].sort((a, b) => (plane === 'xz' ? height(a) - height(b) || layer(a) - layer(b) : layer(a) - layer(b)) || a - b);
  const paint = (ids: number[]): void => {
    for (const id of ids) {
      const p = w.get(id, 'pos')!, b = w.get(id, 'box')!;
      const ch = (w.get(id, 'sprite')?.glyph as string) || (w.has(id, 'solid') ? ((p.y as number) >= feet ? '.' : '#') : w.names[id]![0]);
      // A cell is drawn when the entity covers its centre.
      let drawn = false;
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        const cx = (x0 + x) * ONE + ONE / 2, cy = (y0 + y) * ONE + ONE / 2;
        if (cx >= (p.x as number) && cx < (p.x as number) + (b.w as number) && cy >= (p[V] as number) && cy < (p[V] as number) + (b[H] as number)) { grid[y][x] = ch[0]; drawn = true; }
      }
      // Something small sitting between cell centres would otherwise vanish from the picture:
      // put it in the cell its own centre is in.
      if (!drawn) {
        const x = Math.floor(((p.x as number) + (b.w as number) / 2) / ONE) - x0, y = Math.floor(((p[V] as number) + (b[H] as number) / 2) / ONE) - y0;
        if (x >= 0 && x < cols && y >= 0 && y < rows) grid[y][x] = ch[0];
      }
    }
  };
  // Ground and whatever lies below it first, then the map's walls, then everything standing on the ground.
  paint(order.filter((id) => (w.get(id, 'pos')!.y as number) >= feet));
  for (const m of maps) {
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const ch = tileAt(w, m, (x0 + x) * ONE + ONE / 2, (y0 + y) * ONE + ONE / 2);
      if (ch && ch !== '.') grid[y][x] = ch;
    }
  }
  paint(order.filter((id) => (w.get(id, 'pos')!.y as number) < feet));
  return `origin ${x0},${y0}\n${grid.map((r) => r.join('')).join('\n')}\n`;
}

/** One compact line per entity: name, position, velocity. */
export function observe(w: World): string {
  const out: string[] = [];
  w.names.forEach((name, id) => {
    if (name == null) return;
    const p = w.get(id, 'pos'), v = w.get(id, 'vel');
    const xyz = (c: typeof p): string => `${fmtFx(c!.x as number)},${fmtFx(c!.y as number)}${c!.z ? `,${fmtFx(c!.z as number)}` : ''}`;
    out.push(`${name}${p ? ` pos=${xyz(p)}` : ''}${v ? ` vel=${xyz(v)}` : ''}`);
  });
  return out.join('\n') + '\n';
}
