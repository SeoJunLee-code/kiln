import { ONE, fdiv, isqrt, sinCos24, tickShare, wrapDeg } from './fx.ts';
import { physicsHash, physicsStep, physicsSweep, physicsSync } from './physics.ts';
import { KilnFail, serialize, suggest } from './scene.ts';
import type { Diag } from './scene.ts';
import type { Comp, World } from './world.ts';

export const ACTIONS = ['left', 'right', 'up', 'down', 'a', 'b'];
export type InputScript = Map<number, [string, boolean][]>;

/** Input script: one `TICK ACTION down|up` per line. */
export function parseInput(text: string, file = 'input'): InputScript {
  const script: InputScript = new Map();
  const diags: Diag[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const tok = raw.replace(/#.*$/, '').trim().split(/\s+/);
    if (!tok[0]) return;
    const err = (msg: string, hint?: string) => diags.push({ code: 'K200', file, line: i + 1, msg, hint });
    if (tok.length !== 3 || !/^\d+$/.test(tok[0])) return err(`expected 'TICK ACTION down|up'`);
    if (!ACTIONS.includes(tok[1])) return err(`unknown action '${tok[1]}'`, suggest(tok[1], ACTIONS) ?? `valid: ${ACTIONS.join(' ')}`);
    if (tok[2] !== 'down' && tok[2] !== 'up') return err(`state must be 'down' or 'up', got '${tok[2]}'`);
    const t = +tok[0];
    if (!script.has(t)) script.set(t, []);
    script.get(t)!.push([tok[1], tok[2] === 'down']);
  });
  if (diags.length) throw new KilnFail(diags);
  return script;
}

// Axis tables: position field and the matching size field. 2D scenes simply never move on z.
const P = ['x', 'y', 'z'], S = ['w', 'h', 'd'];

/** Do two boxes overlap on all three axes? (Every box has depth 1 at z 0 unless the scene says otherwise.) */
export function overlap(ap: Comp, ab: Comp, bp: Comp, bb: Comp): boolean {
  for (let a = 0; a < 3; a++) {
    const x = ap[P[a]] as number, y = bp[P[a]] as number;
    if (!(x < y + (bb[S[a]] as number) && x + (ab[S[a]] as number) > y)) return false;
  }
  return true;
}

const rowCache = new WeakMap<Comp, { src: string; rows: string[] }>();

/** Rows of a tiles component, split once per distinct content. */
export function tileRows(t: Comp): string[] {
  const src = t.rows as string;
  let c = rowCache.get(t);
  if (!c || c.src !== src) rowCache.set(t, (c = { src, rows: src.split('\n') }));
  return c.rows;
}

/** Tile character at a point of the map's own plane (x and y, or x and z for plane=xz), or '' outside the map. */
export function tileAt(w: World, map: number, x: number, v: number): string {
  const t = w.get(map, 'tiles')!, mp = w.get(map, 'pos')!;
  const row = tileRows(t)[fdiv(v - (mp[t.plane === 'xz' ? 'z' : 'y'] as number), t.size as number)];
  return row?.[fdiv(x - (mp.x as number), t.size as number)] ?? '';
}

/** A blocking box: position on x, y, z, size on x, y, z, then the entity id (-1 for a tile). */
export type Block = [x: number, y: number, z: number, w: number, h: number, d: number, id: number];

/**
 * Solids bucketed on a coarse x/y grid, rebuilt every tick. A query then looks only at
 * the cells its region touches instead of at every solid in the world.
 */
export interface SolidIndex { ids: number[]; box: Block[]; cells: Map<number, number[]>; big: number[]; seen: Int32Array; query: number }

// Cell edge is 4 units (2^18 in fixed-point), so a shift gives the cell coordinate.
const CELL_SHIFT = 18;
const cellKey = (cx: number, cy: number): number => (cx + 32768) * 65536 + (cy + 32768);

export function buildIndex(w: World, solids: number[]): SolidIndex {
  const ids: number[] = [], box: Block[] = [], cells = new Map<number, number[]>(), big: number[] = [];
  for (const s of solids) {
    const sp = w.get(s, 'pos')!, sb = w.get(s, 'box')!;
    const r: Block = [sp.x as number, sp.y as number, sp.z as number, sb.w as number, sb.h as number, sb.d as number, s];
    const i = ids.push(s) - 1;
    box.push(r);
    const x0 = r[0] >> CELL_SHIFT, x1 = (r[0] + r[3] - 1) >> CELL_SHIFT, y0 = r[1] >> CELL_SHIFT, y1 = (r[1] + r[4] - 1) >> CELL_SHIFT;
    // Something that covers many cells (a floor, a wall) is cheaper to test every time.
    // Crates are kept there too: they move during the tick, and a cell entry would go stale.
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 64 || w.has(s, 'push')) { big.push(i); continue; }
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
      const k = cellKey(cx, cy);
      const list = cells.get(k);
      if (list) list.push(i);
      else cells.set(k, [i]);
    }
  }
  return { ids, box, cells, big, seen: new Int32Array(ids.length), query: 0 };
}

