// The automatic screen judge's own arithmetic and its pictures of a Kiln game. The judging
// model is not called here: its answer is whatever command the owner gives it.
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { agreement, agreementReport, kilnFrames, lastTickOf, packetText, parseAnswer, ticksFor } from '../scripts/autojudge.ts';
import { findChrome } from '../src/chrome.ts';
import { decodePng, summarize } from '../src/png.ts';

const CHECKS = [{ n: 1, do: 'Start.', see: 'A menu.' }, { n: 2, do: 'Press Enter.', see: 'Level 1.' }, { n: 3, do: 'Win.', see: '`You win`.' }];

test('autojudge: the ticks pictured, and the last tick an input names', () => {
  assert.deepEqual(ticksFor(0), [0]);
  assert.deepEqual(ticksFor(200), [0, 50, 100, 150, 200]);
  assert.deepEqual(ticksFor(2), [0, 1, 2]);
  assert.equal(lastTickOf('0 right down\n# note\n140 right up\nexpect event win by 900\n12 start tap\n'), 140);
  assert.equal(lastTickOf(''), 0);
});

test('autojudge: the packet holds the pictures and the checks, and asks for unsure where nothing shows', () => {
  const text = packetText({ id: 'H3/kiln-1', spec: 'H3' }, CHECKS, [{ file: 'menu@0.png', what: 'scene `menu.kiln` at tick 0, untouched' }]);
  assert.match(text, /^- `menu@0\.png`: scene `menu\.kiln` at tick 0, untouched$/m);
  assert.match(text, /^\| 3 \| Win\. \| `You win`\. \|$/m);
  assert.match(text, /`unsure` whenever the pictures do not/);
  assert.doesNotMatch(text, /hash|component|entity/i, 'nothing of the engine inside is shown to the judge');
});

test('autojudge: an answer is read strictly; anything else is unsure', () => {
  assert.deepEqual(parseAnswer('Here you go: {"1":"pass","2":"fail","3":"maybe","9":"pass"} done', CHECKS), { 1: 'pass', 2: 'fail', 3: 'unsure' });
  assert.deepEqual(parseAnswer('I could not tell.', CHECKS), { 1: 'unsure', 2: 'unsure', 3: 'unsure' });
});

test('autojudge: agreement counts only what both judged, and says which way it leans', () => {
  const at = '2026-11-28T00:00:00Z';
  const targets = [{ id: 'H3/kiln-1', spec: 'H3' as const, engine: 'kiln' as const }, { id: 'H3/godot-file-1', spec: 'H3' as const, engine: 'godot' as const }];
  const human = {
    'H3/kiln-1': { spec: 'H3' as const, setup: 'kiln', checks: { 1: { verdict: 'pass' as const, at }, 2: { verdict: 'fail' as const, at }, 3: { verdict: 'skip' as const, at } } },
    'H3/godot-file-1': { spec: 'H3' as const, setup: 'godot-file', checks: { 1: { verdict: 'pass' as const, at }, 2: { verdict: 'pass' as const, at } } },
  };
  const auto = {
    'H3/kiln-1': { spec: 'H3' as const, setup: 'kiln', checks: { 1: 'pass' as const, 2: 'pass' as const, 3: 'pass' as const } },
    'H3/godot-file-1': { spec: 'H3' as const, setup: 'godot-file', checks: { 1: 'fail' as const, 2: 'unsure' as const } },
  };
  const rows = agreement(targets, auto, human);
  assert.deepEqual(rows, [
    { spec: 'H3', engine: 'kiln', judged: 2, covered: 2, agree: 1, autoKinder: 1, autoHarsher: 0 },
    { spec: 'H3', engine: 'godot', judged: 2, covered: 1, agree: 0, autoKinder: 0, autoHarsher: 1 },
  ]);
  assert.match(agreementReport(rows).at(-1)!, /^all: covered 3, agree 1 \(33%\)/);
});

const skip = findChrome() ? false : 'no Chrome or Edge on this machine';
test('autojudge: a Kiln game folder becomes pictures of each scene along its own input', { skip }, async () => {
  const ex = (f: string): string => fileURLToPath(new URL(`../examples/${f}`, import.meta.url));
  const game = mkdtempSync(join(tmpdir(), 'kiln-aj-game-')), out = mkdtempSync(join(tmpdir(), 'kiln-aj-out-'));
  for (const f of ['maze.kiln', 'maze.input']) copyFileSync(ex(f), join(game, f));
  const frames = await kilnFrames(game, out);
  assert.equal(frames.length, 5);
  assert.match(frames[0].what, /^scene `maze\.kiln` at tick 0, replaying the input its agent saved$/);
  for (const f of frames) assert.ok(summarize(decodePng(readFileSync(join(out, f.file)))).drawn > 0.05, `${f.file} shows the game`);
});
