// Rigid-body scenes at size: milliseconds per tick for a walled floor with `n` crates and
// balls dropped on it and four movers pacing through the pile, and where that time goes.
// Run with `node bench/physics.ts` (needs `npm ci --prefix backends/rapier`); add --write
// to update PHYSICS.md. Numbers are from whatever machine runs this, single thread, no rendering.
import { writeFileSync } from 'node:fs';
import { parseScene } from '../src/scene.ts';
import { hash, step } from '../src/sim.ts';
import { freeLink, loadBackend, restoreLink, saveLink } from '../src/physics.ts';
import type { BackendWorld, Link } from '../src/physics.ts';
import type { World } from '../src/world.ts';
import { pace, paceNote, settle } from './settle.ts';

const MOVERS = 4, WARM = 60, TICKS = 240;

/** `n` rigid bodies in four layers above a walled floor, and movers pacing along x under them. */
function scene(n: number): string {
  let seed = 4242;
  const rnd = (m: number): number => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) % m;
  const side = Math.ceil(Math.sqrt(n / 4)), width = side * 1.25 + 2;
  const out = ['world hz=60 gravity=0,30 physics=rapier',
    `entity floor\n  pos 0 0 0\n  box ${width} 1 ${width}\n  solid`,
    `entity west\n  pos -1 -8 0\n  box 1 8 ${width}\n  solid`, `entity east\n  pos ${width} -8 0\n  box 1 8 ${width}\n  solid`,
    `entity north\n  pos 0 -8 -1\n  box ${width} 8 1\n  solid`, `entity south\n  pos 0 -8 ${width}\n  box ${width} 8 1\n  solid`];
  for (let i = 0; i < MOVERS; i++) {
    const z = ((i + 0.5) * width) / MOVERS;
    out.push(`entity mover${i}\n  pos ${1 + i} -1 ${z.toFixed(2)}\n  box 0.8 1 0.8\n  vel\n  body\n  pace x 0.5 ${(width - 1.5).toFixed(2)} 3`);
  }
  for (let i = 0; i < n; i++) {
    const layer = Math.floor(i / (side * side)), cell = i % (side * side);
    const x = 1 + (cell % side) * 1.25 + rnd(20) / 100, z = 1 + Math.floor(cell / side) * 1.25 + rnd(20) / 100;
    out.push(`entity r${i}\n  pos ${x.toFixed(2)} ${(-2.5 - layer * 1.25).toFixed(2)} ${z.toFixed(2)}\n  box 0.8 0.8 0.8\n  rigid ${i % 3 === 0 ? 'ball' : 'box'}`);
  }
  return out.join('\n') + '\n';
}

const world = (n: number): World => parseScene(scene(n)).world;

const median = (xs: number[]): number => xs.sort((a, b) => a - b)[xs.length >> 1];

/** Median milliseconds per tick; `before` runs ahead of every tick (a stand-in for a script). */
function time(w: World, before?: (w: World) => void): number {
  for (let i = 0; i < WARM; i++) { before?.(w); step(w); }
  const ticks: number[] = [];
  for (let i = 0; i < TICKS; i++) {
    const t = performance.now();
    before?.(w); step(w);
    ticks.push(performance.now() - t);
  }
  return median(ticks);
}

/** Wrap the backend's calls in timers: milliseconds and calls per tick, by method. */
function instrument(w: World): Map<string, { ms: number; calls: number }> {
  const acc = new Map<string, { ms: number; calls: number }>();
  const b = (w.link as Link).world as unknown as Record<string, (...a: unknown[]) => unknown>;
  for (const name of ['step', 'read', 'cast', 'touching', 'place', 'moveKinematic', 'mass', 'push'] satisfies (keyof BackendWorld)[]) {
    const inner = b[name].bind(b), a = { ms: 0, calls: 0 };
    acc.set(name, a);
    b[name] = (...args: unknown[]): unknown => {
      const t = performance.now(), r = inner(...args);
      a.ms += performance.now() - t; a.calls++;
      return r;
    };
  }
  return acc;
}

/** A script that writes to every rigid body's position every tick: the worst case for `place` and for casts. */
const nudgeAll = (w: World): void => { for (const id of w.query('rigid', 'pos')) (w.get(id, 'pos')!.x as number) += 1; };

