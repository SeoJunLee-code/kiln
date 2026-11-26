import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { ONE, div, fmtFx, fx, mul, parseFx } from '../src/fx.ts';
import { run, view } from '../src/run.ts';
import { KilnFail, parseScene, serialize } from '../src/scene.ts';
import { hash, parseInput, step } from '../src/sim.ts';

const maze = readFileSync(new URL('../examples/maze.kiln', import.meta.url), 'utf8');
const mazeInput = readFileSync(new URL('../examples/maze.input', import.meta.url), 'utf8');
const codes = (fn: () => unknown): string[] => {
  try { fn(); } catch (e) { if (e instanceof KilnFail) return e.diags.map((d) => d.code); throw e; }
  return [];
};

test('fx: arithmetic matches exact results', () => {
  assert.equal(mul(fx(1.5), fx(2)), fx(3));
  assert.equal(mul(fx(-1.5), fx(2)), fx(-3));
  assert.equal(mul(fx(200), fx(100)), fx(20000));
  assert.equal(div(fx(3), fx(2)), fx(1.5));
  assert.equal(div(fx(-7), fx(2)), fx(-3.5));
  assert.throws(() => div(ONE, 0));
});

test('fx: text round-trips for every representable step', () => {
  for (const v of [0, 1, -1, 65535, 65537, fx(4.6), fx(-0.1), fx(123.456), 2 ** 31 - 1, -(2 ** 31)]) {
    assert.equal(parseFx(fmtFx(v)), v, `value ${v} via '${fmtFx(v)}'`);
  }
  assert.equal(parseFx('1e3'), null);
  assert.equal(parseFx('abc'), null);
  assert.equal(parseFx('40000'), null);
});

test('scene: serialize then parse is a fixed point', () => {
  const s = parseScene(maze);
  const a = serialize(s.world, s.expects);
  const s2 = parseScene(a);
  assert.equal(serialize(s2.world, s2.expects), a);
  assert.equal(hash(s2.world), hash(s.world));
});

test('scene: reports every error at once, with codes and hints', () => {
  let fail: KilnFail | undefined;
  try {
    parseScene('entity p\n  boxx 1 1\n  pos 1\n  vel 1 2 3 4\n  ctrl sped=4\n  pos x\nentity p\nsolid\n  box 1 1\n', 'bad.kiln');
  } catch (e) { fail = e as KilnFail; }
  assert.ok(fail);
  assert.deepEqual(fail.diags.map((d) => `${d.code}:${d.line}`), ['K102:2', 'K105:3', 'K107:4', 'K103:5', 'K104:6', 'K101:7', 'K108:8', 'K106:9']);
  assert.match(fail.diags[0].hint!, /did you mean 'box'/);
  assert.match(fail.diags[3].hint!, /did you mean 'speed'/);
  assert.match(fail.message, /^E K102 bad\.kiln:2 /);
});

test('scene: comments and #tag references coexist', () => {
  const s = parseScene('entity a # trailing comment\n  tag foe\n  pos 0 0\n  box 1 1\n  trigger #foe hit\n');
  assert.equal(s.world.get(0, 'trigger')!.target, '#foe');
  assert.deepEqual(s.world.match('#foe'), [0]);
});

test('determinism: same scene + input gives the same hash, different input does not', () => {
  const a = run(maze, { input: mazeInput });
  const b = run(maze, { input: mazeInput });
  const c = run(maze, { input: mazeInput.replace('60 right down', '61 right down') });
  assert.equal(a.hash, b.hash);
  assert.notEqual(a.hash, c.hash);
});

test('determinism: saving mid-run and resuming reaches the same state', () => {
  const script = parseInput(mazeInput);
  const full = parseScene(maze).world;
  for (let i = 0; i < 200; i++) step(full, script);

  const half = parseScene(maze).world;
  for (let i = 0; i < 90; i++) step(half, script);
  assert.ok(half.pressed.size > 0, 'a key is held at the save point');
  const resumed = parseScene(serialize(half)).world;
  for (let i = 90; i < 200; i++) step(resumed, script);
  assert.equal(hash(resumed), hash(full));
});

test('maze example: all expectations pass with the recorded input', () => {
  const r = run(maze, { input: mazeInput });
  assert.deepEqual(r.expects.filter((e) => !e.ok).map((e) => `${e.text} -- ${e.note}`), []);
  assert.deepEqual(r.world.events.map((e) => e.name), ['coin', 'win']);
});

