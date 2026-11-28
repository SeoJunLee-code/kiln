// A walking body with `step` goes up ledges no higher than that, on fixed-point sweeps only.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { run } from '../src/run.ts';
import { parseScene, serialize } from '../src/scene.ts';
import { fmtFx } from '../src/fx.ts';

const STAIRS = (step: string, extra = ''): string => `world hz=60 gravity=0,30
entity hero
  pos 0 9
  box 0.8 1
  vel
  body${step}
  ctrl 4 0
entity floor
  pos 0 10
  box 20 1
  solid
entity s1
  pos 3 9.5
  box 1 0.5
  solid
entity s2
  pos 4 9
  box 1 1
  solid
entity s3
  pos 5 8.5
  box 5 1.5
  solid
entity wall
  pos 8 7.4
  box 1 1.1
  solid
${extra}`;
const at = (text: string, ticks: number, input = '0 right down\n'): { x: number; y: number; z: number; ride: string } => {
  const w = run(text, { input, ticks }).world, id = w.ids.get('hero')!;
  const p = w.get(id, 'pos')!;
  return { x: Number(fmtFx(p.x as number)), y: Number(fmtFx(p.y as number)), z: Number(fmtFx(p.z as number)), ride: w.get(id, 'body')!.ride as string };
};

test('step: a body walks up stairs no higher than its step, and stops at what is higher', () => {
  const end = at(STAIRS(' step=0.5'), 240);
  // Three steps of 0.5 up, then a wall of 1.1 that it stands against.
  assert.deepEqual([end.x, end.y, end.ride], [7.2, 7.5, 's3']);
  const mid = at(STAIRS(' step=0.5'), 60);
  assert.deepEqual([mid.y, mid.ride], [8, 's2']);
});

test('step: without it, or with one too small, the first stair is a wall', () => {
  for (const step of ['', ' step=0.4']) {
    const end = at(STAIRS(step), 240);
    assert.deepEqual([end.x, end.y, end.ride], [2.2, 9, 'floor']);
  }
});

test('step: a ceiling over the stair leaves no room to go up', () => {
  const end = at(STAIRS(' step=0.5', 'entity lid\n  pos 2 8.1\n  box 3 0.5\n  solid\n'), 240);
  assert.deepEqual([end.x, end.y], [2.2, 9]);
});

test('step: only from the ground: a body in the air does not climb what it flies into', () => {
  // Dropped beside the stair while moving right: it meets the side of s1 in the air and slides down it.
  const text = STAIRS(' step=0.5').replace('pos 0 9\n', 'pos 2.15 8.7\n');
  const soon = at(text, 4);
  assert.equal(soon.x, 2.2);
  assert.ok(soon.y > 8.7 && soon.y < 9, `y=${soon.y}`);
  // Once it has landed it does go up.
  assert.equal(at(text, 60).ride, 's3');
});

test('step: solid tiles are stairs too, and in 3D the floor axes are x and z', () => {
  const tiles = `world hz=60 gravity=0,30
entity hero
  pos 0.1 2
  box 0.8 1
  vel
  body step=1
  ctrl 4 0
entity map
  pos 0 0
  tiles 1 #
    ......
    ....##
    ...###
    ######
`;
  const up = at(tiles, 75);
  assert.deepEqual([up.y, up.x > 4.9], [0, true]);

  const room = `world hz=60 gravity=0,30
entity hero
  pos 0 -1 0
  box 0.8 1 0.8
  vel
  body step=0.5
  ctrl 4 0 xz
entity floor
  pos -5 0 -5
  box 10 1 10
  solid
entity stair
  pos -5 -0.5 -3
  box 10 0.5 1
  solid
entity block
  pos 2 -0.5 -5
  box 1 0.5 10
  solid
`;
  const north = at(room, 36, '0 up down\n');
  assert.deepEqual([north.y, north.ride, north.z < -2], [-1.5, 'stair', true]);
  const east = at(room, 36, '0 right down\n');
  assert.deepEqual([east.y, east.ride], [-1.5, 'block']);
});

test('step: it is a field with a default: scenes that do not use it read and save as before', () => {
  const plain = parseScene('entity a\n  pos 0 0\n  vel\n  body\n').world;
  assert.doesNotMatch(serialize(plain), /step/);
  const set = parseScene('entity a\n  pos 0 0\n  vel\n  body step=0.25\n').world;
  assert.match(serialize(set), /body .*step=0\.25|body 0 "" 0\.25|body.*0\.25/);
  assert.equal(serialize(parseScene(serialize(set)).world), serialize(set));
});
