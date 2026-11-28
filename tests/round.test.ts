// `round`: an entity's outline is the circle inside its box, for blocking and for overlap.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { command } from '../src/commands.ts';
import { fmtFx } from '../src/fx.ts';
import { run } from '../src/run.ts';
import { parseScene } from '../src/scene.ts';
import { meets } from '../src/sim.ts';

const ent = (name: string, x: number, y: number, w: number, h: number, more: string[] = []): string =>
  [`entity ${name}`, `  pos ${x} ${y}`, `  box ${w} ${h}`, ...more.map((m) => `  ${m}`), ''].join('\n');
const pos = (text: string, name: string, ticks = 120): { x: number; y: number; events: string[] } => {
  const w = run(text, { ticks }).world, p = w.get(w.ids.get(name)!, 'pos')!;
  return { x: Number(fmtFx(p.x as number)), y: Number(fmtFx(p.y as number)), events: w.events.map((e) => e.name) };
};
const near = (got: number, want: number, what: string): void => assert.ok(Math.abs(got - want) < 0.0002, `${what}: ${got}, expected ${want}`);

test('round: a circle meets the corner of a box later than its own box would', () => {
  // Radius 1, centre at y 1; the wall's top is at y 1.6, so the circle meets its corner:
  // 0.6 above it, the half chord is 0.8, and the centre stops at 5 - 0.8.
  const wall = ent('wall', 5, 1.6, 2, 2, ['solid']);
  near(pos(ent('ball', 0, 0, 2, 2, ['vel 3 0', 'round']) + wall, 'ball').x, 3.2, 'round');
  assert.equal(pos(ent('ball', 0, 0, 2, 2, ['vel 3 0']) + wall, 'ball').x, 3);
  // The same from the other side, and along y.
  near(pos(ent('ball', 10, 0, 2, 2, ['vel -3 0', 'round']) + wall, 'ball').x, 6.8, 'leftward');
  near(pos(ent('ball', 0, 0, 2, 2, ['vel 0 3', 'round']) + ent('wall', 1.6, 5, 2, 2, ['solid']), 'ball').y, 3.2, 'downward');
  near(pos(ent('ball', 0, 10, 2, 2, ['vel 0 -3', 'round']) + ent('wall', 1.6, 5, 2, 2, ['solid']), 'ball').y, 6.8, 'upward');
});

test('round: flat against a side it stops where a box does; the nearer the corner is to its edge, the later', () => {
  assert.equal(pos(ent('ball', 0, 0, 2, 2, ['vel 3 0', 'round']) + ent('wall', 5, -1, 2, 4, ['solid']), 'ball').x, 3);
  // The wall's top is 0.9 under the centre (0.1 inside the ball's box): half chord sqrt(1 - 0.81).
  near(pos(ent('ball', 0, 0, 2, 2, ['vel 3 0', 'round']) + ent('wall', 5, 1.9, 0.5, 2, ['solid']), 'ball').x, 5 - Math.sqrt(1 - 0.81) - 1, 'grazing');
  // 0.1 under the centre it is nearly the side.
  near(pos(ent('ball', 0, 0, 2, 2, ['vel 3 0', 'round']) + ent('wall', 5, 1.1, 2, 2, ['solid']), 'ball').x, 5 - Math.sqrt(1 - 0.01) - 1, 'nearly flat');
});

test('round: a box meets a round solid, and a circle meets a circle', () => {
  // A unit box moving right, the pillar's centre 0.6 below the box's lower side: it stops 0.8 before the centre.
  near(pos(ent('crate', 0, 0, 1, 1, ['vel 3 0']) + ent('pillar', 5, 0.6, 2, 2, ['solid', 'round']), 'crate').x, 4.2, 'box against circle');
  // Level with its centre the box meets the circle's side.
  assert.equal(pos(ent('crate', 0, 1, 1, 1, ['vel 3 0']) + ent('pillar', 5, 0.6, 2, 2, ['solid', 'round']), 'crate').x, 4);
  // Two circles of radius 1 whose centres are 1.2 apart across the move: 1.6 apart along it.
  near(pos(ent('ball', 0, 0, 2, 2, ['vel 3 0', 'round']) + ent('pillar', 5, 1.2, 2, 2, ['solid', 'round']), 'ball').x, 3.4, 'circle against circle');
  near(pos(ent('ball', 10, 0, 2, 2, ['vel -3 0', 'round']) + ent('pillar', 5, 1.2, 2, 2, ['solid', 'round']), 'ball').x, 6.6, 'circle against circle, leftward');
});

