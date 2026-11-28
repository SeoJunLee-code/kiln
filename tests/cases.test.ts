// What the first agent run could not do headless (proof/lite/RUN.md): see a scene end when a
// trigger loads another, play a game through its scenes, and check one scene for several
// things without copying it. The agent made three copies of its levels and read ticks by hand.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { command } from '../src/commands.ts';
import { run } from '../src/run.ts';

const fix = (p: string): string => fileURLToPath(new URL(`./fixtures/${p}`, import.meta.url));

// hero walks right into `door`, which loads next.kiln at tick 16; `far` lies beyond it.
const scene = (expects: string, heroParts = '  vel 4 0\n', walls = ''): string => `world hz=60 gravity=0,0
${walls}entity hero
  pos 0 0
${heroParts}  box 1 1
entity door
  pos 2 0
  box 1 1
  trigger hero out load:next.kiln
entity far
  pos 5 0
  box 1 1
  trigger hero far
${expects}
`;

test('a scene ends at the tick a trigger loads another one', () => {
  const r = run(scene('expect event out by 300'), { ticks: 300 });
  assert.equal(r.load, 'next.kiln');
  assert.equal(r.world.tick, 16);
  // What lies beyond the door never happens: the old run walked on and emitted `far`.
  assert.deepEqual(r.world.events.map((e) => e.name), ['out', 'load']);
});

test('the last line of test and run names the scene that was loaded', async () => {
  for (const cmd of ['test', 'run']) {
    const r = await command(cmd, { scene: scene('expect event out by 300') });
    assert.match(r.text, /^ok tick=16 hash=[0-9a-f]{8}.* load=next\.kiln\n$/m, r.text);
  }
  const none = await command('test', { scene: scene('expect count out == 0 at 10') });
  assert.doesNotMatch(none.text, /load=/);
});

test('an event count asked for after the scene ended is final; a field has no value', async () => {
  const r = await command('test', { scene: scene('expect count out == 1 at 300\nexpect count far == 0 at 300\nexpect count out == 0 at 300\nexpect at 300 hero.pos.x > 0\nexpect event far by 300') });
  assert.equal(r.code, 1, r.text);
  assert.match(r.text, /^pass scene:\d+ count out == 1 at 300 -- actual 1, scene ended at tick 16 \(load next\.kiln\)$/m);
  assert.match(r.text, /^pass scene:\d+ count far == 0 at 300 -- actual 0, scene ended/m);
  assert.match(r.text, /^FAIL scene:\d+ count out == 0 at 300 -- actual 1, scene ended/m);
  assert.match(r.text, /^FAIL scene:\d+ at 300 hero\.pos\.x > 0 -- scene ended at tick 16 \(load next\.kiln\), before tick 300$/m);
  assert.match(r.text, /^FAIL scene:\d+ event far by 300 -- .*scene ended at tick 16 \(load next\.kiln\)$/m);
  assert.match(r.text, /passed=2 failed=3/);
});

test('expect lines in an input replace the scene\'s, and are reported by the input\'s lines', async () => {
  const text = scene('expect event far by 300', '  vel\n  ctrl 4\n');
  const input = '0 right down\n# stop short of the door\n10 right up\nexpect count out == 0 at 60\n  expect at 60 hero.pos.x < 2\n';
  const r = await command('test', { scene: text, input });
  assert.equal(r.code, 0, r.text);
  assert.match(r.text, /^pass input:4 count out == 0 at 60 -- actual 0$/m);
  assert.match(r.text, /^pass input:5 at 60 hero\.pos\.x < 2 -- actual 0\.6/m);
  assert.doesNotMatch(r.text, /event far/);
  // An input without expect lines leaves the scene's in charge.
  const plain = await command('test', { scene: text, input: '0 right down\n' });
  assert.match(plain.text, /^FAIL scene:\d+ event far by 300/m);
  // A mistake in one is reported against the input.
  const bad = await command('test', { scene: text, input: '0 right down\nexpect reach hero nobody by 10\n' });
  assert.equal(bad.code, 2);
  assert.match(bad.text, /^E K110 input:2 'nobody' matches no entity/m);
});

