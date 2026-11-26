import { fmtFx, parseFx } from './fx.ts';
import { World, registry } from './world.ts';
import type { Comp, CompDef } from './world.ts';

export interface Diag { code: string; file: string; line: number; msg: string; hint?: string }
export const fmtDiag = (d: Diag): string =>
  `E ${d.code} ${d.file}:${d.line} ${d.msg}${d.hint ? ` (hint: ${d.hint})` : ''}`;

export class KilnFail extends Error {
  diags: Diag[];
  constructor(diags: Diag[]) {
    super(diags.map(fmtDiag).join('\n'));
    this.diags = diags;
  }
}

export interface RawExpect { line: number; text: string }
export interface Scene { world: World; expects: RawExpect[]; uses: string[] }

function lev(a: string, b: string): number {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = t;
    }
  }
  return d[b.length];
}

/** Closest candidate within edit distance 2, as a "did you mean" hint. */
export function suggest(word: string, candidates: Iterable<string>): string | undefined {
  let best: string | undefined, bd = 3;
  for (const c of candidates) {
    const x = lev(word, c);
    if (x < bd) { bd = x; best = c; }
  }
  return best && `did you mean '${best}'?`;
}

const NAME = /^[A-Za-z_][\w-]*$/;
const sig = (c: CompDef): string =>
  `${c.name}${c.fields.map((f) => ` ${f.def === undefined ? f.name : `[${f.name}=${f.type === 'fx' ? fmtFx(f.def as number) : f.def}]`}`).join('')}`;

export function parseScene(text: string, file = 'scene'): Scene {
  const world = new World();
  const expects: RawExpect[] = [];
  const uses: string[] = [];
  const diags: Diag[] = [];
  const err = (code: string, line: number, msg: string, hint?: string) => diags.push({ code, file, line, msg, hint });
  let cur = -1;

  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    const body = raw.replace(/#(?![\w-]).*$|^\s*#.*$/, '').trimEnd();
    if (!body.trim()) return;
    const indented = /^\s/.test(body);
    const tok = body.trim().split(/\s+/);

    if (!indented) {
      cur = -1;
      if (tok[0] === 'entity') {
        const n = tok[1];
        if (tok.length !== 2 || !NAME.test(n)) return err('K100', line, `expected 'entity NAME' (letters, digits, _ or -)`);
        if (world.ids.has(n)) return err('K101', line, `duplicate entity '${n}'`);
        cur = world.spawn(n);
      } else if (tok[0] === 'world') {
        for (const kv of tok.slice(1)) {
          const [k, v] = kv.split('=');
          if (k === 'hz' || k === 'tick') {
            if (!/^\d+$/.test(v ?? '') || (k === 'hz' && +v < 1)) err('K104', line, `world ${k} must be a positive integer`);
            else world[k] = +v;
          } else if (k === 'seed') {
            if (!/^-?\d+$/.test(v ?? '')) err('K104', line, `world seed must be an integer`);
            else world.seed = +v | 0;
          } else if (k === 'gravity') {
            const p = (v ?? '').split(',').map(parseFx);
            if (p.length !== 2 || p[0] === null || p[1] === null) err('K104', line, `world gravity must be X,Y`, 'e.g. gravity=0,20');
            else { world.gx = p[0]; world.gy = p[1]; }
          } else err('K103', line, `unknown world setting '${k}'`, 'valid: hz, gravity, seed, tick');
        }
      } else if (tok[0] === 'state') {
        // Written by serialize: run-time state that is not a component.
        for (const kv of tok.slice(1)) {
          const [k, v = ''] = kv.split('=');
          if (k === 'pressed') for (const a of v.split(',').filter(Boolean)) world.pressed.add(a);
          else if (k === 'overlaps') for (const o of v.split(',').filter(Boolean)) world.overlaps.add(o);
          else err('K103', line, `unknown state entry '${k}'`, 'valid: pressed, overlaps');
        }
      } else if (tok[0] === 'use') {
        if (tok.length !== 2) return err('K100', line, `expected 'use PATH' (script path relative to the scene file)`);
        uses.push(tok[1]);
      } else if (tok[0] === 'expect') {
        expects.push({ line, text: tok.slice(1).join(' ') });
      } else {
        err('K108', line, `unknown directive '${tok[0]}'`,
          registry.has(tok[0]) ? 'components must be indented under an entity' : suggest(tok[0], ['entity', 'world', 'expect', 'use', 'state']));
      }
      return;
    }

    if (cur < 0) return err('K106', line, `component '${tok[0]}' is not under an entity`);
    const def = registry.get(tok[0]);
    if (!def) return err('K102', line, `unknown component '${tok[0]}'`, suggest(tok[0], registry.keys()));
    if (world.has(cur, def.name)) return err('K101', line, `duplicate component '${def.name}' on '${world.names[cur]}'`);

    const data: Comp = {};
    let n = 0, bad = false;
    for (const t of tok.slice(1)) {
      const eq = t.indexOf('=');
      let field = eq > 0 ? def.fields.find((f) => f.name === t.slice(0, eq)) : undefined;
      let val = t;
      if (eq > 0 && field) val = t.slice(eq + 1);
      else if (eq > 0 && def.fields[n]?.type !== 'str') {
        err('K103', line, `unknown field '${t.slice(0, eq)}' on '${def.name}'`, suggest(t.slice(0, eq), def.fields.map((f) => f.name)) ?? `usage: ${sig(def)}`);
        bad = true;
        continue;
      } else field = def.fields[n++];
      if (!field) { err('K107', line, `too many values for '${def.name}'`, `usage: ${sig(def)}`); bad = true; break; }
      if (field.type === 'str') data[field.name] = val;
      else {
        const v = field.type === 'fx' ? parseFx(val) : /^-?\d+$/.test(val) ? +val : null;
        if (v === null) { err('K104', line, `'${val}' is not a valid ${field.type === 'fx' ? 'number' : 'integer'} for ${def.name}.${field.name}`); bad = true; }
        else data[field.name] = v;
      }
    }
    for (const fd of def.fields) {
      if (fd.name in data) continue;
      if (fd.def === undefined) { if (!bad) err('K105', line, `'${def.name}' is missing '${fd.name}'`, `usage: ${sig(def)}`); bad = true; }
      else data[fd.name] = fd.def;
    }
    if (!bad) world.add(cur, def.name, data);
  });

  if (diags.length) throw new KilnFail(diags);
  return { world, expects, uses };
}

