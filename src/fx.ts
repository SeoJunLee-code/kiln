// Q16.16 fixed-point. Every value is an int32 held in a JS number.
// Simulation code must use these instead of float math so that the same
// inputs give bit-identical state on every machine.
export const ONE = 65536;

export const fx = (n: number): number => Math.round(n * ONE) | 0;
export const toNum = (a: number): number => a / ONE;

export function mul(a: number, b: number): number {
  const ah = a >> 16, al = a & 0xffff;
  const bh = b >> 16, bl = b & 0xffff;
  return (ah * bh * ONE + ah * bl + al * bh + ((al * bl) >>> 16)) | 0;
}

export function div(a: number, b: number): number {
  if (b === 0) throw new RangeError('fx.div by zero');
  return Math.trunc((a * ONE) / b) | 0;
}

/**
 * Share of a per-second amount that belongs to tick `k` of a second split into `hz` ticks.
 * The shares of one whole second sum to exactly `perSecond`, so a constant velocity
 * never drifts from rounding. Needs no stored remainder.
 */
export const tickShare = (perSecond: number, k: number, hz: number): number =>
  (Math.floor((perSecond * (k + 1)) / hz) - Math.floor((perSecond * k) / hz)) | 0;

const DEC = /^-?(\d+\.?\d*|\.\d+)$/;

/** Parse a decimal literal to fixed-point; null if it is not a plain decimal. */
export function parseFx(s: string): number | null {
  if (!DEC.test(s)) return null;
  const n = Number(s);
  if (n >= 32768 || n < -32768) return null;
  return fx(n);
}

/** Shortest decimal that parses back to the same fixed-point value. */
export function fmtFx(a: number): string {
  for (let d = 0; d <= 5; d++) {
    const s = String(+toNum(a).toFixed(d));
    if (fx(Number(s)) === a) return s;
  }
  return String(toNum(a));
}
