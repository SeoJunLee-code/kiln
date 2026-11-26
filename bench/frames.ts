// Frame rate of the Lite proof game (proof/lite/game) in a real browser window, by
// bench/PROTOCOL.md: each level replays its recorded input in a loop for 60 seconds after a
// warm-up, every frame is timed, every configuration runs three times.
//
//   node bench/frames.ts                 all configurations, writes proof/lite/FPS.md and bench/raw/
//   node bench/frames.ts --only display  measure one configuration again; the others are kept from bench/raw/
//   node bench/frames.ts --seconds 5 --runs 1 --only uncapped   a short trial (writes nothing)
//   node bench/frames.ts --summary bench/raw/FILE.json.gz       recompute one run's numbers from its frames
//
// It opens a browser window and needs it left in front: a covered window is not drawn.
// Numbers are from whatever machine runs this; the machine is written into the result.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, release, totalmem } from 'node:os';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { launch } from '../src/chrome.ts';
import { command } from '../src/commands.ts';
import { serve } from '../src/serve.ts';

const at = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url));
const arg = (name: string): string | undefined => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? undefined : process.argv[i + 1]; };
const SECONDS = Number(arg('seconds') ?? 60), RUNS = Number(arg('runs') ?? 3), WARM = Math.min(5, SECONDS);
const TRIAL = SECONDS !== 60 || RUNS !== 3;
const LEVELS = ['level1', 'level2', 'level3'];
const BUDGET = 1000 / 60;

// Never throttle or stop drawing because the window is not the one being used.
const AWAKE = ['--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'];
const FREE = ['--disable-frame-rate-limit', '--disable-gpu-vsync'];
interface Config { name: string; what: string; args: string[]; throttle?: number; levels: string[] }
const CONFIGS: Config[] = [
  { name: 'display', what: 'as a player gets it: vertical sync on, one frame per display refresh', args: [], levels: LEVELS },
  { name: 'uncapped', what: 'vertical sync off, frame cap off (the protocol\'s setting)', args: FREE, levels: LEVELS },
  { name: 'software', what: 'uncapped, GPU off (`--disable-gpu`): the browser draws and composites on the CPU', args: [...FREE, '--disable-gpu'], levels: ['level3'] },
  { name: 'software-slow4', what: 'as `software`, with the page\'s CPU slowed 4x by the browser (DevTools CPU throttling)', args: [...FREE, '--disable-gpu'], throttle: 4, levels: ['level3'] },
];

export interface Run { date: string; config: string; level: string; run: number; seconds: number; view: string; gpu: string; browser: string; resets: number; visible: boolean; frame: number[]; cpu: number[] }
export interface Summary { frames: number; fps: number; low1: number; median: number; p99: number; longest: number; over: number; cpuMedian: number; cpuP99: number; cpuMean: number }

/** `frame` and `cpu` are per frame, in hundredths of a millisecond. */
export function summarize(r: Pick<Run, 'frame' | 'cpu'>): Summary {
  const ms = r.frame.map((v) => v / 100).sort((a, b) => a - b), cpu = r.cpu.map((v) => v / 100).sort((a, b) => a - b);
  const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
  const q = (xs: number[], p: number): number => xs[Math.min(xs.length - 1, Math.floor(xs.length * p))];
  const slow = ms.slice(ms.length - Math.max(1, Math.round(ms.length / 100)));
  return {
    frames: ms.length, fps: (1000 * ms.length) / sum(ms), low1: 1000 / (sum(slow) / slow.length),
    median: q(ms, 0.5), p99: q(ms, 0.99), longest: ms[ms.length - 1], over: ms.filter((v) => v > BUDGET).length,
    cpuMedian: q(cpu, 0.5), cpuP99: q(cpu, 0.99), cpuMean: sum(cpu) / cpu.length,
  };
}