test('maze example: without input the failures explain what happened', () => {
  const r = run(maze);
  assert.equal(r.ok, false);
  const reach = r.expects.find((e) => e.kind === 'reach')!;
  assert.equal(reach.ok, false);
  assert.match(reach.note, /closest gap [\d.]+ at tick 0, player at 1,1/);
  assert.match(r.expects.find((e) => e.kind === 'gone')!.note, /still alive/);
});

test('collision: a mover stops flush against a solid on each side', () => {
  const scene = (vx: number, vy: number) => `entity m\n  pos 5 5\n  box 1 1\n  vel ${vx} ${vy}\n` +
    'entity l\n  pos 2 0\n  box 1 20\n  solid\nentity r\n  pos 9 0\n  box 1 20\n  solid\n' +
    'entity t\n  pos 0 2\n  box 20 1\n  solid\nentity b\n  pos 0 9\n  box 20 1\n  solid\n';
  const end = (vx: number, vy: number) => {
    const w = run(scene(vx, vy), { ticks: 120 }).world;
    const p = w.get(0, 'pos')!;
    return [fmtFx(p.x as number), fmtFx(p.y as number)];
  };
  assert.deepEqual(end(7, 0), ['8', '5']);
  assert.deepEqual(end(-7, 0), ['3', '5']);
  assert.deepEqual(end(0, 7), ['5', '8']);
  assert.deepEqual(end(0, -7), ['5', '3']);
});

test('platformer: gravity grounds the body and up jumps only when grounded', () => {
  const scene = 'world gravity=0,30\nentity p\n  pos 2 0\n  box 1 1\n  vel\n  body\n  ctrl 4 10\n' +
    'entity floor\n  pos 0 5\n  box 10 1\n  solid\n';
  const landed = run(scene, { ticks: 120 }).world;
  assert.equal(fmtFx(landed.get(0, 'pos')!.y as number), '4');
  assert.equal(landed.get(0, 'body')!.grounded, 1);
  assert.equal(landed.get(0, 'body')!.ride, 'floor');

  const jumped = run(scene, { ticks: 130, input: '120 up down\n121 up up\n' }).world;
  assert.ok((jumped.get(0, 'pos')!.y as number) < fx(3.5), 'left the floor');
  assert.equal(jumped.get(0, 'body')!.grounded, 0);

  const midair = run(scene, { ticks: 10, input: '5 up down\n' }).world;
  assert.ok((midair.get(0, 'vel')!.y as number) > 0, 'no jump while falling');
});

test('trigger: fires once per entry and despawn-other removes the target', () => {
  const scene = 'entity p\n  pos 0 0\n  box 1 1\n  vel 2 0\n  tag hero\n' +
    'entity zone\n  pos 2 0\n  box 1 1\n  trigger #hero enter\n' +
    'entity pit\n  pos 6 0\n  box 1 1\n  trigger p fell despawn-other\n';
  const w = run(scene, { ticks: 400 }).world;
  assert.deepEqual(w.events.map((e) => `${e.name}:${e.a}:${e.b}`), ['enter:zone:p', 'fell:pit:p']);
  assert.deepEqual(w.match('p'), []);
});

test('expect: bad references and syntax are diagnosed before running', () => {
  assert.deepEqual(codes(() => run('entity a\n  pos 0 0\nexpect reach a bb by 10\n')), ['K110']);
  assert.deepEqual(codes(() => run('entity a\n  pos 0 0\nexpect at 5 a.pos.q > 1\nexpect reach a\n')), ['K111', 'K111']);
  assert.deepEqual(codes(() => parseInput('0 jump down\nx\n')), ['K200', 'K200']);
});

test('expect: at-tick comparisons read live state', () => {
  const scene = 'entity a\n  pos 0 0\n  vel 6 0\nexpect at 30 a.pos.x == 3\nexpect at 30 a.pos.x < 2\n';
  const r = run(scene);
  assert.deepEqual(r.expects.map((e) => [e.ok, e.note]), [[true, 'actual 3'], [false, 'actual 3']]);
});

test('view: draws solids, glyphs and names', () => {
  const v = view(run(maze, { input: mazeInput }).world);
  assert.equal(v, [
    'origin 0,0',
    '##########',
    '#...#..@.#',
    '#...#....#',
    '#...#....#',
    '#........#',
    '#........#',
    '##########',
    '',
  ].join('\n'));
});

