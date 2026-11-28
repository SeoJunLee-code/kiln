// Rules written as scene lines: a timer, a tally that says when it is spent, `when`, and
// putting things back as the scene began. None of it needs a script, so check and solve read it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { command } from '../src/commands.ts';
import { run } from '../src/run.ts';
import { parseScene, serialize } from '../src/scene.ts';
import { hash, step } from '../src/sim.ts';
import { cloneWorld } from '../src/solve.ts';

const GAME = `world hz=60 gravity=0,20
entity floor
  pos 0 5
  box 4 1
  solid
entity hero
  pos 1 4
  vel
  box 1 1
  body
  ctrl 3
entity coin
  pos 3 4
  box 1 1
  trigger hero coin despawn-self
entity pit
  pos -20 9
  box 60 1
  trigger hero fell
entity lives
  tally fell 3 -1 then=dead
entity score
  tally coin
entity again
  when fell reset:all
`;
const n = (w: ReturnType<typeof run>['world'], name: string, comp: string, field: string): number | string => w.get(w.ids.get(name)!, comp)![field];
const names = (r: ReturnType<typeof run>): string[] => r.world.events.map((e) => `${e.tick} ${e.name}`);

test('rules: a fall costs a life and puts the scene back; the third fall says dead', () => {
  const r = run(GAME, { input: '0 right down\n', ticks: 300 });
  // Walks right over the coin and off the floor, three times over.
  assert.deepEqual(names(r), ['21 coin', '97 fell', '118 coin', '194 fell', '215 coin', '291 fell', '291 dead']);
  assert.equal(n(r.world, 'lives', 'tally', 'n'), 0);
  // The score went back with everything else; lives did not, because it counts the fall.
  const mid = run(GAME, { input: '0 right down\n', ticks: 100 });
  assert.equal(n(mid.world, 'score', 'tally', 'n'), 0);
  assert.equal(n(mid.world, 'lives', 'tally', 'n'), 2);
  assert.ok(mid.world.ids.has('coin'), 'the coin that was collected is back');
  assert.equal(n(mid.world, 'hero', 'pos', 'y') as number > 0, true);
});

test('rules: reset:NAME puts back only what it names', () => {
  const r = run(GAME.replace('reset:all', 'reset:hero'), { input: '0 right down\n', ticks: 100 });
  assert.equal(n(r.world, 'score', 'tally', 'n'), 1);
  assert.ok(!r.world.ids.has('coin'));
  assert.equal(n(r.world, 'lives', 'tally', 'n'), 2);
});

test('rules: a timer emits once, or again and again with loop, and acts', () => {
  const once = run('entity clock\n  timer 0.5 ring emit:rang\n', { ticks: 100 });
  assert.deepEqual(names(once), ['30 ring', '30 rang']);
  assert.equal(n(once.world, 'clock', 'timer', 'left'), 0);
  const loop = run('entity clock\n  timer 0.5 ring loop=1\n', { ticks: 100 });
  assert.deepEqual(names(loop), ['30 ring', '60 ring', '90 ring']);
  const held = run('entity clock\n  timer 0.5 ring on=0\n', { ticks: 100 });
  assert.deepEqual(names(held), []);
});

test('rules: rules answer each other within the tick, and a circle is cut off', () => {
  const chain = run('entity t\n  timer 0.1 a\nentity r1\n  when a emit:b\nentity r2\n  when b emit:c\nentity count\n  tally c\n', { ticks: 10 });
  assert.deepEqual(names(chain), ['6 a', '6 b', '6 c']);
  assert.equal(n(chain.world, 'count', 'tally', 'n'), 1);
  const circle = run('entity t\n  timer 0.1 a\nentity r1\n  when a emit:b\nentity r2\n  when b emit:a\n', { ticks: 10 });
  assert.ok(circle.world.events.length < 40, `${circle.world.events.length} events from a rule that answers itself`);
});

test('rules: the state round-trips through text and through a copy, mid-run', () => {
  const { world } = parseScene(GAME);
  const script = new Map([[0, [['right', true] as [string, boolean]]]]);
  for (let i = 0; i < 50; i++) step(world, script);
  const text = serialize(world);
  assert.match(text, /^state .*origin=/m, 'the scene as it began travels with the saved state');
  const again = parseScene(text).world, copy = cloneWorld(world);
  for (const w of [world, again, copy]) for (let i = 0; i < 100; i++) step(w, script);
  assert.equal(hash(again), hash(world));
  assert.equal(hash(copy), hash(world));
  assert.equal(world.get(world.ids.get('lives')!, 'tally')!.n, 2);
  // A scene with no reset keeps no origin, so its text and hash are what they always were.
  const plain = parseScene(GAME.replace('  when fell reset:all\n', '')).world;
  for (let i = 0; i < 5; i++) step(plain);
  assert.doesNotMatch(serialize(plain), /origin=/);
});

test('rules: check reads them: unknown actions, names that match nothing, events nobody emits', async () => {
  const check = async (text: string): Promise<string> => (await command('check', { scene: text })).text;
  assert.match(await check('entity a\n  when x explode\n'), /^E K104 scene:2 unknown when action 'explode'/m);
  assert.match(await check('entity a\n  timer 3 x reset:nobody\n'), /^W K311 scene timer on 'a' refers to 'nobody'/m);
  assert.match(await check('entity a\n  when felll reset:all\nentity t\n  timer 1 fell\n'), /^W K335 scene when on 'a' waits for event 'felll', which nothing in the scene emits, so it never acts \(hint: did you mean 'fell'\?\)$/m);
  assert.match(await check('entity a\n  tally x 3 0 then=y\n'), /^W K336 /m);
  assert.doesNotMatch(await check(GAME + 'expect event dead by 400\n'), /^[WE] /m);
});

test('rules: enter is an input action, and a button can be pressed with it', () => {
  const r = run('entity start\n  pin center\n  box 4 1\n  label Start\n  button go key=enter\n', { input: '3 enter down\n4 enter up\n', ticks: 10 });
  assert.deepEqual(names(r), ['4 go']);
});

test('rules: solve finds its way through a scene whose rules are lines', async () => {
  const solved = await command('solve', { scene: GAME + 'expect event coin by 200\nexpect count fell == 0 at 200\n' });
  assert.match(solved.text, /^ok solved /m);
});

test('rules: the guide example of the topic runs as written', async () => {
  const topic = (await command('guide', { topic: 'rules' })).text;
  const lines = topic.split('\n').filter((l) => /^(entity|  \S)/.test(l)).map((l) => l.replace(/\s{2,}\S.*$/, (m) => (/^\s+(pos|box|trigger|tally|keep|timer|when)\b/.test(l) ? '' : m)));
  const scene = 'entity ball\n  pos 0 0 0\n  vel\n  box 1 1 1\n' + lines.join('\n') + '\n';
  const r = await command('check', { scene });
  assert.equal(r.code, 0, r.text);
  assert.doesNotMatch(r.text, /^E /m);
});