/**
 * Solid boxes and solid tiles that overlap the region lo..hi (half-open on each axis), except `self`.
 * The callers only take minima and maxima over the result, so its order does not affect the simulation.
 */
export function blockers(w: World, self: number, index: SolidIndex, maps: number[], lo: number[], hi: number[]): Block[] {
  const out: Block[] = [];
  const q = ++index.query;
  const test = (i: number): void => {
    if (index.seen[i] === q) return;
    index.seen[i] = q;
    if (index.ids[i] === self) return;
    const r = index.box[i];
    if (lo[0] < r[0] + r[3] && hi[0] > r[0] && lo[1] < r[1] + r[4] && hi[1] > r[1] && lo[2] < r[2] + r[5] && hi[2] > r[2]) out.push(r);
  };
  for (const i of index.big) test(i);
  const x1 = (hi[0] - 1) >> CELL_SHIFT, y1 = (hi[1] - 1) >> CELL_SHIFT;
  for (let cx = lo[0] >> CELL_SHIFT; cx <= x1; cx++) for (let cy = lo[1] >> CELL_SHIFT; cy <= y1; cy++) {
    const list = index.cells.get(cellKey(cx, cy));
    if (list) for (const i of list) test(i);
  }
  for (const m of maps) {
    const t = w.get(m, 'tiles')!, mp = w.get(m, 'pos')!;
    const size = t.size as number, solid = t.solid as string, rows = tileRows(t);
    // Rows run along `vi` (y, or z for a floor plan); `wi` is the axis the cells are extruded on.
    const vi = t.plane === 'xz' ? 2 : 1, wi = 3 - vi;
    const at = [mp.x as number, mp.y as number, mp.z as number], depth = t.depth as number;
    if (!(lo[wi] < at[wi] + depth && hi[wi] > at[wi])) continue;
    const c0 = Math.max(0, fdiv(lo[0] - at[0], size)), c1 = fdiv(hi[0] - 1 - at[0], size);
    const r0 = Math.max(0, fdiv(lo[vi] - at[vi], size)), r1 = Math.min(rows.length - 1, fdiv(hi[vi] - 1 - at[vi], size));
    for (let r = r0; r <= r1; r++) {
      const row = rows[r];
      for (let c = c0; c <= c1 && c < row.length; c++) {
        if (!solid.includes(row[c])) continue;
        const b: Block = [at[0] + c * size, 0, 0, size, 0, 0, -1];
        b[vi] = at[vi] + r * size;
        b[vi + 3] = size;
        b[wi] = at[wi];
        b[wi + 3] = depth;
        out.push(b);
      }
    }
  }
  return out;
}

/** Move a crate along one axis by up to `want`, stopping at whatever blocks it. Returns how far it went. */
function shove(w: World, crate: Block, a: number, want: number, index: SolidIndex, maps: number[]): number {
  const from = crate[a];
  let to = (from + want) | 0;
  const lo = [crate[0], crate[1], crate[2]], hi = [crate[0] + crate[3], crate[1] + crate[4], crate[2] + crate[5]];
  lo[a] = Math.min(from, to);
  hi[a] = Math.max(from, to) + crate[a + 3];
  for (const r of blockers(w, crate[6], index, maps, lo, hi)) {
    to = want > 0 ? Math.min(to, r[a] - crate[a + 3]) : Math.max(to, r[a] + r[a + 3]);
  }
  if (w.physics && to !== from) {
    const hit = physicsSweep(w, [crate[0], crate[1], crate[2]], [crate[3], crate[4], crate[5]], a, to - from, want);
    if (hit) to = from + hit.go;
  }
  // The same array sits in the index, so later queries this tick see the crate where it now is.
  crate[a] = to;
  w.get(crate[6], 'pos')![P[a]] = to;
  return to - from;
}

/**
 * Turn a quaternion component by the angle vector (tx, ty, tz), in degrees about the world
 * axes. The small turn is built at 2^24 scale and the product rounded to fixed-point once,
 * so the error per tick is half a unit and does not lean one way.
 */
