// The working loop in one call: apply writes, checks and tests; watch prints values as a run
// goes; diff says where two runs part; check tries the scripts; solve stops when its time is up.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { command } from '../src/commands.ts';

const SCENE = `world hz=60 gravity=0,20
entity floor
  pos 0 5
  box 8 1
  solid
entity hero
  pos 1 4
  vel
  box 1 1
  body
  ctrl 3
entity coin
  pos 5 4
  box 1 1
  trigger hero coin despawn-self
expect event coin by 120
`;
const folder = (): string => mkdtempSync(join(tmpdir(), 'kiln-loop-'));

test('apply: files are written, the folder is checked and tested, and the answer is short', async () => {
  const dir = folder();
  const r = await command('apply', { file: dir, files: [{ path: 'a.kiln', content: SCENE }, { path: 'a.input', content: '0 right down\n' }], watch: 'hero.pos.x,coin.pos', at: '0,90' });
  assert.equal(r.code, 0, r.text);
  assert.equal(readFileSync(join(dir, 'a.kiln'), 'utf8'), SCENE);
  assert.deepEqual(r.text.trimEnd().split('\n'), [
    'wrote 2 files',
    'check ok scenes=1 passed=1 failed=0 edition=lite',
    'test a.kiln watch 0 hero.pos.x=1 coin.pos=5,4,0',
    'test a.kiln watch 90 hero.pos.x=5.5 coin.pos=gone',
    'test a.kiln watch 120 hero.pos.x=7 coin.pos=gone',
    'test a.kiln ok tick=120 hash=' + /hash=(\w+)/.exec(r.text)![1] + ' passed=1 failed=0',
    'test ok scenes=1 passed=1 failed=0',
  ]);
});

test('apply: an edit must match once; a failing test or a broken scene is said, with the files still written', async () => {
  const dir = folder();
  writeFileSync(join(dir, 'a.kiln'), SCENE);
  const slow = await command('apply', { file: dir, edits: [{ path: 'a.kiln', old: 'ctrl 3', new: 'ctrl 1' }], files: [{ path: 'a.input', content: '0 right down\n' }] });
  assert.equal(slow.code, 1);
  assert.match(slow.text, /^wrote 1 file, edited 1$/m);
  assert.match(slow.text, /^test a\.kiln FAIL .*event coin by 120/m);
  const none = await command('apply', { file: dir, edits: [{ path: 'a.kiln', old: 'ctrl 3', new: 'ctrl 2' }, { path: 'a.kiln', old: '  box', new: '  box' }] });
  assert.equal(none.code, 2);
  assert.match(none.text, /^E K007 apply: edit of 'a\.kiln' matches nothing/m);
  assert.match(none.text, /^E K007 apply: edit of 'a\.kiln' matches 3 places/m);
  const broken = await command('apply', { file: dir, files: [{ path: 'a.kiln', content: SCENE.replace('solid', 'sollid') }] });
  assert.equal(broken.code, 2);
  assert.match(broken.text, /E K102 .*a\.kiln:5 unknown component 'sollid'/);
  assert.doesNotMatch(broken.text, /^test /m);
  const out = await command('apply', { file: dir, files: [{ path: '../escape.kiln', content: 'x' }] });
  assert.match(out.text, /^E K006 apply: '\.\.\/escape\.kiln' is not a path inside the game folder/m);
});

test('apply: test=false writes and checks only', async () => {
  const dir = folder();
  const r = await command('apply', { file: dir, files: [{ path: 'a.kiln', content: SCENE }], test: false });
  assert.deepEqual(r.text.trimEnd().split('\n').slice(-1), ['ok applied, not tested']);
});

test('diff: the first tick two runs part, and what differs there', async () => {
  const dir = folder();
  writeFileSync(join(dir, 'a.kiln'), SCENE);
  writeFileSync(join(dir, 'a.input'), '0 right down\n');
  writeFileSync(join(dir, 'b.input'), '0 right down\n30 right up\n');
  writeFileSync(join(dir, 'c.kiln'), SCENE.replace('pos 5 4', 'pos 6 4'));
  const same = await command('diff', { file: join(dir, 'a.kiln'), inputFile: join(dir, 'a.input'), against: join(dir, 'a.input') });
  assert.match(same.text, /^ok same ticks=120 hash=\w+$/m);
  const input = await command('diff', { file: join(dir, 'a.kiln'), inputFile: join(dir, 'a.input'), against: join(dir, 'b.input') });
  assert.equal(input.code, 1);
  assert.match(input.text, /^differ first at tick 31 \(same through tick 30\)$/m);
  assert.match(input.text, /^hero\.vel\.x 3 -> 0$/m);
  const scene = await command('diff', { file: join(dir, 'a.kiln'), inputFile: join(dir, 'a.input'), against: join(dir, 'c.kiln') });
  assert.match(scene.text, /^differ first at tick 0 \(from the start\)$/m);
  assert.match(scene.text, /^coin\.pos\.x 5 -> 6$/m);
});

test('check: a script that fails in its first second fails the check, with its line', async () => {
  const dir = folder();
  writeFileSync(join(dir, 'g.ts'), 'export default (k) => {\n  k.system((w) => {\n    if (w.tick === 20) w.nothing();\n  });\n};\n');
  writeFileSync(join(dir, 'a.kiln'), 'use ./g.ts\n' + SCENE);
  const r = await command('check', { file: join(dir, 'a.kiln') });
  assert.equal(r.code, 2);
  assert.match(r.text, /^E K124 g\.ts:3 script failed while running: w\.nothing is not a function$/m);
});

test('solve: when its time is up it says so and shows how far it got', async () => {
  // The coin is behind a wall with no way round: the search can only run out.
  const walled = SCENE.replace('expect event coin by 120', 'entity wall\n  pos 4 0\n  box 1 5\n  solid\nexpect event coin by 100000');
  const t0 = performance.now();
  const r = await command('solve', { scene: walled, budget: 1 });
  assert.equal(r.code, 1);
  assert.match(r.text, /^fail (gave up after 1 s \(\d+ states; --budget SECONDS for longer|no input reaches the goals)/m);
  assert.ok(performance.now() - t0 < 20_000);
});
