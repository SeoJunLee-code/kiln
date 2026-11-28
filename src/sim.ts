import { ONE, fdiv, isqrt, sinCos24, tickShare, wrapDeg } from './fx.ts';
import { physicsHash, physicsStep, physicsSweep, physicsSync } from './physics.ts';
import { KilnFail, serialize, suggest } from './scene.ts';
import type { Diag } from './scene.ts';
import type { Comp, World } from './world.ts';

export const ACTIONS = ['left', 'right', 'up', 'down', 'a', 'b', 'enter'];
export type InputScript = Map<number, [string, boolean][]>;

/** Input script: one `TICK ACTION down|up` per line. */
export function parseInput(text: string, file = 'input'): InputScript {
  const script: InputScript = new Map();
  const diags: Diag[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const tok = raw.replace(/#.*$/, '').trim().split(/\s+/);
    // An input may carry expect lines of its own (run.ts reads them); they press no keys.
    if (!tok[0] || tok[0] === 'expect') return;
    const err = (msg: string, hint?: string) => diags.push({ code: 'K200', file, line: i + 1, msg, hint });
    if (tok.length !== 3 || !/^\d+$/.test(tok[0])) return err(`expected 'TICK ACTION down|up' or 'TICK BUTTON tap'`);
    // A click or tap on a button is input too, written with the button's entity name.
    if (tok[2] === 'tap') tok.splice(1, 2, `tap:${tok[1]}`, 'down');
    else {
      // 2:left is player 2's left; player 1's actions are the plain ones.
      const [, player, action] = /^(?:([1-9]\d?):)?(.*)$/.exec(tok[1])!;
      if (!ACTIONS.includes(action)) return err(`unknown action '${tok[1]}'`, suggest(action, ACTIONS) ?? `valid: ${ACTIONS.join(' ')}, with N: before it for player N`);
      if (player === '1') tok[1] = action;
    }
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

// A tick should need no new memory: its lists and arrays are kept here and filled again.
// step() never runs inside itself, so one set serves every world, none of it is state, and
// none of it hangs off a World (solve keeps a great many of those).

/** A query asked every tick: the component names, and the list it was last answered with. */
interface Ask { comps: string[]; out: number[]; world?: World; version: number }
export const ask = (...comps: string[]): Ask => ({ comps, out: [], version: 0 });
const CTRL = ask('ctrl', 'vel'), PACE = ask('pace', 'pos', 'vel'), ANIM = ask('anim', 'vel'), BODY = ask('body', 'vel');
const SOLID = ask('solid', 'pos', 'box'), MAPS = ask('tiles', 'pos'), MOVERS = ask('pos', 'vel'), ROT = ask('rot'), QUAT = ask('quat');
const NAV = ask('nav', 'pos', 'vel'), BUTTON = ask('button'), TRIGGER = ask('trigger', 'pos', 'box'), TAG = ask('tag'), TALLY = ask('tally');
export const TIMER = ask('timer'), WHEN = ask('when');

/** Cut a reused list to `n`. Not by setting `length`: that gives the list's memory back, to be asked for again. */
function trim(list: unknown[], n: number): void {
  while (list.length > n) list.pop();
}

/** The same ids as w.query, in the same order. Valid until the same question is asked again. */
export function find(w: World, q: Ask): number[] {
  const out = q.out;
  // Nobody has gained or lost a component since this was last asked: the answer stands.
  if (q.world === w && q.version === w.version) return out;
  q.world = w;
  q.version = w.version;
  const first = w.comps.get(q.comps[0]);
  asking.world = w; asking.q = q; asking.n = 0; asking.last = -1; asking.sorted = true;
  // forEach with a function made once: a for-of over the keys makes an iterator each time.
  first?.forEach(collect);
  trim(out, asking.n);
  if (!asking.sorted) out.sort((a, b) => a - b);
  return out;
}

const asking = { world: undefined as unknown as World, q: undefined as unknown as Ask, n: 0, last: -1, sorted: true };
function collect(_: unknown, id: number): void {
  const { world, q } = asking;
  for (let i = 1; i < q.comps.length; i++) if (!world.has(id, q.comps[i])) return;
  if (id < asking.last) asking.sorted = false;
  asking.last = q.out[asking.n++] = id;
}

/** What w.match(ref) answers, without building it anew. */
const TARGETS: number[] = [];
function targets(w: World, ref: string): number[] {
  let n = 0;
  if (ref.startsWith('#')) {
    for (let i = 0, ids = find(w, TAG); i < ids.length; i++) {
      const id = ids[i];
      const name = w.get(id, 'tag')!.name as string;
      if (name.length === ref.length - 1 && ref.endsWith(name)) TARGETS[n++] = id;
    }
  } else {
    const id = w.ids.get(ref);
    if (id !== undefined) TARGETS[n++] = id;
  }
  trim(TARGETS, n);
  return TARGETS;
}

// "trigger:other" as w.overlaps holds it, made once for a pair of names rather than every tick.
const pairs = new Map<string, Map<string, string>>();
let pairCount = 0;
function pairKey(a: string, b: string): string {
  let of = pairs.get(a);
  let key = of?.get(b);
  if (key !== undefined) return key;
  // A game that keeps spawning new names must not grow this for ever.
  if (pairCount >= 20000) { pairs.clear(); pairCount = 0; of = undefined; }
  if (!of) pairs.set(a, (of = new Map()));
  of.set(b, (key = `${a}:${b}`));
  pairCount++;
  return key;
}

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
export interface SolidIndex { ids: number[]; box: Block[]; cells: Map<number, number[]>; big: number[]; crate: boolean[]; seen: Int32Array; query: number }

// Cell edge is 4 units (2^18 in fixed-point), so a shift gives the cell coordinate.
const CELL_SHIFT = 18;
const cellKey = (cx: number, cy: number): number => (cx << 16) | (cy & 0xffff);

const empty = (list: number[]): void => trim(list, 0);

export function buildIndex(w: World, solids: number[], into?: SolidIndex): SolidIndex {
  const index = into ?? { ids: [], box: [], cells: new Map<number, number[]>(), big: [], crate: [], seen: new Int32Array(Math.max(16, solids.length)), query: 0 };
  const { ids, box, cells, crate } = index;
  let { big } = index;
  // Filled again where it stands: with a solid that moves, this runs every tick.
  cells.forEach(empty);
  let bigs = 0;
  for (let i = 0; i < solids.length; i++) {
    const s = solids[i], sp = w.get(s, 'pos')!, sb = w.get(s, 'box')!;
    const r = box[i] ?? (box[i] = [0, 0, 0, 0, 0, 0, 0]);
    r[0] = sp.x as number; r[1] = sp.y as number; r[2] = sp.z as number; r[3] = sb.w as number; r[4] = sb.h as number; r[5] = sb.d as number; r[6] = s;
    ids[i] = s;
    crate[i] = w.has(s, 'push');
    const x0 = r[0] >> CELL_SHIFT, x1 = (r[0] + r[3] - 1) >> CELL_SHIFT, y0 = r[1] >> CELL_SHIFT, y1 = (r[1] + r[4] - 1) >> CELL_SHIFT;
    // Something that covers many cells (a floor, a wall) is cheaper to test every time.
    // Crates are kept there too: they move during the tick, and a cell entry would go stale.
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 64 || crate[i]) { big[bigs++] = i; continue; }
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
      const k = cellKey(cx, cy);
      const list = cells.get(k);
      if (list) list.push(i);
      else cells.set(k, [i]);
    }
  }
  trim(ids, solids.length); trim(box, solids.length); trim(crate, solids.length); trim(big, bigs);
  // A solid that goes a long way leaves empty cells behind; start the map over before they pile up.
  if (cells.size > 64 + 8 * solids.length) {
    for (const [k, list] of cells) if (!list.length) cells.delete(k);
  }
  if (index.seen.length < solids.length) index.seen = new Int32Array(solids.length * 2);
  else index.seen.fill(0);
  index.query = 0;
  return index;
}

let lastIndex: SolidIndex | undefined;

/** The last tick's index while it still describes these solids, else a new one. */
function solidIndex(w: World, solids: number[]): SolidIndex {
  const old = lastIndex;
  if (old && old.ids.length === solids.length) {
    let i = 0;
    for (; i < solids.length; i++) {
      const s = solids[i], r = old.box[i];
      if (old.ids[i] !== s) break;
      const p = w.get(s, 'pos')!, b = w.get(s, 'box')!;
      if (r[0] !== p.x || r[1] !== p.y || r[2] !== p.z || r[3] !== b.w || r[4] !== b.h || r[5] !== b.d || old.crate[i] !== w.has(s, 'push')) break;
    }
    if (i === solids.length) {
      // `seen` holds query numbers; start them over long before they stop fitting.
      if (old.query > 1e9) { old.query = 0; old.seen.fill(0); }
      return old;
    }
  }
  return (lastIndex = buildIndex(w, solids, old));
}

/** A list of blockers that is filled again and again, with the boxes it made for tiles. */
export interface Hits { list: Block[]; tiles: Block[] }
const hitList = (): Hits => ({ list: [], tiles: [] });
const MOVE_HITS = hitList(), SHOVE_HITS = hitList();

/**
 * Solid boxes and solid tiles that overlap the region lo..hi (half-open on each axis), except `self`.
 * The callers only take minima and maxima over the result, so its order does not affect the simulation.
 */
export function blockers(w: World, self: number, index: SolidIndex, maps: number[], lo: number[], hi: number[], into: Hits = hitList()): Block[] {
  const out = into.list;
  let n = 0, made = 0;
  const q = ++index.query;
  for (let i = 0; i < index.big.length; i++) n = take(index, index.big[i], q, self, lo, hi, out, n);
  const x1 = (hi[0] - 1) >> CELL_SHIFT, y1 = (hi[1] - 1) >> CELL_SHIFT;
  for (let cx = lo[0] >> CELL_SHIFT; cx <= x1; cx++) for (let cy = lo[1] >> CELL_SHIFT; cy <= y1; cy++) {
    const list = index.cells.get(cellKey(cx, cy));
    if (list) for (let i = 0; i < list.length; i++) n = take(index, list[i], q, self, lo, hi, out, n);
  }
  for (let k = 0, all = maps; k < all.length; k++) {
    const m = all[k];
    const t = w.get(m, 'tiles')!, mp = w.get(m, 'pos')!;
    const size = t.size as number, solid = t.solid as string, rows = tileRows(t);
    // Rows run along `vi` (y, or z for a floor plan); `wi` is the axis the cells are extruded on.
    const vi = t.plane === 'xz' ? 2 : 1, wi = 3 - vi;
    const depth = t.depth as number, at = AT;
    at[0] = mp.x as number; at[1] = mp.y as number; at[2] = mp.z as number;
    if (!(lo[wi] < at[wi] + depth && hi[wi] > at[wi])) continue;
    const c0 = Math.max(0, fdiv(lo[0] - at[0], size)), c1 = fdiv(hi[0] - 1 - at[0], size);
    const r0 = Math.max(0, fdiv(lo[vi] - at[vi], size)), r1 = Math.min(rows.length - 1, fdiv(hi[vi] - 1 - at[vi], size));
    for (let r = r0; r <= r1; r++) {
      const row = rows[r];
      for (let c = c0; c <= c1 && c < row.length; c++) {
        if (!solid.includes(row[c])) continue;
        const b = into.tiles[made] ?? (into.tiles[made] = [0, 0, 0, 0, 0, 0, -1]);
        made++;
        b[0] = at[0] + c * size; b[3] = size;
        b[vi] = at[vi] + r * size;
        b[vi + 3] = size;
        b[wi] = at[wi];
        b[wi + 3] = depth;
        out[n++] = b;
      }
    }
  }
  trim(out, n);
  return out;
}

const AT = [0, 0, 0];

/** Add solid `i` to the list if this query has not seen it and it overlaps the region. */
function take(index: SolidIndex, i: number, q: number, self: number, lo: number[], hi: number[], out: Block[], n: number): number {
  if (index.seen[i] === q) return n;
  index.seen[i] = q;
  if (index.ids[i] === self) return n;
  const r = index.box[i];
  if (lo[0] < r[0] + r[3] && hi[0] > r[0] && lo[1] < r[1] + r[4] && hi[1] > r[1] && lo[2] < r[2] + r[5] && hi[2] > r[2]) out[n++] = r;
  return n;
}

/** Fill `lo` and `hi` with the region a box at `cur` covers going along axis `a` as far as `to`. */
function swept(cur: number[], size: number[], a: number, to: number, lo: number[], hi: number[]): void {
  for (let i = 0; i < 3; i++) { lo[i] = cur[i]; hi[i] = cur[i] + size[i]; }
  lo[a] = Math.min(cur[a], to);
  hi[a] = Math.max(cur[a], to) + size[a];
}

// A mover's position, movement and size, and the region it is about to cross.
const CUR = [0, 0, 0], D = [0, 0, 0], SIZE = [0, 0, 0], LO = [0, 0, 0], HI = [0, 0, 0];
const SHOVE_AT = [0, 0, 0], SHOVE_SIZE = [0, 0, 0], SHOVE_LO = [0, 0, 0], SHOVE_HI = [0, 0, 0];

/** Move a crate along one axis by up to `want`, stopping at whatever blocks it. Returns how far it went. */
function shove(w: World, crate: Block, a: number, want: number, index: SolidIndex, maps: number[]): number {
  const from = crate[a];
  let to = (from + want) | 0;
  for (let i = 0; i < 3; i++) { SHOVE_AT[i] = crate[i] as number; SHOVE_SIZE[i] = crate[i + 3] as number; }
  swept(SHOVE_AT, SHOVE_SIZE, a, to, SHOVE_LO, SHOVE_HI);
  const hits = blockers(w, crate[6], index, maps, SHOVE_LO, SHOVE_HI, SHOVE_HITS);
  for (let n = 0; n < hits.length; n++) {
    const r = hits[n];
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

const TURNED: [number, number] = [0, 0];

/**
 * Turn a quaternion component by the angle vector (tx, ty, tz), in degrees about the world
 * axes. The small turn is built at 2^24 scale and the product rounded to fixed-point once,
 * so the error per tick is half a unit and does not lean one way.
 */
export function spinQuat(q: Comp, tx: number, ty: number, tz: number): void {
  const angle = isqrt(tx * tx + ty * ty + tz * tz);
  if (angle === 0) return;
  sinCos24(angle >> 1, TURNED);
  const s = TURNED[0], c = TURNED[1];
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

const held = (w: World, action: string, player: number): number => (w.on(action, player) ? 1 : 0);
const tagOf = (w: World, id: number): string => (w.get(id, 'tag')?.name as string | undefined) ?? '';

/** Where a mover going `way` along axis `a` has to stop for `r`, if that is before `to`. */
const stopped = (to: number, way: number, size: number, a: number, r: Block): number =>
  way > 0 ? Math.min(to, r[a] - size) : Math.max(to, r[a] + r[a + 3]);

/** Entities this tick's triggers and buttons despawn, once all of them have run. */
const DOOMED: number[] = [];

/** Entities and tags this tick's actions put back as the scene began, with the event that asked. */
const RESETS: string[] = [];

/** The action names `check` accepts, for its hint. */
export const ACTION_HINT = 'none, despawn-self, despawn-other, despawn:REF, load:FILE, emit:EVENT, reset:REF, reset:all';

/** Do what a trigger, button, timer or `when` says; `who` is named by a load event, `cause` is the event behind it. */
export function act(w: World, action: string, self: number, other: number | undefined, who: string, cause: string): void {
  if (action === 'none') return;
  for (const a of action.split('+')) {
    if (a === 'despawn-self') DOOMED.push(self);
    else if (a === 'despawn-other' && other !== undefined) DOOMED.push(other);
    else if (a.startsWith('despawn:')) DOOMED.push(...w.match(a.slice(8)));
    // Headless this is only an event; the player reacts to it by opening the scene.
    else if (a.startsWith('load:')) w.events.push({ tick: w.tick, name: 'load', a: a.slice(5), b: who });
    else if (a.startsWith('emit:')) w.events.push({ tick: w.tick, name: a.slice(5), a: who, b: '' });
    else if (a.startsWith('reset:')) RESETS.push(a.slice(6), cause);
  }
}

/** Carry out what this tick's actions asked for: despawns first, then what is put back. */
function settle(w: World): void {
  for (let n = 0; n < DOOMED.length; n++) w.despawn(DOOMED[n]);
  trim(DOOMED, 0);
  if (RESETS.length && !rules.restore) throw new Error(RULES_MISSING);
  for (let n = 0; n < RESETS.length; n += 2) rules.restore!(w, RESETS[n], RESETS[n + 1]);
  trim(RESETS, 0);
}

// What the physics step needs from this tick to move a mover that a body ran into.
const moved = { w: undefined as unknown as World, index: undefined as unknown as SolidIndex, maps: [] as number[] };

/** Move a mover along one axis by up to `want`, as far as nothing solid or rigid is in the way. */
function nudge(id: number, a: number, want: number): number {
  const { w, index, maps } = moved;
  const p = w.get(id, 'pos')!, b = w.get(id, 'box')!;
  const cur = [p.x as number, p.y as number, p.z as number], size = [b.w as number, b.h as number, b.d as number];
  const from = cur[a];
  let to = (from + want) | 0;
  swept(cur, size, a, to, SHOVE_LO, SHOVE_HI);
  const hits = blockers(w, id, index, maps, SHOVE_LO, SHOVE_HI, SHOVE_HITS);
  for (let n = 0, r = hits[0]; n < hits.length; r = hits[++n]) to = want > 0 ? Math.max(from, Math.min(to, r[a] - size[a])) : Math.min(from, Math.max(to, r[a] + r[a + 3]));
  if (to !== from) {
    const hit = physicsSweep(w, cur, size, a, to - from, 0);
    if (hit) to = from + hit.go;
  }
  p[P[a]] = to;
  return to - from;
}

/** Filled in by rules.ts when a game that uses `timer`, `when` or `reset:` loads it. */
export const rules: {
  begin?: (w: World) => string;
  timers?: (w: World) => void;
  answer?: (w: World, from: number, end: number) => void;
  restore?: (w: World, ref: string, cause: string) => void;
} = {};
const RULES_MISSING = "'timer', 'when' or 'reset:' is used but the rules were not loaded: name one in a scene or a script of the game";

/** Filled in by nav.ts when a game that uses `nav` loads it. */
export const nav: { run?: (w: World, ids: number[]) => void } = {};

/** Advance one fixed tick. System order is fixed: input, ctrl, pace, scripts (pre), gravity, move, physics, turn, triggers, scripts (post). */
export function step(w: World, script?: InputScript): void {
  // The scene as its run began, kept only when a rule can ask to go back to it.
  if (w.origin === undefined) w.origin = w.tick === 0 && rules.begin ? rules.begin(w) : '';
  // What was tapped or newly pressed this tick: buttons answer to these further down.
  let fresh: string[] | undefined;
  const pressed = script?.get(w.tick);
  if (pressed) for (const [action, down] of pressed) {
    if (down) (fresh ??= []).push(action);
    if (action[3] === ':') continue;
    if (down) w.pressed.add(action);
    else w.pressed.delete(action);
  }
  const heard = w.events.length;
  const k = w.tick % w.hz;

  for (let n = 0, ids = find(w, CTRL); n < ids.length; n++) {
    const id = ids[n];
    const c = w.get(id, 'ctrl')!, v = w.get(id, 'vel')!;
    const speed = c.speed as number, jump = c.jump as number, p = c.player as number;
    v.x = (held(w, 'right', p) - held(w, 'left', p)) * speed;
    if (c.plane === 'xz') {
      // Ground plane is x/z: up/down walk along z, and `a` jumps.
      v.z = (held(w, 'down', p) - held(w, 'up', p)) * speed;
      if (jump > 0 && held(w, 'a', p) && w.get(id, 'body')?.grounded) v.y = -jump;
    } else if (jump > 0) {
      if (held(w, 'up', p) && w.get(id, 'body')?.grounded) v.y = -jump;
    } else if (!w.gy || !w.has(id, 'body')) v.y = (held(w, 'down', p) - held(w, 'up', p)) * speed;
    // A body under gravity with no jump walks: its fall is gravity's, not the keys'.
  }

  for (let n = 0, ids = find(w, PACE); n < ids.length; n++) {
    const id = ids[n];
    const c = w.get(id, 'pace')!, p = w.get(id, 'pos')!, v = w.get(id, 'vel')!, a = c.axis as string;
    if ((p[a] as number) >= (c.max as number)) v[a] = -(c.speed as number);
    else if ((p[a] as number) <= (c.min as number) || v[a] === 0) v[a] = c.speed;
  }

  const walkers = find(w, NAV);
  if (walkers.length) {
    if (!nav.run) throw new Error(`'nav' is used but navigation was not loaded: name nav in the scene or a script of the game`);
    nav.run(w, walkers);
  }

  for (let n = 0; n < w.pre.length; n++) w.pre[n](w);

  // Which way an animated sprite looks is state: it has to survive a save, and standing
  // still must not forget it. It follows what the entity is trying to do this tick.
  for (let n = 0, ids = find(w, ANIM); n < ids.length; n++) {
    const id = ids[n];
    const x = w.get(id, 'vel')!.x as number;
    if (x) w.get(id, 'anim')!.face = x > 0 ? 1 : -1;
  }

  for (let n = 0, ids = find(w, BODY); n < ids.length; n++) {
    const id = ids[n];
    // The backend gives a rigid body its gravity; adding it here too would read as a script changing its speed.
    if (w.physics && w.has(id, 'rigid')) continue;
    const v = w.get(id, 'vel')!;
    v.x = ((v.x as number) + tickShare(w.gx, k, w.hz)) | 0;
    v.y = ((v.y as number) + tickShare(w.gy, k, w.hz)) | 0;
    v.z = ((v.z as number) + tickShare(w.gz, k, w.hz)) | 0;
  }

  const index = solidIndex(w, find(w, SOLID));
  const maps = find(w, MAPS);
  if (w.physics) physicsSync(w);
  for (let n = 0, ids = find(w, MOVERS); n < ids.length; n++) {
    const id = ids[n];
    // A rigid body is moved by the physics backend, below.
    if (w.physics && w.has(id, 'rigid')) continue;
    const p = w.get(id, 'pos')!, v = w.get(id, 'vel')!, b = w.get(id, 'box');
    const cur = CUR, d = D;
    cur[0] = p.x as number; cur[1] = p.y as number; cur[2] = p.z as number;
    d[0] = tickShare(v.x as number, k, w.hz); d[1] = tickShare(v.y as number, k, w.hz); d[2] = tickShare(v.z as number, k, w.hz);
    if (!b || w.has(id, 'solid')) {
      for (let a = 0; a < 3; a++) p[P[a]] = (cur[a] + d[a]) | 0;
      continue;
    }
    // Swept test per axis: a solid anywhere along the path stops the mover, however fast it is.
    const size = SIZE;
    size[0] = b.w as number; size[1] = b.h as number; size[2] = b.d as number;
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
      swept(cur, size, a, to, LO, HI);
      const hits = blockers(w, id, index, maps, LO, HI, MOVE_HITS);
      // Crates in the way. With gravity on y, y is up/down and crates are not pushed along it;
      // without gravity (top-down) y is a ground axis like x. Only the nearest crate is shoved.
      let crates: Block[] | undefined;
      for (let i = 0; i < hits.length; i++) {
        const r = hits[i];
        if (!(a === 1 && w.gy !== 0) && r[6] >= 0 && w.has(r[6], 'push')) (crates ??= []).push(r);
        else to = stopped(to, d[a], size[a], a, r);
      }
      if (crates) {
        let near = crates[0];
        for (let n = 0, r = crates[0]; n < crates.length; r = crates[++n]) if (d[a] > 0 ? r[a] < near[a] : r[a] > near[a]) near = r;
        const contact = d[a] > 0 ? near[a] - size[a] : near[a] + near[a + 3];
        // `to` is where the mover would end up without crates; anything past the contact point is the shove.
        if (d[a] > 0 ? to > contact : to < contact) to = contact + shove(w, near, a, to - contact, index, maps);
        for (let n = 0, r = crates[0]; n < crates.length; r = crates[++n]) if (r !== near) to = stopped(to, d[a], size[a], a, r);
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
          for (let n = 0, r = hits[0]; n < hits.length; r = hits[++n]) if (r[6] >= 0 && r[1] - size[1] === to && (ride < 0 || r[6] < ride)) ride = r[6];
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

  // A rigid body that ran into a mover moves it aside: along one axis, as far as nothing solid is in the way.
  if (w.physics) {
    moved.w = w; moved.index = index; moved.maps = maps;
    physicsStep(w, nudge);
  }

  // Turning. An angle is added to exactly, like a position. A quaternion is multiplied by
  // this tick's small turn and then scaled back to unit length, all in fixed-point.
  for (let n = 0, ids = find(w, ROT); n < ids.length; n++) {
    const id = ids[n];
    const r = w.get(id, 'rot')!;
    if (r.spin) r.angle = wrapDeg((r.angle as number) + tickShare(r.spin as number, k, w.hz));
  }
  for (let n = 0, ids = find(w, QUAT); n < ids.length; n++) {
    const id = ids[n];
    const q = w.get(id, 'quat')!;
    if (w.physics && w.has(id, 'rigid')) continue;
    if (q.sx || q.sy || q.sz) spinQuat(q, tickShare(q.sx as number, k, w.hz), tickShare(q.sy as number, k, w.hz), tickShare(q.sz as number, k, w.hz));
  }

  w.tick++;

  if (w.met.length) w.met = [];
  trim(DOOMED, 0);
  trim(RESETS, 0);
  if (fresh) for (let n = 0, ids = find(w, BUTTON); n < ids.length; n++) {
    const id = ids[n];
    const b = w.get(id, 'button')!, name = w.names[id]!;
    if (!fresh.includes(`tap:${name}`) && !fresh.includes(b.key as string)) continue;
    w.events.push({ tick: w.tick, name: b.event as string, a: name, b: '' });
    act(w, b.action as string, id, undefined, name, b.event as string);
  }
  for (let n = 0, triggers = find(w, TRIGGER); n < triggers.length; n++) {
    const t = triggers[n];
    const tr = w.get(t, 'trigger')!, tp = w.get(t, 'pos')!, tb = w.get(t, 'box')!;
    for (let m = 0, others = targets(w, tr.target as string); m < others.length; m++) {
      const o = others[m];
      const op = w.get(o, 'pos'), ob = w.get(o, 'box');
      if (o === t || !op || !ob) continue;
      const touching = overlap(tp, tb, op, ob);
      if (!touching && !w.overlaps.size) continue;
      const key = pairKey(w.names[t]!, w.names[o]!);
      if (!touching) { w.overlaps.delete(key); continue; }
      if (w.overlaps.has(key)) continue;
      w.overlaps.add(key);
      w.met.push({ a: w.names[t]!, at: tagOf(w, t), b: w.names[o]!, bt: tagOf(w, o) });
      w.events.push({ tick: w.tick, name: tr.event as string, a: w.names[t]!, b: w.names[o]! });
      act(w, tr.action as string, t, o, w.names[o]!, tr.event as string);
    }
  }
  settle(w);
  for (let n = 0; n < w.post.length; n++) w.post[n](w);
  if (rules.timers) rules.timers(w);
  else if (find(w, TIMER).length || find(w, WHEN).length) throw new Error(RULES_MISSING);
  // A tally counts what this step emitted, scripts included. It is state: saved and hashed.
  // A `when` answers the same events with an action. Either may emit, so they go round
  // until nothing new was said (a rule that keeps answering itself is cut off).
  for (let from = heard, round = 0; from < w.events.length && round < 16; round++) {
    const end = w.events.length;
    for (let n = 0, ids = find(w, TALLY); n < ids.length; n++) {
      const id = ids[n];
      const t = w.get(id, 'tally')!;
      for (let i = from; i < end; i++) {
        if (w.events[i].name !== t.event) continue;
        t.n = (t.n as number) + (t.by as number);
        if (t.then && t.n === t.hit) w.events.push({ tick: w.tick, name: t.then as string, a: w.names[id]!, b: '' });
      }
    }
    if (rules.answer) rules.answer(w, from, end);
    settle(w);
    from = end;
  }
  settle(w);
}

/**
 * Which picture of its sheet an `anim` entity shows now. It is a function of the tick and
 * of the state, so replaying the same input draws the same frames.
 */
export function frameOf(w: World, id: number): number {
  const a = w.get(id, 'anim');
  if (!a) return 0;
  const n = Math.max(1, a.frames as number), idle = Math.min(Math.max(0, a.idle as number), n - 1);
  const v = w.get(id, 'vel'), moving = !!v && (v.x !== 0 || v.y !== 0);
  const turn = Math.floor((w.tick * Math.max(1, a.fps as number)) / w.hz);
  return !idle ? turn % n : moving ? idle + (turn % (n - idle)) : turn % idle;
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
