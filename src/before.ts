// `kiln test SCENE --before OLD`: run the game as it was and as it is with the same input,
// and report the first tick where the two worlds differ, and what differs there as scene text.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { loadMods } from './load.ts';
import { loadBackend, physicsOf } from './physics.ts';
import { run } from './run.ts';
import { earlier } from './serve.ts';
import { differences } from '../web/compare.ts';

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

/**
 * Lines that say where the run of `file` first leaves the run of `before` (a scene file or a
 * git revision), over `ticks` ticks with the same input. Scripts of both are loaded afresh
 * before each run, so a component one of them defines is its own at that moment.
 */
export async function divergence(file: string, text: string, before: string, ticks: number, opts: { input?: string; inputFile?: string } = {}): Promise<string[]> {
  const old = restore(before, file);
  try {
    const oldText = readFileSync(old.scene, 'utf8');
    const go = async (scene: string, source: string, to: number, each?: (hash: string) => void) => {
      const mods = await loadMods(source, scene);
      await loadBackend(physicsOf(source), scene);
      return run(source, { input: opts.input, inputFile: opts.inputFile, file: scene, ticks: to, mods, onTick: each });
    };
    const was: string[] = [], is: string[] = [];
    await go(old.scene, oldText, ticks, (h) => was.push(h));
    await go(file, text, ticks, (h) => is.push(h));
    const n = Math.min(was.length, is.length);
    let at = 0;
    while (at < n && was[at] === is[at]) at++;
    if (at === n && was.length === is.length) return [`same as before=${before} through tick ${n - 1}`];
    // One run is over sooner (a scene that loads another stops there) and they agree until then.
    if (at === n) return [`differs from before=${before}: the same through tick ${n - 1}, then ${was.length < is.length ? 'the run before' : 'this run'} ends`];
    const a = (await go(old.scene, oldText, at)).world, b = (await go(file, text, at)).world;
    const lines = differences(a, b);
    // A backend's own state can differ before the rounded scene text does.
    if (!lines.length) lines.push('(only state the scene text does not hold differs)');
    const more = lines.length - SHOWN;
    return [`differs from before=${before} first at tick ${at}`, ...lines.slice(0, SHOWN), ...(more > 0 ? [`... ${more} more lines`] : [])];
  } finally { old.drop(); }
}