test('collision: a fast mover does not tunnel through a thin wall', () => {
  const scene = (vx: number, vy: number) => `entity m\n  pos 10 10\n  box 1 1\n  vel ${vx} ${vy}\n` +
    'entity r\n  pos 14 0\n  box 0.25 30\n  solid\nentity l\n  pos 6 0\n  box 0.25 30\n  solid\n' +
    'entity d\n  pos 0 14\n  box 30 0.25\n  solid\nentity u\n  pos 0 6\n  box 30 0.25\n  solid\n';
  const end = (vx: number, vy: number) => {
    const p = run(scene(vx, vy), { ticks: 3 }).world.get(0, 'pos')!;
    return [fmtFx(p.x as number), fmtFx(p.y as number)];
  };
  assert.deepEqual(end(900, 0), ['13', '10']);
  assert.deepEqual(end(-900, 0), ['6.25', '10']);
  assert.deepEqual(end(0, 900), ['10', '13']);
  assert.deepEqual(end(0, -900), ['10', '6.25']);
});

test('scene: held keys and trigger overlaps survive a save', () => {
  const w = parseScene(maze).world;
  const script = parseInput(mazeInput);
  for (let i = 0; i < 200; i++) step(w, script);
  const text = serialize(w);
  assert.match(text, /^state pressed=up overlaps=exit:player$/m);
  assert.equal(hash(parseScene(text).world), hash(w));
});

const cave = readFileSync(new URL('../examples/cave.kiln', import.meta.url), 'utf8');
const caveInput = readFileSync(new URL('../examples/cave.input', import.meta.url), 'utf8');

