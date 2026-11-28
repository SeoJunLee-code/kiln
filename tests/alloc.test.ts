import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));
const FLAGS = ['--min-semi-space-size=64', '--max-semi-space-size=64'];

// What a tick that changes nothing may still allocate. On the reference PC it is a byte
// or two in these scenes (it was 5,000 to 10,000); the ceiling leaves room for another
// OS or Node version and still fails if a list or iterator made every tick comes back.
const CEILING = 400;

test('a tick in which nothing happens allocates nearly nothing', () => {
  for (const scene of ['maze', 'platformer', 'level1', 'lift']) {
    // One scene to a process: what else was run in it changes the numbers.
    const out = execFileSync(process.execPath, [...FLAGS, here('../bench/alloc.ts'), here(`../examples/${scene}.kiln`)], { encoding: 'utf8' });
    const [r] = JSON.parse(out) as { idleBytesPerTick: number }[];
    // Below zero the collector ran inside the measurement, which would say nothing.
    assert.ok(r.idleBytesPerTick >= 0 && r.idleBytesPerTick < CEILING, `${scene}: ${r.idleBytesPerTick} bytes per idle tick`);
  }
});

// One byte per entity and tick would be 10,000 here: whatever a tick allocates, it must
// not grow with the number of entities.
test('ten thousand moving entities allocate nearly nothing per tick', () => {
  const program = `
    import { crowd } from ${JSON.stringify(new URL('../bench/crowd.ts', import.meta.url).href)};
    import { median } from ${JSON.stringify(new URL('../bench/alloc.ts', import.meta.url).href)};
    import { step } from ${JSON.stringify(new URL('../src/sim.ts', import.meta.url).href)};
    const out = {};
    for (const kind of ['drift', 'fall']) {
      const w = crowd(10000, kind);
      for (let i = 0; i < 600; i++) step(w);
      out[kind] = median(() => { for (let i = 0; i < 20; i++) step(w); }, 20, 11);
    }
    console.log(JSON.stringify(out));`;
  const out = JSON.parse(execFileSync(process.execPath, [...FLAGS, '--input-type=module', '-e', program], { encoding: 'utf8' })) as Record<string, number>;
  for (const [kind, bytes] of Object.entries(out)) assert.ok(bytes >= 0 && bytes < 2000, `${kind}: ${bytes} bytes per tick`);
});
