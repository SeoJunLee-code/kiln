// Makes the sound files of held-out spec 1 (proof/compare/h1-sounds/*.wav) from arithmetic,
// with the same triangle notes as scripts/sounds.ts, so they have no outside source and both
// engines of the comparison are given the same bytes. Run: node scripts/h1sounds.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { note, wav } from './sounds.ts';

const dir = new URL('../proof/compare/h1-sounds/', import.meta.url);
mkdirSync(dir, { recursive: true });
const put = (name: string, samples: number[]): void => writeFileSync(new URL(name, dir), wav(samples));
const seq = (notes: [number, number][], peak = 90): number[] => notes.flatMap(([hz, ms]) => note(hz, ms, peak));

put('flip.wav', seq([[440, 50], [660, 70]]));
put('death.wav', seq([[330, 90], [220, 90], [147, 110], [98, 200]]));
put('checkpoint.wav', seq([[660, 80], [880, 160]]));
put('win.wav', seq([[523, 120], [659, 120], [784, 120], [1047, 400]]));
// A sixteen-note loop, 6.4 seconds, quieter than the effects.
const A = 220, C = 262, D = 294, E = 330, G = 392;
put('music.wav', seq([A, E, A, C, D, E, D, C, G / 2, D, G / 2, C, D, E, C, A].map(hz => [hz, 400] as [number, number]), 45));
