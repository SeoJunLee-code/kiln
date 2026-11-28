// Navigation: movers with `nav` walk to their target around whatever is solid.
//
// The way is found on a square grid by A*, in fixed-point and integers only, so every
// machine finds the same one. A mover plans one cell ahead: it picks the next cell,
// walks to its centre, and looks again, so a door that opens or a target that moves is
// noticed a cell later. What it is doing is in the component, so a saved state goes on
// the same way. Loaded when a game uses `nav`; others do not carry it.
import { ONE } from './fx.ts';
import { blockers, buildIndex, nav } from './sim.ts';
import type { SolidIndex } from './sim.ts';
import type { Comp, World } from './world.ts';

/** Cells looked at per plan, at most: past that the mover heads for the closest one it found. */
const LIMIT = 4096;
/** 1/√2 in fixed-point: a diagonal step covers no more ground per second than a straight one. */
const DIAGONAL = 46341;
// The eight neighbours: straight ones first, so that ties go to them. Costs are 10 and 14.
const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [-1, -1], [1, -1]];

/** What one mover's planning needs to know about the ground. */
interface Ground {
  w: World; id: number; index: SolidIndex; maps: number[];
  cell: number;
  /** The two axes of the floor, and the third. */
  u: number; v: number; t: number;
  /** The mover's box: its size, and where it is on the third axis. */
  size: number[]; third: number;
}

const SIZE = ['w', 'h', 'd'], AXIS = ['x', 'y', 'z'];
const LO = [0, 0, 0], HI = [0, 0, 0];

/** Is anything solid in the way of the mover's box when its centre goes straight from one point to the other? */
function blocked(g: Ground, au: number, av: number, bu: number, bv: number): boolean {
  const hu = g.size[g.u] >> 1, hv = g.size[g.v] >> 1;
  LO[g.u] = Math.min(au, bu) - hu; HI[g.u] = Math.max(au, bu) - hu + g.size[g.u];
  LO[g.v] = Math.min(av, bv) - hv; HI[g.v] = Math.max(av, bv) - hv + g.size[g.v];
  LO[g.t] = g.third; HI[g.t] = g.third + g.size[g.t];
  return blockers(g.w, g.id, g.index, g.maps, LO, HI).length > 0;
}

const key = (cu: number, cv: number): number => (cu + 32768) * 65536 + (cv + 32768);

/**
 * The first cell after `from` on a shortest way to `to` (cells as [u, v]), or the way to
 * the closest cell to it that can be reached; null when no step gets any closer.
 */
export function firstStep(open: (cu: number, cv: number) => boolean, from: number[], to: number[]): number[] | null {
  const guess = (cu: number, cv: number): number => {
    const du = Math.abs(cu - to[0]), dv = Math.abs(cv - to[1]);
    return 10 * Math.max(du, dv) + 4 * Math.min(du, dv);
  };
  // A binary heap of [estimate through here, estimate left, order found, u, v, cost, first step].
  const heap: number[][] = [];
  const less = (a: number[], b: number[]): boolean => (a[0] - b[0] || a[1] - b[1] || a[2] - b[2]) < 0;
  let found = 0;
  const push = (cu: number, cv: number, cost: number, first: number[] | null): void => {
    const h = guess(cu, cv), e: number[] = [cost + h, h, found++, cu, cv, cost, ...(first ?? [])];
    let i = heap.push(e) - 1;
    for (let up = (i - 1) >> 1; i > 0 && less(e, heap[up]); up = (i - 1) >> 1) { heap[i] = heap[up]; i = up; }
    heap[i] = e;
  };
  const pop = (): number[] => {
    const top = heap[0], last = heap.pop()!;
    if (heap.length) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= heap.length) break;
        if (c + 1 < heap.length && less(heap[c + 1], heap[c])) c++;
        if (!less(heap[c], last)) break;
        heap[i] = heap[c];
        i = c;
      }
      heap[i] = last;
    }
    return top;
  };

  const best = new Map<number, number>([[key(from[0], from[1]), 0]]);
  const done = new Set<number>();
  push(from[0], from[1], 0, null);
  let closest: number[] = heap[0];
  while (heap.length && done.size < LIMIT) {
    const at = pop(), cu = at[3], cv = at[4], k = key(cu, cv);
    if (done.has(k)) continue;
    done.add(k);
    if (at[1] < closest[1]) closest = at;
    if (at[1] === 0) break;
    for (let i = 0; i < 8; i++) {
      const [du, dv] = DIRS[i], nu = cu + du, nv = cv + dv, nk = key(nu, nv);
      const cost = at[5] + (i < 4 ? 10 : 14);
      if (done.has(nk) || cost >= (best.get(nk) ?? Infinity)) continue;
      // A diagonal step needs both cells beside it: corners are not cut.
      if (!open(nu, nv) || (i >= 4 && (!open(nu, cv) || !open(cu, nv)))) continue;
      best.set(nk, cost);
      push(nu, nv, cost, at.length > 6 ? [at[6], at[7]] : [nu, nv]);
    }
  }
  return closest.length > 6 ? [closest[6], closest[7]] : null;
}