// Put around the player's frame callback from outside, so the player measured is the one
// that ships. `end` is a tick short of the level's load: the level starts over there
// instead of leaving the page, which makes a loop of real play as long as the recording.
const hook = (end: number): string => `(() => {
  const raf = window.requestAnimationFrame.bind(window), N = 1 << 21;
  const at = new Float64Array(N), cpu = new Float32Array(N);
  let n = 0, on = false, resets = 0;
  window.requestAnimationFrame = (cb) => raf((t) => {
    if (kiln.world.tick >= ${end}) { kiln.reset(); resets++; }
    const a = performance.now();
    cb(t);
    const b = performance.now();
    if (on && n < N) { at[n] = a; cpu[n] = b - a; n++; }
  });
  window.bench = {
    start() { n = 0; resets = 0; on = true; },
    stop() {
      on = false;
      const frame = [], work = [];
      for (let i = 1; i < n; i++) { frame.push(Math.round((at[i] - at[i - 1]) * 100)); work.push(Math.round(cpu[i] * 100)); }
      const c = document.getElementById('view');
      let gpu = 'none';
      try { const gl = document.createElement('canvas').getContext('webgl'); gpu = gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL); } catch {}
      return { frame, cpu: work, resets, gpu, view: c.width + 'x' + c.height, visible: document.visibilityState === 'visible', browser: navigator.userAgent.replace(/^.*(Chrome\\/[\\d.]+).*$/, '$1') };
    },
  };
})()`;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function measure(config: Config, level: string, run: number, end: number): Promise<Run> {
  const server = await serve(at(`../proof/lite/game/${level}.kiln`), at(`../proof/lite/game/${level}.input`), 0);
  const browser = await launch({ args: [...AWAKE, ...config.args], window: { width: 1280, height: 800 } });
  try {
    const page = await browser.open(`http://127.0.0.1:${server.port}/`, null);
    for (let i = 0; i < 200 && !(await page.eval<boolean>('!!window.kiln')); i++) await sleep(50);
    if (config.throttle) await page.send('Emulation.setCPUThrottlingRate', { rate: config.throttle });
    await page.eval(hook(end));
    await sleep(WARM * 1000);
    await page.eval('bench.start()');
    await sleep(SECONDS * 1000);
    const got = await page.eval<Omit<Run, 'date' | 'config' | 'level' | 'run' | 'seconds'>>('bench.stop()');
    if (got.frame.length < 10) throw new Error(`${config.name} ${level}: ${got.frame.length} frames in ${SECONDS} s; the window was not being drawn`);
    if (page.errors().length) throw new Error(`page errors: ${page.errors()[0]}`);
    // A window that was covered or minimized stops being drawn: such a run is not a measurement.
    const covered = got.frame.reduce((a, b) => a + b, 0) / 100000;
    if (!got.visible || covered < SECONDS * 0.98) throw new Error(`${config.name} ${level}: frames cover ${covered.toFixed(1)} of ${SECONDS} s, visible=${got.visible}; the window was not in front`);
    return { date: new Date().toISOString().slice(0, 10), config: config.name, level, run, seconds: SECONDS, ...got };
  } finally {
    await browser.close();
    server.close();
  }
}

/** What the result has to say about the machine: no names, serial numbers or paths. */
function machine(): string[] {
  const lines = [`CPU: ${cpus()[0].model.trim()} (${cpus().length} threads)`, `Memory: ${Math.round(totalmem() / 2 ** 30)} GB`, `OS: ${process.platform} ${release()}`];
  if (process.platform === 'win32') {
    try {
      const ps = (c: string): string => execFileSync('powershell', ['-NoProfile', '-Command', c], { encoding: 'utf8' }).trim();
      for (const l of ps('Get-CimInstance Win32_VideoController | ForEach-Object { "$($_.Name)|$($_.DriverVersion)|$($_.CurrentHorizontalResolution)x$($_.CurrentVerticalResolution)|$($_.CurrentRefreshRate)" }').split(/\r?\n/)) {
        const [name, driver, size, hz] = l.split('|');
        lines.push(`GPU: ${name}, driver ${driver}${hz ? `, drives the display at ${size}, ${hz} Hz` : ', not driving a display'}`);
      }
      const plan = /[0-9a-f]{8}-[0-9a-f-]{27}/.exec(ps('powercfg /getactivescheme'))?.[0] ?? '?';
      const known: Record<string, string> = { '381b4222': 'Balanced', '8c5e7fda': 'High performance', 'a1841308': 'Power saver' };
      lines.push(`Power: ${ps('(Get-CimInstance Win32_Battery).BatteryStatus') === '2' ? 'on mains' : 'on battery'}, Windows power plan ${known[plan.slice(0, 8)] ?? plan}`);
    } catch { lines.push('GPU, display and power: not read'); }
  }
  return lines;
}

const f = (v: number, d = 2): string => v.toFixed(d);
const row = (r: Run): string => {
  const s = summarize(r);
  return `| ${r.level} | ${r.run} | ${s.frames} | ${f(s.fps, 1)} | ${f(s.low1, 1)} | ${f(s.median)} | ${f(s.p99)} | ${f(s.longest, 1)} | ${s.over} (${f((100 * s.over) / s.frames, 3)}%) | ${f(s.cpuMedian)} | ${f(s.cpuP99)} | ${f(s.cpuMean, 3)} |`;
};

