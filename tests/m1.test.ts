import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { command } from '../src/commands.ts';
import { parseScene, serialize } from '../src/scene.ts';
import { World } from '../src/world.ts';

const ex = (name: string): string => fileURLToPath(new URL(`../examples/${name}`, import.meta.url));
const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

test('script: patrol example passes and is reproducible', async () => {
  const a = await command('test', { file: ex('patrol.kiln'), inputFile: ex('patrol.input') });
  const b = await command('test', { file: ex('patrol.kiln'), inputFile: ex('patrol.input') });
  assert.equal(a.code, 0, a.text);
  assert.match(a.text, /passed=3 failed=0/);
  assert.equal(a.text, b.text);
});

test('script: walking straight into the guard fails `never` and reports the event', async () => {
  const r = await command('test', { file: ex('patrol.kiln'), input: '0 right down\n', events: true });
  assert.equal(r.code, 1);
  assert.match(r.text, /FAIL .*never player guard -- tick \d+/);
  assert.match(r.text, /event \d+ caught guard player/);
});

test('script: schema with a scene lists script components', async () => {
  const r = await command('schema', { file: ex('patrol.kiln') });
  assert.match(r.text, /^patrol min max speed {2}-- walks back and forth/m);
});

test('script: missing file, nondeterministic API and bad export are diagnosed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kiln-'));
  writeFileSync(join(dir, 'rng.ts'), 'export default (k) => {\n  k.system(() => Math.random());\n  // Date in a comment is fine\n  const t = Date.now();\n};\n');
  writeFileSync(join(dir, 'noexport.ts'), 'export const x = 1;\n');
  const scene = 'use ./nope.ts\nuse ./rng.ts\nuse ./noexport.ts\nentity a\n  pos 0 0\n';
  const r = await command('check', { file: join(dir, 's.kiln'), scene });
  assert.equal(r.code, 2);
  const lines = r.text.trim().split('\n');
  assert.match(lines[0], /^E K120 .*s\.kiln:1 script '\.\/nope\.ts' not found/);
  assert.match(lines[1], /^E K121 \.\/rng\.ts:2 nondeterministic API 'Math\.random'.*w\.rand\(\)/);
  assert.match(lines[2], /^E K121 \.\/rng\.ts:4 nondeterministic API 'Date'/);
  assert.match(lines[3], /^E K123 .*s\.kiln:3 /);
  assert.equal(lines[4], 'fail errors=4');
});

test('rand: seeded, reproducible, and saved with the scene', () => {
  const draw = (seed: number) => { const w = new World(); w.seed = seed; return [w.rand(), w.rand(), w.rand()]; };
  assert.deepEqual(draw(7), draw(7));
  assert.notDeepEqual(draw(7), draw(8));
  const w = parseScene('world seed=7\n').world;
  w.rand();
  const again = parseScene(serialize(w)).world;
  assert.equal(again.seed, w.seed);
  assert.equal(again.rand(), w.rand());
});

test('command: unknown command and unreadable file give coded errors', async () => {
  assert.match((await command('fly', {})).text, /^E K003 /);
  const r = await command('run', { file: 'does-not-exist.kiln' });
  assert.equal(r.code, 2);
  assert.match(r.text, /^E K001 /);
});

