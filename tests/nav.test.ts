// Navigation: movers find their way around solids, the same way everywhere.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { build } from '../src/build.ts';
import { command } from '../src/commands.ts';
import { ONE } from '../src/fx.ts';
import { firstStep } from '../src/nav.ts';
import { KilnFail, parseScene, serialize } from '../src/scene.ts';
import { hash, step } from '../src/sim.ts';
import type { World } from '../src/world.ts';

const at = (w: World, name: string, f: string): number => (w.get(w.ids.get(name)!, 'pos')![f] as number) / ONE;
const steps = (w: World, n: number): void => { for (let t = 0; t < n; t++) step(w); };
const mover = (name: string, x: number, y: number, nav: string): string => `entity ${name}\n  pos ${x} ${y}\n  box 0.8 0.8\n  vel\n  nav ${nav}\n`;
const goal = (x: number, y: number): string => `entity goal\n  pos ${x} ${y}\n  box 0.8 0.8\n`;
// A wall with its only gap at the bottom.
const MAZE = 'entity walls\n  pos 0 0\n  tiles\n    ##########\n    #...#....#\n    #...#....#\n    #...#....#\n    #........#\n    ##########\n';

test('nav: the first step goes around, takes no corner, and gets as close as it can', () => {
  const wall = new Set(['1,0', '1,1']);
  const open = (u: number, v: number): boolean => Math.abs(u) < 6 && Math.abs(v) < 6 && !wall.has(`${u},${v}`);
  assert.deepEqual(firstStep(open, [0, 0], [3, 0]), [0, -1]);
  assert.equal(firstStep(open, [0, 0], [0, 0]), null);
  assert.deepEqual(firstStep(open, [0, 0], [9, 9]), [0, 1]);
});

test('nav: a mover walks round the wall to its target, says so once, and never enters a wall', () => {
  const w = parseScene(`${MAZE}${mover('wolf', 1.1, 1.1, 'goal 4 event=bitten')}${goal(7.1, 1.1)}`).world;
  let lowest = 0, events = 0;
  for (let t = 0; t < 400; t++) {
    step(w);
    events += w.events.filter((e) => e.name === 'bitten' && e.tick === w.tick - 1).length;
    lowest = Math.max(lowest, at(w, 'wolf', 'y'));
    const x = at(w, 'wolf', 'x'), y = at(w, 'wolf', 'y');
    assert.ok(!(x + 0.8 > 4 && x < 5 && y < 4), `in the wall at ${x},${y}`);
  }
  assert.ok(lowest > 3.9, `went down only to ${lowest}`);
  assert.ok(Math.abs(at(w, 'wolf', 'x') - 7.1) < 0.01 && Math.abs(at(w, 'wolf', 'y') - 1.1) < 0.01, `ended at ${at(w, 'wolf', 'x')},${at(w, 'wolf', 'y')}`);
  assert.equal(events, 1);
});

// Pinned: CI runs this on three operating systems.
const PINNED = '96ba5cad';
const scene = `world seed=3\n${MAZE}${mover('wolf', 1.1, 1.1, '#prey 3 reach=1')}${mover('cub', 2.1, 3.1, 'wolf 2')}entity goal\n  pos 7.1 1.1\n  box 0.8 0.8\n  tag prey\n  vel\n  pace y 1.1 3.9 1\n`;

test('nav: same scene, same walk; a saved state goes on the same way', () => {
  const w = parseScene(scene).world;
  steps(w, 90);
  const copy = parseScene(serialize(w)).world;
  copy.tick = w.tick;
  steps(w, 200);
  steps(copy, 200);
  assert.equal(hash(copy), hash(w));
  assert.equal(hash(w), PINNED);
});

test('nav: with no way through it goes as close as it can; a door that goes opens the way', () => {
  const shut = parseScene(`entity door\n  pos 4 4\n  box 1 1\n  solid\n${MAZE}${mover('wolf', 1.1, 1.1, 'goal 4')}${goal(7.1, 1.1)}`).world;
  steps(shut, 300);
  assert.ok(at(shut, 'wolf', 'x') < 3.2 && at(shut, 'wolf', 'x') > 2.8, `waits at ${at(shut, 'wolf', 'x')}`);
  shut.despawn(shut.ids.get('door')!);
  steps(shut, 300);
  assert.ok(Math.abs(at(shut, 'wolf', 'x') - 7.1) < 0.01, `ended at ${at(shut, 'wolf', 'x')}`);
});

test('nav: on a 3D floor, around a block', () => {
  const w = parseScene(`entity block\n  pos 3 0 -2\n  box 1 1 5\n  solid\nentity a\n  pos 0.1 0 0.1\n  box 0.8 1 0.8\n  vel\n  nav goal 4 plane=xz\nentity goal\n  pos 6.1 0 0.1\n  box 0.8 1 0.8\n`).world;
  steps(w, 400);
  assert.ok(Math.abs(at(w, 'a', 'x') - 6.1) < 0.01 && Math.abs(at(w, 'a', 'z') - 0.1) < 0.01);
});

test('nav: mistakes are errors or warnings, and only games that use it carry it', async () => {
  assert.throws(() => parseScene('entity a\n  pos 0 0\n  box 1 1\n  vel\n  nav b 1 plane=yz\n'), KilnFail);
  const lint = (await command('check', { scene: 'world gravity=0,20\nentity a\n  pos 0 0\n  box 1 1\n  vel\n  body\n  nav hero 2\n' })).text;
  assert.match(lint, /^W K311 scene nav on 'a' walks to 'hero'/m);
  assert.match(lint, /^W K323 /m);
  const dir = mkdtempSync(join(tmpdir(), 'kiln-nav-'));
  const game = (text: string): { parts: string[]; written: string[] } => {
    writeFileSync(join(dir, 'game.kiln'), text);
    return build(join(dir, 'game.kiln'), mkdtempSync(join(tmpdir(), 'kiln-nav-out-')));
  };
  const withNav = game(scene);
  assert.ok(withNav.parts.includes('nav') && withNav.written.includes('engine/src/nav.js'));
  const without = game(goal(1, 1));
  assert.ok(!without.parts.includes('nav') && !without.written.includes('engine/src/nav.js'));
});
