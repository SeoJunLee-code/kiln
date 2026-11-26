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

/** Exact floor(a / n) for integers, n > 0. Plain float division can be off by one near a boundary. */
export function fdiv(a: number, n: number): number {
  let q = Math.floor(a / n);
  while (q * n > a) q--;
  while ((q + 1) * n <= a) q++;
  return q;
}

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

/** Exact floor(sqrt(n)) for an integer 0 <= n < 2^53. */
export function isqrt(n: number): number {
  let r = Math.floor(Math.sqrt(n));
  while (r * r > n) r--;
  while ((r + 1) * (r + 1) <= n) r++;
  return r;
}

// sin of each whole degree 0..90, scaled by 2^24. A table, not Math.sin: the result must
// be the same integers on every machine. It is finer than fixed-point so that a small
// turn per tick, repeated thousands of times, does not add up to a visible error.
const SIN = [
  0, 292803, 585516, 878052, 1170319, 1462231, 1753697, 2044628, 2334937, 2624535,
  2913333, 3201244, 3488179, 3774052, 4058776, 4342263, 4624427, 4905183, 5184445, 5462127,
  5738146, 6012416, 6284856, 6555381, 6823909, 7090358, 7354647, 7616697, 7876426, 8133756,
  8388608, 8640905, 8890570, 9137527, 9381700, 9623016, 9861400, 10096781, 10329086, 10558244,
  10784187, 11006844, 11226149, 11442034, 11654434, 11863283, 12068519, 12270079, 12467901, 12661926,
  12852093, 13038346, 13220627, 13398880, 13573053, 13743091, 13908942, 14070557, 14227886, 14380881,
  14529495, 14673684, 14813402, 14948609, 15079262, 15205322, 15326749, 15443509, 15555564, 15662880,
  15765426, 15863169, 15956081, 16044131, 16127295, 16205546, 16278861, 16347217, 16410594, 16468971,
  16522332, 16570661, 16613941, 16652161, 16685309, 16713374, 16736348, 16754223, 16766996, 16774661,
  16777216,
];
const TURN = 360 * ONE, QUARTER = 90 * ONE, P24 = 16777216;

/** An angle in fixed-point degrees brought into 0 <= a < 360. */
export const wrapDeg = (a: number): number => a - fdiv(a, TURN) * TURN;

/**
 * [sin, cos] of an angle in fixed-point degrees, scaled by 2^24. Whole degrees come from
 * the table; the fraction f of a degree is added with sin(a+f) = sin a cos f + cos a sin f,
 * where sin f = f and cos f = 1 - f*f/2 are exact to well under one unit at this size.
 * Every product here is an integer below 2^53, so plain numbers hold it exactly.
 */
export function sinCos24(deg: number): [number, number] {
  const a = wrapDeg(deg), q = Math.floor(a / QUARTER), r = a - q * QUARTER;
  const d = r >> 16, s0 = SIN[d], c0 = SIN[90 - d];
  // The fraction in radians: f * pi/180, scaled by 2^24.
  const rad = Math.floor(((r & 0xffff) * 74961321) / 16777216);
  const half = Math.floor((rad * rad) / (2 * P24));
  const s = s0 + Math.round((c0 * rad - s0 * half) / P24);
  const c = c0 - Math.round((s0 * rad + c0 * half) / P24);
  // `| 0` so that a zero is never the float's negative zero.
  return q === 0 ? [s, c] : q === 1 ? [c, -s | 0] : q === 2 ? [-s | 0, -c | 0] : [-c | 0, s];
}

/** [sin, cos] of an angle in fixed-point degrees, as fixed-point. */
export function sinCos(deg: number): [number, number] {
  const [s, c] = sinCos24(deg);
  return [Math.round(s / 256) | 0, Math.round(c / 256) | 0];
}
