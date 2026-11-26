// Because a run is fully determined by scene + input, the engine can search the input
// space itself: breadth-first over "which keys are held for the next few ticks", with
// identical states merged. A result is a proof that the level can be finished, as an
// input script that `kiln test` replays.
import { evalTick, parseExpects } from './expect.ts';
import type { Expect } from './expect.ts';
import type { Mods } from './run.ts';
import { parseScene } from './scene.ts';
import { step } from './sim.ts';
import { World, registry } from './world.ts';

/** Independent copy of a world. Script systems are shared, so scripts must keep their state in components. */
export function cloneWorld(w: World): World {
  const c = new World();
  c.tick = w.tick; c.hz = w.hz; c.gx = w.gx; c.gy = w.gy; c.seed = w.seed;
  c.names = [...w.names];
  c.ids = new Map(w.ids);
  for (const [name, m] of w.comps) {
    const n = new Map<number, Record<string, number | string>>();
    for (const [id, d] of m) n.set(id, { ...d });
    c.comps.set(name, n);
  }
  c.pressed = new Set(w.pressed);
  c.overlaps = new Set(w.overlaps);
  c.events = [...w.events];
  c.pre = w.pre;
  c.post = w.post;
  return c;
}

interface Node { w: World; ex: Expect[]; parent: Node | null; keys: string[]; done: number }

export interface SolveResult {
  ok: boolean;
  /** input script that satisfies the goals, when ok */
  input: string;
  tick: number;
  states: number;
  note: string;
}

const GOALS = ['reach', 'gone', 'event'];

/**
 * Search for an input script that satisfies every reach/gone/event expectation without
 * breaking a `never`. `at` expectations are not searched for (they are checked by `test`).
 *   stepTicks  how long each key choice is held (smaller = finer control, larger search)
 *   maxStates  give up after this many distinct states
 */
export function solve(sceneText: string, opts: { file?: string; mods?: Mods; stepTicks?: number; maxStates?: number } = {}): SolveResult {
  const { world, expects: raw } = parseScene(sceneText, opts.file);
  if (opts.mods) { world.pre = opts.mods.pre; world.post = opts.mods.post; }
  const expects = parseExpects(raw, world, opts.file).filter((e) => e.kind !== 'at');
  const goals = expects.filter((e) => GOALS.includes(e.kind)).length;
  const stepTicks = opts.stepTicks ?? 5, maxStates = opts.maxStates ?? 200000;
  const fail = (note: string, tick = 0, states = 0): SolveResult => ({ ok: false, input: '', tick, states, note });
  if (!goals) return fail('nothing to solve: the scene has no reach, gone or event expectation');
  const limit = Math.max(...expects.filter((e) => GOALS.includes(e.kind)).map((e) => e.by));

  // Key choices: jumping controllers need up combined with a direction; 4-way ones do not.
  const jumper = world.query('ctrl').some((id) => (world.get(id, 'ctrl')!.jump as number) > 0);
  const choices = jumper
    ? [[], ['right'], ['left'], ['up'], ['up', 'right'], ['up', 'left']]
    : [[], ['right'], ['left'], ['down'], ['up']];

  const count = (ex: Expect[]): number => ex.filter((e) => GOALS.includes(e.kind) && e.ok).length;
  // Two states count as the same when every non-static entity matches to 1/64 of a unit.
  // Exact positions differ by rounding dust depending on the tick phase, which would make
  // almost every state unique. The merge is therefore approximate, and that is safe:
  // an answer is only reported after it has been replayed exactly.
  const fxFields = new Map<string, Set<string>>();
  for (const def of registry.values()) fxFields.set(def.name, new Set(def.fields.filter((f) => f.type === 'fx').map((f) => f.name)));
  const key = (n: Node): string => {
    let s = n.ex.map((e) => (e.ok === undefined ? '?' : +e.ok)).join('');
    n.w.names.forEach((name, id) => {
      if (name == null || n.w.has(id, 'solid') || n.w.has(id, 'tiles')) return;
      s += `|${name}`;
      for (const [comp, m] of n.w.comps) {
        const d = m.get(id);
        if (!d) continue;
        const fx = fxFields.get(comp);
        for (const f in d) s += `,${fx?.has(f) ? (d[f] as number) >> 10 : d[f]}`;
      }
    });
    return s;
  };

  evalTick(world, expects);
  const root: Node = { w: world, ex: expects, parent: null, keys: [], done: count(expects) };
  const seen = new Set([key(root)]);
  const queue = [root];
  let best = root, goal: Node | null = root.done === goals ? root : null;

  for (let head = 0; head < queue.length && !goal; head++) {
    const n = queue[head];
    if (n.w.tick >= limit) continue;
    for (const keys of choices) {
      const c: Node = { w: cloneWorld(n.w), ex: n.ex.map((e) => ({ ...e })), parent: n, keys, done: 0 };
      c.w.pressed = new Set(keys);
      let dead = false;
      for (let i = 0; i < stepTicks && !dead; i++) {
        step(c.w);
        evalTick(c.w, c.ex);
        dead = c.ex.some((e) => e.ok === false);
      }
      if (dead) continue;
      const k = key(c);
      if (seen.has(k)) continue;
      seen.add(k);
      c.done = count(c.ex);
      if (c.done > best.done) best = c;
      if (c.done === goals) { goal = c; break; }
      queue.push(c);
    }
    if (seen.size > maxStates) break;
  }

  if (!goal) {
    const open = best.ex.find((e) => GOALS.includes(e.kind) && !e.ok)!;
    const why = seen.size > maxStates ? `gave up after ${maxStates} states` : `no input reaches the goals by tick ${limit}`;
    return fail(`${why}; best run met ${best.done}/${goals}, still open: ${open.text}${open.note ? ` (${open.note})` : ''}`, best.w.tick, seen.size);
  }

  // Walk back to the root and write key changes as an input script.
  const path: Node[] = [];
  for (let n: Node | null = goal; n && n.parent; n = n.parent) path.unshift(n);
  const lines: string[] = [];
  let held: string[] = [], t = root.w.tick;
  for (const n of path) {
    for (const a of held) if (!n.keys.includes(a)) lines.push(`${t} ${a} up`);
    for (const a of n.keys) if (!held.includes(a)) lines.push(`${t} ${a} down`);
    held = n.keys;
    t += stepTicks;
  }
  for (const a of held) lines.push(`${t} ${a} up`);
  return { ok: true, input: lines.join('\n') + (lines.length ? '\n' : ''), tick: goal.w.tick, states: seen.size, note: '' };
}
