// Reference images: what each example looks like, compared with a tolerance.
//
// Pixels differ across GPUs, drivers and shader compilers, so the comparison is made
// in one place only: Linux CI, where the browser draws in software. There a picture
// that drifts from its reference fails the build. Anywhere else this script only
// checks that every scene draws something, and reports the distance for information.
//
//   node scripts/images.ts           compare (enforced on the reference environment)
//   node scripts/images.ts --write   replace the references with what was just drawn
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from '../src/chrome.ts';
import { GPU_SWITCHES, look } from '../src/look.ts';
import { compare, decodePng, summarize } from '../src/png.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REFERENCES = join(ROOT, 'tests', 'images');
const ACTUAL = join(ROOT, 'out', 'images');

// Scene, and the tick of its recorded run at which the picture is taken.
const CASES: [scene: string, tick: number][] = [
  ['maze', 0], ['cave', 60], ['dungeon', 0], ['platformer', 90], ['level1', 0],
  ['sokoban', 120], ['quest', 200], ['arena3d', 120], ['crypt3d', 60],
];
// A pixel counts as changed when a channel moves by more than 8 of 255;
// a picture fails when more than 0.2% of its pixels changed.
const CHANNEL = 8, SHARE = 0.002;

const write = process.argv.includes('--write');
const reference = process.platform === 'linux' && !!process.env.CI;
mkdirSync(ACTUAL, { recursive: true });
mkdirSync(REFERENCES, { recursive: true });

const browser = await launch({ args: GPU_SWITCHES });
let failed = 0;
try {
  for (const [scene, tick] of CASES) {
    const file = join(ROOT, 'examples', `${scene}.kiln`), name = `${scene}@${tick}.png`;
    const seen = await look(file, { tick, inputFile: join(ROOT, 'examples', `${scene}.input`), browser });
    writeFileSync(join(ACTUAL, name), seen.png);
    const problems: string[] = [];
    if (!summarize(seen.picture).box) problems.push('the frame is blank');
    if (seen.errors.length) problems.push(`page error: ${seen.errors[0].split('\n')[0]}`);
    let distance = 'no reference';
    if (write) writeFileSync(join(REFERENCES, name), seen.png);
    else if (existsSync(join(REFERENCES, name))) {
      const d = compare(decodePng(readFileSync(join(REFERENCES, name))), seen.picture, CHANNEL);
      distance = d.sameSize ? `changed=${(d.changed * 100).toFixed(3)}% worst=${d.worst}` : 'size differs';
      if (reference && (!d.sameSize || d.changed > SHARE)) problems.push(`differs from its reference (${distance})`);
    } else if (reference) problems.push('has no reference image');
    console.log(`${problems.length ? 'FAIL' : 'ok  '} ${name} renderer=${seen.renderer} ${write ? 'written' : distance}${problems.length ? ` -- ${problems.join('; ')}` : ''}`);
    if (problems.length) failed++;
  }
} finally {
  await browser.close();
}
console.log(reference ? `reference environment: ${failed} failed` : `not the reference environment (Linux CI): differences are reported, not enforced; ${failed} failed`);
process.exit(failed ? 1 : 0);
