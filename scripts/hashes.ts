// Runs every example with its recorded input and compares the final state hash with
// examples/HASHES. CI runs this on Linux, macOS and Windows, so a hash that differs
// between machines shows up as a failure.
//   node scripts/hashes.ts           print current hashes
//   node scripts/hashes.ts --check   compare with examples/HASHES (exit 1 on mismatch)
//   node scripts/hashes.ts --write   update examples/HASHES after an intended change
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadMods } from '../src/load.ts';
import { run } from '../src/run.ts';

const dir = fileURLToPath(new URL('../examples/', import.meta.url));
const lines: string[] = [];
for (const f of readdirSync(dir).filter((x) => x.endsWith('.kiln')).sort()) {
  const scene = readFileSync(dir + f, 'utf8');
  const inputFile = dir + f.replace(/\.kiln$/, '.input');
  const input = existsSync(inputFile) ? readFileSync(inputFile, 'utf8') : undefined;
  const r = run(scene, { input, file: f, mods: await loadMods(scene, dir + f) });
  lines.push(`${f} tick=${r.world.tick} hash=${r.hash} expects=${r.ok ? 'pass' : 'FAIL'}`);
}
const now = lines.join('\n') + '\n';
const file = dir + 'HASHES';
const mode = process.argv[2];

if (mode === '--write') writeFileSync(file, now);
process.stdout.write(now);
if (mode === '--check') {
  const want = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  if (want !== now) {
    console.log(`E K900 hashes differ from examples/HASHES. expected:\n${want}`);
    process.exitCode = 1;
  } else console.log('ok hashes match');
}
if (lines.some((l) => l.endsWith('FAIL'))) process.exitCode = 1;