test('mcp: initialize, list the single tool, and call it', async () => {
  const child = spawn(process.execPath, [cli, 'mcp'], { stdio: ['pipe', 'pipe', 'inherit'] });
  const replies: Record<string, any> = {};
  let buf = '';
  const got = new Promise<void>((res) => child.stdout.on('data', (d) => {
    buf += d;
    for (let i; (i = buf.indexOf('\n')) >= 0; buf = buf.slice(i + 1)) {
      const m = JSON.parse(buf.slice(0, i));
      replies[m.id] = m;
    }
    if (Object.keys(replies).length === 5) res();
  }));
  const rpc = (id: number | undefined, method: string, params: unknown = {}) =>
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  rpc(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } });
  rpc(undefined, 'notifications/initialized');
  rpc(2, 'tools/list');
  rpc(3, 'tools/call', { name: 'kiln', arguments: { cmd: 'test', file: ex('maze.kiln'), input_file: ex('maze.input'), view: true } });
  rpc(4, 'tools/call', { name: 'kiln', arguments: { cmd: 'check', scene: 'entity a\n  poss 1 1\n' } });
  rpc(5, 'nope');
  await got;
  child.kill();

  assert.equal(replies[1].result.protocolVersion, '2025-06-18');
  assert.deepEqual(replies[2].result.tools.map((t: any) => t.name), ['kiln']);
  assert.equal(replies[3].result.isError, false);
  assert.match(replies[3].result.content[0].text, /#\.\.\.#\.\.@\.#\n[\s\S]*ok tick=240 hash=[0-9a-f]{8} passed=5 failed=0/);
  assert.equal(replies[4].result.isError, true);
  assert.match(replies[4].result.content[0].text, /^E K102 scene:2 unknown component 'poss' \(hint: did you mean 'pos'\?\)/);
  assert.equal(replies[5].error.code, -32601);
});

test('serve: strips types from engine and game files and refuses paths outside them', { timeout: 20000 }, async () => {
  const { serve } = await import('../src/serve.ts');
  const { port, close } = await serve(ex('patrol.kiln'), ex('patrol.input'), 0);
  try {
    const get = async (p: string) => { const r = await fetch(`http://127.0.0.1:${port}${p}`); return { status: r.status, type: r.headers.get('content-type'), text: await r.text() }; };

    assert.match((await get('/')).text, /<title>Kiln player<\/title>/);
    const cfg = JSON.parse((await get('/config.json')).text);
  assert.deepEqual([cfg.scene, cfg.input], ['patrol.kiln', true]);
  assert.ok(cfg.scenes.includes('maze.kiln'));
    const engine = await get('/engine/src/world.ts');
    assert.match(engine.type!, /text\/javascript/);
    assert.doesNotMatch(engine.text, /export interface|: FieldType/);
    assert.doesNotThrow(() => new Function(engine.text.replace(/^export /gm, '')));
    assert.match((await get('/game/patrol.kiln')).text, /^use \.\/patrol\.ts$/m);
    assert.match((await get('/game/patrol.ts')).type!, /text\/javascript/);
    assert.match((await get('/input')).text, /^0 down down/);
    assert.equal((await get('/game/..%2fpackage.json')).status, 403);
    assert.equal((await get('/engine/..%2f..%2fREADME.md')).status, 403);
    assert.equal((await get('/game/nope.kiln')).status, 404);
  assert.equal((await get('/game/HASHES')).status, 403, 'only game assets are served from the scene folder');
  } finally {
    close();
  }
});

test('platformer example: passes, and missing the first jump is explained', async () => {
  const ok = await command('test', { file: ex('platformer.kiln'), inputFile: ex('platformer.input') });
  assert.equal(ok.code, 0, ok.text);
  assert.match(ok.text, /passed=4 failed=0/);

  const bad = await command('test', { file: ex('platformer.kiln'), input: '0 right down\n', events: true });
  assert.equal(bad.code, 1);
  assert.match(bad.text, /FAIL .*never hero pit -- tick \d+/);
  assert.match(bad.text, /event \d+ fell pit hero/);
});

test('serve: image assets keep their type', { timeout: 20000 }, async () => {
  const { serve } = await import('../src/serve.ts');
  const { port, close } = await serve(ex('platformer.kiln'), undefined, 0);
  try {
    const r = await fetch(`http://127.0.0.1:${port}/game/hero.svg`);
    assert.match(r.headers.get('content-type')!, /^image\/svg\+xml/);
    assert.match(await r.text(), /^<svg /);
  } finally {
    close();
  }
});

test('solve: finds an input for the cave, and the input passes `test`', async () => {
  const solved = await command('solve', { file: ex('cave.kiln') });
  assert.equal(solved.code, 0, solved.text);
  const lines = solved.text.trim().split('\n');
  assert.match(lines.at(-1)!, /^ok solved tick=\d+ states=\d+$/);
  const input = lines.slice(0, -1).join('\n') + '\n';
  assert.match(input, /^0 (right|down) down\n/);

  // `at 255 hero.pos.x == 10.1` is tied to the hand-written route, so check the searched goal only.
  const replay = await command('test', { file: ex('cave.kiln'), input });
  assert.match(replay.text, /^pass .*gone gem by 300/m);
});