test('tiles: rows round-trip, including # which is otherwise a comment', () => {
  const s = parseScene(cave);
  const text = serialize(s.world, s.expects);
  assert.match(text, /^  tiles\n    ############\n    #\.\.\.\.#\.\.\.\.\.#$/m);
  assert.equal(serialize(parseScene(text).world, s.expects), text);
  assert.deepEqual(codes(() => parseScene('entity m\n  pos 0 0\n  tiles\nentity b\n  pos 1 1\n')), ['K105']);
});

test('tiles: solid cells stop movers flush on every side, other cells do not', () => {
  const scene = (vx: number, vy: number) =>
    `entity map\n  pos 0 0\n  tiles 2\n    #####\n    #.~.#\n    #...#\n    #####\nentity m\n  pos 4.5 4\n  box 1 1\n  vel ${vx} ${vy}\n`;
  const end = (vx: number, vy: number) => {
    const p = run(scene(vx, vy), { ticks: 120 }).world.get(1, 'pos')!;
    return [fmtFx(p.x as number), fmtFx(p.y as number)];
  };
  assert.deepEqual(end(900, 0), ['7', '4']);
  assert.deepEqual(end(-900, 0), ['2', '4']);
  assert.deepEqual(end(0, 900), ['4.5', '5']);
  assert.deepEqual(end(0, -900), ['4.5', '2']);
});

test('cave example: solved by the recorded input, and the view shows the map', () => {
  const r = run(cave, { input: caveInput });
  assert.deepEqual(r.expects.filter((e) => !e.ok).map((e) => `${e.text} -- ${e.note}`), []);
  assert.equal(view(r.world), [
    'origin 0,0',
    '############',
    '#....#.....#',
    '#.##.#.###.#',
    '#.#....#...#',
    '#.####.#.#.#',
    '#......#.#@#',
    '############',
    '',
  ].join('\n'));
});

const dungeon = readFileSync(new URL('../examples/dungeon.kiln', import.meta.url), 'utf8');

test('prefab: spawn characters become centred entities and the saved scene is plain', () => {
  const s = parseScene(dungeon);
  const w = s.world;
  assert.deepEqual([...w.ids.keys()], ['map', 'hero', 'coin1', 'coin2', 'door', 'coin3']);
  const p = w.get(w.ids.get('hero')!, 'pos')!;
  // Centred in cell (1,1): the cell origin plus half of what the 0.8 box leaves free.
  assert.deepEqual([p.x, p.y], [ONE + ((ONE - fx(0.8)) >> 1), ONE + ((ONE - fx(0.8)) >> 1)]);
  assert.equal(w.get(0, 'tiles')!.spawn, '');
  assert.doesNotMatch(w.get(0, 'tiles')!.rows as string, /[@oD]/);

  const text = serialize(w, s.expects);
  assert.doesNotMatch(text, /^prefab |spawn=/m);
  const again = parseScene(text);
  assert.equal(serialize(again.world, again.expects), text);
  assert.equal(hash(again.world), hash(w));
});

test('prefab: mistakes are reported once, at the line that caused them', () => {
  const scene = 'prefab coin\n  boxx 1 1\n  pos 0 0\nprefab coin\nentity map\n  pos 0 0\n  tiles spawn=o:coin,x:nope,bad\n    oo.x\n';
  let fail: KilnFail | undefined;
  try { parseScene(scene, 's'); } catch (e) { fail = e as KilnFail; }
  assert.deepEqual(fail!.diags.map((d) => `${d.code}:${d.line}`), ['K109:3', 'K101:4', 'K110:7', 'K104:7', 'K102:2']);
});

test('scene: a default-empty string before a set field is saved by name', () => {
  const w = parseScene('entity a\n  pos 0 0\n  sprite color=gold\n').world;
  const text = serialize(w);
  assert.match(text, /^  sprite color=gold$/m);
  assert.equal(parseScene(text).world.get(0, 'sprite')!.color, 'gold');
});

const arena = readFileSync(new URL('../examples/arena3d.kiln', import.meta.url), 'utf8');

test('3d: z is a real axis for movement, collision and triggers', () => {
  const scene = 'world gravity=0,30\n' +
    'entity m\n  pos 1 -1 1\n  box 1 1 1\n  vel 0 0 6\n  body\n' +
    'entity floor\n  pos 0 0 0\n  box 10 1 10\n  solid\n' +
    'entity wall\n  pos 0 -3 5\n  box 10 3 1\n  solid\n' +
    'entity near\n  pos 1 -1 3\n  box 1 1 0.5\n  trigger m near\n' +
    'entity aside\n  pos 4 -1 3\n  box 1 1 0.5\n  trigger m aside\n';
  const w = run(scene, { ticks: 120 }).world;
  const p = w.get(0, 'pos')!;
  assert.deepEqual([fmtFx(p.x as number), fmtFx(p.y as number), fmtFx(p.z as number)], ['1', '-1', '4']);
  assert.equal(w.get(0, 'body')!.grounded, 1);
  assert.deepEqual(w.events.map((e) => e.name), ['near']);
});

test('3d: a scene without z behaves exactly as before and saves without z', () => {
  const text = serialize(parseScene('world gravity=0,20\nentity a\n  pos 1 2\n  box 1 1\n  vel 3 0\n').world);
  assert.equal(text, 'world hz=60 gravity=0,20\nentity a\n  pos 1 2\n  vel 3\n  box 1 1\n');
  const w3 = parseScene('world gravity=0,30,2\nentity a\n  pos 1 2 3\n  box 1 1 4\n').world;
  assert.match(serialize(w3), /^world hz=60 gravity=0,30,2\nentity a\n  pos 1 2 3\n  box 1 1 4\n$/);
});

test('3d: the floor plan view looks down on x/z', () => {
  const v = view(parseScene(arena).world, 'xz');
  const rows = v.split('\n');
  assert.equal(rows[0], 'origin -4,-4');
  assert.equal(rows[1], '~'.repeat(20), 'the pit lies below everything, so it only shows around the floor');
  assert.equal(rows[6], '~~~~#@########E#~~~~');
  assert.equal(rows[14], '~~~~#########*##~~~~');
});

test('trigger: despawn:REF removes another entity, so a key can open a door', () => {
  const scene = 'entity p\n  pos 0 0\n  box 1 1\n  vel 3 0\n' +
    'entity key\n  pos 2 0\n  box 0.5 0.5\n  trigger p key despawn-self+despawn:#door\n' +
    'entity door1\n  pos 5 0\n  box 1 1\n  solid\n  tag door\n' +
    'entity door2\n  pos 5 3\n  box 1 1\n  solid\n  tag door\n';
  const opened = run(scene, { ticks: 180 }).world;
  assert.deepEqual([...opened.ids.keys()], ['p']);
  assert.equal(fmtFx(opened.get(0, 'pos')!.x as number), '9');

  const locked = run(scene.replace('despawn-self+despawn:#door', 'none'), { ticks: 180 }).world;
  assert.equal(fmtFx(locked.get(0, 'pos')!.x as number), '4', 'stopped flush against the door');
  assert.deepEqual(codes(() => parseScene('entity a\n  pos 0 0\n  box 1 1\n  trigger a x despawn-slef\n')), ['K104']);
});

test('pace: turns at both ends on any axis, and a bad axis is an error', () => {
  const scene = 'entity g\n  pos 2 0 0\n  box 1 1\n  vel\n  pace z 0 3 6\n';
  const at = (ticks: number) => fmtFx(run(scene, { ticks }).world.get(0, 'pos')!.z as number);
  assert.deepEqual([at(15), at(30), at(60), at(90)], ['1.5', '3', '0', '3']);
  assert.deepEqual(codes(() => parseScene('entity g\n  pos 0 0\n  vel\n  pace w 0 3 6\n')), ['K104']);
});

test('push: a crate is shoved until something stops it, and a second crate does', () => {
  const scene = (extra: string) => 'entity p\n  pos 0 0\n  box 1 1\n  vel 3 0\n' +
    'entity c\n  pos 2 0\n  box 1 1\n  solid\n  push\n' +
    'entity wall\n  pos 8 0\n  box 1 1\n  solid\n' + extra;
  const end = (extra: string) => {
    const w = run(scene(extra), { ticks: 300 }).world;
    return ['p', 'c'].map((n) => fmtFx(w.get(w.ids.get(n)!, 'pos')!.x as number));
  };
  assert.deepEqual(end(''), ['6', '7'], 'crate against the wall, pusher behind it');
  assert.deepEqual(end('entity c2\n  pos 5 0\n  box 1 1\n  solid\n  push\n'), ['3', '4'], 'no chain pushing');
  // Not in the path sideways: the crate does not move when the mover only slides past it.
  assert.deepEqual(end('').length, 2);
  const beside = run('entity p\n  pos 0 0\n  box 1 1\n  vel 3 0\nentity c\n  pos 2 1.5\n  box 1 1\n  solid\n  push\n', { ticks: 120 }).world;
  assert.equal(fmtFx(beside.get(1, 'pos')!.x as number), '2');
});

test('push: results are the same run to run', () => {
  const sokoban = readFileSync(new URL('../examples/sokoban.kiln', import.meta.url), 'utf8');
  const input = readFileSync(new URL('../examples/sokoban.input', import.meta.url), 'utf8');
  const a = run(sokoban, { input }), b = run(sokoban, { input });
  assert.equal(a.hash, b.hash);
  assert.ok(a.ok, a.expects.map((e) => `${e.text} ${e.ok} ${e.note}`).join('; '));
});

test('ride: a body standing on a moving solid goes with it, and stays put when it steps off', () => {
  const scene = 'world gravity=0,30\n' +
    'entity rider\n  pos 2.5 3\n  box 1 1\n  vel\n  body\n' +
    'entity lift\n  pos 2 4\n  box 2 0.5\n  solid\n  vel\n  pace x 2 8 3\n' +
    'entity ground\n  pos -5 8\n  box 30 1\n  solid\n';
  const at = (ticks: number) => {
    const w = run(scene, { ticks }).world;
    return [fmtFx(w.get(0, 'pos')!.x as number), fmtFx(w.get(1, 'pos')!.x as number), w.get(0, 'body')!.ride];
  };
  // The first tick is spent landing; from then on the rider keeps its place on the lift.
  const [rx, lx, on] = at(100);
  assert.equal(on, 'lift');
  assert.ok(Math.abs(Number(rx) - Number(lx) - 0.5) < 0.1, `rider ${rx} lift ${lx}`);
  const turned = at(260);
  assert.equal(turned[2], 'lift');
  assert.ok(Math.abs(Number(turned[0]) - Number(turned[1]) - 0.5) < 0.1, `after the turn: rider ${turned[0]} lift ${turned[1]}`);
});

test('view: an entity that covers no cell centre is still shown', () => {
  const w = parseScene('entity floor\n  pos 0 1\n  box 4 1\n  solid\nentity bug\n  pos 1.6 0.1\n  box 0.8 0.8\n  vel\n  sprite @\n').world;
  assert.equal(view(w), 'origin 0,0\n..@.\n####\n');
});
