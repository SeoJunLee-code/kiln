import { fmtFx, parseFx } from './fx.ts';
import { KilnFail, suggest } from './scene.ts';
import type { Diag, RawExpect } from './scene.ts';
import { overlap } from './sim.ts';
import { registry } from './world.ts';
import type { World } from './world.ts';

export interface Expect {
  line: number;
  text: string;
  kind: 'reach' | 'never' | 'at' | 'event' | 'gone';
  a: string;
  b: string;
  /** deadline tick; Infinity = whole run */
  by: number;
  path: string[];
  op: string;
  val: number | string;
  /** undefined while undecided */
  ok?: boolean;
  note: string;
  best: number;
}

const OPS: Record<string, (a: number | string, b: number | string) => boolean> = {
  '<': (a, b) => a < b, '<=': (a, b) => a <= b, '>': (a, b) => a > b, '>=': (a, b) => a >= b,
  '==': (a, b) => a === b, '!=': (a, b) => a !== b,
};
const USAGE = `forms: reach A B by N | never A B | gone A by N | event NAME by N | at N A.comp.field OP VALUE`;

/**
 * Expectation forms (A/B are entity names or #tags):
 *   reach A B by N      A overlaps B at some tick <= N
 *   never A B           A never overlaps B during the run
 *   gone A by N         A has been despawned by tick N
 *   event NAME by N     a trigger emitted NAME by tick N
 *   at N A.comp.field OP VALUE
 */
export function parseExpects(raw: RawExpect[], w: World, file = 'scene'): Expect[] {
  const diags: Diag[] = [];
  const out: Expect[] = [];
  for (const r of raw) {
    const err = (code: string, msg: string, hint?: string) => diags.push({ code, file, line: r.line, msg, hint });
    const t = r.text.split(/\s+/);
    const e: Expect = { line: r.line, text: r.text, kind: 'reach', a: '', b: '', by: Infinity, path: [], op: '', val: 0, note: '', best: Infinity };
    const int = (s: string | undefined): number => (/^\d+$/.test(s ?? '') ? +s! : NaN);
    const ref = (s: string): string => {
      if (!w.match(s).length) err('K110', `'${s}' matches no entity`, s.startsWith('#') ? 'no entity has that tag' : suggest(s, w.ids.keys()));
      return s;
    };
    if (t[0] === 'reach' && t.length === 5 && t[3] === 'by') { e.a = ref(t[1]); e.b = ref(t[2]); e.by = int(t[4]); }
    else if (t[0] === 'never' && t.length === 3) { e.kind = 'never'; e.a = ref(t[1]); e.b = ref(t[2]); }
    else if (t[0] === 'gone' && t.length === 4 && t[2] === 'by') { e.kind = 'gone'; e.a = ref(t[1]); e.by = int(t[3]); }
    else if (t[0] === 'event' && t.length === 4 && t[2] === 'by') { e.kind = 'event'; e.a = t[1]; e.by = int(t[3]); }
    else if (t[0] === 'at' && t.length === 5) {
      e.kind = 'at'; e.by = int(t[1]); e.path = t[2].split('.'); e.op = t[3];
      const [name, comp, field] = e.path;
      const fd = registry.get(comp)?.fields.find((x) => x.name === field);
      if (e.path.length !== 3) err('K111', `'${t[2]}' must be ENTITY.component.field`);
      else {
        e.a = ref(name);
        if (!fd) err('K111', `unknown field '${comp}.${field}'`, suggest(comp, registry.keys()));
        else {
          const v = fd.type === 'str' ? t[4] : fd.type === 'fx' ? parseFx(t[4]) : int(t[4]);
          if (v === null || Number.isNaN(v)) err('K104', `'${t[4]}' is not a valid value for ${comp}.${field}`);
          else e.val = v;
        }
      }
      if (!OPS[e.op]) err('K111', `unknown operator '${e.op}'`, 'valid: < <= > >= == !=');
    } else { err('K111', `cannot parse 'expect ${r.text}'`, USAGE); continue; }
    if (Number.isNaN(e.by)) err('K104', `tick must be a non-negative integer`);
    out.push(e);
  }
  if (diags.length) throw new KilnFail(diags);
  return out;
}

/** Last tick the run must reach to decide every expectation. */
export const lastTick = (es: Expect[]): number => es.reduce((m, e) => (Number.isFinite(e.by) ? Math.max(m, e.by) : m), 0);

function gap(w: World, a: number, b: number): number | null {
  const ap = w.get(a, 'pos'), ab = w.get(a, 'box'), bp = w.get(b, 'pos'), bb = w.get(b, 'box');
  if (!ap || !ab || !bp || !bb) return null;
  if (overlap(ap, ab, bp, bb)) return -1;
  const gx = Math.max(0, (ap.x as number) - (bp.x as number) - (bb.w as number), (bp.x as number) - (ap.x as number) - (ab.w as number));
  const gy = Math.max(0, (ap.y as number) - (bp.y as number) - (bb.h as number), (bp.y as number) - (ap.y as number) - (ab.h as number));
  return gx + gy;
}

const where = (w: World, ref: string): string => {
  const p = w.match(ref).map((id) => w.get(id, 'pos')).find(Boolean);
  return p ? `${ref} at ${fmtFx(p.x as number)},${fmtFx(p.y as number)}` : `${ref} has no pos`;
};

/** Evaluate after every step (and once before the first). */
export function evalTick(w: World, es: Expect[]): void {
  for (const e of es) {
    if (e.ok !== undefined) continue;
    if (e.kind === 'reach' || e.kind === 'never') {
      let touching = false;
      for (const a of w.match(e.a)) for (const b of w.match(e.b)) {
        const g = a === b ? null : gap(w, a, b);
        if (g === null) continue;
        if (g < 0) touching = true;
        else if (g < e.best) { e.best = g; e.note = `closest gap ${fmtFx(g)} at tick ${w.tick}, ${where(w, e.a)}`; }
      }
      if (touching) { e.ok = e.kind === 'reach'; e.note = `tick ${w.tick}`; }
      else if (w.tick >= e.by) e.ok = false;
    } else if (e.kind === 'gone') {
      if (!w.match(e.a).length) { e.ok = true; e.note = `tick ${w.tick}`; }
      else if (w.tick >= e.by) { e.ok = false; e.note = `still alive, ${where(w, e.a)}`; }
    } else if (e.kind === 'event') {
      const ev = w.events.find((x) => x.name === e.a);
      if (ev) { e.ok = true; e.note = `tick ${ev.tick}`; }
      else if (w.tick >= e.by) { e.ok = false; e.note = `events so far: ${[...new Set(w.events.map((x) => x.name))].join(' ') || 'none'}`; }
    } else if (w.tick === e.by) {
      const [name, comp, field] = e.path;
      const id = w.match(name)[0];
      const c = id === undefined ? undefined : w.get(id, comp);
      if (!c) { e.ok = false; e.note = `${name} has no '${comp}' at tick ${w.tick}`; continue; }
      const v = c[field];
      e.ok = OPS[e.op](v, e.val);
      e.note = `actual ${typeof v === 'number' && registry.get(comp)!.fields.find((x) => x.name === field)!.type === 'fx' ? fmtFx(v) : v}`;
    }
  }
}

/** Resolve whatever is still open at the end of the run. */
export function finish(es: Expect[]): void {
  for (const e of es) {
    if (e.ok !== undefined) continue;
    e.ok = e.kind === 'never';
    if (e.kind === 'at') e.note = `run ended before tick ${e.by}`;
  }
}