const summaryFile = arg('summary');
if (summaryFile) {
  const r = JSON.parse(gunzipSync(readFileSync(summaryFile)).toString('utf8')) as Run;
  console.log(`${r.config} ${row(r)}`);
} else if (process.argv[1]?.endsWith('frames.ts')) {
  // Where each level's recorded play ends: the tick of its load, from a headless run.
  const ends = new Map<string, number>();
  for (const level of LEVELS) {
    const r = await command('run', { file: at(`../proof/lite/game/${level}.kiln`), inputFile: at(`../proof/lite/game/${level}.input`) });
    const tick = Number(/tick=(\d+) .*load=/.exec(r.text)?.[1]);
    if (!tick) throw new Error(`${level}: the recorded input does not reach a load\n${r.text}`);
    // The player runs at most 15 ticks in one frame; stopping 20 short never lets the load fire.
    ends.set(level, tick - 20);
  }
  let runs: Run[] = [];
  for (const config of CONFIGS.filter((c) => !arg('only') || c.name === arg('only'))) {
    for (const level of config.levels) {
      for (let run = 1; run <= RUNS; run++) {
        let r: Run | undefined;
        // Two more tries if the window lost the screen; after that the error stands.
        for (let tries = 0; !r; tries++) {
          try { r = await measure(config, level, run, ends.get(level)!); } catch (e) { if (tries === 2) throw e; console.log(`again: ${(e as Error).message}`); }
        }
        runs.push(r);
        console.log(`${config.name} ${row(r)} resets=${r.resets} view=${r.view} visible=${r.visible} gpu=${r.gpu}`);
      }
    }
  }
  if (!TRIAL) {
    mkdirSync(at('raw'), { recursive: true });
    for (const r of runs) writeFileSync(at(`raw/lite-${r.config}-${r.level}-${r.run}.json.gz`), gzipSync(JSON.stringify(r)));
    // The result is always built from the frames on disk, so it cannot say more than they do.
    runs = readdirSync(at('raw')).filter((n) => /^lite-.*\.json\.gz$/.test(n)).map((n) => JSON.parse(gunzipSync(readFileSync(at(`raw/${n}`))).toString('utf8')) as Run)
      .sort((a, b) => a.level.localeCompare(b.level) || a.run - b.run);
    const head = '| Level | Run | Frames | Average FPS | 1% low | Frame ms, median | Frame ms, 99th | Longest frame ms | Frames over 16.67 ms | CPU ms, median | CPU ms, 99th | CPU ms, mean |\n|---|---|---|---|---|---|---|---|---|---|---|---|';
    const low = (names: string[]): { n: number; worst: number; under: number } => {
      const lows = runs.filter((r) => names.includes(r.config)).map((r) => summarize(r).low1);
      return { n: lows.length, worst: Math.min(...lows), under: lows.filter((v) => v < 60).length };
    };
    const pc = low(['uncapped', 'software']), slow = low(['software-slow4']);
    const shown = runs.filter((r) => r.config === 'display').map((r) => summarize(r));
    const out = [
      '# Lite proof game: frame rate', '',
      'Written by `node bench/frames.ts`; do not edit by hand. Rules: [`bench/PROTOCOL.md`](../../bench/PROTOCOL.md).',
      'What these numbers do and do not show is in [`RUN.md`](RUN.md).', '',
      `Measured ${[...new Set(runs.map((r) => r.date))].sort().join(' and ')}, ${runs[0].browser}, in a window (not headless), game view ${runs[0].view} pixels, drawn by Canvas 2D.`,
      `Each row is ${SECONDS} seconds of the level's recorded play, looped, after ${WARM} seconds of warm-up.`,
      `Every run of every configuration is listed. The page was visible in all of them: ${runs.every((r) => r.visible) ? 'yes' : 'NO'}.`, '',
      '## Machine', '', ...machine().map((l) => `- ${l}`), `- GPU the browser used: ${[...new Set(runs.map((r) => `${r.gpu} (${r.config})`))].join('; ')}`, '',
      `## Result`, '',
      `- **This PC, no frame cap, with and without its GPU** (\`uncapped\`, \`software\`; ${pc.n} runs): the slowest 1% low is **${f(pc.worst, 1)} fps**; ${pc.under} runs fell under 60.`,
      `- **As shown on the display** (\`display\`; ${shown.length} runs): ${shown.reduce((a, s) => a + s.over, 0)} of ${shown.reduce((a, s) => a + s.frames, 0)} frames took longer than 16.67 ms.`,
      `- **A slower machine, imitated** (\`software-slow4\`; ${slow.n} runs): the slowest 1% low is **${f(slow.worst, 1)} fps**; ${slow.under} of ${slow.n} runs fell under 60. This is the browser slowing this PC's page down, not a slower machine.`, '',
      ...CONFIGS.filter((c) => runs.some((r) => r.config === c.name)).flatMap((c) => [`## ${c.name}`, '', `${c.what[0].toUpperCase()}${c.what.slice(1)}.`, '', head, ...runs.filter((r) => r.config === c.name).map(row), '']),
      '## Columns', '',
      '- Average FPS: frames ÷ seconds. 1% low: the average frame rate of the slowest 1% of frames.',
      '- Frame ms: time from one frame callback to the next. CPU ms: time inside the callback (simulation ticks, drawing calls, the side panel), main thread only.',
      '- The browser\'s clock is coarsened to 0.1 ms, so a single frame under about 0.2 ms is not resolved; averages over a run are.',
      '- GPU frame time is not recorded: Canvas 2D has no timestamp queries.', '',
    ];
    writeFileSync(at('../proof/lite/FPS.md'), out.join('\n'));
    console.log('wrote proof/lite/FPS.md and bench/raw/');
  }
}
