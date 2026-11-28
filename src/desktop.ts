// `kiln desktop`: one executable file that runs a built game. It is Node's single
// executable application (`node --build-sea`, Node 25.5 or newer, nothing downloaded):
// the Node binary with the launcher (launcher.cjs) and the files of `build` inside it.
// The window is the Chrome or Edge installed on the player's machine, so the file holds
// no renderer of its own and is about the size of Node.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, openSync, readSync, writeSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from './build.ts';

const LAUNCHER = fileURLToPath(new URL('launcher.cjs', import.meta.url));

/** A port this game gets every time (40000 to 49999). */
export function portOf(title: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < title.length; i++) h = Math.imul(h ^ title.charCodeAt(i), 0x01000193);
  return 40000 + ((h >>> 0) % 10000);
}

/** Build the game into `dir` with what the launcher needs beside it; returns every file. */
export function stage(sceneFile: string, dir: string): { files: string[]; skipped: string[]; title: string } {
  const b = build(sceneFile, dir);
  const title = basename(sceneFile).replace(/\.kiln$/, '').replace(/[^\w.-]+/g, '-') || 'game';
  const files = [...new Set(b.written)];
  writeFileSync(join(dir, 'kiln-desktop.json'), JSON.stringify({ title, port: portOf(title), width: 960, height: 640, files }));
  return { files, skipped: b.skipped, title };
}

/** Can this Node build an executable? */
export function canBuildSea(node: string): boolean {
  try {
    const [major, minor] = execFileSync(node, ['--version'], { encoding: 'utf8' }).trim().slice(1).split('.').map(Number);
    return major > 25 || (major === 25 && minor >= 5);
  } catch { return false; }
}

/** Mark a Windows executable as a window program, so no console opens behind the game. */
export function hideConsole(exe: string): void {
  const fd = openSync(exe, 'r+');
  try {
    const word = Buffer.alloc(4);
    readSync(fd, word, 0, 4, 0x3c);
    const pe = word.readUInt32LE(0);
    readSync(fd, word, 0, 4, pe);
    if (word.toString('latin1') !== 'PE\0\0') throw new Error('not a Windows executable');
    // Optional header (24 bytes in) + 68: Subsystem. 2 = windows, 3 = console.
    const subsystem = Buffer.from([2, 0]);
    writeSync(fd, subsystem, 0, 2, pe + 24 + 68);
  } finally { closeSync(fd); }
}

export function desktop(sceneFile: string, outFile: string, opts: { node?: string; console?: boolean } = {}): { out: string; files: number; bytes: number; skipped: string[] } {
  const node = opts.node ?? process.execPath;
  if (!canBuildSea(node)) throw new Error('an executable needs Node 25.5 or newer to build it (--node PATH names one)');
  let out = resolve(outFile);
  const windows = process.platform === 'win32';
  if (windows && !out.endsWith('.exe')) out += '.exe';
  const temp = mkdtempSync(join(tmpdir(), 'kiln-desktop-'));
  try {
    const dir = join(temp, 'game');
    const { files, skipped } = stage(sceneFile, dir);
    const assets = Object.fromEntries([...files, 'kiln-desktop.json'].map((f) => [f, join(dir, f)]));
    mkdirSync(dirname(out), { recursive: true });
    const config = join(temp, 'sea.json');
    writeFileSync(config, JSON.stringify({ main: LAUNCHER, output: out, assets, disableExperimentalSEAWarning: true, execArgvExtension: 'none' }));
    execFileSync(node, ['--build-sea', config], { stdio: 'pipe' });
    if (process.platform === 'darwin') execFileSync('codesign', ['--force', '--sign', '-', out], { stdio: 'pipe' });
    // Only a Windows binary has the field; --node may name another platform's.
    if (!opts.console && readFileSync(out).subarray(0, 2).toString('latin1') === 'MZ') hideConsole(out);
    return { out, files: files.length, bytes: statSync(out).size, skipped };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
