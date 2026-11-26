// What the first agent run showed `solve` could not do (proof/lite/RUN.md, failures 2 to 5):
// find the way round walls and a closed door, and keep off what must not be touched.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { command } from '../src/commands.ts';

const file = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url));

// Solves a scene and replays the answer with `test`. Returns the states searched and the replay.
async function solved(opts: { file?: string; scene?: string }): Promise<{ states: number; replay: string; input: string }> {
  const s = await command('solve', opts);
  assert.equal(s.code, 0, s.text);
  const lines = s.text.trimEnd().split('\n');
  const input = lines.slice(0, -1).join('\n') + '\n';
  const r = await command('test', { ...opts, input });
  assert.equal(r.code, 0, r.text);
  return { states: Number(/states=(\d+)/.exec(lines[lines.length - 1])![1]), replay: r.text, input };
}

test('solve: gems in a maze, a door that opens last, guards never touched', async () => {
  // Gave up after 200,000 states before distance followed the walls: the door, still closed,
  // was the nearest goal in a straight line.
  const r = await solved({ file: file('./fixtures/vault.kiln') });
  assert.ok(r.states < 20_000, `states ${r.states}`);
  assert.match(r.replay, /pass .*count caught == 0 at 1500 -- actual 0/);
});

test('solve: the proof game\'s levels stay cheap to solve', async () => {
  for (const [level, budget] of [['level1', 1_000], ['level2', 25_000], ['level3', 40_000]] as const) {
    const r = await solved({ file: file(`../proof/lite/game/${level}.kiln`) });
    assert.ok(r.states < budget, `${level}: states ${r.states}`);
  }
});

const hall = (expects: string): string => `world hz=60
entity map
  pos 0 0
  tiles
    #########
    #.......#
    #.#####.#
    #.......#
    #########
entity hero
  pos 1.15 3.15
  vel
  box 0.7 0.7
  ctrl 4
entity goal
  pos 7.25 3.25
  box 0.5 0.5
  trigger hero win
entity trap
  pos 4 3
  box 1 1
  trigger hero hit
expect event win by 900
${expects}
`;

test('solve: `count NAME == 0 at N` keeps the answer off that event', async () => {
  // The short way runs over the trap; the long way goes round the top.
  const through = await solved({ scene: hall('') });
  const round = await solved({ scene: hall('expect count hit == 0 at 900') });
  assert.match(round.replay, /pass .*count hit == 0 at 900 -- actual 0/);
  assert.match(round.input, /\bup down\b/);
  assert.doesNotMatch(through.input, /\bup down\b/);
  for (const same of ['expect count hit <= 0 at 900', 'expect count hit < 1 at 900']) {
    assert.equal((await solved({ scene: hall(same) })).input, round.input, same);
  }
});

test('solve: a count that allows the event does not steer the search', async () => {
  const free = await solved({ scene: hall('') });
  assert.equal((await solved({ scene: hall('expect count hit <= 1 at 900') })).input, free.input);
});

test('solve: says so when the only way is over what must not happen', async () => {
  const shut = hall('expect count hit == 0 at 900').replace('#.......#\n    #.#####.#', '#########\n    #########');
  const s = await command('solve', { scene: shut });
  assert.equal(s.code, 1, s.text);
  assert.match(s.text, /no input reaches the goals by tick 900/);
});