export function spinQuat(q: Comp, tx: number, ty: number, tz: number): void {
  const angle = isqrt(tx * tx + ty * ty + tz * tz);
  if (angle === 0) return;
  const [s, c] = sinCos24(angle >> 1);
  const ax = Math.round((tx * s) / angle), ay = Math.round((ty * s) / angle), az = Math.round((tz * s) / angle);
  const x = q.x as number, y = q.y as number, z = q.z as number, v = q.w as number;
  // (ax, ay, az, c) * (x, y, z, v): the new turn applied after the old one.
  const nx = c * x + ax * v + ay * z - az * y;
  const ny = c * y - ax * z + ay * v + az * x;
  const nz = c * z + ax * y - ay * x + az * v;
  const nw = c * v - ax * x - ay * y - az * z;
  // Back to unit length. The four are at 2^40 scale; 2^-12 brings their squares under 2^53.
  const px = Math.round(nx / 4096), py = Math.round(ny / 4096), pz = Math.round(nz / 4096), pw = Math.round(nw / 4096);
  const len = isqrt(px * px + py * py + pz * pz + pw * pw);
  if (len === 0) return;
  q.x = Math.round((px * ONE) / len); q.y = Math.round((py * ONE) / len); q.z = Math.round((pz * ONE) / len); q.w = Math.round((pw * ONE) / len);
}

