// Bytes the simulation allocates per tick. The heap is read before and after a stretch
// of ticks; with a young generation large enough that nothing is collected in between,
// the difference is what the ticks allocated. A stretch in which the collector ran
// shows up as a smaller (or negative) number, so the median of many stretches is used.
//   node --min-semi-space-size=64 --max-semi-space-size=64 bench/alloc.ts SCENE.kiln ...
// Both flags are needed: without the minimum the young generation starts small and is
// collected inside a stretch. Scenes with `use` scripts are not handled yet. Nothing in
// CI runs this yet; the first numbers are in HANDOFF.md.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseScene } from '../src/scene.ts';
import { parseInput, step } from '../src/sim.ts';

const STRETCH = 200, STRETCHES = 21, WARMUP = 2000;

export interface Alloc { scene: string; bytesPerTick: number; idleBytesPerTick: number }

/** Median bytes per tick over stretches of `STRETCH` ticks. */
function median(run: () => void): number {
  const seen: number[] = [];
  for (let s = 0; s < STRETCHES; s++) {
    const before = process.memoryUsage().heapUsed;
    run();
    seen.push((process.memoryUsage().heapUsed - before) / STRETCH);
  }
  return Math.round(seen.sort((a, b) => a - b)[STRETCHES >> 1]);
}

/**
 * Two numbers for a scene. Played: the scene with its recorded input, started again
 * for every stretch (parsing is outside the measurement). Idle: the same world after
 * the input has run out, where nothing new happens and a tick should need nothing.
 */
export function measure(sceneFile: string): Alloc {
  const text = readFileSync(sceneFile, 'utf8');
  let input = '';
  try { input = readFileSync(sceneFile.replace(/\.kiln$/, '.input'), 'utf8'); } catch { /* no input: the scene runs by itself */ }
  const script = parseInput(input.split(/\r?\n/).filter((l) => !/^\s*expect\b/.test(l)).join('\n'));
  // Let the JIT settle first: compiling allocates too.
  let world = parseScene(text, sceneFile).world;
  for (let i = 0; i < WARMUP; i++) step(world, script);
  const idleBytesPerTick = median(() => { for (let i = 0; i < STRETCH; i++) step(world, script); });
  const worlds = Array.from({ length: STRETCHES }, () => parseScene(text, sceneFile).world);
  const bytesPerTick = median(() => { world = worlds.pop()!; for (let i = 0; i < STRETCH; i++) step(world, script); });
  return { scene: sceneFile.replace(/^.*[\\/]/, ''), bytesPerTick, idleBytesPerTick };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = process.argv.slice(2);
  if (!files.length) throw new Error('usage: node --min-semi-space-size=64 --max-semi-space-size=64 bench/alloc.ts SCENE.kiln ...');
  console.log(JSON.stringify(files.map(measure)));
}
