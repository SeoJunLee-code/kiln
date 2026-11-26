// Rigid bodies through the physics backend. The backend is an optional package
// (backends/rapier); CI installs it, and without it these are skipped.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from '../src/build.ts';
import { command } from '../src/commands.ts';
import { ONE } from '../src/fx.ts';
import { freeLink, loadBackend, restoreLink, saveLink } from '../src/physics.ts';
import { run } from '../src/run.ts';
import { KilnFail, parseScene, serialize } from '../src/scene.ts';
import { hash, step } from '../src/sim.ts';
import { cloneWorld, solve } from '../src/solve.ts';
import type { World } from '../src/world.ts';

const root = (rel: string): string => fileURLToPath(new URL(`../${rel}`, import.meta.url));
const skip = existsSync(root('backends/rapier/node_modules')) ? false : 'the rapier backend is not installed (npm ci --prefix backends/rapier)';
before(async () => { if (!skip) await loadBackend('rapier'); });

const at = (w: World, name: string, comp: string, field: string): number => (w.get(w.ids.get(name)!, comp)![field] as number) / ONE;
// Hash of the scene in the determinism test after 300 ticks. CI compares it on three OSes.
const PINNED = '9ef98050';
const FLOOR = 'entity floor\n  pos -10 0 -10\n  box 20 1 20\n  solid\n';
const codes = (fn: () => unknown): string[] => {
  try { fn(); } catch (e) { if (e instanceof KilnFail) return e.diags.map((d) => d.code); throw e; }
  return [];
};

test('physics: the scene names its backend, and mistakes are errors or warnings', async () => {
  const w = parseScene('world gravity=0,30 physics=rapier\nentity a\n  pos 0 0 0\n  box 1 1 1\n  rigid ball 2 0.5\n').world;
  assert.equal(w.physics, 'rapier');
  assert.match(serialize(w), /^world hz=60 gravity=0,30 physics=rapier\nentity a\n  pos 0 0\n  box 1 1\n  rigid ball 2 0.5\n$/);
  assert.deepEqual(codes(() => parseScene('world physics=havok\n')), ['K104']);
  assert.deepEqual(codes(() => parseScene('world physics=rapier\nentity a\n  pos 0 0\n  box 1 1\n  rigid cone\n')), ['K104']);
  const lint = (await command('check', { scene: 'entity a\n  pos 0 0\n  box 1 1\n  rigid\nentity b\n  pos 0 0\n  rigid\n' })).text;
  assert.match(lint, /^W K316 scene 'a' has 'rigid' but the world has no physics backend/m);
  assert.match(lint, /^W K310 scene 'b' has 'rigid' but no 'box'/m);
});

test('physics: a scene that asks for a backend nobody loaded says so', () => {
  // In a fresh process, so that this file's own loading of the backend does not hide it.
  const code = `import('./src/run.ts').then(({ run }) => { try { run('world physics=rapier\\nentity a\\n  pos 0 0\\n  box 1 1\\n  rigid\\n', { ticks: 1 }); } catch (e) { console.log(e.message); } })`;
  const r = spawnSync(process.execPath, ['-e', code], { cwd: root('.'), encoding: 'utf8' });
  assert.match(r.stdout, /^E K130 scene:0 physics backend 'rapier' is not loaded \(hint: install it once: npm ci --prefix backends\/rapier\)/);
});

test('physics: a box falls, lands on the floor and comes to rest; a bouncy ball comes back up', { skip }, () => {
  const scene = `world gravity=0,30 physics=rapier\n${FLOOR}` +
    'entity crate\n  pos 0 -5 0\n  box 1 1 1\n  rigid\n' +
    'entity dull\n  pos 4 -5 0\n  box 1 1 1\n  rigid ball\n' +
    'entity lively\n  pos 8 -5 0\n  box 1 1 1\n  rigid ball bounce=0.9\n';
  const w = run(scene, { ticks: 30 }).world;
  // Half a second of free fall under 30 units/s^2: 3.75 units, give or take the integrator.
  assert.ok(Math.abs(at(w, 'crate', 'pos', 'y') - -1.25) < 0.3, `after 30 ticks y=${at(w, 'crate', 'pos', 'y')}`);
  assert.ok(at(w, 'crate', 'vel', 'y') > 14 && at(w, 'crate', 'vel', 'y') < 16);
  // Its highest point after the first landing: the lively ball climbs most of the way back.
  let dullTop = 0, livelyTop = 0;
  for (let t = 30; t < 400; t++) {
    step(w);
    if (t > 35) { dullTop = Math.min(dullTop, at(w, 'dull', 'pos', 'y')); livelyTop = Math.min(livelyTop, at(w, 'lively', 'pos', 'y')); }
  }
  assert.ok(Math.abs(at(w, 'crate', 'pos', 'y') - -1) < 0.01, `resting y=${at(w, 'crate', 'pos', 'y')}`);
  assert.deepEqual(['x', 'y', 'z'].map((f) => at(w, 'crate', 'vel', f)), [0, 0, 0]);
  assert.ok(dullTop > -1.2, `the dull ball rose to ${dullTop}`);
  assert.ok(livelyTop < -3, `the lively ball only rose to ${livelyTop}`);
  freeLink(w);
});

