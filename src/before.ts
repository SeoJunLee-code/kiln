// Where two runs part. `kiln test SCENE --before OLD` runs the game as it was and as it is with
// the same input; `kiln diff SCENE --against OTHER` runs any two (another input, another scene,
// a git revision). Both report the first tick where the worlds differ and what differs there.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { loadMods } from './load.ts';
import { loadBackend, physicsOf } from './physics.ts';
import { run } from './run.ts';
import { earlier } from './serve.ts';
import { differences } from '../web/compare.ts';
import type { World } from './world.ts';

/** Lines of difference shown; the rest are counted. */
const SHOWN = 24;

/** The old game on disk: another scene file where it is, or a revision written out to a temporary folder. */
function restore(before: string, file: string): { scene: string; drop: () => void } {
  const was = earlier(before, file);
  if (/\.kiln$/.test(before) && existsSync(before)) return { scene: resolve(before), drop: () => {} };
  const dir = mkdtempSync(join(tmpdir(), 'kiln-before-'));
  const from = dirname(resolve(file));
  // Paths are listed relative to the game's folder, so a script's imports still find each other.
  const names = execFileSync('git', ['-C', from, 'ls-tree', '-r', '--name-only', '-z', before, '--', '.'], { encoding: 'utf8', maxBuffer: 64 << 20 });
  for (const rel of names.split('\0').filter((n) => n && !n.startsWith('..'))) {
    const bytes = was.read(rel);
    if (!bytes) continue;
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), bytes);
  }
  return { scene: join(dir, was.scene), drop: () => rmSync(dir, { recursive: true, force: true }) };
}

/** One of two runs to compare: a scene and the input it is played with. */
export interface Side { file: string; text: string; input?: string; inputFile?: string }

/**
 * Run both sides and find the first tick where their states differ. `at` counts ticks
 * run (0: they differ before any step); `n` is how many both ran, plus one. With no
 * `ticks` the first side runs to its end and the second as long as the first did.
 * `ends`: they agree as far as both go, and that side stops sooner. Scripts of each side
 * are loaded afresh before each run, so a component one of them defines is its own then.
 */
export async function parting(one: Side, two: Side, ticks?: number): Promise<{ at: number; n: number; last: string; ends?: 1 | 2; a?: World; b?: World }> {
  const go = async (s: Side, to: number | undefined, each?: (hash: string) => void) => {
    const mods = await loadMods(s.text, s.file);
    await loadBackend(physicsOf(s.text), s.file);
    return run(s.text, { input: s.input, inputFile: s.inputFile, file: s.file, ticks: to, mods, onTick: each });
  };
  const was: string[] = [], is: string[] = [];
  await go(one, ticks, (h) => was.push(h));
  await go(two, ticks ?? was.length - 1, (h) => is.push(h));
  const n = Math.min(was.length, is.length);
  let at = 0;
  while (at < n && was[at] === is[at]) at++;
  if (at === n) return { at, n, last: was[n - 1], ends: was.length === is.length ? undefined : was.length < is.length ? 1 : 2 };
  return { at, n, last: was[n - 1], a: (await go(one, at)).world, b: (await go(two, at)).world };
}

/** The other side of `diff`: another input for the same scene, another scene file, or the game at a git revision. */
export function against(other: string, side: Side): { side: Side; drop: () => void } {
  if (!/\.kiln$/.test(other) && existsSync(other)) return { side: { ...side, input: readFileSync(other, 'utf8'), inputFile: other }, drop: () => {} };
  const old = restore(other, side.file);
  return { side: { ...side, file: old.scene, text: readFileSync(old.scene, 'utf8') }, drop: old.drop };
}

/**
 * Lines that say where the run of `file` first leaves the run of `before` (a scene file or a
 * git revision), over `ticks` ticks with the same input.
 */
export async function divergence(file: string, text: string, before: string, ticks: number, opts: { input?: string; inputFile?: string } = {}): Promise<string[]> {
  const old = restore(before, file);
  try {
    const p = await parting({ ...opts, file: old.scene, text: readFileSync(old.scene, 'utf8') }, { ...opts, file, text }, ticks);
    if (!p.a) return [p.ends ? `differs from before=${before}: the same through tick ${p.n - 1}, then ${p.ends === 1 ? 'the run before' : 'this run'} ends` : `same as before=${before} through tick ${p.n - 1}`];
    const lines = differences(p.a, p.b!);
    // A backend's own state can differ before the rounded scene text does.
    if (!lines.length) lines.push('(only state the scene text does not hold differs)');
    const more = lines.length - SHOWN;
    return [`differs from before=${before} first at tick ${p.at}`, ...lines.slice(0, SHOWN), ...(more > 0 ? [`... ${more} more lines`] : [])];
  } finally { old.drop(); }
}
