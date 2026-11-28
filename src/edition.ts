import type { Diag, Scene } from './scene.ts';
import { registry } from './world.ts';
import type { Axis, Edition } from './world.ts';

/** Smallest first. Each edition contains the ones before it (docs/EDITIONS.md). */
export const EDITIONS: Edition[] = ['lite', 'standard', 'ultra'];
/** What a game is measured on. Its edition is the highest of these. */
export const AXES: Axis[] = ['drawing', 'physics', 'world', 'network'];
export const isEdition = (s: string): s is Edition => (EDITIONS as string[]).includes(s);
const rank = (e: Edition): number => EDITIONS.indexOf(e);

/** One use of something Lite does not have: what it is, the axis and edition it belongs to, and where it was written. */
export interface Need { axis: Axis; edition: Edition; what: string; line: number }

/**
 * Everything in the scene that asks for more than Lite, in line order. The edition of a
 * game is never declared; it is worked out from this list.
 *
 * A component names its axis and edition where it is defined. The rest are features of a
 * value or of a combination, so they are listed here:
 *   - a physics backend (megabytes a Lite game must not carry),
 *   - more than one player (network sessions),
 *   - a glTF model (drawn only by the WebGPU renderer),
 *   - `rot` in a scene drawn in 3D (the WebGL2 renderer, which is Lite's, does not turn boxes).
 */
export function needs(scene: Scene): Need[] {
  const w = scene.world, out: Need[] = [];
  const add = (axis: Axis, edition: Edition, what: string, key: string): void => void out.push({ axis, edition, what, line: scene.at.get(key) ?? 0 });
  if (w.physics) add('physics', 'standard', `physics=${w.physics}`, 'physics');
  if (w.players > 1) add('network', 'standard', `players=${w.players}`, 'players');
  for (const def of registry.values()) {
    if (def.needs) for (const id of w.query(def.name)) add(def.needs[0], def.needs[1], `'${def.name}'`, `${id} ${def.name}`);
  }
  for (const id of w.query('sprite')) {
    if (/\.(gltf|glb)$/i.test(w.get(id, 'sprite')!.mesh as string)) add('drawing', 'standard', 'a glTF mesh', `${id} sprite`);
  }
  if (w.query('eye').length) for (const id of w.query('rot')) add('drawing', 'standard', `'rot' in a 3D scene`, `${id} rot`);
  return out.sort((a, b) => a.line - b.line || (a.what < b.what ? -1 : a.what > b.what ? 1 : 0));
}

/** The edition each axis needs. */
export function axes(list: Need[]): Record<Axis, Edition> {
  const out = Object.fromEntries(AXES.map((a) => [a, 'lite'])) as Record<Axis, Edition>;
  for (const n of list) if (rank(n.edition) > rank(out[n.axis])) out[n.axis] = n.edition;
  return out;
}

/** The smallest edition that has everything in `list`: the highest of its axes. */
export const lowest = (list: Need[]): Edition => EDITIONS[Math.max(0, ...list.map((n) => rank(n.edition)))];

/** Uses above `ceiling`, as errors. */
export function over(list: Need[], ceiling: Edition, file: string): Diag[] {
  return list.filter((n) => rank(n.edition) > rank(ceiling)).map((n) => ({
    code: 'K140', file, line: n.line, msg: `${n.what} needs ${n.axis} ${n.edition}; the ceiling is ${ceiling}`,
  }));
}

/**
 * Why the scene is not Lite: one line per axis that is above it, naming each kind of use
 * that sets the axis once, with its first line and how many more there are.
 */
export function why(list: Need[]): string[] {
  const at = axes(list), out: string[] = [];
  for (const axis of AXES) {
    if (at[axis] === 'lite') continue;
    const kinds = new Map<string, { line: number; more: number }>();
    for (const n of list) {
      if (n.axis !== axis || n.edition !== at[axis]) continue;
      const k = kinds.get(n.what);
      if (k) k.more++;
      else kinds.set(n.what, { line: n.line, more: 0 });
    }
    out.push(`${axis} ${at[axis]}: ${[...kinds].map(([what, k]) => `${what} (line ${k.line}${k.more ? `, +${k.more} more` : ''})`).join(', ')}`);
  }
  return out;
}
