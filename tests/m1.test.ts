import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
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
    assert.deepEqual(JSON.parse((await get('/config.json')).text), { scene: 'patrol.kiln', input: true });
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
