import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { canBuildSea, desktop, hideConsole, portOf, stage } from '../src/desktop.ts';

const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));
const LAUNCHER = here('../src/launcher.cjs');
const SCENE = here('../examples/maze.kiln');

const temp = (): string => mkdtempSync(join(tmpdir(), 'kiln-test-desktop-'));

test('desktop: the launcher serves every file of the staged game and nothing else', async () => {
  const dir = temp();
  try {
    const { files, title } = stage(SCENE, dir);
    assert.equal(title, 'maze');
    assert.ok(files.includes('index.html') && files.includes('game/maze.kiln'));
    assert.match(execFileSync(process.execPath, [LAUNCHER, dir, '--selftest'], { encoding: 'utf8' }), new RegExp(`^ok selftest title=maze files=${files.length + 1} `));

    const child = spawn(process.execPath, [LAUNCHER, dir, '--serve']);
    try {
      const url = await new Promise<string>((resolve, reject) => {
        child.stdout.once('data', (d) => resolve(/http:\S+/.exec(String(d))![0]));
        child.once('exit', () => reject(new Error('launcher stopped')));
      });
      assert.equal(new URL(url).port, String(portOf('maze')));
      const scene = await fetch(new URL('game/maze.kiln', url));
      assert.equal(await scene.text(), readFileSync(SCENE, 'utf8'));
      assert.match((await fetch(url)).headers.get('content-type')!, /^text\/html/);
      for (const path of ['..%2f..%2fpackage.json', 'engine/../../x', 'nothing']) assert.equal((await fetch(new URL(path, url))).status, 404, path);
      // A request under another name (DNS rebinding) is refused.
      const status = await new Promise<number>((resolve) => request(url, { headers: { host: 'example.com' } }, (r) => r.resume().on('end', () => resolve(r.statusCode!))).end());
      assert.equal(status, 404);
      // A second start of the same game finds the first and stops.
      assert.match(execFileSync(process.execPath, [LAUNCHER, dir], { encoding: 'utf8', env: { ...process.env, KILN_BROWSER: '' } }), /already running/);
    } finally {
      child.kill();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('desktop: the console flag of a Windows executable is the one field changed', () => {
  const dir = temp();
  try {
    const file = join(dir, 'a.exe');
    const bytes = Buffer.alloc(512);
    bytes.write('MZ', 0, 'latin1');
    bytes.writeUInt32LE(128, 0x3c);
    bytes.write('PE\0\0', 128, 'latin1');
    bytes.writeUInt16LE(3, 128 + 92);
    writeFileSync(file, bytes);
    hideConsole(file);
    const after = readFileSync(file);
    assert.equal(after.readUInt16LE(128 + 92), 2);
    after.writeUInt16LE(3, 128 + 92);
    assert.deepEqual(after, bytes);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Building needs Node 25.5; CI has a job with it (.github/workflows/ci.yml, `desktop`).
test('desktop: one executable file that carries the whole game', { skip: canBuildSea(process.execPath) ? false : 'this Node cannot build one' }, () => {
  const dir = temp();
  try {
    const built = desktop(SCENE, join(dir, 'maze'), { console: true });
    assert.ok(built.bytes > 1_000_000);
    assert.match(execFileSync(built.out, ['--selftest'], { encoding: 'utf8', cwd: dir }), new RegExp(`^ok selftest title=maze files=${built.files + 1} `));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('desktop: an older Node says what is needed', { skip: canBuildSea(process.execPath) ? 'this Node can build' : false }, () => {
  assert.throws(() => desktop(SCENE, join(tmpdir(), 'kiln-never')), /Node 25\.5/);
});