const cellOf = (x: number, size: number): number => Math.floor(x / size);
const centreOf = (c: number, size: number): number => c * size + (size >> 1);

/** The centre of a thing along one axis: the middle of its box, or its pos. */
const middle = (w: World, id: number, a: number): number => (w.get(id, 'pos')![AXIS[a]] as number) + (((w.get(id, 'box')?.[SIZE[a]] as number | undefined) ?? 0) >> 1);

/** The nearest entity the name or #tag stands for, itself aside; ties go to the lowest id. */
function target(w: World, id: number, ref: string, u: number, v: number): number | undefined {
  let found: number | undefined, near = Infinity;
  for (const t of w.match(ref)) {
    if (t === id || !w.has(t, 'pos')) continue;
    const du = (middle(w, t, u) - middle(w, id, u)) / ONE, dv = (middle(w, t, v) - middle(w, id, v)) / ONE;
    if (du * du + dv * dv < near) { near = du * du + dv * dv; found = t; }
  }
  return found;
}

function steer(w: World, ids: number[]): void {
  let ground: { index: SolidIndex; maps: number[] } | undefined;
  for (const id of ids) {
    const n: Comp = w.get(id, 'nav')!, p = w.get(id, 'pos')!, vel = w.get(id, 'vel')!, b = w.get(id, 'box');
    if (!b) continue;
    const flat = n.plane === 'xz', u = 0, v = flat ? 2 : 1;
    const cu = middle(w, id, u), cv = middle(w, id, v);
    const stop = (): void => { vel.x = 0; vel[AXIS[v]] = 0; n.on = 0; };
    const goal = target(w, id, n.to as string, u, v);
    if (goal === undefined) { stop(); n.there = 0; continue; }
    const gu = middle(w, goal, u), gv = middle(w, goal, v);
    const du = (gu - cu) / ONE, dv = (gv - cv) / ONE, reach = (n.reach as number) / ONE;
    if (du * du + dv * dv <= reach * reach) {
      if (!n.there && n.event) w.emit(n.event as string, w.names[id]!, w.names[goal]!);
      n.there = 1;
      stop();
      continue;
    }
    n.there = 0;

    if (n.on && cu === n.nx && cv === n.ny) n.on = 0;
    let wu = n.nx as number, wv = n.ny as number;
    if (!n.on) {
      if (!ground) {
        // What stands still: solids that do not move, and solid tiles.
        const solids = w.query('solid', 'pos', 'box').filter((s) => !w.has(s, 'vel'));
        ground = { index: buildIndex(w, solids), maps: w.query('tiles', 'pos') };
      }
      const cell = n.cell as number, third = 3 - v;
      const g: Ground = { w, id, ...ground, cell, u, v, t: third, size: [b.w as number, b.h as number, b.d as number], third: p[AXIS[third]] as number };
      const from = [cellOf(cu, cell), cellOf(cv, cell)], to = [cellOf(gu, cell), cellOf(gv, cell)];
      if (from[0] === to[0] && from[1] === to[1]) {
        // The last stretch: straight to the target. Not remembered, since the target may move.
        wu = gu; wv = gv;
      } else {
        const known = new Map<number, boolean>();
        const open = (a: number, c: number): boolean => {
          const k = key(a, c);
          let is = known.get(k);
          if (is === undefined) known.set(k, is = !blocked(g, centreOf(a, cell), centreOf(c, cell), centreOf(a, cell), centreOf(c, cell)));
          return is;
        };
        const next = firstStep(open, from, to);
        if (!next) { stop(); continue; }
        wu = centreOf(next[0], cell); wv = centreOf(next[1], cell);
        // Off the middle of its own cell, the straight way to the next could clip a corner.
        const home = [centreOf(from[0], cell), centreOf(from[1], cell)];
        if ((cu !== home[0] || cv !== home[1]) && blocked(g, cu, cv, wu, wv)) { wu = home[0]; wv = home[1]; }
        n.on = 1; n.nx = wu; n.ny = wv;
      }
    }

    const mu = wu - cu, mv = wv - cv, speed = n.speed as number;
    const most = mu && mv ? Math.floor((speed * DIAGONAL) / ONE) : speed;
    vel.x = Math.max(-most, Math.min(most, mu * w.hz)) | 0;
    vel[AXIS[v]] = Math.max(-most, Math.min(most, mv * w.hz)) | 0;
  }
}

nav.run = steer;
