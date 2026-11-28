// Time to the first frame and memory after loading, for the Lite proof game as `build`
// writes it: the built folder is served from this machine and opened in a new browser with
// an empty profile each time, so nothing is cached.
//
//   node bench/start.ts              10 starts of each level, writes proof/lite/START.md
//   node bench/start.ts --runs 2     a short trial (writes nothing)
//
// "First frame" is the time from the start of navigation to the end of the player's first
// frame callback. "JS heap" is the page's JavaScript heap after a forced collection; it
// does not include canvases, images or GPU memory. The network is the loopback interface,
// so download time is next to nothing: bytes are listed instead.
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from '../src/build.ts';
import { launch } from '../src/chrome.ts';

const at = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url));
const i = process.argv.indexOf('--runs');
const RUNS = i < 0 ? 10 : Number(process.argv[i + 1]);
const LEVELS = ['level1', 'level2', 'level3'];
const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm', '.wav': 'audio/wav', '.ogg': 'audio/ogg' };

const hook = `(() => {
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf((t) => { cb(t); if (window.firstFrame === undefined && window.kiln) window.firstFrame = performance.now(); });
})()`;

interface Start { ms: number; heap: number; requests: number; bytes: number; gzip: number }

async function start(dir: string, args: string[]): Promise<Start> {
  const asked = new Set<string>();
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url!, 'http://x').pathname);
    const file = join(dir, normalize(path.endsWith('/') ? `${path}index.html` : path));
    try {
      if (!file.startsWith(dir + sep) || !statSync(file).isFile()) throw new Error('no');
      asked.add(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
      res.end(readFileSync(file));
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const browser = await launch({ args });
  try {
    const page = await browser.open('about:blank', { width: 1280, height: 800 });
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: hook });
    await page.send('Page.navigate', { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/` });
    let ms: number | undefined;
    for (let n = 0; n < 400 && ms === undefined; n++) {
      await new Promise((r) => setTimeout(r, 50));
      try { ms = await page.eval<number | undefined>('window.firstFrame'); } catch { /* the page is still navigating */ }
    }
    if (ms === undefined) throw new Error(`no frame within 20 s: ${page.errors().join('; ')}`);
    // What arrives after the first frame (images, sounds) belongs to the load too.
    await new Promise((r) => setTimeout(r, 1000));
    await page.send('HeapProfiler.collectGarbage');
    const heap = ((await page.send('Runtime.getHeapUsage')) as { usedSize: number }).usedSize;
    const files = [...asked].map((f) => readFileSync(f));
    return { ms, heap, requests: files.length, bytes: files.reduce((a, f) => a + f.length, 0), gzip: files.reduce((a, f) => a + gzipSync(f).length, 0) };
  } finally {
    await browser.close();
    server.close();
  }
}

const median = (xs: number[]): number => xs.slice().sort((a, b) => a - b)[xs.length >> 1];
// Headless Chrome spends up to a second starting its GPU process before the first frame it
// shows, whatever the page draws, so the starts without a GPU are listed beside them.
const CONFIGS = [{ name: 'default', args: [] as string[] }, { name: 'GPU off', args: ['--disable-gpu'] }];
const rows: string[] = [];
for (const config of CONFIGS) for (const level of LEVELS) {
  const dir = mkdtempSync(join(tmpdir(), 'kiln-start-'));
  try {
    build(at(`../proof/lite/game/${level}.kiln`), dir);
    const runs: Start[] = [];
    for (let r = 0; r < RUNS; r++) runs.push(await start(dir, config.args));
    const ms = runs.map((r) => r.ms), heap = runs.map((r) => r.heap / 1048576), last = runs[runs.length - 1];
    const row = `| ${level}, ${config.name} | ${median(ms).toFixed(0)} | ${Math.min(...ms).toFixed(0)} to ${Math.max(...ms).toFixed(0)} | ${median(heap).toFixed(1)} | ${last.requests} | ${(last.bytes / 1000).toFixed(0)} | ${(last.gzip / 1000).toFixed(0)} |`;
    console.log(row);
    rows.push(row);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (RUNS === 10) {
  writeFileSync(at('../proof/lite/START.md'), `# Lite proof game: first frame and memory

Measured with \`node bench/start.ts\` on ${new Date().toISOString().slice(0, 10)}, on the reference PC (a laptop with
Intel integrated graphics), headless Chrome, a new browser with an empty profile for each of
${RUNS} starts, the built game served over the loopback interface.

| Start scene, browser | First frame, median ms | Lowest to highest ms | JS heap after loading, median MB | Files fetched | KB | KB gzipped |
|---|---|---|---|---|---|---|
${rows.join('\n')}

"default" is headless Chrome as it comes; "GPU off" is the same with \`--disable-gpu\`. In a
trial with the requests timed, every file had arrived within 90 ms of navigation, and the
long starts were spent waiting for and inside the first frame callback only when the
browser used the GPU: the cost is in starting it, which a browser already open has paid.

What this does not say: a download over a real network (see the byte columns), a phone, a
visible window, memory held by canvases, images or the GPU. KB are 1,000 bytes. The gzipped
column compresses each file by itself; this server sent them uncompressed.
`);
  console.log('wrote proof/lite/START.md');
}
