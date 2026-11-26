import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ONE, div, fmtFx, fx, mul, tickShare } from './fx.ts';
import type { Mods } from './run.ts';
import { KilnFail } from './scene.ts';
import type { Diag } from './scene.ts';
import { defineComponent } from './world.ts';
import type { Field, System } from './world.ts';

/** What a script's default export receives. */
export interface Kiln {
  component(name: string, doc: string, fields?: Field[]): void;
  /** stage 'pre' runs before physics each tick, 'post' after triggers */
  system(fn: System, stage?: 'pre' | 'post'): void;
  ONE: number;
  fx: typeof fx;
  mul: typeof mul;
  div: typeof div;
  fmtFx: typeof fmtFx;
  tickShare: typeof tickShare;
}

// Anything that would make two runs of the same scene differ.
const NONDET = /\bMath\.random\b|\bDate\b|\bperformance\b|\bsetTimeout\b|\bsetInterval\b|\bprocess\b|\bfetch\b/;

/** Import every script named by a scene's `use` lines and collect what they register. */
export async function loadMods(sceneText: string, sceneFile: string): Promise<Mods> {
  const mods: Mods = { pre: [], post: [] };
  const diags: Diag[] = [];
  const api: Kiln = {
    component: defineComponent,
    system: (fn, stage = 'pre') => void mods[stage].push(fn),
    ONE, fx, mul, div, fmtFx, tickShare,
  };
  const lines = sceneText.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /^use\s+(\S+)\s*$/.exec(lines[i]);
    if (!m) continue;
    const err = (code: string, msg: string, hint?: string, file = sceneFile, line = i + 1) => diags.push({ code, file, line, msg, hint });
    const path = resolve(dirname(sceneFile), m[1]);
    let src: string;
    try { src = readFileSync(path, 'utf8'); } catch { err('K120', `script '${m[1]}' not found`, `looked at ${path}`); continue; }
    let clean = true;
    src.split(/\r?\n/).forEach((l, n) => {
      const hit = NONDET.exec(l.replace(/\/\/.*$/, ''));
      if (!hit) return;
      clean = false;
      err('K121', `nondeterministic API '${hit[0]}' in a script`, 'use w.rand() for randomness and w.tick for time', m[1], n + 1);
    });
    if (!clean) continue;
    try {
      const mod = await import(pathToFileURL(path).href);
      if (typeof mod.default !== 'function') err('K123', `script '${m[1]}' has no default export function`, 'export default (k) => { k.system((w) => { ... }) }');
      else mod.default(api);
    } catch (e) {
      err('K122', `script '${m[1]}' failed to load: ${(e as Error).message.split('\n')[0]}`);
    }
  }
  if (diags.length) throw new KilnFail(diags);
  return mods;
}