/** Advance one fixed tick. System order is fixed: input, ctrl, pace, scripts (pre), gravity, move, physics, turn, triggers, scripts (post). */
export function step(w: World, script?: InputScript): void {
  for (const [action, down] of script?.get(w.tick) ?? []) {
    if (down) w.pressed.add(action);
    else w.pressed.delete(action);
  }
  const k = w.tick % w.hz;
  const on = (a: string): number => (w.pressed.has(a) ? 1 : 0);

  for (const id of w.query('ctrl', 'vel')) {
    const c = w.get(id, 'ctrl')!, v = w.get(id, 'vel')!;
    const speed = c.speed as number, jump = c.jump as number;
    v.x = (on('right') - on('left')) * speed;
    if (c.plane === 'xz') {
      // Ground plane is x/z: up/down walk along z, and `a` jumps.
      v.z = (on('down') - on('up')) * speed;
      if (jump > 0 && on('a') && w.get(id, 'body')?.grounded) v.y = -jump;
    } else if (jump > 0) {
      if (on('up') && w.get(id, 'body')?.grounded) v.y = -jump;
    } else v.y = (on('down') - on('up')) * speed;
  }

  for (const id of w.query('pace', 'pos', 'vel')) {
    const c = w.get(id, 'pace')!, p = w.get(id, 'pos')!, v = w.get(id, 'vel')!, a = c.axis as string;
    if ((p[a] as number) >= (c.max as number)) v[a] = -(c.speed as number);
    else if ((p[a] as number) <= (c.min as number) || v[a] === 0) v[a] = c.speed;
  }

  for (const sys of w.pre) sys(w);

  for (const id of w.query('body', 'vel')) {
    // The backend gives a rigid body its gravity; adding it here too would read as a script changing its speed.
    if (w.physics && w.has(id, 'rigid')) continue;
    const v = w.get(id, 'vel')!;
    v.x = ((v.x as number) + tickShare(w.gx, k, w.hz)) | 0;
    v.y = ((v.y as number) + tickShare(w.gy, k, w.hz)) | 0;
    v.z = ((v.z as number) + tickShare(w.gz, k, w.hz)) | 0;
  }

  const index = buildIndex(w, w.query('solid', 'pos', 'box'));
  const maps = w.query('tiles', 'pos');
  if (w.physics) physicsSync(w);
  for (const id of w.query('pos', 'vel')) {
    // A rigid body is moved by the physics backend, below.
    if (w.physics && w.has(id, 'rigid')) continue;
    const p = w.get(id, 'pos')!, v = w.get(id, 'vel')!, b = w.get(id, 'box');
    const cur = [p.x as number, p.y as number, p.z as number];
    const d = [tickShare(v.x as number, k, w.hz), tickShare(v.y as number, k, w.hz), tickShare(v.z as number, k, w.hz)];
    if (!b || w.has(id, 'solid')) {
      for (let a = 0; a < 3; a++) p[P[a]] = (cur[a] + d[a]) | 0;
      continue;
    }
    // Swept test per axis: a solid anywhere along the path stops the mover, however fast it is.
    const size = [b.w as number, b.h as number, b.d as number];
    const body = w.get(id, 'body');
    // Standing on something that moves: go along with it sideways. (Vertically the platform
    // itself does the work: it is solid, so it lifts or drops whatever rests on it.)
    if (body?.ride) {
      const pid = w.ids.get(body.ride as string), pv = pid === undefined ? undefined : w.get(pid, 'vel');
      if (pv) {
        d[0] += tickShare(pv.x as number, k, w.hz);
        d[2] += tickShare(pv.z as number, k, w.hz);
      }
    }
    let grounded = 0, ride = -1;
    for (let a = 0; a < 3; a++) {
      if (d[a] === 0) continue;
      let under = -1;
      const from = cur[a], free = (from + d[a]) | 0;
      let to = free;
      const lo = [...cur], hi = [cur[0] + size[0], cur[1] + size[1], cur[2] + size[2]];
      lo[a] = Math.min(from, to);
      hi[a] = Math.max(from, to) + size[a];
      const stop = (r: Block): void => { to = d[a] > 0 ? Math.min(to, r[a] - size[a]) : Math.max(to, r[a] + r[a + 3]); };
      const hits = blockers(w, id, index, maps, lo, hi);
      // Crates in the way. With gravity on y, y is up/down and crates are not pushed along it;
      // without gravity (top-down) y is a ground axis like x. Only the nearest crate is shoved.
      const crates = a === 1 && w.gy !== 0 ? [] : hits.filter((r) => r[6] >= 0 && w.has(r[6], 'push'));
      for (const r of hits) if (!crates.includes(r)) stop(r);
      if (crates.length) {
        const near = crates.reduce((m, r) => ((d[a] > 0 ? r[a] < m[a] : r[a] > m[a]) ? r : m));
        const contact = d[a] > 0 ? near[a] - size[a] : near[a] + near[a + 3];
        // `to` is where the mover would end up without crates; anything past the contact point is the shove.
        if (d[a] > 0 ? to > contact : to < contact) to = contact + shove(w, near, a, to - contact, index, maps);
        for (const r of crates) if (r !== near) stop(r);
      }
      // Rigid bodies stand in the way too. They are turned boxes and balls that only the
      // backend knows exactly, so it is asked how far this box can go before touching one.
      if (w.physics && to !== from) {
        const hit = physicsSweep(w, cur, size, a, to - from, d[a]);
        if (hit) { to = from + hit.go; under = hit.id; }
      }
      if (to !== free) {
        v[P[a]] = 0;
        if (a === 1 && d[a] > 0) {
          grounded = 1;
          // What it landed on: the entity whose top it now rests on (lowest id if several).
          for (const r of hits) if (r[6] >= 0 && r[1] - size[1] === to && (ride < 0 || r[6] < ride)) ride = r[6];
          if (under >= 0 && (ride < 0 || under < ride)) ride = under;
        }
      }
      cur[a] = to;
    }
    for (let a = 0; a < 3; a++) p[P[a]] = cur[a];
    if (body) {
      body.grounded = grounded;
      body.ride = ride >= 0 ? w.names[ride]! : '';
    }
  }

  if (w.physics) physicsStep(w);

  // Turning. An angle is added to exactly, like a position. A quaternion is multiplied by
  // this tick's small turn and then scaled back to unit length, all in fixed-point.
  for (const id of w.query('rot')) {
    const r = w.get(id, 'rot')!;
    if (r.spin) r.angle = wrapDeg((r.angle as number) + tickShare(r.spin as number, k, w.hz));
  }
  for (const id of w.query('quat')) {
    const q = w.get(id, 'quat')!;
    if (w.physics && w.has(id, 'rigid')) continue;
    if (q.sx || q.sy || q.sz) spinQuat(q, tickShare(q.sx as number, k, w.hz), tickShare(q.sy as number, k, w.hz), tickShare(q.sz as number, k, w.hz));
  }

  w.tick++;

  const doomed: number[] = [];
  for (const t of w.query('trigger', 'pos', 'box')) {
    const tr = w.get(t, 'trigger')!, tp = w.get(t, 'pos')!, tb = w.get(t, 'box')!;
    for (const o of w.match(tr.target as string)) {
      const op = w.get(o, 'pos'), ob = w.get(o, 'box');
      if (o === t || !op || !ob) continue;
      const key = `${w.names[t]}:${w.names[o]}`;
      if (!overlap(tp, tb, op, ob)) { w.overlaps.delete(key); continue; }
      if (w.overlaps.has(key)) continue;
      w.overlaps.add(key);
      w.events.push({ tick: w.tick, name: tr.event as string, a: w.names[t]!, b: w.names[o]! });
      for (const act of (tr.action as string).split('+')) {
        if (act === 'despawn-self') doomed.push(t);
        else if (act === 'despawn-other') doomed.push(o);
        else if (act.startsWith('despawn:')) doomed.push(...w.match(act.slice(8)));
        // Headless this is only an event; the player reacts to it by opening the scene.
        else if (act.startsWith('load:')) w.events.push({ tick: w.tick, name: 'load', a: act.slice(5), b: w.names[o]! });
      }
    }
  }
  for (const id of doomed) w.despawn(id);
  for (const sys of w.post) sys(w);
}

/**
 * FNV-1a hash of the full simulation state. Equal hash = identical state. With a physics
 * backend running, its exact state is hashed too: the scene text holds it only rounded.
 */
export function hash(w: World): string {
  const s = serialize(w) + physicsHash(w);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, '0');
}