test('physics: the same scene gives the same state, pinned so that every OS must agree', { skip }, () => {
  const scene = `world gravity=0,30 physics=rapier\n${FLOOR}` +
    'entity a\n  pos 0 -3 0\n  box 1 1 1\n  rigid\n  quat 0.2 0.1 0 0.97 sx=90 sz=40\n' +
    'entity b\n  pos 0.4 -6 0.3\n  box 1.2 0.6 0.8\n  rigid density=2\n' +
    'entity c\n  pos -0.3 -9 0.2\n  box 0.8 0.8 0.8\n  rigid ball bounce=0.5\n';
  const first = run(scene, { ticks: 300 }), second = run(scene, { ticks: 300 });
  assert.equal(first.hash, second.hash);
  // The backend's exact state is in the hash, not only the rounded values in the text.
  assert.notEqual(first.hash, hash(parseScene(serialize(first.world)).world));
  assert.equal(first.hash, PINNED);
  // What the text holds of a body is what the backend had, rounded: a unit quaternion and a place above the floor.
  const q = ['x', 'y', 'z', 'w'].map((f) => at(first.world, 'a', 'quat', f));
  assert.ok(Math.abs(Math.hypot(...q) - 1) < 0.001);
  assert.ok(at(first.world, 'a', 'pos', 'y') < 0 && at(first.world, 'a', 'pos', 'y') > -3);
  freeLink(first.world);
  freeLink(second.world);
});

test('physics: movers push bodies, solid tiles hold them, and a despawned body leaves', { skip }, () => {
  const scene = 'world gravity=0,30 physics=rapier\n' +
    'entity map\n  pos -2 0 -2\n  tiles plane=xz\n    ##########\n    ##########\n    ##########\n    ##########\n' +
    'entity mover\n  pos 0 -1 0\n  box 1 1 1\n  vel 2 0 0\n' +
    'entity crate\n  pos 2 -1 0\n  box 1 1 1\n  rigid\n' +
    'entity far\n  pos 0 -1 1.5\n  box 0.5 1 0.5\n  rigid\n' +
    'entity gate\n  pos 5 -1 -1\n  box 0.2 1 3\n  trigger crate through despawn-other\n';
  const w = run(scene, { ticks: 60 }).world;
  // The mover has gone 2 units and the crate was in its way: pushed ahead, still on the tiles.
  assert.ok(at(w, 'crate', 'pos', 'x') > 2.9, `crate x=${at(w, 'crate', 'pos', 'x')}`);
  assert.ok(Math.abs(at(w, 'crate', 'pos', 'y') - -1) < 0.05, `crate y=${at(w, 'crate', 'pos', 'y')}`);
  assert.ok(Math.abs(at(w, 'far', 'pos', 'x')) < 0.01, 'a body out of the way stays');
  // Pushed on into the gate, the crate is despawned; the rest keeps running.
  for (let t = 0; t < 120; t++) step(w);
  assert.equal(w.ids.has('crate'), false);
  assert.deepEqual(w.events.map((e) => e.name), ['through']);
  assert.ok(Math.abs(at(w, 'far', 'pos', 'y') - -1) < 0.05);
  freeLink(w);
});

test('physics: a saved state continues exactly as the run it was taken from', { skip }, () => {
  const scene = `world gravity=0,30 physics=rapier\n${FLOOR}` +
    'entity a\n  pos 0 -3 0\n  box 1 1 1\n  rigid\n  quat sx=120\nentity b\n  pos 0.3 -5 0.2\n  box 1 1 1\n  rigid ball bounce=0.6\n';
  const w = run(scene, { ticks: 40 }).world;
  const copy = cloneWorld(w), saved = saveLink(w);
  assert.ok(saved && saved.bytes > 1000);
  for (let t = 0; t < 200; t++) step(w);
  restoreLink(copy, saved);
  for (let t = 0; t < 200; t++) step(copy);
  assert.equal(hash(copy), hash(w));
  // Without the saved state a copy starts the backend cold from the rounded text, and drifts.
  const cold = cloneWorld(run(scene, { ticks: 40 }).world);
  for (let t = 0; t < 200; t++) step(cold);
  assert.notEqual(hash(cold), hash(w));
  for (const x of [w, copy, cold]) freeLink(x);
});

test('solve: finds the push that rolls the ball onto the plate, with or without room to keep snapshots', { skip, timeout: 120000 }, async () => {
  const text = readFileSync(root('examples/tumble3d.kiln'), 'utf8');
  const roomy = solve(text);
  assert.equal(roomy.ok, true, roomy.note);
  assert.equal(roomy.resimulated, 0);
  // The answer replays: test runs it from the start and the goal is met.
  const dir = mkdtempSync(join(tmpdir(), 'kiln-physics-'));
  writeFileSync(join(dir, 'answer.input'), roomy.input);
  const replay = await command('test', { file: root('examples/tumble3d.kiln'), inputFile: join(dir, 'answer.input') });
  assert.match(replay.text, /passed=1 failed=0$/m);
  // With room for almost no snapshots, states are rebuilt by running their inputs again: same search, same answer.
  const tight = solve(text, { physicsCache: 1 });
  assert.deepEqual([tight.ok, tight.input, tight.states], [true, roomy.input, roomy.states]);
  assert.ok(tight.resimulated! > 0, 'nothing was re-simulated');
});

test('build: a physics scene takes its backend along', { skip }, () => {
  const out = mkdtempSync(join(tmpdir(), 'kiln-physics-build-'));
  const { written } = build(root('examples/tumble3d.kiln'), out);
  for (const f of ['engine/src/physics.js', 'engine/backends/rapier/index.js', 'engine/backends/rapier/node_modules/@dimforge/rapier3d-deterministic-compat/dist/rapier.mjs']) {
    assert.ok(written.includes(f), `${f} was not written`);
  }
  assert.match(readFileSync(join(out, 'index.html'), 'utf8'), /"@dimforge\/rapier3d-deterministic-compat": "\.\/engine\/backends\/rapier\/node_modules\//);
});

