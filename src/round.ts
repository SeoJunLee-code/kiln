// `round`: an entity's outline is the circle inside its box, for blocking and for overlap.
//
// A part of its own: loaded when a game has something round, others do not carry it.
// Whole numbers only. Lengths are doubled so that a centre is a whole number too, and a
// root is rounded up, so the same sums give the same stop on every machine.
import { isqrt } from './fx.ts';
import { overlap, round } from './sim.ts';
import type { Block } from './sim.ts';
import type { World } from './world.ts';

const P = ['x', 'y'], S = ['w', 'h'];

/** The least whole number whose square is not under `n`. */
const rootUp = (n: number): number => { const r = isqrt(n); return r * r < n ? r + 1 : r; };

/**
 * Do two entities with pos and box overlap? As boxes, unless one is `round`: then its
 * outline in x and y is the circle inside its box. Lengths are doubled so that a centre
 * is a whole number; the sums stay whole and are the same on every machine.
 */
function meets(w: World, a: number, b: number): boolean {
  const ap = w.get(a, 'pos')!, ab = w.get(a, 'box')!, bp = w.get(b, 'pos')!, bb = w.get(b, 'box')!;
  if (!overlap(ap, ab, bp, bb)) return false;
  const ar = w.has(a, 'round'), br = w.has(b, 'round');
  if (!ar && !br) return true;
  let sum = 0;
  for (let i = 0; i < 2; i++) {
    const ac = 2 * (ap[P[i]] as number) + (ab[S[i]] as number), bc = 2 * (bp[P[i]] as number) + (bb[S[i]] as number);
    // From the centre of a circle to the other: its centre, or the nearest point of its box.
    const e = ar && br ? ac - bc : ar ? Math.max(0, 2 * (bp[P[i]] as number) - ac, ac - bc - (bb[S[i]] as number)) : Math.max(0, 2 * (ap[P[i]] as number) - bc, bc - ac - (ab[S[i]] as number));
    sum += e * e;
  }
  const reach = (ar ? Math.min(ab.w as number, ab.h as number) : 0) + (br ? Math.min(bb.w as number, bb.h as number) : 0);
  return sum < reach * reach;
}

/**
 * `stopped` when the mover (`mr`) or what is in its way (`rr`) is round, for a move
 * along x or y. The circle meets a flat side as a box would; past the end of a side it
 * meets the corner, or the other circle, later by the half chord at that height, or not
 * at all. The root is rounded up: a stop is never inside the other shape.
 */
function stoppedRound(to: number, way: number, cur: number[], size: number[], a: number, r: Block, mr: boolean, rr: boolean): number {
  const b = 1 - a, from = cur[a];
  const mc = 2 * cur[b] + size[b], rc = 2 * r[b] + r[b + 3], rca = 2 * r[a] + r[a + 3];
  const reach = (mr ? Math.min(size[0], size[1]) : 0) + (rr ? Math.min(r[3], r[4]) : 0);
  // How far apart they are across the move, and where along it the other's outline is centred.
  const e = mr && rr ? Math.abs(mc - rc) : mr ? Math.max(0, 2 * r[b] - mc, mc - rc - r[b + 3]) : Math.max(0, 2 * cur[b] - rc, rc - mc - size[b]);
  if (e >= reach) return to;
  const at = rr ? rca : way > 0 ? 2 * r[a] : 2 * (r[a] + r[a + 3]);
  // Already past it and moving away.
  if (way > 0 ? 2 * from + size[a] >= at : 2 * from + size[a] <= at) return to;
  const half = e ? rootUp(reach * reach - e * e) : reach;
  // The mover's centre stops there if it is the circle; its leading side does if it is a box.
  const lead = mr ? size[a] : way > 0 ? 2 * size[a] : 0;
  const stop = way > 0 ? Math.floor((at - half - lead) / 2) : Math.ceil((at + half - lead) / 2);
  return way > 0 ? Math.min(to, Math.max(stop, from)) : Math.max(to, Math.min(stop, from));
}

round.meets = meets;
round.stop = stoppedRound;
