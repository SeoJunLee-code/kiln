// A laptop runs fast for a few seconds and then settles at a lower speed (three times lower
// on the machine this was written on). Numbers measured on either side of that are not
// comparable, so the benchmarks work until it has settled and measure at the sustained speed.

/** Milliseconds for a fixed piece of integer work: how fast the machine is right now. */
export function pace(): number {
  const t = performance.now();
  let x = 0;
  for (let i = 0; i < 2e7; i++) x = (x + i * i) | 0;
  return performance.now() - t + (x & 0);
}

/** Six seconds of full load. Returns the pace when called and the pace afterwards. */
export function settle(): { burst: number; before: number } {
  const burst = pace();
  for (const until = performance.now() + 6000; performance.now() < until;) pace();
  return { burst, before: pace() };
}

/** The paragraph a report carries about the speed it was measured at. */
export const paceNote = (burst: number, before: number, after: number): string =>
  `Measured at the machine's sustained speed, after six seconds of full load. A fixed loop of
integer work took ${burst.toFixed(0)} ms when the process started, ${before.toFixed(0)} ms before the first row and ${after.toFixed(0)} ms
after the last: where the first is much lower, a game's first seconds run that much faster
than these numbers, and where the last two differ, the rows are not comparable.`;
