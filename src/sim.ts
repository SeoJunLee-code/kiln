import { fdiv, tickShare } from './fx.ts';
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

export function overlap(ap: Comp, ab: Comp, bp: Comp, bb: Comp): boolean {
  const ax = ap.x as number, ay = ap.y as number, bx = bp.x as number, by = bp.y as number;
  return ax < bx + (bb.w as number) && ax + (ab.w as number) > bx && ay < by + (bb.h as number) && ay + (ab.h as number) > by;
}

const rowCache = new WeakMap<Comp, { src: string; rows: string[] }>();

/** Rows of a tiles component, split once per distinct content. */
export function tileRows(t: Comp): string[] {
  const src = t.rows as string;
  let c = rowCache.get(t);
  if (!c || c.src !== src) rowCache.set(t, (c = { src, rows: src.split('\n') }));
  return c.rows;
}

/** Tile character at a world point, or '' outside the map. */
export function tileAt(w: World, map: number, x: number, y: number): string {
  const t = w.get(map, 'tiles')!, mp = w.get(map, 'pos')!;
  const row = tileRows(t)[fdiv(y - (mp.y as number), t.size as number)];
  return row?.[fdiv(x - (mp.x as number), t.size as number)] ?? '';
}

export type Rect = [x: number, y: number, w: number, h: number];

/** Solid boxes and solid tiles that overlap the region [x0,x1) x [y0,y1), except `self`. */
export function blockers(w: World, self: number, solids: number[], maps: number[], x0: number, y0: number, x1: number, y1: number): Rect[] {
  const out: Rect[] = [];
  for (const s of solids) {
    if (s === self) continue;
    const sp = w.get(s, 'pos')!, sb = w.get(s, 'box')!;
    const sx = sp.x as number, sy = sp.y as number, sw = sb.w as number, sh = sb.h as number;
    if (x0 < sx + sw && x1 > sx && y0 < sy + sh && y1 > sy) out.push([sx, sy, sw, sh]);
  }
  for (const m of maps) {
    const t = w.get(m, 'tiles')!, mp = w.get(m, 'pos')!;
    const size = t.size as number, solid = t.solid as string, rows = tileRows(t);
    const mx = mp.x as number, my = mp.y as number;
    const c0 = Math.max(0, fdiv(x0 - mx, size)), c1 = fdiv(x1 - 1 - mx, size);
    const r0 = Math.max(0, fdiv(y0 - my, size)), r1 = Math.min(rows.length - 1, fdiv(y1 - 1 - my, size));
    for (let r = r0; r <= r1; r++) {
      const row = rows[r];
      for (let c = c0; c <= c1 && c < row.length; c++) {
        if (solid.includes(row[c])) out.push([mx + c * size, my + r * size, size, size]);
      }
    }
  }
  return out;
}

/** Advance one fixed tick. System order is fixed: input, ctrl, gravity, move, triggers. */
export function step(w: World, script?: InputScript): void {
  for (const [action, down] of script?.get(w.tick) ?? []) {
    if (down) w.pressed.add(action);
    else w.pressed.delete(action);
  }
  const k = w.tick % w.hz;
  const on = (a: string): number => (w.pressed.has(a) ? 1 : 0);

  for (const id of w.query('ctrl', 'vel')) {
    const c = w.get(id, 'ctrl')!, v = w.get(id, 'vel')!;
    const speed = c.speed as number;
    v.x = (on('right') - on('left')) * speed;
    if ((c.jump as number) > 0) {
      if (on('up') && w.get(id, 'body')?.grounded) v.y = -(c.jump as number);
    } else v.y = (on('down') - on('up')) * speed;
  }

  for (const sys of w.pre) sys(w);

  for (const id of w.query('body', 'vel')) {
    const v = w.get(id, 'vel')!;
    v.x = ((v.x as number) + tickShare(w.gx, k, w.hz)) | 0;
    v.y = ((v.y as number) + tickShare(w.gy, k, w.hz)) | 0;
  }

  const solids = w.query('solid', 'pos', 'box');
  const maps = w.query('tiles', 'pos');
  for (const id of w.query('pos', 'vel')) {
    const p = w.get(id, 'pos')!, v = w.get(id, 'vel')!, b = w.get(id, 'box');
    const dx = tickShare(v.x as number, k, w.hz), dy = tickShare(v.y as number, k, w.hz);
    const x0 = p.x as number, y0 = p.y as number;
    if (!b || w.has(id, 'solid')) {
      p.x = (x0 + dx) | 0;
      p.y = (y0 + dy) | 0;
      continue;
    }
    // Swept test per axis: a solid anywhere along the path stops the mover, however fast it is.
    const bw = b.w as number, bh = b.h as number;
    let nx = (x0 + dx) | 0;
    if (dx !== 0) {
      for (const [sx, , sw] of blockers(w, id, solids, maps, Math.min(x0, nx), y0, Math.max(x0, nx) + bw, y0 + bh)) {
        nx = dx > 0 ? Math.min(nx, sx - bw) : Math.max(nx, sx + sw);
        v.x = 0;
      }
    }
    p.x = nx;
    let ny = (y0 + dy) | 0, grounded = 0;
    if (dy !== 0) {
      for (const [, sy, , sh] of blockers(w, id, solids, maps, nx, Math.min(y0, ny), nx + bw, Math.max(y0, ny) + bh)) {
        if (dy > 0) { ny = Math.min(ny, sy - bh); grounded = 1; }
        else ny = Math.max(ny, sy + sh);
        v.y = 0;
      }
    }
    p.y = ny;
    const body = w.get(id, 'body');
    if (body) body.grounded = grounded;
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
      if (tr.action === 'despawn-self') doomed.push(t);
      else if (tr.action === 'despawn-other') doomed.push(o);
    }
  }
  for (const id of doomed) w.despawn(id);
  for (const sys of w.post) sys(w);
}

/** FNV-1a hash of the full simulation state. Equal hash = identical state. */
export function hash(w: World): string {
  const s = serialize(w);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, '0');
}