test('test DIR runs each NAME.CASE.input as one more check of NAME.kiln', async () => {
  const r = await command('test', { file: fix('chain') });
  assert.equal(r.code, 0, r.text);
  assert.match(r.text, /^room\.kiln ok tick=32 .* passed=2 failed=0 load=end\.kiln$/m);
  assert.match(r.text, /^room\.trap\.input ok tick=32 .* passed=2 failed=0 load=room\.kiln$/m);
  assert.match(r.text, /^ok scenes=2 cases=1 passed=3 failed=0\n$/m);
  // check has nothing to say about inputs.
  assert.match((await command('check', { file: fix('chain') })).text, /^ok scenes=2 passed=2 failed=0 edition=lite\n$/m);
});

test('--follow plays on into the scene that was loaded, with that scene\'s input', async () => {
  const r = await command('test', { file: fix('chain/room.kiln'), inputFile: fix('chain/room.input'), follow: true });
  assert.equal(r.code, 0, r.text);
  assert.match(r.text, /^scene room\.kiln tick=32 hash=[0-9a-f]{8} passed=2 load=end\.kiln$/m);
  assert.match(r.text, /^ok tick=1 hash=[0-9a-f]{8} passed=1 failed=0 path=room\.kiln>end\.kiln\n$/m);
  assert.doesNotMatch(r.text, /^pass /m);
  // Without it the run stops where the scene does.
  const one = await command('test', { file: fix('chain/room.kiln'), inputFile: fix('chain/room.input') });
  assert.match(one.text, /load=end\.kiln\n$/);
  assert.doesNotMatch(one.text, /path=/);
});

test('--follow stops at a scene that fails, and says which', async () => {
  // Walking left with the scene's own expects: caught, so `event exit` fails and nothing is followed.
  const r = await command('test', { file: fix('chain/room.kiln'), input: '0 left down\n', follow: true });
  assert.equal(r.code, 1, r.text);
  assert.match(r.text, /^FAIL .*room\.kiln:\d+ event exit by 300 -- .*scene ended at tick 32 \(load room\.kiln\)$/m);
  assert.match(r.text, /^FAIL .*count caught == 0 at 300 -- actual 1/m);
  assert.match(r.text, /^fail tick=32 .* load=room\.kiln\n$/m);
});

test('--follow gives up on a scene that loads itself, and on one that loads nothing there', async () => {
  const loop = await command('test', { file: fix('loop/again.kiln'), follow: true });
  assert.equal(loop.code, 2);
  // The same scene, input and kept state twice: a circle, said at once.
  assert.match(loop.text, /^E K132 the game goes round for ever: again\.kiln > again\.kiln, each time with the same/m);
  assert.equal(loop.text.match(/^scene /gm)?.length, 1, loop.text);
  // Kept state that changes every time is not a circle: the count of scenes ends it.
  const dir = mkdtempSync(join(tmpdir(), 'kiln-loop-'));
  const grows = join(dir, 'grows.kiln');
  writeFileSync(grows, ['world hz=60 gravity=0,0', 'entity hero', '  pos 0 0', '  box 1 1', 'entity door', '  pos 0 0', '  box 1 1', '  trigger hero out load:grows.kiln', 'entity far', '  pos 5 5', '  vel 1 0', '  keep pos', 'expect event out by 60', ''].join(String.fromCharCode(10)));
  const counted = await command('test', { file: grows, follow: true });
  assert.match(counted.text, /^E K132 still loading after 64 scenes: grows\.kiln x64; last /m);
  const lost = await command('test', { file: fix('loop/lost.kiln'), follow: true });
  assert.equal(lost.code, 2);
  assert.match(lost.text, /^E K001 lost\.kiln loads 'nowhere\.kiln', which is not next to it$/m);
  const text = await command('test', { scene: scene('expect event out by 60'), follow: true });
  assert.match(text.text, /^E K002 follow needs a scene file/m);
});

