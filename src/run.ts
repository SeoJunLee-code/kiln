import { ONE, fmtFx } from './fx.ts';
import { evalTick, finish, lastTick, parseExpects } from './expect.ts';
import type { Expect } from './expect.ts';
import { parseScene } from './scene.ts';
import { hash, parseInput, step } from './sim.ts';
import type { World } from './world.ts';

export interface RunResult { world: World; hash: string; expects: Expect[]; ok: boolean }

/** Load a scene, run it headless, and evaluate its `expect` lines. */
export function run(sceneText: string, opts: { input?: string; ticks?: number; file?: string; inputFile?: string } = {}): RunResult {
  const { world, expects: raw } = parseScene(sceneText, opts.file);
  const expects = parseExpects(raw, world, opts.file);
  const script = opts.input === undefined ? undefined : parseInput(opts.input, opts.inputFile);
  const end = world.tick + (opts.ticks ?? Math.max(lastTick(expects) - world.tick, 0));
  evalTick(world, expects);
  while (world.tick < end) {
    step(world, script);
    evalTick(world, expects);
  }
  finish(expects);
  return { world, hash: hash(world), expects, ok: expects.every((e) => e.ok) };
}

/** ASCII picture of the world, one character per world unit. Cheap for an agent to read. */
export function view(w: World, maxW = 100, maxH = 50): string {
  const items = w.query('pos', 'box');
  if (!items.length) return '(nothing with pos+box)\n';
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const id of items) {
    const p = w.get(id, 'pos')!, b = w.get(id, 'box')!;
    x0 = Math.min(x0, Math.floor((p.x as number) / ONE));
    y0 = Math.min(y0, Math.floor((p.y as number) / ONE));
    x1 = Math.max(x1, Math.ceil(((p.x as number) + (b.w as number)) / ONE));
    y1 = Math.max(y1, Math.ceil(((p.y as number) + (b.h as number)) / ONE));
  }
  const cols = Math.min(x1 - x0, maxW), rows = Math.min(y1 - y0, maxH);
  const grid = Array.from({ length: rows }, () => Array<string>(cols).fill('.'));
  // Draw order: solids, then static things, then movers, so the things that move stay visible.
  const layer = (id: number): number => (w.has(id, 'solid') ? 0 : w.has(id, 'vel') ? 2 : 1);
  for (const id of [...items].sort((a, b) => layer(a) - layer(b) || a - b)) {
    const p = w.get(id, 'pos')!, b = w.get(id, 'box')!;
    const ch = (w.get(id, 'sprite')?.glyph as string) || (w.has(id, 'solid') ? '#' : w.names[id]![0]);
    // A cell is drawn when the entity covers its centre.
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const cx = (x0 + x) * ONE + ONE / 2, cy = (y0 + y) * ONE + ONE / 2;
      if (cx >= (p.x as number) && cx < (p.x as number) + (b.w as number) && cy >= (p.y as number) && cy < (p.y as number) + (b.h as number)) grid[y][x] = ch[0];
    }
  }
  return `origin ${x0},${y0}\n${grid.map((r) => r.join('')).join('\n')}\n`;
}

/** One compact line per entity: name, position, velocity. */
export function observe(w: World): string {
  const out: string[] = [];
  w.names.forEach((name, id) => {
    if (name == null) return;
    const p = w.get(id, 'pos'), v = w.get(id, 'vel');
    out.push(`${name}${p ? ` pos=${fmtFx(p.x as number)},${fmtFx(p.y as number)}` : ''}${v ? ` vel=${fmtFx(v.x as number)},${fmtFx(v.y as number)}` : ''}`);
  });
  return out.join('\n') + '\n';
}
