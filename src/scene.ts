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
/** `at`: the line each thing was written on, keyed 'ID COMPONENT' or 'physics'. A spawned entity points at its prefab. */
export interface Scene { world: World; expects: RawExpect[]; uses: string[]; at: Map<string, number> }

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
  const told = new Set<string>();
  const at = new Map<string, number>();
  const err = (code: string, line: number, msg: string, hint?: string): void => {
    const k = `${code}:${line}:${msg}`;
    if (!told.has(k)) { told.add(k); diags.push({ code, file, line, msg, hint }); }
  };
  let cur = -1;
  // Prefabs: named component lists, instantiated by a tile map's `spawn` table.
  const prefabs = new Map<string, { tok: string[]; line: number }[]>();
  let curPrefab: string | null = null;
  // The tiles component whose rows are being read, and where each one was declared.
  let rowsOf: Comp | null = null;
  const tileLines: [number, Comp, number][] = [];

  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    // Tile rows are taken verbatim: '#' is a tile here, not a comment.
    if (rowsOf && /^ {4}\S/.test(raw)) {
      const row = raw.slice(4).trimEnd();
      rowsOf.rows = rowsOf.rows ? `${rowsOf.rows}\n${row}` : row;
      return;
    }
    // A `tiles` line keeps its '#': there it is the usual solid character, not a comment.
    const body = (/^\s+tiles(\s|$)/.test(raw) ? raw : raw.replace(/#(?![\w-]).*$|^\s*#.*$/, '')).trimEnd();
    if (!body.trim()) return;
    rowsOf = null;
    const indented = /^\s/.test(body);
    const tok = body.trim().split(/\s+/);

    if (!indented) {
      cur = -1;
      curPrefab = null;
      if (tok[0] === 'entity') {
        const n = tok[1];
        if (tok.length !== 2 || !NAME.test(n)) return err('K100', line, `expected 'entity NAME' (letters, digits, _ or -)`);
        if (world.ids.has(n)) return err('K101', line, `duplicate entity '${n}'`);
        cur = world.spawn(n);
      } else if (tok[0] === 'prefab') {
        const n = tok[1];
        if (tok.length !== 2 || !NAME.test(n)) return err('K100', line, `expected 'prefab NAME' (letters, digits, _ or -)`);
        if (prefabs.has(n)) return err('K101', line, `duplicate prefab '${n}'`);
        prefabs.set(n, []);
        curPrefab = n;
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
            if (p.length < 2 || p.length > 3 || p.includes(null)) err('K104', line, `world gravity must be X,Y or X,Y,Z`, 'e.g. gravity=0,20');
            else { world.gx = p[0]!; world.gy = p[1]!; world.gz = p[2] ?? 0; }
          } else if (k === 'physics') {
            if (v !== 'rapier') err('K104', line, `unknown physics backend '${v ?? ''}'`, 'valid: physics=rapier');
            else { world.physics = v; at.set('physics', line); }
          } else err('K103', line, `unknown world setting '${k}'`, 'valid: hz, gravity, seed, tick, physics');
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
          registry.has(tok[0]) ? 'components must be indented under an entity' : suggest(tok[0], ['entity', 'prefab', 'world', 'expect', 'use', 'state']));
      }
      return;
    }

    if (curPrefab) {
      if (tok[0] === 'pos') return err('K109', line, `a prefab cannot have 'pos'`, 'the tile cell that spawns it gives the position');
      prefabs.get(curPrefab)!.push({ tok, line });
      return;
    }
    if (cur < 0) return err('K106', line, `component '${tok[0]}' is not under an entity`);
    addComp(cur, tok, line);
  });

  function addComp(id: number, tok: string[], line: number): void {
    const def = registry.get(tok[0]);
    if (!def) return err('K102', line, `unknown component '${tok[0]}'`, suggest(tok[0], registry.keys()));
    if (world.has(id, def.name)) return err('K101', line, `duplicate component '${def.name}' on '${world.names[id]}'`);

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
    if (def.name === 'tiles' && !bad && data.plane !== 'xy' && data.plane !== 'xz') {
      err('K104', line, `tiles plane must be xy or xz, got '${data.plane}'`);
      bad = true;
    }
    if (def.name === 'pace' && !bad && !['x', 'y', 'z'].includes(data.axis as string)) {
      err('K104', line, `pace axis must be x, y or z, got '${data.axis}'`, 'usage: pace axis min max speed');
      bad = true;
    }
    if (def.name === 'rot' && !bad && !['x', 'y', 'z'].includes(data.axis as string)) {
      err('K104', line, `rot axis must be x, y or z, got '${data.axis}'`, 'usage: rot angle [spin] [axis]');
      bad = true;
    }
    if (def.name === 'quat' && !bad && !data.x && !data.y && !data.z && !data.w) {
      err('K104', line, `quat 0 0 0 0 is not an orientation`, 'no turn is quat 0 0 0 1');
      bad = true;
    }
    if (def.name === 'rigid' && !bad && data.shape !== 'box' && data.shape !== 'ball') {
      err('K104', line, `rigid shape must be box or ball, got '${data.shape}'`);
      bad = true;
    }
    if (def.name === 'trigger' && !bad) {
      for (const act of (data.action as string).split('+')) {
        if (!/^(none|despawn-self|despawn-other|despawn:#?[A-Za-z_][\w-]*|load:[\w.-]+\.kiln)$/.test(act)) {
          err('K104', line, `unknown trigger action '${act}'`, suggest(act, ['none', 'despawn-self', 'despawn-other']) ?? 'valid: none, despawn-self, despawn-other, despawn:NAME, despawn:#tag, load:FILE.kiln; join with +');
          bad = true;
        }
      }
    }
    if (bad) return;
    world.add(id, def.name, data);
    at.set(`${id} ${def.name}`, line);
    if (def.name === 'tiles') {
      data.rows = '';
      rowsOf = data;
      tileLines.push([id, data, line]);
    }
  }

  for (const [mapId, t, line] of tileLines) {
    if (!t.rows) { err('K105', line, `'tiles' has no rows`, 'put the rows under it, each indented 4 spaces'); continue; }
    if (!t.spawn) continue;
    // Replace spawn characters with entities built from prefabs. Afterwards the scene is
    // plain entities, so saving and loading it does not spawn anything twice.
    const table = new Map<string, string>();
    for (const pair of (t.spawn as string).split(',')) {
      const name = pair.slice(2);
      if (pair[1] !== ':' || !name) err('K104', line, `spawn entry '${pair}' must be CHAR:PREFAB`, 'e.g. spawn=o:coin,@:hero');
      else if (!prefabs.has(name)) err('K110', line, `unknown prefab '${name}'`, suggest(name, prefabs.keys()) ?? `define it with a top-level 'prefab ${name}' block`);
      else table.set(pair[0], name);
    }
    const mp = world.get(mapId, 'pos');
    if (!mp) { err('K105', line, `'tiles' with spawn needs 'pos' on the same entity`); continue; }
    const rows = (t.rows as string).split('\n'), size = t.size as number;
    const total = new Map<string, number>(), seq = new Map<string, number>();
    for (const row of rows) for (const ch of row) {
      const name = table.get(ch);
      if (name) total.set(name, (total.get(name) ?? 0) + 1);
    }
    t.rows = rows.map((row, r) => [...row].map((ch, c) => {
      const name = table.get(ch);
      if (!name) return ch;
      const k = (seq.get(name) ?? 0) + 1;
      seq.set(name, k);
      // A prefab used once keeps its plain name, so other entities can refer to it directly.
      const ename = total.get(name) === 1 ? name : `${name}${k}`;
      if (world.ids.has(ename)) { err('K101', line, `spawned entity '${ename}' duplicates an existing entity`); return '.'; }
      const id = world.spawn(ename);
      for (const l of prefabs.get(name)!) addComp(id, l.tok, l.line);
      const b = world.get(id, 'box');
      // Centred in its cell when it has a box.
      const cx = (mp.x as number) + c * size + (b ? (size - (b.w as number)) >> 1 : 0);
      // On a floor plan the row gives z, and the entity stands on the level the walls stand on.
      if (t.plane === 'xz') {
        world.add(id, 'pos', {
          x: cx,
          y: (mp.y as number) + (t.depth as number) - (b ? (b.h as number) : 0),
          z: (mp.z as number) + r * size + (b ? (size - (b.d as number)) >> 1 : 0),
        });
      } else {
        world.add(id, 'pos', { x: cx, y: (mp.y as number) + r * size + (b ? (size - (b.h as number)) >> 1 : 0), z: mp.z as number });
      }
      return '.';
    }).join('')).join('\n');
    t.spawn = '';
  }
  if (diags.length) throw new KilnFail(diags);
  return { world, expects, uses, at };
}

