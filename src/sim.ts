import { tickShare } from './fx.ts';
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
  for (const id of w.query('pos', 'vel')) {
    const p = w.get(id, 'pos')!, v = w.get(id, 'vel')!, b = w.get(id, 'box');
    const dx = tickShare(v.x as number, k, w.hz), dy = tickShare(v.y as number, k, w.hz);
    if (!b || w.has(id, 'solid')) {
      p.x = ((p.x as number) + dx) | 0;
      p.y = ((p.y as number) + dy) | 0;
      continue;
    }
    p.x = ((p.x as number) + dx) | 0;
    for (const s of solids) {
      if (s === id) continue;
      const sp = w.get(s, 'pos')!, sb = w.get(s, 'box')!;
      if (!overlap(p, b, sp, sb)) continue;
      if (dx > 0) p.x = (sp.x as number) - (b.w as number);
      else if (dx < 0) p.x = (sp.x as number) + (sb.w as number);
      v.x = 0;
    }
    p.y = ((p.y as number) + dy) | 0;
    let grounded = 0;
    for (const s of solids) {
      if (s === id) continue;
      const sp = w.get(s, 'pos')!, sb = w.get(s, 'box')!;
      if (!overlap(p, b, sp, sb)) continue;
      if (dy > 0) { p.y = (sp.y as number) - (b.h as number); grounded = 1; }
      else if (dy < 0) p.y = (sp.y as number) + (sb.h as number);
      v.y = 0;
    }
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
  const s = `${serialize(w)}|${w.tick}|${[...w.pressed].sort()}|${[...w.overlaps].sort()}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, '0');
}
