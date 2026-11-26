import { ONE, div, fmtFx, fx, mul, tickShare } from './fx.ts';
import type { Mods } from './run.ts';
import { defineComponent } from './world.ts';
import type { Field, System } from './world.ts';

/** What a script's default export receives. */
export interface Kiln {
  component(name: string, doc: string, fields?: Field[]): void;
  /** stage 'pre' runs before physics each tick, 'post' after triggers */
  system(fn: System, stage?: 'pre' | 'post'): void;
  ONE: number;
  fx: typeof fx;
  mul: typeof mul;
  div: typeof div;
  fmtFx: typeof fmtFx;
  tickShare: typeof tickShare;
}

/** Build the script API; registered systems are collected into `mods`. No Node APIs, so it also runs in a browser. */
export const makeApi = (mods: Mods): Kiln => ({
  component: defineComponent,
  system: (fn, stage = 'pre') => void mods[stage].push(fn),
  ONE, fx, mul, div, fmtFx, tickShare,
});
