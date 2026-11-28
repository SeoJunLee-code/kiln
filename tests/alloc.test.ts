import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

// What a tick that changes nothing may still allocate. On the reference PC it is about
// 1,300 to 1,800 bytes in these scenes (it was 5,000 to 10,000); the ceiling leaves room
// for another OS or Node version and still fails if the old way comes back.
const CEILING = 3000;

test('a tick in which nothing happens allocates little', () => {
  for (const scene of ['maze', 'platformer']) {
    // One scene to a process: what else was run in it changes the numbers.
    const out = execFileSync(process.execPath, ['--min-semi-space-size=64', '--max-semi-space-size=64', here('../bench/alloc.ts'), here(`../examples/${scene}.kiln`)], { encoding: 'utf8' });
    const [r] = JSON.parse(out) as { idleBytesPerTick: number }[];
    // Below zero the collector ran inside the measurement, which would say nothing.
    assert.ok(r.idleBytesPerTick >= 0 && r.idleBytesPerTick < CEILING, `${scene}: ${r.idleBytesPerTick} bytes per idle tick`);
  }
});