await loadBackend('rapier');
const { burst, before } = settle();
const sizes = [50, 200, 500, 1000, 2000].slice(0, +(process.env.KILN_PERF_ROWS ?? 5));
const speed: string[] = [], where: string[] = [], snap: string[] = [];
for (const n of sizes) {
  // 1. A clean run: one timer around the whole tick and one around the backend's step.
  let w = world(n);
  step(w);
  const inner = (w.link as Link).world, solve = inner.step.bind(inner);
  let inStep = 0;
  inner.step = (): void => { const t = performance.now(); solve(); inStep = performance.now() - t; };
  for (let i = 1; i < WARM; i++) step(w);
  const whole: number[] = [], inside: number[] = [], rest: number[] = [];
  for (let i = 0; i < TICKS; i++) {
    const t = performance.now();
    step(w);
    const all = performance.now() - t;
    whole.push(all); inside.push(inStep); rest.push(all - inStep);
  }
  const worst = Math.max(...whole), ms = median(whole), solver = median(inside), kiln = median(rest), h = hash(w);
  freeLink(w);

  // 2. The same run with every call into the backend timed and counted.
  w = world(n);
  step(w);
  const acc = instrument(w);
  for (let i = 1; i < WARM; i++) step(w);
  for (const a of acc.values()) { a.ms = 0; a.calls = 0; }
  const t3 = performance.now();
  for (let i = 0; i < TICKS; i++) step(w);
  const timed = (performance.now() - t3) / TICKS;
  if (hash(w) !== h) throw new Error(`timing changed the result for ${n} bodies`);
  const per = (name: string): { ms: number; calls: number } => ({ ms: acc.get(name)!.ms / TICKS, calls: acc.get(name)!.calls / TICKS });

  // 3. Saving and restoring the physics state, as `solve` does for every node it expands.
  const t1 = performance.now();
  let bytes = 0;
  for (let i = 0; i < 20; i++) bytes = saveLink(w)!.bytes;
  const save = (performance.now() - t1) / 20, saved = saveLink(w)!;
  freeLink(w);
  const t2 = performance.now();
  for (let i = 0; i < 20; i++) { restoreLink(w, saved); freeLink(w); }
  const restore = (performance.now() - t2) / 20;

  // 4. Every body written to every tick.
  w = world(n);
  const written = time(w, nudgeAll), hw = hash(w);
  freeLink(w);

  console.error(`${n} bodies: ${ms.toFixed(3)} ms/tick (solver ${solver.toFixed(3)}, kiln ${kiln.toFixed(3)}, worst ${worst.toFixed(1)}), written ${written.toFixed(3)}, save ${save.toFixed(2)} restore ${restore.toFixed(2)} ms, ${bytes} bytes`);
  speed.push(`| ${n} | ${ms.toFixed(3)} | ${worst.toFixed(1)} | ${solver.toFixed(3)} | ${kiln.toFixed(3)} | ${Math.round((kiln / ms) * 100)}% | ${ms <= 1000 / 60 ? 'yes' : 'no'} | ${written.toFixed(3)} | ${h} | ${hw} |`);
  where.push(`| ${n} | ${timed.toFixed(3)} | ${['read', 'cast', 'touching', 'moveKinematic'].map((m) => `${per(m).calls.toFixed(1)} | ${per(m).ms.toFixed(3)}`).join(' | ')} |`);
  snap.push(`| ${n} | ${(bytes / 1024).toFixed(0)} | ${save.toFixed(2)} | ${restore.toFixed(2)} | ${Math.floor((256 * 1024 * 1024) / bytes)} |`);
}

const after = pace();
console.error(`pace: ${burst.toFixed(0)} ms fresh, ${before.toFixed(0)} before, ${after.toFixed(0)} after`);

const out = `# Rigid-body scenes at size

Generated by \`node bench/physics.ts --write\`. A walled floor, N crates and balls dropped on
it in four layers, and ${MOVERS} movers pacing through the pile. ${WARM} ticks to warm up, then the
median of ${TICKS} ticks (each column its own median). One thread, no rendering.

Node ${process.version.split('.')[0]}, Rapier 0.21.0 (deterministic build), one laptop-class machine. One run; expect some noise.

${paceNote(burst, before, after)}

## Whole tick

"Solver" is the backend's own step. "Kiln" is everything else in the tick: keeping entities
and bodies in step (one read of every body, written back as fixed-point and compared the
next tick to see what a script changed), the movers' sweeps, and the fixed-point core.
"Written" is the same scene with a script writing to every body's position every tick: each
is then put in its new place, and a mover's sweep has to ask about the near ones one by one.

| Rigid bodies | ms per tick | worst tick | solver | Kiln | Kiln's share | fits 60 Hz | written, ms per tick | final hash | written, final hash |
|---|---|---|---|---|---|---|---|---|---|
${speed.join('\n')}

## Backend calls per tick

From a second run with a timer around every call into the backend. The timers add to what
they measure (the tick is slower than above), so the times are upper bounds.

| Rigid bodies | ms per tick, timed | read calls | read ms | cast calls | cast ms | touching calls | touching ms | moveKinematic calls | moveKinematic ms |
|---|---|---|---|---|---|---|---|---|---|
${where.join('\n')}

## Saving and restoring

What \`solve\` pays to keep a search node's physics state and to go back to it.

| Rigid bodies | snapshot, KiB | save, ms | restore, ms | snapshots in solve's 256 MiB |
|---|---|---|---|---|
${snap.join('\n')}

The hash columns are there so that an optimisation which changes results cannot go unnoticed.
`;
process.stdout.write(out);
if (process.argv.includes('--write')) writeFileSync(new URL('PHYSICS.md', import.meta.url), out);
