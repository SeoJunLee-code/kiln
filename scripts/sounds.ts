// Makes the example sounds (examples/*.wav) from arithmetic, so they have no outside source.
// Run: node scripts/sounds.ts. Triangle waves, so no Math.sin and the same bytes on every
// machine; 8-bit mono at 8 kHz to keep the files small.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const RATE = 8000;

/** A WAV file from samples in -127..127. */
export function wav(samples: number[], rate = RATE): Buffer {
  const out = Buffer.alloc(44 + samples.length);
  out.write('RIFF', 0);
  out.writeUInt32LE(36 + samples.length, 4);
  out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20); // PCM
  out.writeUInt16LE(1, 22); // mono
  out.writeUInt32LE(rate, 24);
  out.writeUInt32LE(rate, 28); // bytes per second
  out.writeUInt16LE(1, 32);
  out.writeUInt16LE(8, 34);
  out.write('data', 36);
  out.writeUInt32LE(samples.length, 40);
  samples.forEach((s, i) => out.writeUInt8(128 + s, 44 + i));
  return out;
}

/** A triangle note: `hz` for `ms`, fading out linearly from `peak` (0..127). */
export function note(hz: number, ms: number, peak = 90): number[] {
  const n = Math.floor((RATE * ms) / 1000), out: number[] = [];
  for (let i = 0; i < n; i++) {
    const phase = ((i * hz * 4) % (RATE * 4)) / RATE; // 0..4 through one wave
    const tri = phase < 1 ? phase : phase < 3 ? 2 - phase : phase - 4; // -1..1
    out.push(Math.trunc((tri * peak * (n - i)) / n));
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const put = (name: string, samples: number[]): void => writeFileSync(new URL(`../examples/${name}`, import.meta.url), wav(samples));
  put('coin.wav', [...note(988, 60), ...note(1319, 140)]);
  put('door.wav', [...note(262, 90), ...note(330, 90), ...note(392, 90), ...note(523, 220)]);
  // A quiet eight-note loop.
  put('tune.wav', [220, 262, 330, 262, 196, 247, 294, 247].flatMap((hz) => note(hz, 250, 50)));
}