test('solve does not walk on through a trigger that loads another scene', async () => {
  // `far` is behind the door, in a corridor with no way round. Before, the search stepped
  // through the door and reported a win.
  const CORRIDOR = 'entity map\n  pos -1 -1\n  tiles\n    #########\n    #.......#\n    #########\n';
  const blocked = await command('solve', { scene: scene('expect event far by 300', '  vel\n  ctrl 4\n', CORRIDOR), maxStates: 3000 });
  assert.equal(blocked.code, 1, blocked.text);
  // The door itself is still a goal that can be met: the scene ends there with everything done.
  const out = await command('solve', { scene: scene('expect event out by 300', '  vel\n  ctrl 4\n', CORRIDOR) });
  assert.equal(out.code, 0, out.text);
  assert.match(out.text, /^ok solved tick=\d+/m);
});

// The proof game is kept as the agent made it, copies included. These show the copies are no
// longer needed: the agent's own inputs and expects, run against the levels themselves.
const GAME = fileURLToPath(new URL('../proof/lite/game/', import.meta.url));
const asCase = (copy: string, drop: RegExp = /^$/): string => {
  const expects = readFileSync(`${GAME}${copy}.kiln`, 'utf8').split(/\r?\n/).filter((l) => l.startsWith('expect ') && !drop.test(l));
  return `${readFileSync(`${GAME}${copy}.input`, 'utf8')}\n${expects.join('\n')}\n`;
};

test('proof game (Lite): B, C and D hold on the levels themselves, without the copied scenes', async () => {
  const door = await command('test', { file: `${GAME}level1.kiln`, input: asCase('test_door') });
  assert.equal(door.code, 0, door.text);
  assert.match(door.text, /passed=6 failed=0\n$/);
  const guard = await command('test', { file: `${GAME}level2.kiln`, input: asCase('test_guard') });
  assert.equal(guard.code, 0, guard.text);
  assert.match(guard.text, /passed=4 failed=0 load=level2\.kiln\n$/);
  // The copy of level 3 added an entity to stand for a place; the position checks beside it say the same.
  const crate = await command('test', { file: `${GAME}level3.kiln`, input: asCase('test_crate', / mark /) });
  assert.equal(crate.code, 0, crate.text);
  assert.match(crate.text, /passed=8 failed=0\n$/);
});

test('proof game (Lite): one command plays it from the first level to the ending', async () => {
  const r = await command('test', { file: `${GAME}level1.kiln`, inputFile: `${GAME}level1.input`, follow: true });
  assert.equal(r.code, 0, r.text);
  assert.match(r.text, /path=level1\.kiln>level2\.kiln>level3\.kiln>end\.kiln\n$/);
});

test('before: the first tick where a change makes the game differ, and what differs', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { execFileSync } = await import('node:child_process');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { command } = await import('../src/commands.ts');
  const dir = mkdtempSync(join(tmpdir(), 'kiln-diff-'));
  const scene = (speed: number): string => `entity ball\n  pos 0 0\n  vel ${speed} 0\nentity rock\n  pos 9 9\nexpect at 30 ball.pos.x > 0\n`;
  const file = join(dir, 'game.kiln');
  writeFileSync(file, scene(1));
  writeFileSync(join(dir, 'old.kiln'), scene(1));
  const git = (...args: string[]): void => void execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { stdio: 'ignore' });
  git('init', '-q');
  git('add', '.');
  git('commit', '-qm', 'one');
  const same = await command('test', { file, before: 'HEAD' });
  assert.match(same.text, /^same as before=HEAD through tick 30$/m);
  writeFileSync(file, scene(2));
  for (const before of ['HEAD', join(dir, 'old.kiln')]) {
    const r = await command('test', { file, before });
    assert.equal(r.code, 0, r.text);
    // The two start with different speeds, so they differ before anything has moved.
    assert.match(r.text, /differs from before=.+ first at tick 0\r?\n~ ball\r?\n    - vel 1\r?\n    \+ vel 2\r?\n/);
    assert.doesNotMatch(r.text, /rock/);
  }
  assert.match((await command('test', { file, before: 'nothing' })).text, /neither a scene file nor a git revision/);
  assert.match((await command('test', { scene: scene(1), before: 'HEAD' })).text, /^E K002 /m);
});
