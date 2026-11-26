// Because a run is fully determined by scene + input, the engine can search the input
// space itself: over "which keys are held for the next few ticks", nearest-to-a-goal
// first, with identical states merged. A result is a proof that the level can be finished, as an
// input script that `kiln test` replays.
import { evalTick, gap, parseExpects } from './expect.ts';
import type { Expect } from './expect.ts';
import type { Mods } from './run.ts';
import { parseScene } from './scene.ts';
import { freeLink, restoreLink, saveLink } from './physics.ts';
import type { SavedLink } from './physics.ts';
import { step, tileRows } from './sim.ts';
import { World, registry } from './world.ts';

/** Independent copy of a world. Script systems are shared, so scripts must keep their state in components. */
export function cloneWorld(w: World): World {
  const c = new World();
  c.tick = w.tick; c.hz = w.hz; c.gx = w.gx; c.gy = w.gy; c.gz = w.gz; c.seed = w.seed; c.physics = w.physics;
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

// `phys` is the physics backend's state at this node: null before physics has started,
// undefined when it is not held (no physics, or dropped from the cache).
interface Node { w: World; ex: Expect[]; parent: Node | null; keys: string[]; done: number; depth: number; f: number; seq: number; phys?: SavedLink | null }

/** How many bytes of physics snapshots a search keeps before it drops the oldest. */
const PHYSICS_CACHE = 256 * 1024 * 1024;

export interface SolveResult {
  ok: boolean;
  /** input script that satisfies the goals when ok; otherwise the input of the attempt that got furthest */
  input: string;
  tick: number;
  states: number;
  note: string;
  /** Physics scenes only: search steps that had to be simulated again because their snapshot had left the cache. */
  resimulated?: number;
}

const GOALS = ['reach', 'gone', 'event'];

/**
 * Search for an input script that satisfies every reach/gone/event expectation without
 * breaking a `never` or a `count NAME == 0 at N`. Other `at` and `count` expectations are not
 * searched for (they are checked by `test`).
 *   stepTicks  how long each key choice is held (smaller = finer control, larger search)
 *   maxStates  give up after this many distinct states
 *   physicsCache  bytes of physics snapshots to keep (physics scenes only)
 */
export function solve(sceneText: string, opts: { file?: string; mods?: Mods; stepTicks?: number; maxStates?: number; physicsCache?: number } = {}): SolveResult {
  const { world, expects: raw } = parseScene(sceneText, opts.file);
  if (opts.mods) { world.pre = opts.mods.pre; world.post = opts.mods.post; }
  const parsed = parseExpects(raw, world, opts.file);
  const expects = parsed.filter((e) => e.kind !== 'at' && e.kind !== 'count');
  // `count NAME == 0 at N` says an event must not happen up to tick N. The search treats it like
  // `never`: a run that emits NAME by then is dropped.
  const forbidden = parsed.filter((e) => e.kind === 'count' && ((e.val === 0 && (e.op === '==' || e.op === '<=')) || (e.val === 1 && e.op === '<')));
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
  // Distance along the way round the walls, for top-down scenes on a tile grid. A straight line
  // points through walls, and through a door that is still closed. Cells are the cells of the
  // first map; walls are its solid tiles plus every solid thing that cannot move. The field for a
  // cell is found once per set of such things (a door that is removed changes the set).
  const map = jumper || ground ? undefined : world.query('tiles', 'pos').find((id) => world.get(id, 'tiles')!.plane === 'xy');
  const grid = map === undefined ? null : (() => {
    const tl = world.get(map, 'tiles')!, p = world.get(map, 'pos')!, rows = tileRows(tl);
    return { x: p.x as number, y: p.y as number, size: tl.size as number, rows, solid: tl.solid as string, w: Math.max(...rows.map((r) => r.length)), h: rows.length };
  })();
  const fields = new Map<string, Int32Array | null>();
  const cellOf = (w: World, id: number): number => {
    const p = w.get(id, 'pos'), b = w.get(id, 'box');
    if (!grid || !p || !b) return -1;
    const cx = Math.floor(((p.x as number) + ((b.w as number) >> 1) - grid.x) / grid.size), cy = Math.floor(((p.y as number) + ((b.h as number) >> 1) - grid.y) / grid.size);
    return cx < 0 || cy < 0 || cx >= grid.w || cy >= grid.h ? -1 : cy * grid.w + cx;
  };
  const fixed = (w: World): number[] => w.query('solid', 'pos', 'box').filter((id) => !w.has(id, 'push') && !w.has(id, 'vel') && !w.has(id, 'tiles'));
  /** Steps from every cell to the cell of `to`; null when `to` is walled in or off the map. */
  const field = (w: World, to: number, walls: number[], sig: string): Int32Array | null => {
    const start = cellOf(w, to);
    if (!grid || start < 0) return null;
    const k = `${sig}|${start}`;
    const had = fields.get(k);
    if (had !== undefined) return had;
    const blocked = new Uint8Array(grid.w * grid.h);
    grid.rows.forEach((row, r) => { for (let c = 0; c < row.length; c++) if (grid.solid.includes(row[c])) blocked[r * grid.w + c] = 1; });
    for (const id of walls) { const c = id === to ? -1 : cellOf(w, id); if (c >= 0) blocked[c] = 1; }
    let out: Int32Array | null = null;
    if (!blocked[start]) {
      out = new Int32Array(grid.w * grid.h).fill(-1);
      out[start] = 0;
      const queue = [start];
      for (let i = 0; i < queue.length; i++) {
        const c = queue[i], cx = c % grid.w;
        for (const nb of [cx > 0 ? c - 1 : -1, cx < grid.w - 1 ? c + 1 : -1, c - grid.w, c + grid.w]) {
          if (nb < 0 || nb >= blocked.length || blocked[nb] || out[nb] >= 0) continue;
          out[nb] = out[c] + 1;
          queue.push(nb);
        }
      }
    }
    fields.set(k, out);
    return out;
  };
  // A goal with no way to it yet still pulls, but less than any goal that can be walked to.
  const NO_WAY = 2 ** 27;
  const straight = nearest;
  const walked = (w: World, ids: number[], others: number[]): number => {
    if (!grid) return straight(w, ids, others);
    const walls = fixed(w), sig = walls.join(',');
    let m = Infinity;
    for (const i of ids) {
      const f = field(w, i, walls, sig);
      for (const o of others) {
        if (i === o) continue;
        const g = gap(w, i, o);
        if (g === null) continue;
        // The straight gap, plus the cells the walls add to the way: smooth where nothing is in
        // the way, and right about which side of a wall is nearer.
        const from = cellOf(w, i), at = cellOf(w, o), steps = f && at >= 0 ? f[at] : -1;
        const direct = Math.abs((from % grid.w) - (at % grid.w)) + Math.abs(Math.floor(from / grid.w) - Math.floor(at / grid.w));
        m = Math.min(m, Math.max(g, 0) + (steps < 0 ? NO_WAY : (steps - direct) * grid.size));
      }
    }
    return m;
  };
  const heuristic = (n: Node): number => {
    let h = Infinity;
    for (const e of n.ex) {
      if (e.ok || !GOALS.includes(e.kind)) continue;
      let d = Infinity;
      if (e.kind === 'reach') {
        d = walked(n.w, n.w.match(e.b), n.w.match(e.a));
        // When the thing that has to arrive is not steered directly (a crate), getting the
        // steered entity next to it comes first; that is a much weaker pull than the goal itself.
        const ctrl = n.w.query('ctrl'), movers = n.w.match(e.a).filter((id) => !ctrl.includes(id));
        if (movers.length) { const c = walked(n.w, movers, ctrl); if (c !== Infinity) d = d * 16 + c; }
      }
      else {
        // gone: whoever the entity's own trigger waits for. event: the triggers that emit it.
        const ids = e.kind === 'gone' ? n.w.match(e.a) : n.w.query('trigger').filter((id) => n.w.get(id, 'trigger')!.event === e.a);
        for (const id of ids) {
          const tr = n.w.get(id, 'trigger');
          if (tr) d = Math.min(d, walked(n.w, [id], n.w.match(tr.target as string)));
        }
      }
      h = Math.min(h, d);
    }
    return h === Infinity ? 0 : h;
  };
  // Order: fewer open goals first, then nearer to one, then shorter inputs; ties by age.
  // All integers, so the search order (and the answer) is the same on every machine.
  // A `gone #tag` goal is met one member at a time: each one still there counts, below a whole goal.
  const left = (n: Node): number => n.ex.reduce((s, e) => s + (e.kind === 'gone' && !e.ok ? Math.min(n.w.match(e.a).length, 63) : 0), 0);
  const rank = (n: Node): number => (goals - n.done) * 2 ** 36 + left(n) * 2 ** 29 + heuristic(n) + n.depth * 2048;

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

  // Physics scenes. A backend's state is too large to keep at every node, so snapshots
  // live in a cache with a byte budget. A node whose snapshot was dropped gets it back by
  // restoring the nearest ancestor that still has one and running the inputs between
  // them again; a restored snapshot continues exactly, so that gives the same state.
  const physics = !!world.physics, held: Node[] = [];
  let heldBytes = 0, resimulated = 0;
  const keep = (n: Node, saved: SavedLink | null): void => {
    n.phys = saved;
    if (!saved) return;
    held.push(n);
    heldBytes += saved.bytes;
    while (heldBytes > (opts.physicsCache ?? PHYSICS_CACHE) && held.length > 1) {
      const old = held.shift()!;
      heldBytes -= old.phys!.bytes;
      old.phys = undefined;
    }
  };
  /** Advance a copy of a node's world by one key choice. Returns false if a `never` broke. */
  const advance = (w: World, ex: Expect[], keys: string[]): boolean => {
    w.pressed = new Set(keys);
    for (let i = 0; i < stepTicks; i++) {
      step(w);
      evalTick(w, ex);
      if (ex.some((e) => e.ok === false)) return false;
      if (forbidden.length) for (let j = w.events.length - 1; j >= 0 && w.events[j].tick === w.tick; j--) {
        if (forbidden.some((f) => f.a === w.events[j].name && w.tick <= f.by)) return false;
      }
    }
    return true;
  };
  const physicsAt = (n: Node): SavedLink | null => {
    if (n.phys !== undefined) return n.phys;
    const path: Node[] = [];
    let from: Node = n;
    while (from.phys === undefined) { path.unshift(from); from = from.parent!; }
    const w = cloneWorld(from.w);
    restoreLink(w, from.phys);
    const ex = from.ex.map((e) => ({ ...e }));
    for (const p of path) advance(w, ex, p.keys);
    resimulated += path.length;
    const saved = saveLink(w);
    freeLink(w);
    keep(n, saved);
    return saved;
  };

  evalTick(world, expects);
  let seq = 0;
  const root: Node = { w: world, ex: expects, parent: null, keys: [], done: count(expects), depth: 0, f: 0, seq: seq++, phys: physics ? null : undefined };
  const seen = new Set([key(root)]);
  push(root);
  // Furthest attempt so far: fewest open goals, then nearest to the next one.
  let best = root, bestF = Infinity, goal: Node | null = root.done === goals ? root : null;

  while (heap.length && !goal && seen.size <= maxStates) {
    const n = pop();
    if (n.w.tick >= limit) continue;
    for (const keys of choices) {
      const c: Node = { w: cloneWorld(n.w), ex: n.ex.map((e) => ({ ...e })), parent: n, keys, done: 0, depth: n.depth + 1, f: 0, seq: seq++ };
      if (physics) restoreLink(c.w, physicsAt(n));
      const alive = advance(c.w, c.ex, keys);
      const k = alive ? key(c) : '';
      const fresh = alive && !seen.has(k);
      if (physics) {
        if (fresh) keep(c, saveLink(c.w));
        freeLink(c.w);
      }
      if (!fresh) continue;
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

  return { ok: true, input: script(goal), tick: goal.w.tick, states: seen.size, note: '', ...(physics ? { resimulated } : {}) };
}
