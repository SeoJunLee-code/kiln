// Is Rapier's deterministic build usable as Kiln's rigid-body backend?
// Kiln needs three things from it:
//   1. the same inputs give the same state on every OS (checked against EXPECTED, in CI on three OSes)
//   2. a state can be saved and restored exactly (what `solve` does at every search node)
//   3. saving and restoring is cheap enough to do thousands of times
//   node rapier.ts           check against EXPECTED
//   node rapier.ts --write   record this machine's result as EXPECTED
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import RAPIER from '@dimforge/rapier3d-deterministic-compat';

await RAPIER.init();
const HERE = dirname(fileURLToPath(import.meta.url));
const BODIES = 300, TICKS = 600, HALF = 300;

function fnv(bytes: Uint8Array, h = 0x811c9dc5): number {
  for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
const hex = (h: number): string => h.toString(16).padStart(8, '0');

// A pile: boxes and balls dropped onto a floor with walls, each with a spin.
function build(): InstanceType<typeof RAPIER.World> {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.createCollider(RAPIER.ColliderDesc.cuboid(20, 0.5, 20).setTranslation(0, -0.5, 0));
  for (const [x, z, hx, hz] of [[-6, 0, 0.5, 6], [6, 0, 0.5, 6], [0, -6, 6, 0.5], [0, 6, 6, 0.5]]) {
    world.createCollider(RAPIER.ColliderDesc.cuboid(hx, 4, hz).setTranslation(x, 4, z));
  }
  let seed = 12345;
  const next = (): number => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let i = 0; i < BODIES; i++) {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(next() * 8 - 4, 2 + i * 0.35, next() * 8 - 4)
      .setAngvel({ x: next() * 6 - 3, y: next() * 6 - 3, z: next() * 6 - 3 }));
    const shape = i % 3 === 0 ? RAPIER.ColliderDesc.ball(0.3 + next() * 0.2)
      : RAPIER.ColliderDesc.cuboid(0.2 + next() * 0.3, 0.2 + next() * 0.3, 0.2 + next() * 0.3);
    world.createCollider(shape.setRestitution(0.2).setFriction(0.6), body);
  }
  return world;
}

// Position, rotation and velocity of every body, as the 32-bit values the engine holds.
function stateHash(world: InstanceType<typeof RAPIER.World>): number {
  const values: number[] = [];
  world.forEachRigidBody((body) => {
    const p = body.translation(), r = body.rotation(), v = body.linvel(), w = body.angvel();
    values.push(p.x, p.y, p.z, r.x, r.y, r.z, r.w, v.x, v.y, v.z, w.x, w.y, w.z);
  });
  return fnv(new Uint8Array(new Float32Array(values).buffer));
}

function run(world: InstanceType<typeof RAPIER.World>, ticks: number): void {
  for (let t = 0; t < ticks; t++) world.step();
}

// 1. Two fresh worlds, same steps.
const a = build();
const start = performance.now();
run(a, HALF);
const midHash = stateHash(a);
const saveStart = performance.now();
const saved = a.takeSnapshot();
const saveMs = performance.now() - saveStart;
const savedHash = fnv(saved);
run(a, TICKS - HALF);
const stepMs = (performance.now() - start - saveMs) / TICKS;
const endHash = stateHash(a);

const b = build();
run(b, TICKS);
const repeatHash = stateHash(b);

// 2. Restore the middle state and finish from there.
const loadStart = performance.now();
const c = RAPIER.World.restoreSnapshot(saved);
const loadMs = performance.now() - loadStart;
const restoredMid = stateHash(c);
run(c, TICKS - HALF);
const restoredEnd = stateHash(c);

// 3. The cost of the save/restore pair, as solve would pay it per node.
const rounds = 200;
const pairStart = performance.now();
for (let i = 0; i < rounds; i++) RAPIER.World.restoreSnapshot(a.takeSnapshot()).free();
const pairMs = (performance.now() - pairStart) / rounds;

const result = `bodies=${BODIES} ticks=${TICKS} mid=${hex(midHash)} end=${hex(endHash)} snapshot=${hex(savedHash)}`;
const checks: [string, boolean][] = [
  ['same steps twice give the same state', repeatHash === endHash],
  ['restored state equals the saved one', restoredMid === midHash],
  ['restored world finishes in the same state', restoredEnd === endHash],
];
const file = join(HERE, 'EXPECTED');
if (process.argv.includes('--write')) writeFileSync(file, result + '\n');
const expected = existsSync(file) ? readFileSync(file, 'utf8').trim() : undefined;
checks.push([`matches EXPECTED`, expected === result]);

console.log(result);
console.log(`platform=${process.platform} arch=${process.arch} node=${process.version}`);
console.log(`step=${stepMs.toFixed(3)}ms snapshot=${saved.length}B save=${saveMs.toFixed(2)}ms load=${loadMs.toFixed(2)}ms save+load=${pairMs.toFixed(2)}ms`);
let failed = 0;
for (const [name, ok] of checks) { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); if (!ok) failed++; }
if (expected !== undefined && expected !== result) console.log(`expected: ${expected}`);
process.exit(failed ? 1 : 0);
