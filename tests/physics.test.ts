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
const PINNED = 'b390abd2';
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
  assert.deepEqual(codes(() => parseScene('world physics=rapier\nentity a\n  pos 0 0\n  box 1 1\n  rigid pyramid\n')), ['K104']);
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

test('physics: a solid mover pushes bodies, solid tiles hold them, and a despawned body leaves', { skip }, () => {
  const scene = 'world gravity=0,30 physics=rapier\n' +
    'entity map\n  pos -2 0 -2\n  tiles plane=xz\n    ##########\n    ##########\n    ##########\n    ##########\n' +
    'entity mover\n  pos 0 -1 0\n  box 1 1 1\n  vel 2 0 0\n  solid\n' +
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

// A walker on a floor with a wall at x=8: `walker` is 0.8 wide and walks right at 4 units/s while `right` is held.
const WALK = `world gravity=0,30 physics=rapier\n${FLOOR}` +
  'entity wall\n  pos 8 -3 -2\n  box 1 3 4\n  solid\n' +
  'entity walker\n  pos 0 -1 0\n  box 0.8 1 0.8\n  vel\n  body\n  ctrl 4 9 xz\n';
const HOLD_RIGHT = new Map([[0, [['right', true]] as [string, boolean][]]]);
/** Run a scene for `ticks` with `right` held, and return the smallest gap seen between the walker's right side and a body's left. */
function walk(scene: string, ticks: number, body: string): { w: World; gap: number } {
  const w = parseScene(scene).world;
  let gap = Infinity;
  for (let t = 0; t < ticks; t++) {
    step(w, HOLD_RIGHT);
    gap = Math.min(gap, at(w, body, 'pos', 'x') - (at(w, 'walker', 'pos', 'x') + 0.8));
  }
  return { w, gap };
}

test('physics: a body blocks the character, who pushes a light one along and cannot move a heavy one', { skip }, () => {
  const light = walk(`${WALK}entity crate\n  pos 2 -1 0\n  box 1 1 1\n  rigid\n`, 90, 'crate');
  // A second and a half at 4 units/s: the crate has gone ahead of the walker, never overlapped, never outrun by much.
  assert.ok(at(light.w, 'crate', 'pos', 'x') > 5, `light crate x=${at(light.w, 'crate', 'pos', 'x')}`);
  assert.ok(light.gap > 0 && light.gap < 0.02, `smallest gap ${light.gap}`);
  assert.ok(at(light.w, 'crate', 'vel', 'x') <= 4.01, `crate speed ${at(light.w, 'crate', 'vel', 'x')}`);
  // 400 times the walker's mass, and friction holds it: the walker stops against it.
  const heavy = walk(`${WALK}entity crate\n  pos 2 -1 0\n  box 1 1 1\n  rigid density=256\n`, 90, 'crate');
  assert.ok(Math.abs(at(heavy.w, 'crate', 'pos', 'x') - 2) < 0.05, `heavy crate x=${at(heavy.w, 'crate', 'pos', 'x')}`);
  assert.ok(heavy.gap > 0, `smallest gap ${heavy.gap}`);
  assert.ok(at(heavy.w, 'walker', 'pos', 'x') < 1.25, `walker x=${at(heavy.w, 'walker', 'pos', 'x')}`);
  for (const r of [light, heavy]) freeLink(r.w);
});

test('physics: a body pushed against a wall stays out of the wall and out of the character', { skip }, () => {
  // The walker keeps walking for three seconds after the body has reached the wall at x=8.
  for (const [body, size, extra] of [['crate', 1, ''], ['ball', 0.8, ' ball bounce=0.3']] as [string, number, string][]) {
    const { w, gap } = walk(`${WALK}entity ${body}\n  pos 5 ${-size} 0\n  box ${size} ${size} ${size}\n  rigid${extra}\n`, 300, body);
    assert.ok(gap > 0, `${body}: the walker was ${-gap} inside it`);
    assert.ok(Math.abs(at(w, body, 'pos', 'x') + size - 8) < 0.01, `${body}: its far side is at x=${at(w, body, 'pos', 'x') + size}, the wall starts at 8`);
    assert.ok(Math.abs(at(w, body, 'pos', 'y') - -size) < 0.01, `${body}: squeezed off the floor to y=${at(w, body, 'pos', 'y')}`);
    assert.ok(Math.abs(at(w, 'walker', 'pos', 'x') + 0.8 + size - 8) < 0.03, `${body}: the walker stopped at x=${at(w, 'walker', 'pos', 'x')}`);
    freeLink(w);
  }
});

test('physics: the character lands on a body, stands on it, rides it and can jump from it', { skip }, () => {
  const scene = `world gravity=0,30 physics=rapier\n${FLOOR}` +
    'entity crate\n  pos 0 -1 0\n  box 2 1 2\n  rigid\n' +
    'entity walker\n  pos 0.5 -4 0.5\n  box 0.8 1 0.8\n  vel\n  body\n  ctrl 4 9 xz\n';
  const w = run(scene, { ticks: 60 }).world;
  const body = w.get(w.ids.get('walker')!, 'body')!;
  // Feet on the crate's top (y=-1), less the hair's breadth a mover keeps from a body.
  assert.ok(Math.abs(at(w, 'walker', 'pos', 'y') + 1 - -1) < 0.02, `walker feet at y=${at(w, 'walker', 'pos', 'y') + 1}`);
  assert.deepEqual([body.grounded, body.ride], [1, 'crate']);
  assert.ok(Math.abs(at(w, 'crate', 'pos', 'y') - -1) < 0.01, 'the crate was pressed into the floor');
  const jump = new Map([[60, [['a', true]] as [string, boolean][]]]);
  for (let t = 60; t < 70; t++) step(w, jump);
  assert.ok(at(w, 'walker', 'pos', 'y') + 1 < -1.8, `ten ticks into a jump the feet are at y=${at(w, 'walker', 'pos', 'y') + 1}`);
  freeLink(w);
});

test('physics: a body blocks from the first tick, and a fast one does not pass through a thin wall', { skip }, () => {
  // The backend's own scene queries see a body only after its first step; the walker must not use that tick to get in.
  const near = parseScene(`${WALK}entity crate\n  pos 0.81 -1 0\n  box 1 1 1\n  rigid density=256\n`).world;
  step(near, HOLD_RIGHT);
  assert.ok(at(near, 'walker', 'pos', 'x') + 0.8 <= 0.81, `after one tick the walker's side is at ${at(near, 'walker', 'pos', 'x') + 0.8}`);
  // 4 units per tick at a wall 0.2 thick: without a look ahead, one tick ends short of it and the next past it.
  const fast = run(`world gravity=0,30 physics=rapier\n${FLOOR}entity thin\n  pos 4.2 -3 -2\n  box 0.2 3 4\n  solid\n` +
    'entity shot\n  pos 0 -1 0\n  box 0.4 0.4 0.4\n  vel 240 0 0\n  rigid ball\n', { ticks: 60 }).world;
  assert.ok(at(fast, 'shot', 'pos', 'x') < 4.2, `the shot is at x=${at(fast, 'shot', 'pos', 'x')}, past the wall at 4.2`);
  for (const x of [near, fast]) freeLink(x);
});

test('physics: a pushed crate (fixed-point) is stopped by a body too', { skip }, () => {
  const scene = `${WALK}entity crate\n  pos 2 -1 0\n  box 1 1 1\n  solid\n  push\nentity anvil\n  pos 4 -1 0\n  box 1 1 1\n  rigid density=256\n`;
  const { w } = walk(scene, 120, 'crate');
  // Walker, crate, anvil: the crate was shoved a unit and stopped at the anvil, which did not give way.
  assert.ok(Math.abs(at(w, 'anvil', 'pos', 'x') - 4) < 0.05, `anvil x=${at(w, 'anvil', 'pos', 'x')}`);
  const side = at(w, 'crate', 'pos', 'x') + 1;
  assert.ok(side > 3.9 && side <= at(w, 'anvil', 'pos', 'x'), `the crate's far side is at x=${side}`);
  freeLink(w);
});

test('physics: an impulse changes a body\'s speed once and is used up; a force keeps pushing', { skip }, async () => {
  // No gravity, so that the only changes of speed are the pushes. The ball's mass is 2 x 4/3 pi 0.5^3.
  const scene = 'world physics=rapier\n' +
    'entity ball\n  pos 0 0 0\n  box 1 1 1\n  rigid ball 2\n  impulse 3 0 -1.5\n' +
    'entity crate\n  pos 5 0 0\n  box 1 1 1\n  rigid\n  force 0 -6 0\n' +
    'entity ghost\n  pos 9 0 0\n  box 1 1 1\n  impulse 1 0 0\n';
  const w = run(scene, { ticks: 1 }).world;
  const mass = 2 * (4 / 3) * Math.PI * 0.125;
  assert.ok(Math.abs(at(w, 'ball', 'vel', 'x') - 3 / mass) < 0.001 && Math.abs(at(w, 'ball', 'vel', 'z') - -1.5 / mass) < 0.001, `ball speed ${at(w, 'ball', 'vel', 'x')}, ${at(w, 'ball', 'vel', 'z')}`);
  assert.equal(w.has(w.ids.get('ball')!, 'impulse'), false);
  for (let t = 1; t < 60; t++) step(w);
  // A second later the ball still has that speed, and the crate (mass 1) has gained 6 units/s upward.
  assert.ok(Math.abs(at(w, 'ball', 'vel', 'x') - 3 / mass) < 0.001);
  assert.ok(Math.abs(at(w, 'crate', 'vel', 'y') - -6) < 0.01, `crate speed ${at(w, 'crate', 'vel', 'y')}`);
  assert.equal(w.has(w.ids.get('crate')!, 'force'), true);
  // The text holds the force and no longer the impulse, so a reader of the scene sees what is still acting.
  assert.match(serialize(w), /entity crate\n(  .*\n)*  force 0 -6\n/);
  assert.doesNotMatch(serialize(w), /entity ball\n(  .*\n)*  impulse/);
  // On something that is not a rigid body they do nothing, and check says so.
  assert.equal(at(w, 'ghost', 'pos', 'x'), 9);
  assert.match((await command('check', { scene })).text, /^W K310 scene 'ghost' has 'impulse' but no 'rigid'/m);
  freeLink(w);
});

test('physics: a script kicks a body by giving it an impulse', { skip }, () => {
  // What a script does: on a tick of its choosing, add the component. Here the kick beats gravity for a moment.
  const scene = `world gravity=0,30 physics=rapier\n${FLOOR}entity ball\n  pos 0 -1 0\n  box 1 1 1\n  rigid ball\n`;
  const kick = (x: World): void => { if (x.tick === 30) x.add(x.ids.get('ball')!, 'impulse', { x: 0, y: -5 * ONE, z: 0 }); };
  const w = run(scene, { ticks: 30, mods: { pre: [kick], post: [] } }).world;
  assert.ok(Math.abs(at(w, 'ball', 'pos', 'y') - -1) < 0.01, 'the ball should rest on the floor before the kick');
  let top = 0;
  for (let t = 30; t < 90; t++) { step(w); top = Math.min(top, at(w, 'ball', 'pos', 'y')); }
  // Mass 0.52, so it leaves at about 9.5 units/s and rises about 1.5 units under gravity 30.
  assert.ok(top < -2.2 && top > -2.8, `the ball rose to y=${top}`);
  freeLink(w);
});

test('physics: a script puts a body somewhere, sets its speed, turn and spin; what it leaves alone stays exact', { skip }, () => {
  const scene = `world gravity=0,30 physics=rapier\n${FLOOR}entity ball\n  pos 0 -1 0\n  box 1 1 1\n  rigid ball\nentity crate\n  pos 4 -1 0\n  box 1 1 1\n  rigid\n`;
  const set = (x: World, name: string, comp: string, data: Record<string, number>): void => void Object.assign(x.get(x.ids.get(name)!, comp)!, data);
  const move = (x: World): void => {
    if (x.tick === 30) set(x, 'ball', 'pos', { x: 6 * ONE, y: -5 * ONE });   // lifted and moved: it falls again, over there
    if (x.tick === 31) set(x, 'crate', 'vel', { z: 3 * ONE });               // sent sliding
    if (x.tick === 32) set(x, 'crate', 'quat', { sy: 720 * ONE });           // set spinning
  };
  const w = run(scene, { ticks: 30, mods: { pre: [move], post: [] } }).world;
  step(w);
  assert.ok(Math.abs(at(w, 'ball', 'pos', 'x') - 6) < 0.001 && Math.abs(at(w, 'ball', 'pos', 'y') - -5) < 0.02, `ball at ${at(w, 'ball', 'pos', 'x')}, ${at(w, 'ball', 'pos', 'y')}`);
  step(w);
  // One tick of floor friction (0.5 x gravity 30 / 60) is already off it.
  assert.ok(Math.abs(at(w, 'crate', 'vel', 'z') - 2.75) < 0.01, `crate speed ${at(w, 'crate', 'vel', 'z')}`);
  const z1 = at(w, 'crate', 'pos', 'z');
  step(w);
  assert.ok(at(w, 'crate', 'pos', 'z') > z1 + 0.03, 'the crate should be sliding');
  // Floor friction takes about 60 degrees/second off a flat 1x1 box each tick.
  assert.ok(at(w, 'crate', 'quat', 'sy') > 600 && at(w, 'crate', 'quat', 'sy') < 720, `crate spin ${at(w, 'crate', 'quat', 'sy')}`);
  for (let t = 33; t < 120; t++) step(w);
  // The ball came down where it was put, and the crate turned.
  assert.ok(Math.abs(at(w, 'ball', 'pos', 'x') - 6) < 0.05 && Math.abs(at(w, 'ball', 'pos', 'y') - -1) < 0.02, `ball ended at ${at(w, 'ball', 'pos', 'x')}, ${at(w, 'ball', 'pos', 'y')}`);
  assert.ok(Math.abs(at(w, 'crate', 'quat', 'w')) < 0.999, 'the crate should have turned');

  // A turn given as a quaternion of any length is taken as its direction.
  const turned = run(scene, { ticks: 5, mods: { pre: [(x) => { if (x.tick === 3) set(x, 'crate', 'quat', { y: 2 * ONE, w: 2 * ONE }); }], post: [] } }).world;
  assert.ok(Math.abs(at(turned, 'crate', 'quat', 'y') - Math.SQRT1_2) < 0.01 && Math.abs(at(turned, 'crate', 'quat', 'w') - Math.SQRT1_2) < 0.01, `quat ${at(turned, 'crate', 'quat', 'y')}, ${at(turned, 'crate', 'quat', 'w')}`);

  // A script that only reads, or writes back what is there, changes nothing: the mirror is rounded, the body is not.
  const plain = run(scene, { ticks: 120 }).world;
  const echo = run(scene, { ticks: 120, mods: { pre: [(x) => { for (const id of x.query('rigid')) for (const c of ['pos', 'vel', 'quat']) if (x.has(id, c)) Object.assign(x.get(id, c)!, { ...x.get(id, c)! }); }], post: [] } }).world;
  assert.equal(hash(echo), hash(plain));
  assert.notEqual(hash(w), hash(plain));
  for (const x of [w, turned, plain, echo]) freeLink(x);
});

test('physics: a body put in the character\'s way stops it on that very tick, and a saved state continues through it', { skip }, () => {
  const scene = `${WALK}entity crate\n  pos 6 -1 -3\n  box 1 1 1\n  rigid density=256\n`;
  // On tick 30 the heavy crate appears 0.03 in front of the walker, who covers 0.067 a tick.
  const drop = (x: World): void => {
    if (x.tick !== 30) return;
    const p = x.get(x.ids.get('walker')!, 'pos')!;
    Object.assign(x.get(x.ids.get('crate')!, 'pos')!, { x: (p.x as number) + Math.round(0.83 * ONE), z: (p.z as number) - Math.round(0.1 * ONE) });
  };
  const gap = (x: World): number => at(x, 'crate', 'pos', 'x') - (at(x, 'walker', 'pos', 'x') + 0.8);
  const w = parseScene(scene).world;
  w.pre.push(drop);
  for (let t = 0; t < 30; t++) step(w, HOLD_RIGHT);
  const copy = cloneWorld(w), saved = saveLink(w);
  copy.pre.push(drop);
  const before = at(w, 'walker', 'pos', 'x');
  step(w, HOLD_RIGHT);
  assert.ok(gap(w) >= 0 && gap(w) < 0.04, `gap right after the crate appeared: ${gap(w)}`);
  assert.ok(at(w, 'walker', 'pos', 'x') - before < 0.03, 'the walker should have been stopped short');
  for (let t = 31; t < 90; t++) { step(w, HOLD_RIGHT); assert.ok(gap(w) >= 0, `tick ${t}: the walker is ${-gap(w)} inside the crate`); }
  restoreLink(copy, saved);
  for (let t = 30; t < 90; t++) step(copy, HOLD_RIGHT);
  assert.equal(hash(copy), hash(w));
  for (const x of [w, copy]) freeLink(x);
});

test('physics: a saved state continues exactly while the character is pushing', { skip }, () => {
  const scene = `${WALK}entity crate\n  pos 1 -1 0\n  box 1 1 1\n  rigid\nentity ball\n  pos 3 -0.8 0.2\n  box 0.8 0.8 0.8\n  rigid ball bounce=0.4\n`;
  const w = parseScene(scene).world;
  for (let t = 0; t < 30; t++) step(w, HOLD_RIGHT);
  const copy = cloneWorld(w), saved = saveLink(w);
  for (let t = 30; t < 200; t++) step(w, HOLD_RIGHT);
  restoreLink(copy, saved);
  for (let t = 30; t < 200; t++) step(copy, HOLD_RIGHT);
  assert.equal(hash(copy), hash(w));
  assert.ok(at(w, 'crate', 'pos', 'x') > 3, 'nothing was pushed');
  for (const x of [w, copy]) freeLink(x);
});

test('physics: a body that runs into the character moves it, by their weights, and never through a wall', { skip }, () => {
  const HERO = 'entity hero\n  pos 0 -2 0\n  box 1 2 1\n  vel 0 0 0\n  body\n';
  const ball = (x: number, speed: number, density: number, more = ''): string => `entity ball\n  pos ${x} -1 0\n  box 1 1 1\n  vel ${speed} 0 0\n  rigid ball ${density}\n${more}`;
  const play = (ents: string, ticks = 240, each?: (w: World) => void): World => {
    const w = parseScene(`world gravity=0,30 physics=rapier\n${FLOOR}${ents}`).world;
    for (let t = 0; t < ticks; t++) { step(w); each?.(w); }
    return w;
  };
  // The hero weighs its box, 2. A ball of 2.6 moves it more than a ball of 0.1, and both come to rest.
  const heavy = play(HERO + ball(-4, 4, 5)), light = play(HERO + ball(-4, 4, 0.2));
  const far = at(heavy, 'hero', 'pos', 'x'), near = at(light, 'hero', 'pos', 'x');
  assert.ok(far > 0.03 && near > 0 && far > near * 5, `the hero went ${far} for the heavy ball, ${near} for the light one`);
  assert.equal(at(heavy, 'ball', 'vel', 'x'), 0);
  assert.equal(at(heavy, 'hero', 'pos', 'y'), -2);
  // The same bits on every OS: CI runs this on three.
  assert.equal(hash(heavy), 'ee3ca884');
  // From the other side, and with the ball made before the hero, it is the mirror image
  // (not to the last bit: the backend's floats round differently at -3.5 and at 4.5).
  const mirrored = play(ball(4, -4, 5) + HERO);
  assert.ok(Math.abs(at(mirrored, 'hero', 'pos', 'x') + far) < 0.001, `mirrored, the hero went ${at(mirrored, 'hero', 'pos', 'x')}, not ${-far}`);
  // With its back to a wall the hero cannot give way, and does not.
  const walled = play(`${HERO}entity wall\n  pos 1 -3 -2\n  box 1 3 4\n  solid\n${ball(-4, 4, 5)}`);
  assert.equal(at(walled, 'hero', 'pos', 'x'), 0);
  // A ball that something keeps pushing takes the hero along, up to the wall, and never ends up inside it.
  let gap = Infinity;
  const driven = play(`${HERO}entity wall\n  pos 4 -3 -2\n  box 1 3 4\n  solid\n${ball(-3, 0, 5, '  force 40 0 0\n')}`, 900, (w) => {
    gap = Math.min(gap, at(w, 'hero', 'pos', 'x') - (at(w, 'ball', 'pos', 'x') + 1));
  });
  assert.equal(at(driven, 'hero', 'pos', 'x'), 3);
  assert.ok(gap > -0.02, `the ball was ${-gap} inside the hero`);
  // What rests on the hero's head presses it down, but the floor is in the way.
  const loaded = play(`${HERO}entity crate\n  pos 0.1 -4 0.1\n  box 0.8 0.8 0.8\n  rigid box 2\n`);
  assert.equal(at(loaded, 'hero', 'pos', 'y'), -2);
  assert.ok(Math.abs(at(loaded, 'crate', 'pos', 'y') - -2.8) < 0.01, `the crate is at ${at(loaded, 'crate', 'pos', 'y')}`);
  // A state saved in the middle of being pushed continues exactly.
  const w = play(HERO + ball(-3, 0, 5, '  force 40 0 0\n'), 60);
  assert.ok(at(w, 'hero', 'pos', 'x') > 0, 'the hero was not being pushed yet');
  const copy = cloneWorld(w), saved = saveLink(w);
  for (let t = 0; t < 120; t++) step(w);
  restoreLink(copy, saved);
  for (let t = 0; t < 120; t++) step(copy);
  assert.equal(hash(copy), hash(w));
  for (const x of [heavy, light, mirrored, walled, driven, loaded, w, copy]) freeLink(x);
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
  for (const f of ['engine/src/physics.js', 'engine/src/rigid.js', 'engine/backends/rapier/index.js', 'engine/backends/rapier/node_modules/@dimforge/rapier3d-deterministic-compat/dist/rapier.mjs']) {
    assert.ok(written.includes(f), `${f} was not written`);
  }
  assert.match(readFileSync(join(out, 'index.html'), 'utf8'), /"@dimforge\/rapier3d-deterministic-compat": "\.\/engine\/backends\/rapier\/node_modules\//);
});


test('bodies a script writes to every tick still stop a mover, to the same bits', { skip }, () => {
  // Every body is "fresh" to the backend's casts on every tick here: the case in which a cast
  // leaves out the ones too far away to touch. The hash was taken before it left any out.
  let ents = 'entity guard\n  pos -8 -1 0\n  box 0.8 1 0.8\n  vel\n  body\n  pace x -8 7 3\n';
  for (let i = 0; i < 24; i++) ents += `entity r${i}\n  pos ${-4 + (i % 6) * 1.5} -1.5 ${-3 + Math.floor(i / 6) * 1.5}\n  box 0.8 0.8 0.8\n  rigid ${i % 3 ? 'box' : 'ball'}\n`;
  const w = parseScene(`world gravity=0,30 physics=rapier\n${FLOOR}${ents}`).world;
  let least = Infinity;
  for (let t = 0; t < 180; t++) {
    for (const id of w.query('rigid', 'pos')) (w.get(id, 'pos')!.x as number) += 1;
    step(w);
    // The guard walks into r12 and r13 on its row; it may shove them but never be inside one.
    for (const name of ['r12', 'r13']) {
      const gap = Math.max(Math.abs(at(w, name, 'pos', 'x') - at(w, 'guard', 'pos', 'x')) - 0.8, Math.abs(at(w, name, 'pos', 'z') - at(w, 'guard', 'pos', 'z')) - 0.8);
      least = Math.min(least, gap);
    }
  }
  assert.ok(least > -0.02, `the guard got ${-least} into a body`);
  assert.ok(at(w, 'r12', 'pos', 'x') > -3.9, 'the guard never shoved the first body in its way');
  assert.equal(hash(w), '2b87d1e3');
  freeLink(w);
});

test('physics: the other shapes come to rest at their own size, and block a mover', { skip }, () => {
  const body = (name: string, x: number, shape: string): string => `entity ${name}\n  pos ${x} -2 0\n  box 1 2 1\n  rigid ${shape}\n`;
  const w = parseScene(`world gravity=0,30 physics=rapier\n${FLOOR}${body('cap', -3, 'capsule')}${body('can', 0, 'cylinder')}${body('cone', 3, 'cone')}entity guy\n  pos -8 -1 0\n  box 0.8 1 0.8\n  vel\n  body\n  pace x -8 9 3\n`).world;
  for (let t = 0; t < 30; t++) step(w);
  // Each stands on its end, its feet where the floor is.
  for (const name of ['cap', 'can', 'cone']) assert.ok(Math.abs(at(w, name, 'pos', 'y') + 2) < 0.1, `${name} rests at ${at(w, name, 'pos', 'y')}`);
  for (let t = 0; t < 120; t++) step(w);
  assert.ok(at(w, 'cap', 'pos', 'x') > -2.9, 'the mover never reached the capsule');
  freeLink(w);
});

// Pinned like the scene above: the same joints give the same bits on every OS.
const JOINED = '1c32a37b';
const arm = (name: string, x: number, joint: string): string => `entity ${name}\n  pos ${x - 0.5} -0.5 -0.5\n  box 1 1 1\n  rigid\n  joint ${joint}\n`;

test('physics: joints hold, swing, slide and drive as written, and the same everywhere', { skip }, () => {
  const w = parseScene(`world gravity=0,30 physics=rapier
${arm('door', 2, 'hinge world -2 0 0 axis=z max=45 min=-5')}${arm('wheel', 12, 'hinge world -2 0 0 axis=y motor=90 power=1000')}${arm('lift', 20, 'slider world axis=x motor=2 power=1000 min=-3 max=3')}${arm('hung', 30, 'rope world 0 -2 0 length=4')}${arm('sprung', 40, 'spring world 0 -2 0 stiff=100 damp=10')}${arm('post', 50, 'fixed world')}${arm('beam', 51.5, 'fixed post')}`).world;
  for (let t = 0; t < 120; t++) step(w);
  const centre = (n: string): number[] => ['x', 'y', 'z'].map((f) => at(w, n, 'pos', f) + 0.5);
  const near = (n: string, want: number[]): void => centre(n).forEach((v, i) => assert.ok(Math.abs(v - want[i]) < 0.2, `${n} is at ${centre(n)}, wanted ${want}`));
  // The door falls from level to its stop at 45 degrees, 2 units from the pivot.
  near('door', [1.414, 1.414, 0]);
  // 90 degrees/second for two seconds: half way round the pivot at x=10, on the far side.
  near('wheel', [8, 0, 0]);
  near('lift', [23, 0, 0]);
  near('hung', [30, 2, 0]);
  near('sprung', [40, 0.3, 0]);
  near('post', [50, 0, 0]);
  near('beam', [51.5, 0, 0]);
  assert.equal(hash(w), JOINED);
  // Motors and limits can be changed while running; dropping the joint lets go.
  w.get(w.ids.get('lift')!, 'joint')!.motor = -2 * ONE;
  w.drop(w.ids.get('post')!, 'joint');
  w.despawn(w.ids.get('beam')!);
  for (let t = 0; t < 60; t++) step(w);
  near('lift', [21, 0, 0]);
  assert.ok(centre('post')[1] > 5, 'the post did not fall');
  freeLink(w);
});

test('physics: a saved state with joints continues exactly, and the other end can go', { skip }, () => {
  const w = parseScene(`world gravity=0,30 physics=rapier\n${arm('a', 2, 'ball world -2 0 0')}${arm('b', 4, 'ball a -1 0 0')}`).world;
  for (let t = 0; t < 40; t++) step(w);
  const copy = cloneWorld(w);
  restoreLink(copy, saveLink(w));
  for (let t = 0; t < 60; t++) { step(w); step(copy); }
  assert.equal(hash(copy), hash(w));
  w.despawn(w.ids.get('a')!);
  const y = at(w, 'b', 'pos', 'y');
  for (let t = 0; t < 60; t++) step(w);
  assert.ok(at(w, 'b', 'pos', 'y') > y + 3, 'b did not fall');
  for (const x of [w, copy]) freeLink(x);
});

test('physics: mistakes in joints are errors or warnings', { skip }, async () => {
  const one = 'world physics=rapier\nentity a\n  pos 0 0\n  box 1 1\n  rigid\n';
  assert.deepEqual(codes(() => parseScene(`${one}  joint weld world\n`)), ['K104']);
  assert.deepEqual(codes(() => parseScene(`${one}  joint hinge world axis=w\n`)), ['K104']);
  const lint = (await command('check', { scene: `${one}  joint rope b\nentity c\n  pos 3 0\n  box 1 1\n  rigid\n  joint rope d\nentity d\n  pos 5 0\n` })).text;
  assert.match(lint, /^W K311 scene joint on 'a' refers to 'b'/m);
  assert.match(lint, /^W K322 scene joint on 'c' ties it to 'd', which has no body/m);
});
