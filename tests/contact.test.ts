// A trigger that removes what it touches does so in the step of the contact. `reach` and `never`
// measure boxes after the step, so they used to miss it: `never hero #guard` passed for a hero a
// guard had just removed. Found by the first agent run (proof/lite/RUN.md, failure 6).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { command } from '../src/commands.ts';

const scene = (action: string, expects: string): string => `world hz=60
entity hero
  pos 0 0
  vel 4 0
  box 1 1
entity guard
  pos 3 0
  box 1 1
  tag guard
  trigger hero caught ${action}
${expects}
`;

test('reach sees a contact whose trigger removed one side in the same step', async () => {
  for (const action of ['despawn:hero', 'despawn-other', 'despawn-self', 'none']) {
    const r = await command('test', { scene: scene(action, 'expect reach hero guard by 60\nexpect reach #guard hero by 60') });
    assert.equal(r.code, 0, `${action}\n${r.text}`);
    assert.match(r.text, /reach hero guard by 60 -- tick 31/, action);
  }
});

test('never fails on a contact whose trigger removed one side in the same step', async () => {
  for (const action of ['despawn:hero', 'despawn-self']) {
    const r = await command('test', { scene: scene(action, 'expect never hero #guard\nexpect count caught == 1 at 60') });
    assert.equal(r.code, 1, `${action}\n${r.text}`);
    assert.match(r.text, /FAIL .*never hero #guard -- tick 31/, action);
  }
});

test('a contact with something else does not count', async () => {
  const r = await command('test', { scene: scene('despawn:hero', 'expect never hero wall\nexpect at 60 guard.pos.x == 3') + 'entity wall\n  pos 9 9\n  box 1 1\n' });
  assert.equal(r.code, 0, r.text);
});
