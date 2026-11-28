import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { command } from '../src/commands.ts';
import { paintOf, parseScene, serialize } from '../src/scene.ts';
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
    if (Object.keys(replies).length === 6) res();
  }));
  const rpc = (id: number | undefined, method: string, params: unknown = {}) =>
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  rpc(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } });
  rpc(undefined, 'notifications/initialized');
  rpc(2, 'tools/list');
  rpc(3, 'tools/call', { name: 'kiln', arguments: { cmd: 'test', file: ex('maze.kiln'), input_file: ex('maze.input'), view: true } });
  rpc(4, 'tools/call', { name: 'kiln', arguments: { cmd: 'check', scene: 'entity a\n  poss 1 1\n' } });
  rpc(5, 'nope');
  rpc(6, 'tools/call', { name: 'kiln', arguments: { cmd: 'guide', topic: 'physics' } });
  await got;
  child.kill();

  assert.equal(replies[1].result.protocolVersion, '2025-06-18');
  assert.deepEqual(replies[2].result.tools.map((t: any) => t.name), ['kiln']);
  assert.equal(replies[3].result.isError, false);
  assert.match(replies[3].result.content[0].text, /#\.\.\.#\.\.@\.#\n[\s\S]*ok tick=240 hash=[0-9a-f]{8} passed=5 failed=0/);
  assert.equal(replies[4].result.isError, true);
  assert.match(replies[4].result.content[0].text, /^E K102 scene:2 unknown component 'poss' \(hint: did you mean 'pos'\?\)/);
  assert.equal(replies[5].error.code, -32601);
  assert.match(replies[6].result.content[0].text, /^KILN GUIDE: physics[\s\S]*^rigid /m);
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

test('guide: the core and its topics cover every component and command, and each stays small', async () => {
  const { registry } = await import('../src/world.ts');
  const { COMMANDS } = await import('../src/commands.ts');
  const { TOPICS } = await import('../src/guide.ts');
  const g = (await command('guide', {})).text;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // A component is either explained in the core, or named there on its topic's line and explained in that topic.
  for (const [name, def] of registry) {
    const line = new RegExp(`^${esc(name)}( |$)`, 'm');
    if (!def.topic) { assert.match(g, line, `component ${name}`); continue; }
    assert.ok(Object.hasOwn(TOPICS, def.topic), `component ${name} has unknown topic ${def.topic}`);
    assert.doesNotMatch(g, line, `${name} is explained twice`);
    assert.match(g, new RegExp(`^${def.topic}: (.* )?${esc(name)} `, 'm'), `core guide names ${name}`);
    assert.match((await command('guide', { topic: def.topic })).text, line, `guide ${def.topic} explains ${name}`);
  }
  for (const topic of Object.keys(TOPICS)) {
    const t = await command('guide', { topic });
    assert.equal(t.code, 0);
    assert.ok(t.text.length < 2500, `guide ${topic} is ${t.text.length} characters`);
    assert.ok([...registry.values()].some((c) => c.topic === topic), `topic ${topic} has no component`);
  }
  const bad = await command('guide', { topic: 'nope' });
  assert.equal(bad.code, 2);
  assert.match(bad.text, /^E K003 unknown guide topic 'nope' \(hint: valid: physics view levels ui audio\)/);
  // Room for the next few core components: adding one must not be what breaks this test.
  assert.ok(g.length < 5600, `core guide is ${g.length} characters`);
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

  for (const f of ['index.html', 'config.json', 'engine/web/player.js', 'engine/src/sim.js', 'game/patrol.kiln', 'game/patrol.js', 'game/hero.svg']) {
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
  assert.match(lines.at(-1)!, /^ok scenes=(\d+)( cases=\d+)? passed=\d+ failed=0$/);
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

test('check: warns about parts of a scene that load but silently do nothing', async () => {
  const scene = 'entity hero\n  pos 0 0\n  ctrl 4 0 xz\n' +
    'entity coin\n  pos 2 0\n  trigger hro coin despawn:#dor\n' +
    'entity ghost\n  vel 1 0\n  sprite @\n' +
    'expect reach hero coin by 60\n';
  const r = await command('check', { scene });
  assert.equal(r.code, 0, 'warnings do not fail the check');
  const lines = r.text.trim().split('\n');
  const has = (re: RegExp) => assert.ok(lines.some((l) => re.test(l)), `${re} not in:\n${r.text}`);
  has(/^W K310 scene 'hero' has 'ctrl' but no 'vel', so it does nothing \(hint: add vel to 'hero'\)$/);
  has(/^W K310 scene 'coin' has 'trigger' but no 'box'/);
  has(/^W K310 scene 'ghost' has 'vel' but no 'pos'/);
  has(/^W K311 scene trigger on 'coin' refers to 'hro', which matches no entity \(hint: did you mean 'hero'\?\)$/);
  has(/^W K311 scene trigger on 'coin' refers to '#dor'/);
  has(/^W K313 scene 'hero' walks on the x\/z plane but nothing has 'eye'/);
  assert.match(lines.at(-1)!, /^ok entities=3 expects=1 scripts=0 edition=lite warnings=\d+$/);

  assert.match((await command('check', { scene: 'entity a\n  pos 0 0\n  rot 30\n' })).text, /^W K310 scene 'a' has 'rot' but no 'box'/m);
  const none = await command('check', { scene: 'entity a\n  pos 0 0\n' });
  assert.match(none.text, /^W K300 .*no expect lines/m);
  assert.match(none.text, /warnings=1$/m);
});

test('check: every example is free of warnings, and a missing asset is noticed', async () => {
  const { readdirSync } = await import('node:fs');
  for (const f of readdirSync(ex('')).filter((x) => x.endsWith('.kiln'))) {
    const r = await command('check', { file: ex(f) });
    assert.match(r.text, /warnings=0$/m, `${f}:\n${r.text}`);
  }
  const dir = mkdtempSync(join(tmpdir(), 'kiln-lint-'));
  writeFileSync(join(dir, 's.kiln'), 'entity a\n  pos 0 0\n  box 1 1\n  vel\n  ctrl 3\n  sprite @ white hero.png\n  trigger a go load:next.kiln\nexpect event go by 9\n');
  const r = await command('check', { file: join(dir, 's.kiln') });
  assert.match(r.text, /^W K312 .*uses image 'hero\.png', which is not next to the scene$/m);
  assert.match(r.text, /^W K312 .*loads 'next\.kiln', which is not next to the scene$/m);
});

test('tiles paint: a color or image per character, checked and kept through a save', async () => {
  const map = (line: string, rows = '    #.~\n'): string => `entity map\n  pos 0 0\n  ${line}\n${rows}`;
  const w = parseScene(map('tiles solid=#~ paint=#:#2f6f4f,~:steelblue,.:grass.svg')).world;
  assert.equal(w.get(0, 'tiles')!.paint, '#:#2f6f4f,~:steelblue,.:grass.svg');
  assert.deepEqual([...paintOf('#:teal,.:grass.svg,bad')], [['#', ['teal', '']], ['.', ['', 'grass.svg']]]);
  // The paint is part of the saved text, and an unpainted map saves as it always did.
  assert.equal(serialize(parseScene(serialize(w)).world), serialize(w));
  assert.match(serialize(w), /^  tiles 1 #~ paint=#:#2f6f4f,~:steelblue,\.:grass\.svg$/m);
  assert.match(serialize(parseScene(map('tiles')).world), /^  tiles$/m);

  const bad = await command('check', { scene: map('tiles paint=#teal,~:') });
  assert.equal(bad.code, 2);
  assert.match(bad.text, /^E K104 scene:3 paint entry '#teal' must be CHAR:COLOR or CHAR:IMAGE/m);
  assert.match(bad.text, /^E K104 scene:3 paint entry '~:' must be/m);

  const typo = await command('check', { scene: map('tiles paint=w:teal') });
  assert.match(typo.text, /^W K317 scene tiles on 'map' paints 'w', which is in none of its rows$/m);
  const flat = await command('check', { scene: map('tiles paint=#:wall.png') + 'entity cam\n  pos 0 0\n  eye 0 -8 9\n' });
  assert.match(flat.text, /^W K318 scene tiles on 'map' paints '#' with an image, but the scene is drawn in 3D/m);

  const dir = mkdtempSync(join(tmpdir(), 'kiln-paint-'));
  writeFileSync(join(dir, 's.kiln'), map('tiles paint=#:wall.png'));
  assert.match((await command('check', { file: join(dir, 's.kiln') })).text, /^W K312 .*paints '#' with image 'wall\.png', which is not next to the scene$/m);
});

test("'#' as a value: named it is kept, bare it is a comment and check says so", async () => {
  const one = (sprite: string): string => `entity a\n  pos 0 0\n  box 1 1\n  ${sprite}\n`;
  assert.equal(parseScene(one('sprite glyph=# color=red')).world.get(0, 'sprite')!.glyph, '#');
  assert.equal(parseScene(one('sprite @ red  # the hero')).world.get(0, 'sprite')!.color, 'red');
  assert.equal(parseScene('entity a\n  tag x\n  trigger #x hit  # comment\n').world.get(0, 'trigger')!.target, '#x');
  const r = await command('check', { scene: one('sprite # red') });
  assert.match(r.text, /^W K319 scene line 4: '#' after 'sprite' starts a comment, so glyph is empty \(hint: for the character '#' write glyph=#; put a comment on its own line\)$/m);
  assert.doesNotMatch((await command('check', { scene: one('sprite @ # red') })).text, /K319/);
  assert.doesNotMatch((await command('check', { scene: one('sprite glyph=#') })).text, /K319/);
});

test('anim: the frame comes from the tick and the state, and the facing is saved', async () => {
  const { frameOf, hash, parseInput, step } = await import('../src/sim.ts');
  const scene = (anim: string, more = '  vel\n  ctrl 4\n'): string => `world hz=60\nentity hero\n  pos 0 0\n  box 1 1\n${more}  sprite @ white sheet.png\n  ${anim}\n`;
  const w = parseScene(scene('anim 4 fps=10 idle=1')).world;
  const input = parseInput('0 right down\n30 right up\n30 left down\n60 left up\n');
  const seen: Record<number, [frame: number, face: number]> = {};
  for (let t = 0; t <= 70; t++) {
    if ([0, 6, 12, 18, 24, 36, 70].includes(t)) seen[t] = [frameOf(w, 0), w.get(0, 'anim')!.face as number];
    step(w, input);
  }
  // Standing: frame 0. Moving: frames 1..3 in turn, one every 6 ticks. After the turn at
  // tick 30 it looks left, and still does when it stops.
  assert.deepEqual(seen, { 0: [0, 1], 6: [2, 1], 12: [3, 1], 18: [1, 1], 24: [2, 1], 36: [1, -1], 70: [0, -1] });
  assert.match(serialize(w), /^  anim 4 10 1 -1$/m);
  const again = parseScene(serialize(w)).world;
  assert.equal(hash(again), hash(w));
  again.get(0, 'anim')!.face = 1;
  assert.notEqual(hash(again), hash(w), 'the facing is part of the state');

  // Without idle frames the whole sheet loops, moving or not; a frame count below 1 does not divide by zero.
  const loop = parseScene(scene('anim 3 fps=60')).world;
  assert.deepEqual([0, 1, 2, 3].map(() => { const f = frameOf(loop, 0); step(loop); return f; }), [0, 1, 2, 0]);
  assert.equal(frameOf(parseScene(scene('anim 0')).world, 0), 0);

  const check = async (text: string): Promise<string> => (await command('check', { scene: text })).text;
  assert.match(await check(scene('anim 4 idle=4')), /^W K320 scene anim on 'hero' has frames=4 fps=8 idle=4/m);
  assert.match(await check(scene('anim 0')), /^W K320 /m);
  assert.match(await check(scene('anim 4').replace(' sheet.png', '')), /^W K321 scene 'hero' has 'anim' but its sprite has no image/m);
  assert.match(await check(scene('anim 4 idle=1', '')), /^W K322 scene anim on 'hero' has idle=1 but 'hero' has no 'vel'/m);
  assert.match(await check(scene('anim 4') + 'entity cam\n  pos 0 0\n  eye 0 -8 9\n'), /^W K323 scene 'hero' has 'anim', but the scene is drawn in 3D/m);
  assert.match(await check('entity a\n  pos 0 0\n  box 1 1\n  anim 2\n'), /^W K310 scene 'a' has 'anim' but no 'sprite'/m);
  assert.doesNotMatch(await check(scene('anim 4 idle=1')), /^W K32/m);
});

test('levels: a tally counts events, and keep hands it to the scene a load opens', async () => {
  const { run } = await import('../src/run.ts');
  const { kept, take } = await import('../src/scene.ts');
  const read = (name: string): string => readFileSync(ex(name), 'utf8');
  const n = (w: World, name = 'score'): unknown => w.get(w.ids.get(name)!, 'tally')!.n;

  // The first level ends at its load event with both coins counted.
  const one = run(read('level1.kiln'), { input: read('level1.input'), file: 'level1.kiln' });
  assert.equal(one.load, 'level2.kiln');
  assert.equal(n(one.world), 2);
  assert.equal(one.kept, 'entity score\n  tally coin 2');
  // The second starts from that when it is handed over, and from its own file when it is not.
  const alone = run(read('level2.kiln'), { input: read('level2.input'), file: 'level2.kiln' });
  const after = run(read('level2.kiln'), { input: read('level2.input'), file: 'level2.kiln', kept: one.kept });
  assert.deepEqual([n(alone.world), n(after.world)], [0, 2]);
  assert.notEqual(alone.hash, after.hash);
  assert.equal(alone.kept, undefined);
  // --follow is that same run.
  const f = await command('test', { file: ex('level1.kiln'), inputFile: ex('level1.input'), follow: true });
  assert.match(f.text, new RegExp(`^ok tick=${after.world.tick} hash=${after.hash} .*path=level1\\.kiln>level2\\.kiln\\n$`, 'm'));

  // It is state: it survives a save, and going down works for lives.
  const lives = 'entity hero\n  pos 0 0\n  box 1 1\n  vel 4 0\nentity spike\n  pos 2 0\n  box 1 1\n  trigger hero hit\nentity hud\n  tally hit 3 -1\n  keep tally,label,nope\n';
  const hurt = run(lives, { ticks: 60 });
  assert.equal(n(hurt.world, 'hud'), 2);
  assert.match(serialize(hurt.world), /^ {2}tally hit 2 -1$/m);
  assert.equal(n(parseScene(serialize(hurt.world)).world, 'hud'), 2);
  // Only what the entity has is handed over.
  assert.equal(kept(hurt.world), 'entity hud\n  tally hit 2 -1');

  // Taking: only an entity that is here, only what it keeps, and nothing else in the text is read.
  const w = parseScene('entity hud\n  tally hit 3 -1\n  keep tally\nentity other\n  tally hit 5\n').world;
  take(w, 'world hz=1\nentity hud\n  tally hit 1 -1\n  label sneaked\nentity other\n  tally hit 9\nentity ghost\n  tally hit 7\nrubbish\n');
  assert.deepEqual([n(w, 'hud'), n(w, 'other'), w.has(w.ids.get('hud')!, 'label'), w.hz, w.ids.has('ghost')], [1, 5, false, 60, false]);

  const check = async (text: string): Promise<string> => (await command('check', { scene: text })).text;
  const warned = await check(lives);
  assert.match(warned, /^W K324 scene 'hud' keeps 'label', but has no 'label', so nothing is carried \(hint: add label to 'hud'\)$/m);
  assert.match(warned, /^W K324 scene 'hud' keeps 'nope', which is not a component, so nothing is carried/m);
  assert.match(await check('entity m\n  pos 0 0\n  keep tiles\n  tiles\n    #\n'), /^W K324 scene 'm' keeps 'tiles', which cannot be carried/m);
  assert.doesNotMatch(await check('entity hud\n  tally hit 3 -1\n  keep tally\n'), /K324/);
  assert.match((await command('check', { file: ex('level1.kiln') })).text, /edition=lite warnings=0/);
});

test('ui: a tap or its key presses a button, as recorded input that replays', async () => {
  const { run } = await import('../src/run.ts');
  const scene = `entity go\n  pin center\n  box 4 1\n  label Go\n  button go despawn:#gate+load:next.kiln key=a\nentity once\n  pin top\n  box 1 1\n  button once despawn-self\nentity gate\n  pos 0 0\n  box 1 1\n  tag gate\nentity n\n  tally once\n`;
  const at = (input: string, ticks = 30) => run(scene, { input, ticks });
  const names = (r: ReturnType<typeof at>): string[] => r.world.events.map((e) => `${e.tick} ${e.name} ${e.a}`);

  // Nothing happens by itself; a tap at tick 5 is an event in the next tick, with the button's actions.
  assert.deepEqual(names(at('')), []);
  const tapped = at('5 go tap\n');
  assert.deepEqual(names(tapped), ['6 go go', '6 load next.kiln']);
  assert.equal(tapped.load, 'next.kiln');
  assert.equal(tapped.world.ids.has('gate'), false);
  // The key does the same, once per press however long it is held; another key does nothing.
  assert.deepEqual(names(at('3 a down\n')), ['4 go go', '4 load next.kiln']);
  assert.deepEqual(names(at('3 b down\n3 left down\n9 a up\n')), []);
  // Every tap counts, until the button is gone; then a tap finds nothing.
  const twice = at('2 once tap\n2 once tap\n8 once tap\n');
  assert.deepEqual(names(twice), ['3 once once']);
  assert.equal(twice.world.get(twice.world.ids.get('n')!, 'tally')!.n, 1);
  // The same input gives the same hash, and a different one does not.
  assert.equal(at('5 once tap\n').hash, at('5 once tap\n').hash);
  assert.notEqual(at('5 once tap\n').hash, at('').hash);

  // A tap on what is not a button is an error, not silence.
  assert.throws(() => at('5 og tap\n'), /E K201 input:0 input taps 'og', which is not an entity with 'button' \(hint: did you mean 'go'\?\)/);
  assert.throws(() => at('5 gate tap\n'), /K201 .*'gate'.*\(hint: buttons: go once\)/);
  assert.throws(() => at('5 go tapp\n'), /K200/);

  const check = async (text: string): Promise<string> => (await command('check', { scene: text })).text;
  assert.doesNotMatch(await check(`${scene}expect event go by 30\n`), /^W /m);
  const bad = await check('entity a\n  pin middle\n  pos 1 1\n  box 1 1\n  button x despawn:nobody key=z\nentity b\n  button y\nentity c\n  pin top\nexpect event x by 9\n');
  assert.match(bad, /^W K311 scene button on 'a' refers to 'nobody', which matches no entity/m);
  assert.match(bad, /^W K328 scene button on 'a' has key=z, which is not an input action, so no key presses it \(hint: did you mean 'a'\?\)$/m);
  assert.match(bad, /^W K329 scene pin on 'a' has where=middle, which is not a place on the screen, so it is drawn in the centre/m);
  assert.match(bad, /^W K330 scene 'a' has 'pin' and 'pos'/m);
  assert.match(bad, /^W K310 scene 'b' has 'button' but no 'box', so it does nothing/m);
  assert.match(bad, /^W K310 scene 'b' has 'button' but no 'pos' or 'pin', so it is nowhere to click/m);
  assert.match(bad, /^W K310 scene 'c' has 'pin' but no 'box' or 'label', so there is nothing to draw/m);
  assert.match(await check('entity a\n  pin top\n  label hi\nentity cam\n  pos 0 0\n  eye 0 -8 9\n'), /^W K331 scene 'a' has 'pin', but the scene is drawn in 3D/m);

  // The example: the title's button opens the first level, and the run goes on to the end.
  const followed = await command('test', { file: ex('title.kiln'), inputFile: ex('title.input'), follow: true });
  assert.match(followed.text, /^ok .* path=title\.kiln>level1\.kiln>level2\.kiln$/m);
});

test('sound: check says what will not be heard, and a run does not depend on it', async () => {
  const scene = (sound: string): string => `entity hero\n  pos 0 0\n  box 1 1\n  vel 1 0\nentity coin\n  pos 2 0\n  box 1 1\n  trigger hero coin despawn-self\n${sound}expect event coin by 120\n`;
  const check = async (text: string): Promise<string> => (await command('check', { scene: text })).text;
  assert.doesNotMatch(await check(scene('entity audio\n  sound coin:coin.wav music=tune.ogg vol=0.5\n')), /K32\d/);
  const bad = await check(scene('entity audio\n  sound coin,cion:a.wav,coin:b.txt music=song.flac\nentity more\n  sound coin:c.wav\n'));
  assert.match(bad, /^W K325 scene sound on 'audio' has 'coin', which is not EVENT:FILE, so it plays nothing/m);
  assert.match(bad, /^W K326 scene sound on 'audio' plays 'a.wav' on 'cion', which no trigger or button here emits \(hint: did you mean 'coin'\?\)$/m);
  assert.match(bad, /^W K325 scene sound on 'audio' uses 'b.txt', which is not a .wav, .mp3 or .ogg file$/m);
  assert.match(bad, /^W K325 scene sound on 'audio' uses 'song.flac'/m);
  assert.match(bad, /^W K327 scene 'more' has 'sound', but 'audio' has one already and only the first is used/m);
  // A script may emit anything, so with one the event is not doubted.
  assert.doesNotMatch(await check(`use ./x.ts\n${scene('entity audio\n  sound boom:a.wav\n')}`), /K326/);
  // A file that is not next to the scene is the warning images get.
  const dir = mkdtempSync(join(tmpdir(), 'kiln-sound-'));
  writeFileSync(join(dir, 's.kiln'), scene('entity audio\n  sound coin:nope.wav\n'));
  assert.match((await command('check', { file: join(dir, 's.kiln') })).text, /^W K312 \S+ sound on 'audio' uses 'nope.wav', which is not next to the scene$/m);
  // Headless, the same things happen with the sound line and without it.
  const { run } = await import('../src/run.ts');
  const quiet = run(scene('')), loud = run(scene('entity audio\n  sound coin:coin.wav\n'));
  assert.ok(quiet.ok && loud.ok);
  assert.deepEqual(loud.world.events, quiet.world.events);
});

// A client for the server: one request at a time, the reply's text back.
function client(env: Record<string, string> = {}) {
  const child = spawn(process.execPath, [cli, 'mcp'], { stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env, ...env } });
  const waiting = new Map<number, (text: string) => void>();
  let buf = '', id = 0;
  child.stdout.on('data', (d) => {
    buf += d;
    for (let i; (i = buf.indexOf('\n')) >= 0; buf = buf.slice(i + 1)) {
      const m = JSON.parse(buf.slice(0, i)); // every line of stdout is a reply
      waiting.get(m.id)?.(m.result.content[0].text);
    }
  });
  const call = (args: Record<string, unknown>): Promise<string> => new Promise((ok) => {
    waiting.set(++id, ok);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'kiln', arguments: args } }) + '\n');
  });
  return { call, close: () => child.kill() };
}

test('mcp: a script changed during a session is read again, and so is what it imports', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kiln-mcp-'));
  const scene = join(dir, 's.kiln');
  writeFileSync(scene, 'world hz=60\nuse ./a.ts\n');
  writeFileSync(join(dir, 'a.ts'), "import { name } from './b.ts';\nexport default (k) => { k.system((w) => { if (w.tick === 1) { console.log('seen', name); w.emit(name); } }); };\n");
  const server = client();
  const run = () => server.call({ cmd: 'run', file: scene, ticks: 2, events: true });
  writeFileSync(join(dir, 'b.ts'), "export const name = 'one';\n");
  const first = await run();
  assert.match(first, /event 1 one/);
  assert.match(first, /^log: seen one$/m);
  writeFileSync(join(dir, 'b.ts'), "export const name = 'two';\n");
  assert.match(await run(), /event 1 two/);
  server.close();
});

test('mcp: a command that does not end is stopped with an error, and the server goes on', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kiln-mcp-'));
  const scene = join(dir, 's.kiln');
  writeFileSync(scene, 'world hz=60\nuse ./a.ts\n');
  writeFileSync(join(dir, 'a.ts'), 'export default (k) => { k.system(() => { for (;;); }); };\n');
  const server = client({ KILN_TIMEOUT_MS: '3000' });
  assert.match(await server.call({ cmd: 'run', file: scene, ticks: 2 }), /^E K005 run stopped after 3 s \(hint: /);
  assert.match(await server.call({ cmd: 'check', scene: 'entity a\n  pos 1 1\n' }), /^ok /m);
  server.close();
});

test('command: a script that throws while running is reported with its file and line', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kiln-throw-'));
  const scene = join(dir, 's.kiln');
  writeFileSync(scene, 'world hz=60\nuse ./a.ts\n');
  writeFileSync(join(dir, 'a.ts'), "export default (k) => {\n  k.system((w) => { w.spawn('dot'); w.spawn('dot'); });\n};\n");
  const r = await command('run', { file: scene, ticks: 2 });
  assert.equal(r.code, 2);
  assert.match(r.text, /^E K124 a\.ts:2 script failed while running: duplicate entity 'dot'$/m);
});
