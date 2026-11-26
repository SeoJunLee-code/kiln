// The Lite proof game (proof/lite): built by an agent from proof/lite/SPEC.md, kept working here.
// The headless half is the agent's own evidence replayed; the browser half is what the agent
// could not see from headless runs: that winning a level opens the next one, and that a guard
// sends the player back to the start of the level.
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from '../src/build.ts';
import { findChrome, launch } from '../src/chrome.ts';
import type { Browser } from '../src/chrome.ts';
import { command } from '../src/commands.ts';
import { GPU_SWITCHES, openPlayer } from '../src/look.ts';

const GAME = fileURLToPath(new URL('../proof/lite/game', import.meta.url));
const at = (name: string): string => join(GAME, name);
// One frame of level 3 makes 81 Canvas 2D calls today (tiles, boxes, glyphs, the label).
const BUDGET_CALLS = 90;
const skip = findChrome() ? false : 'no Chrome or Edge on this machine';
let browser: Browser;
before(async () => { if (!skip) browser = await launch({ args: GPU_SWITCHES }); });
after(async () => { if (!skip) await browser.close(); });

test('proof game (Lite): every scene passes its expects with its recorded input', async () => {
  const r = await command('test', { file: GAME });
  assert.equal(r.code, 0, r.text);
  assert.match(r.text, /ok scenes=7 passed=7 failed=0\n$/);
});

test('proof game (Lite): needs nothing above Lite, with no warnings', async () => {
  const r = await command('check', { file: GAME, edition: 'lite' });
  assert.equal(r.code, 0, r.text);
  assert.match(r.text, /ok scenes=7 passed=7 failed=0 edition=lite\n$/);
  assert.doesNotMatch(r.text, /^W /m);
  assert.doesNotMatch(r.text, /warnings=[1-9]/);
});

test('proof game (Lite): the build carries the 2D engine only, inside the Lite byte budget', () => {
  const out = mkdtempSync(join(tmpdir(), 'kiln-proof-'));
  try {
    const b = build(at('level1.kiln'), out);
    assert.deepEqual(b.parts, []);
    assert.ok(b.engineBytes <= 94_000, `engine bytes ${b.engineBytes}`);
    for (const f of readdirSync(GAME)) assert.ok(b.written.some((w) => w.replace(/\.js$/, '.ts').endsWith(f)), `${f} is missing from the build`);
  } finally { rmSync(out, { recursive: true, force: true }); }
});

// Replays a scene's recorded input in the real player and says which scene the page opens next.
async function opens(scene: string, ticks: number): Promise<string> {
  const player = await openPlayer(at(scene), { inputFile: at(scene.replace(/\.kiln$/, '.input')), browser });
  try {
    await player.page.eval(`kiln.runTo(${ticks})`);
    let where = '';
    for (let i = 0; i < 50 && !where.includes('scene='); i++) {
      await new Promise((r) => setTimeout(r, 100));
      try { where = await player.page.eval<string>('location.search'); } catch { /* the page is navigating */ }
    }
    return decodeURIComponent(where.replace(/^\?scene=/, ''));
  } finally { await player.close(); }
}

test('proof game (Lite), in a browser: each level won opens the next, and level 3 opens the end screen', { skip }, async () => {
  assert.equal(await opens('level1.kiln', 900), 'level2.kiln');
  assert.equal(await opens('level2.kiln', 1500), 'level3.kiln');
  assert.equal(await opens('level3.kiln', 2400), 'end.kiln');
});

test('proof game (Lite), in a browser: a guard sends the player back to the start of the level', { skip }, async () => {
  assert.equal(await opens('test_guard.kiln', 600), 'level2.kiln');
});

test('proof game (Lite), in a browser: a door that is still closed opens nothing', { skip }, async () => {
  const player = await openPlayer(at('test_door.kiln'), { inputFile: at('test_door.input'), browser });
  try {
    await player.page.eval('kiln.runTo(300)');
    await new Promise((r) => setTimeout(r, 1000));
    assert.doesNotMatch(await player.page.eval<string>('location.search'), /scene=/);
    assert.deepEqual(player.page.errors(), []);
  } finally { await player.close(); }
});

// Frame time is measured on the reference PC (proof/lite/FPS.md); a shared CI machine cannot
// check it. What it can check is the work a frame asks of the browser, which is the same on
// every run: the number of Canvas 2D drawing calls for one frame of the largest level.
test('proof game (Lite), in a browser: a frame of level 3 stays inside its drawing-call budget', { skip }, async () => {
  const player = await openPlayer(at('level3.kiln'), { inputFile: at('level3.input'), browser });
  try {
    const calls = await player.page.eval<number>(`(() => {
      kiln.runTo(300);
      let n = 0;
      const proto = CanvasRenderingContext2D.prototype, kept = {};
      for (const name of ['fillRect', 'fillText', 'drawImage']) {
        kept[name] = proto[name];
        proto[name] = function (...a) { n++; return kept[name].apply(this, a); };
      }
      kiln.runTo(301);
      Object.assign(proto, kept);
      return n;
    })()`);
    assert.ok(calls > 0 && calls <= BUDGET_CALLS, `drawing calls in one frame: ${calls}`);
  } finally { await player.close(); }
});

// The second build of the same spec (proof/lite/RERUN.md), kept as its agent left it.
test('proof game (Lite), second build: passes as a folder, follows through to the end, and is Lite', async () => {
  const dir = fileURLToPath(new URL('../proof/lite/rerun', import.meta.url));
  const t = await command('test', { file: dir });
  assert.equal(t.code, 0, t.text);
  assert.match(t.text, /ok scenes=4 cases=3 passed=7 failed=0\n$/);
  const f = await command('test', { file: join(dir, 'level1.kiln'), inputFile: join(dir, 'level1.input'), follow: true });
  assert.equal(f.code, 0, f.text);
  assert.match(f.text, /path=level1\.kiln>level2\.kiln>level3\.kiln>end\.kiln/);
  const c = await command('check', { file: dir, edition: 'lite' });
  assert.equal(c.code, 0, c.text);
  assert.match(c.text, /failed=0 edition=lite\n$/);
  assert.doesNotMatch(c.text, /^W /m);
});