/** Canonical scene text for the current state. Parsing it back gives the same world. */
export function serialize(w: World, expects: RawExpect[] = [], uses: string[] = []): string {
  const out = [...uses.map((u) => `use ${u}`),
    `world hz=${w.hz} gravity=${fmtFx(w.gx)},${fmtFx(w.gy)}${w.seed ? ` seed=${w.seed}` : ''}${w.tick ? ` tick=${w.tick}` : ''}`];
  w.names.forEach((name, id) => {
    if (name == null) return;
    out.push(`entity ${name}`);
    for (const def of registry.values()) {
      const c = w.get(id, def.name);
      if (!c) continue;
      const vals = def.fields.map((fd) => (fd.type === 'fx' ? fmtFx(c[fd.name] as number) : String(c[fd.name])));
      let end = vals.length;
      while (end > 0 && def.fields[end - 1].def !== undefined && c[def.fields[end - 1].name] === def.fields[end - 1].def) end--;
      out.push(`  ${[def.name, ...vals.slice(0, end)].join(' ')}`);
    }
  });
  if (w.pressed.size || w.overlaps.size) {
    out.push(`state${w.pressed.size ? ` pressed=${[...w.pressed].sort()}` : ''}${w.overlaps.size ? ` overlaps=${[...w.overlaps].sort()}` : ''}`);
  }
  for (const e of expects) out.push(`expect ${e.text}`);
  return out.join('\n') + '\n';
}

/** Compact component reference meant to be pasted into an agent's context. */
export function schemaText(): string {
  return [...registry.values()].map((c) => `${sig(c)}  -- ${c.doc}`).join('\n') + '\n';
}