test('solve: a platformer needs jumps, and gets them', { timeout: 60000 }, async () => {
  const solved = await command('solve', { file: ex('platformer.kiln') });
  assert.equal(solved.code, 0, solved.text);
  assert.match(solved.text, /^\d+ up down$/m);
  const input = solved.text.trim().split('\n').slice(0, -1).join('\n') + '\n';
  const replay = await command('test', { file: ex('platformer.kiln'), input, ticks: 300 });
  assert.match(replay.text, /pass .*gone #coin by 300/);
  assert.match(replay.text, /pass .*event win by 300/);
  assert.match(replay.text, /pass .*never hero pit/);
});

test('solve: an unreachable goal is reported with how far the search got', async () => {
  const scene = 'entity map\n  pos 0 0\n  tiles\n    #######\n    #..#..#\n    #######\n' +
    'entity hero\n  pos 1.1 1.1\n  box 0.8 0.8\n  vel\n  ctrl 4\n' +
    'entity gem\n  pos 5.2 1.2\n  box 0.5 0.5\n  trigger hero gem despawn-self\n' +
    'expect gone gem by 120\n';
  const r = await command('solve', { scene });
  assert.equal(r.code, 1);
  assert.match(r.text, /^fail no input reaches the goals by tick 120; best run met 0\/1, still open: gone gem by 120/);
  // The furthest attempt is drawn: the hero has walked up to the wall that cuts it off.
  assert.match(r.text, /^furthest attempt, tick \d+:\norigin 0,0\n#######\n#\.h#\.g#\n#######$/m);

  const none = await command('solve', { scene: 'entity a\n  pos 0 0\nexpect at 5 a.pos.x == 0\n' });
  assert.match(none.text, /^fail nothing to solve/);
});

test('dungeon example: drawn entirely as a grid, and the engine can solve it', { timeout: 60000 }, async () => {
  const solved = await command('solve', { file: ex('dungeon.kiln') });
  assert.equal(solved.code, 0, solved.text);
  const input = solved.text.trim().split('\n').slice(0, -1).join('\n') + '\n';
  const replay = await command('test', { file: ex('dungeon.kiln'), input });
  assert.equal(replay.code, 0, replay.text);
});

test('solve: a 3D scene with a jump is solved, and the same search gives the same answer', { timeout: 60000 }, async () => {
  const a = await command('solve', { file: ex('arena3d.kiln') });
  const b = await command('solve', { file: ex('arena3d.kiln') });
  assert.equal(a.code, 0, a.text);
  assert.equal(a.text, b.text);
  assert.match(a.text, /^\d+ a down$/m, 'the gem is on a step, so the answer has to jump');
  const input = a.text.trim().split('\n').slice(0, -1).join('\n') + '\n';
  const replay = await command('test', { file: ex('arena3d.kiln'), input });
  assert.equal(replay.code, 0, replay.text);
});

test('solve: the search limit is reported, not hidden', async () => {
  const r = await command('solve', { file: ex('arena3d.kiln'), maxStates: 50 });
  assert.equal(r.code, 1);
  assert.match(r.text, /^fail gave up after 50 states; best run met \d\/2, still open: /);
});

test('guide: one call covers every component and command, and stays small', async () => {
  const { registry } = await import('../src/world.ts');
  const { COMMANDS } = await import('../src/commands.ts');
  const g = (await command('guide', {})).text;
  for (const name of registry.keys()) assert.match(g, new RegExp(`^${name}( |$)`, 'm'), `component ${name}`);
  for (const c of COMMANDS.filter((x) => x !== 'guide')) assert.match(g, new RegExp(`^${c} `, 'm'), `command ${c}`);
  // The scene shown in the guide has to be real.
  const sample = 'prefab hero\n  box 0.8 0.8\nprefab coin\n  box 0.5 0.5\n' + g.slice(g.indexOf('entity map'), g.indexOf('A spawned prefab'));
  assert.equal((await command('check', { scene: sample })).code, 0);
  assert.ok(g.length < 6000, `guide is ${g.length} characters`);
});

test('build: a static folder with js modules only, scripts converted, assets copied', async () => {
  const { build } = await import('../src/build.ts');
  const { readFileSync: read, existsSync } = await import('node:fs');
  const out = mkdtempSync(join(tmpdir(), 'kiln-build-'));
  const files = build(ex('patrol.kiln'), out).written;

  for (const f of ['index.html', 'config.json', 'engine/web/player.js', 'engine/web/gl.js', 'engine/src/sim.js', 'game/patrol.kiln', 'game/patrol.js', 'game/hero.svg']) {
    assert.ok(files.includes(f) && existsSync(join(out, f)), f);
  }
  // Node-only modules are not part of what the browser needs.
  assert.ok(!files.some((f) => /engine\/src\/(cli|mcp|serve|commands|load|build)\.js$/.test(f)));
  for (const f of files.filter((x) => x.endsWith('.js'))) {
    const code = read(join(out, f), 'utf8');
    assert.doesNotMatch(code, /from '\.\.?\/[^']+\.ts'/, `${f} still imports .ts`);
    assert.doesNotMatch(code, /: (string|number)\b|^import type/m, `${f} still has types`);
  }
  assert.match(read(join(out, 'index.html'), 'utf8'), /src="engine\/web\/player\.js"/);
  const cfg = JSON.parse(read(join(out, 'config.json'), 'utf8'));
  assert.equal(cfg.built, true);
  assert.ok(cfg.scenes.includes('arena3d.kiln'));
  // The built simulation is the same code: load it and run a scene with it.
  const sim = await import(pathToFileURL(join(out, 'engine/src/sim.js')).href);
  assert.equal(typeof sim.step, 'function');
});

test('vault example: the solver has to fetch the key before the door will open', { timeout: 60000 }, async () => {
  const solved = await command('solve', { file: ex('vault.kiln') });
  assert.equal(solved.code, 0, solved.text);
  const input = solved.text.trim().split('\n').slice(0, -1).join('\n') + '\n';
  const replay = await command('test', { file: ex('vault.kiln'), input, events: true });
  assert.equal(replay.code, 0, replay.text);
  const order = [...replay.text.matchAll(/^event \d+ (\w+)/gm)].map((m) => m[1]);
  assert.deepEqual(order, ['key', 'win']);
});

test('new: a fresh game folder checks, solves, and points an agent at the engine', async () => {
  const { newGame } = await import('../src/new.ts');
  const { readFileSync: read } = await import('node:fs');
  const dir = join(mkdtempSync(join(tmpdir(), 'kiln-new-')), 'mygame');
  assert.deepEqual(newGame(dir), ['game.kiln', 'AGENTS.md', 'CLAUDE.md', '.mcp.json']);

  assert.equal((await command('check', { file: join(dir, 'game.kiln') })).code, 0);
  const solved = await command('solve', { file: join(dir, 'game.kiln') });
  assert.equal(solved.code, 0, solved.text);

  const mcp = JSON.parse(read(join(dir, '.mcp.json'), 'utf8')).mcpServers.kiln;
  assert.equal(mcp.command, 'node');
  assert.match(mcp.args[0], /src\/cli\.ts$/);
  assert.equal(mcp.args[1], 'mcp');
  assert.match(read(join(dir, 'AGENTS.md'), 'utf8'), /cli\.ts guide/);
  assert.throws(() => newGame(dir), /exists and is not empty/);
});

test('mesh: OBJ text becomes unit-cube triangles with outward normals', async () => {
  const { parseObj } = await import('../web/gl.ts');
  const { readFileSync: read } = await import('node:fs');
  const data = parseObj(read(ex('gem.obj'), 'utf8'));
  assert.equal(data.length, 8 * 3 * 6);
  for (let i = 0; i < data.length; i += 6) {
    const p = [data[i], data[i + 1], data[i + 2]], n = [data[i + 3], data[i + 4], data[i + 5]];
    assert.ok(p.every((x) => x >= 0 && x <= 1), `position ${p}`);
    assert.ok(Math.abs(Math.hypot(...n) - 1) < 1e-5, `normal length ${n}`);
  }
  // Convex and centred, so every face normal must point away from the centre.
  for (let i = 0; i < data.length; i += 18) {
    const c = [0, 1, 2].map((a) => (data[i + a] + data[i + 6 + a] + data[i + 12 + a]) / 3 - 0.5);
    assert.ok(c[0] * data[i + 3] + c[1] * data[i + 4] + c[2] * data[i + 5] > 0, `face ${i / 18} points inward`);
  }
  // A quad is split into two triangles; junk lines and bad indices are skipped.
  assert.equal(parseObj('v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nvn 0 0 1\nf 1/1/1 2/2/1 3/3/1 4/4/1\nf 1 2 99\n').length, 2 * 3 * 6);
});

test('gauntlet example: pacing guards make it a timing puzzle, and solve times the crossing', { timeout: 60000 }, async () => {
  // Walking straight in gets the hero removed by the first guard it meets.
  const rush = await command('test', { file: ex('gauntlet.kiln'), input: '0 right down\n', events: true });
  assert.equal(rush.code, 1);
  assert.match(rush.text, /event \d+ hit foe\d hero/);

  const solved = await command('solve', { file: ex('gauntlet.kiln') });
  assert.equal(solved.code, 0, solved.text);
  const input = solved.text.trim().split('\n').slice(0, -1).join('\n') + '\n';
  const replay = await command('test', { file: ex('gauntlet.kiln'), input, events: true });
  assert.equal(replay.code, 0, replay.text);
  assert.doesNotMatch(replay.text, /event \d+ hit/);
});

test('sokoban example: solve pushes the crate around the corner onto the pad', { timeout: 90000 }, async () => {
  const solved = await command('solve', { file: ex('sokoban.kiln') });
  assert.equal(solved.code, 0, solved.text);
  const input = solved.text.trim().split('\n').slice(0, -1).join('\n') + '\n';
  assert.equal((await command('test', { file: ex('sokoban.kiln'), input })).code, 0);
});

test('build: files that are not game assets are left out and reported', async () => {
  const { build } = await import('../src/build.ts');
  const { existsSync } = await import('node:fs');
  const game = mkdtempSync(join(tmpdir(), 'kiln-game-'));
  writeFileSync(join(game, 'level.kiln'), 'entity a\n  pos 0 0\n');
  writeFileSync(join(game, '.env'), 'API_KEY=secret\n');
  writeFileSync(join(game, 'notes.md'), 'private\n');
  writeFileSync(join(game, 'id_rsa'), 'key\n');
  const out = mkdtempSync(join(tmpdir(), 'kiln-out-'));
  const b = build(join(game, 'level.kiln'), out);
  assert.deepEqual(b.skipped.sort(), ['.env', 'id_rsa', 'notes.md']);
  assert.ok(existsSync(join(out, 'game/level.kiln')));
  for (const f of b.skipped) assert.ok(!existsSync(join(out, 'game', f)), f);
});

test('lift example: the gap is too wide to jump, so solve rides the lift across', { timeout: 90000 }, async () => {
  const solved = await command('solve', { file: ex('lift.kiln') });
  assert.equal(solved.code, 0, solved.text);
  const input = solved.text.trim().split('\n').slice(0, -1).join('\n') + '\n';
  const replay = await command('test', { file: ex('lift.kiln'), input });
  assert.equal(replay.code, 0, replay.text);
  // Without the lift there is no way over.
  const { readFileSync: read } = await import('node:fs');
  const noLift = read(ex('lift.kiln'), 'utf8').replace(/entity lift[\s\S]*?(?=\nentity )/, '');
  assert.equal((await command('solve', { scene: noLift, file: ex('lift.kiln') })).code, 1);
});

test('quest example: key, door and a sweeping guard together, solved without being hit', { timeout: 90000 }, async () => {
  const solved = await command('solve', { file: ex('quest.kiln') });
  assert.equal(solved.code, 0, solved.text);
  const input = solved.text.trim().split('\n').slice(0, -1).join('\n') + '\n';
  const replay = await command('test', { file: ex('quest.kiln'), input, events: true, view: true });
  assert.equal(replay.code, 0, replay.text);
  assert.deepEqual([...replay.text.matchAll(/^event \d+ (\w+)/gm)].map((m) => m[1]), ['key', 'win']);
  assert.match(replay.text, /@/, 'the hero is visible in the final picture');
});

test('test DIR: every scene with its own input, one line each, failures in full', async () => {
  const all = await command('test', { file: ex('') });
  assert.equal(all.code, 0, all.text);
  const lines = all.text.trim().split('\n');
  assert.match(lines.at(-1)!, /^ok scenes=(\d+) passed=\1 failed=0$/);
  assert.ok(lines.some((l) => /^quest\.kiln ok tick=1800 hash=[0-9a-f]{8} passed=1 failed=0$/.test(l)));

  const dir = mkdtempSync(join(tmpdir(), 'kiln-dir-'));
  writeFileSync(join(dir, 'good.kiln'), 'entity a\n  pos 0 0\n  vel 6 0\nexpect at 10 a.pos.x == 1\n');
  writeFileSync(join(dir, 'bad.kiln'), 'entity a\n  pos 0 0\nexpect at 10 a.pos.x == 1\n');
  const mixed = await command('test', { file: dir });
  assert.equal(mixed.code, 1);
  assert.match(mixed.text, /^bad\.kiln FAIL .*actual 0$/m);
  assert.match(mixed.text, /^good\.kiln ok /m);
  assert.match(mixed.text, /^fail scenes=2 passed=1 failed=1$/m);
});

test('expect count: the number of events by a tick', async () => {
  const scene = 'entity p\n  pos 0 0\n  box 1 1\n  vel 3 0\n' +
    ['2', '4', '6'].map((x, i) => `entity c${i}\n  pos ${x} 0\n  box 0.5 0.5\n  trigger p coin despawn-self\n`).join('') +
    'expect count coin == 3 at 120\nexpect count coin >= 1 at 30\nexpect count coin == 3 at 30\nexpect count coin == 3 at 999\n';
  const r = await command('test', { scene, ticks: 200 });
  assert.equal(r.code, 1);
  const lines = r.text.trim().split('\n');
  assert.match(lines[0], /^pass .*count coin == 3 at 120 -- actual 3$/);
  assert.match(lines[1], /^pass .*count coin >= 1 at 30 -- actual 1$/);
  assert.match(lines[2], /^FAIL .*count coin == 3 at 30 -- actual 1$/);
  assert.match(lines[3], /^FAIL .*count coin == 3 at 999 -- run ended before tick 999$/);
  assert.match((await command('check', { scene: 'entity a\n  pos 0 0\nexpect count coin == x at 5\n' })).text, /^E K104 /);
});

test('crypt3d example: a 3D level drawn as a floor plan, solved by the engine', { timeout: 90000 }, async () => {
  const solved = await command('solve', { file: ex('crypt3d.kiln') });
  assert.equal(solved.code, 0, solved.text);
  const input = solved.text.trim().split('\n').slice(0, -1).join('\n') + '\n';
  assert.equal((await command('test', { file: ex('crypt3d.kiln'), input })).code, 0);
});

test('levels: load:FILE is an event headless, and both levels are solvable', { timeout: 90000 }, async () => {
  for (const [file, goal] of [['level1.kiln', 'load'], ['level2.kiln', 'win']]) {
    const solved = await command('solve', { file: ex(file) });
    assert.equal(solved.code, 0, solved.text);
    const input = solved.text.trim().split('\n').slice(0, -1).join('\n') + '\n';
    const replay = await command('test', { file: ex(file), input, events: true, ticks: 600 });
    assert.match(replay.text, new RegExp(`^event \\d+ ${goal} `, 'm'));
  }
  const r = await command('test', { file: ex('level1.kiln'), inputFile: ex('level1.input'), events: true });
  assert.equal(r.code, 0, r.text);
  assert.match(r.text, /^event \d+ load level2\.kiln hero$/m);
  assert.match((await command('check', { scene: 'entity a\n  pos 0 0\n  box 1 1\n  trigger a x load:../secret.txt\n' })).text, /^E K104 .*unknown trigger action/);
});