test('round: stopped against something is not inside it, and it can leave again', () => {
  for (const [ball, wall] of [
    [ent('ball', 0, 0, 2, 2, ['vel 3 0', 'round']), ent('wall', 5, 1.6, 2, 2, ['solid', 'trigger ball hit'])],
    [ent('ball', 0, 0, 2, 2, ['vel 3 0', 'round']), ent('wall', 5, 1.2, 2, 2, ['solid', 'round', 'trigger ball hit'])],
    [ent('ball', 0, 0, 1, 1, ['vel 3 0']), ent('wall', 5, 0.6, 2, 2, ['solid', 'round', 'trigger ball hit'])],
  ]) {
    const w = run(ball + wall, { ticks: 120 }).world;
    assert.deepEqual(w.events.map((e) => e.name), [], 'touching is not overlapping');
    assert.equal(meets(w, w.ids.get('ball')!, w.ids.get('wall')!), false);
    // Turned round, it moves away freely from where it stood.
    const back = run(ball.replace('vel 3 0', 'vel -3 0').replace(/pos \S+ \S+/, `pos ${fmtFx(w.get(0, 'pos')!.x as number)} ${fmtFx(w.get(0, 'pos')!.y as number)}`) + wall, { ticks: 30 }).world;
    assert.ok((back.get(0, 'pos')!.x as number) < (w.get(0, 'pos')!.x as number) - 60000);
  }
});

test('round: triggers and reach go by the circle, not by its box', async () => {
  // The coin's box overlaps the hero's box at its corner; the circles are apart.
  const corner = ent('hero', 0, 0, 2, 2, ['round']) + ent('coin', 1.8, 1.8, 1, 1, ['round', 'trigger hero got']);
  assert.deepEqual(pos(corner, 'hero', 10).events, []);
  assert.deepEqual(pos(corner.replace(/  round\n/g, ''), 'hero', 10).events, ['got']);
  // Moved in until the circles cross (centres 1.5 apart is their radii together): it is taken.
  const taken = ent('hero', 0, 0, 2, 2, ['round']) + ent('coin', 1.5, 1.5, 1, 1, ['round', 'trigger hero got']);
  assert.deepEqual(pos(taken, 'hero', 10).events, ['got']);
  // A round thing against a box: nearest point of the box.
  const edge = ent('hero', 0, 0, 2, 2, ['round']) + ent('pad', 1.75, 1.75, 1, 1, ['trigger hero on']);
  assert.deepEqual(pos(edge, 'hero', 10).events, []);
  assert.deepEqual(pos(edge.replace('pos 1.75 1.75', 'pos 1.7 1.7'), 'hero', 10).events, ['on']);

  const reach = await command('test', { scene: corner + 'expect never hero coin\n', ticks: 10 });
  assert.equal(reach.code, 0, reach.text);
  const miss = await command('test', { scene: corner + 'expect reach hero coin by 10\n' });
  assert.equal(miss.code, 1);
});

test('round: a ball under gravity lands on a floor, rests and rides it', () => {
  const text = 'world gravity=0,20\n' + ent('ball', 0, 0, 1, 1, ['vel', 'body', 'round']) + ent('floor', -5, 4, 10, 1, ['solid']);
  const w = run(text, { ticks: 120 }).world, b = w.get(w.ids.get('ball')!, 'body')!;
  assert.deepEqual([fmtFx(w.get(0, 'pos')!.y as number), b.grounded, b.ride], ['3', 1, 'floor']);
});

test('round: check says when the box is not square, and only games with something round carry the part', async () => {
  const { build } = await import('../src/build.ts');
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  assert.match((await command('check', { scene: ent('a', 0, 0, 2, 1, ['round']) })).text, /^W K337 scene 'a' is round in a box that is not square/m);
  assert.doesNotMatch((await command('check', { scene: ent('a', 0, 0, 1, 1, ['round']) })).text, /K337/);
  const dir = mkdtempSync(join(tmpdir(), 'kiln-round-'));
  const game = (text: string): { parts: string[]; written: string[] } => {
    writeFileSync(join(dir, 'game.kiln'), text);
    return build(join(dir, 'game.kiln'), mkdtempSync(join(tmpdir(), 'kiln-round-out-')));
  };
  const withIt = game(ent('a', 0, 0, 1, 1, ['round']));
  assert.ok(withIt.parts.includes('round') && withIt.written.includes('engine/src/round.js'));
  const without = game(ent('a', 0, 0, 1, 1));
  assert.ok(!without.parts.includes('round') && !without.written.includes('engine/src/round.js'));
});

test('round: it is a line of the scene and of the guide', async () => {
  assert.ok(parseScene(ent('a', 0, 0, 1, 1, ['round'])).world.has(0, 'round'));
  assert.match((await command('guide', {})).text, /^round {2}-- /m);
});