/** Canonical scene text for the current state. Parsing it back gives the same world. */
export function serialize(w: World, expects: RawExpect[] = [], uses: string[] = []): string {
  const out = [...uses.map((u) => `use ${u}`),
    `world hz=${w.hz} gravity=${fmtFx(w.gx)},${fmtFx(w.gy)}${w.gz ? `,${fmtFx(w.gz)}` : ''}${w.seed ? ` seed=${w.seed}` : ''}${w.physics ? ` physics=${w.physics}` : ''}${w.tick ? ` tick=${w.tick}` : ''}`];
  w.names.forEach((name, id) => {
    if (name == null) return;
    out.push(`entity ${name}`);
    for (const def of registry.values()) {
      const c = w.get(id, def.name);
      if (!c) continue;
      const vals = def.fields.map((fd) => (fd.type === 'fx' ? fmtFx(c[fd.name] as number) : String(c[fd.name])));
      let end = vals.length;
      while (end > 0 && def.fields[end - 1].def !== undefined && c[def.fields[end - 1].name] === def.fields[end - 1].def) end--;
      // Positional until the first empty string, then name=value for what is not default.
      const gap = vals.findIndex((v, i) => i < end && v === '');
      const parts = gap < 0 ? vals.slice(0, end) : [
        ...vals.slice(0, gap),
        ...def.fields.slice(gap, end).filter((fd) => c[fd.name] !== fd.def).map((fd) => `${fd.name}=${vals[def.fields.indexOf(fd)]}`),
      ];
      out.push(`  ${[def.name, ...parts].join(' ')}`);
      if (def.name === 'tiles') for (const r of (c.rows as string).split('\n')) out.push(`    ${r}`);
    }
  });
  if (w.pressed.size || w.overlaps.size) {
    out.push(`state${w.pressed.size ? ` pressed=${[...w.pressed].sort()}` : ''}${w.overlaps.size ? ` overlaps=${[...w.overlaps].sort()}` : ''}`);
  }
  for (const e of expects) out.push(`expect ${e.text}`);
  return out.join('\n') + '\n';
}

/** Compact component reference meant to be pasted into an agent's context. */
/** Every component; or, given a topic, only its components ('' = the ones without a topic). */
export function schemaText(topic?: string): string {
  return [...registry.values()].filter((c) => topic === undefined || (c.topic ?? '') === topic).map((c) => `${sig(c)}  -- ${c.needs ? `[${c.needs[1]}] ` : ''}${c.doc}`).join('\n') + '\n';
}
