// Because a run is fully determined by scene + input, the engine can search the input
// space itself: over "which keys are held for the next few ticks", nearest-to-a-goal
// first, with identical states merged. A result is a proof that the level can be finished, as an
// input script that `kiln test` replays.
import { evalTick, gap, parseExpects } from './expect.ts';
import type { Expect } from './expect.ts';
import type { Mods } from './run.ts';
import { parseScene } from './scene.ts';
import { step } from './sim.ts';
import { World, registry } from './world.ts';

/** Independent copy of a world. Script systems are shared, so scripts must keep their state in components. */
export function cloneWorld(w: World): World {
  const c = new World();
  c.tick = w.tick; c.hz = w.hz; c.gx = w.gx; c.gy = w.gy; c.gz = w.gz; c.seed = w.seed;
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

interface Node { w: World; ex: Expect[]; parent: Node | null; keys: string[]; done: number; depth: number; f: number; seq: number }

export interface SolveResult {
  ok: boolean;
  /** input script that satisfies the goals when ok; otherwise the input of the attempt that got furthest */
  input: string;
  tick: number;
  states: number;
  note: string;
}

const GOALS = ['reach', 'gone', 'event'];

/**
 * Search for an input script that satisfies every reach/gone/event expectation without
 * breaking a `never`. `at` and `count` expectations are not searched for (they are checked by `test`).
 *   stepTicks  how long each key choice is held (smaller = finer control, larger search)
 *   maxStates  give up after this many distinct states
 */
export function solve(sceneText: string, opts: { file?: string; mods?: Mods; stepTicks?: number; maxStates?: number } = {}): SolveResult {
  const { world, expects: raw } = parseScene(sceneText, opts.file);
  if (opts.mods) { world.pre = opts.mods.pre; world.post = opts.mods.post; }
  const expects = parseExpects(raw, world, opts.file).filter((e) => e.kind !== 'at' && e.kind !== 'count');
  const goals = expects.filter((e) => GOALS.includes(e.kind)).length;
  const stepTicks = opts.stepTicks ?? 5, maxStates = opts.maxStates ?? 200000;
  const fail = (note: string, tick = 0, states = 0): SolveResult => ({ ok: false, input: '', tick, states, note });
  if (!goals) return fail('nothing to solve: the scene has no reach, gone or event expectation');
  const limit = Math.max(...expects.filter((e) => GOALS.includes(e.kind)).map((e) => e.by));

  // Key choices: jumping controllers need up combined with a direction; 4-way ones do not.
  const ctrls = world.query('ctrl').map((id) => world.get(id, 'ctrl')!);
  const jumper = ctrls.some((c) => (c.jump as number) > 0), ground = ctrls.some((c) => c.plane === 'xz');
  const walk = [[], ['right'], ['left'], ['down'], ['up']];
  const choices = ground
    ? (jumper ? [...walk, ...walk.map((k) => ['a', ...k])] : walk)
    : jumper ? [[], ['right'], ['left'], ['up'], ['up', 'right'], ['up', 'left']] : walk;

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
      // Walls and maps never change; a crate is solid but does move.
      if (name == null || (n.w.has(id, 'solid') && !n.w.has(id, 'push')) || n.w.has(id, 'tiles')) return;
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

  // Distance still to cover for the nearest open goal, in fixed-point units.
  const nearest = (w: World, ids: number[], others: number[]): number => {
    let m = Infinity;
    for (const i of ids) for (const o of others) {
      const g = i === o ? null : gap(w, i, o);
      if (g !== null) m = Math.min(m, Math.max(g, 0));
    }
    return m;
  };
  const heuristic = (n: Node): number => {
    let h = Infinity;
    for (const e of n.ex) {
      if (e.ok || !GOALS.includes(e.kind)) continue;
      let d = Infinity;
      if (e.kind === 'reach') {
        d = nearest(n.w, n.w.match(e.a), n.w.match(e.b));
        // When the thing that has to arrive is not steered directly (a crate), getting the
        // steered entity next to it comes first; that is a much weaker pull than the goal itself.
        const ctrl = n.w.query('ctrl'), movers = n.w.match(e.a).filter((id) => !ctrl.includes(id));
        if (movers.length) { const c = nearest(n.w, ctrl, movers); if (c !== Infinity) d = d * 16 + c; }
      }
      else {
        // gone: whoever the entity's own trigger waits for. event: the triggers that emit it.
        const ids = e.kind === 'gone' ? n.w.match(e.a) : n.w.query('trigger').filter((id) => n.w.get(id, 'trigger')!.event === e.a);
        for (const id of ids) {
          const tr = n.w.get(id, 'trigger');
          if (tr) d = Math.min(d, nearest(n.w, [id], n.w.match(tr.target as string)));
        }
      }
      h = Math.min(h, d);
    }
    return h === Infinity ? 0 : h;
  };
  // Order: fewer open goals first, then nearer to one, then shorter inputs; ties by age.
  // All integers, so the search order (and the answer) is the same on every machine.
  const rank = (n: Node): number => (goals - n.done) * 2 ** 36 + heuristic(n) + n.depth * 2048;

  const heap: Node[] = [];
  const less = (a: Node, b: Node): boolean => a.f < b.f || (a.f === b.f && a.seq < b.seq);
  const push = (n: Node): void => {
    let i = heap.push(n) - 1;
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (!less(heap[i], heap[up])) break;
      [heap[i], heap[up]] = [heap[up], heap[i]];
      i = up;
    }
  };
  const pop = (): Node => {
    const top = heap[0], last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && less(heap[l], heap[m])) m = l;
        if (r < heap.length && less(heap[r], heap[m])) m = r;
        if (m === i) break;
        [heap[i], heap[m]] = [heap[m], heap[i]];
        i = m;
      }
    }
    return top;
  };

  evalTick(world, expects);
  let seq = 0;
  const root: Node = { w: world, ex: expects, parent: null, keys: [], done: count(expects), depth: 0, f: 0, seq: seq++ };
  const seen = new Set([key(root)]);
  push(root);
  // Furthest attempt so far: fewest open goals, then nearest to the next one.
  let best = root, bestF = Infinity, goal: Node | null = root.done === goals ? root : null;

  while (heap.length && !goal && seen.size <= maxStates) {
    const n = pop();
    if (n.w.tick >= limit) continue;
    for (const keys of choices) {
      const c: Node = { w: cloneWorld(n.w), ex: n.ex.map((e) => ({ ...e })), parent: n, keys, done: 0, depth: n.depth + 1, f: 0, seq: seq++ };
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
      if (c.done === goals) { goal = c; break; }
      c.f = rank(c);
      if (c.f - c.depth * 2048 < bestF) { best = c; bestF = c.f - c.depth * 2048; }
      push(c);
    }
  }

  // Walk back to the root and write key changes as an input script.
  const script = (end: Node): string => {
    const path: Node[] = [];
    for (let n: Node | null = end; n && n.parent; n = n.parent) path.unshift(n);
    const lines: string[] = [];
    let held: string[] = [], t = root.w.tick;
    for (const n of path) {
      for (const a of held) if (!n.keys.includes(a)) lines.push(`${t} ${a} up`);
      for (const a of n.keys) if (!held.includes(a)) lines.push(`${t} ${a} down`);
      held = n.keys;
      t += stepTicks;
    }
    for (const a of held) lines.push(`${t} ${a} up`);
    return lines.join('\n') + (lines.length ? '\n' : '');
  };

  if (!goal) {
    const open = best.ex.find((e) => GOALS.includes(e.kind) && !e.ok)!;
    const why = seen.size > maxStates ? `gave up after ${maxStates} states` : `no input reaches the goals by tick ${limit}`;
    return { ...fail(`${why}; best run met ${best.done}/${goals}, still open: ${open.text}${open.note ? ` (${open.note})` : ''}`, best.w.tick, seen.size), input: script(best) };
  }

  return { ok: true, input: script(goal), tick: goal.w.tick, states: seen.size, note: '' };
}
