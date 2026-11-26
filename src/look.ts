import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { launch } from './chrome.ts';
import type { Browser, Page } from './chrome.ts';
import { decodePng, summarize } from './png.ts';
import type { Picture } from './png.ts';
import { serve } from './serve.ts';

// Switches that let a headless browser draw with a GPU or, without one, in software.
// Measured in spikes/RESULTS.md; the Vulkan switch breaks adapter lookup on Windows.
export const GPU_SWITCHES = ['--enable-unsafe-webgpu', '--enable-unsafe-swiftshader', ...(process.platform === 'linux' ? ['--enable-features=Vulkan'] : [])];

export interface LookOptions {
  /** Tick to stop at before the picture is taken (default 0). */
  tick?: number;
  inputFile?: string;
  width?: number;
  height?: number;
  /** Extra query parameters for the player page, e.g. 'pad'. */
  query?: string;
  /** Let WebGPU present to the canvas as it does for a player, instead of drawing only for the picture. */
  onscreen?: boolean;
  /** A browser to reuse; without one, look starts its own and closes it. */
  browser?: Browser;
}

export interface Look {
  png: Buffer;
  picture: Picture;
  /** '2d', 'webgl2' or 'webgpu' */
  renderer: string;
  tick: number;
  hash: string;
  /** Console errors and exceptions from the page. */
  errors: string[];
}

export interface Player {
  page: Page;
  close(): Promise<void>;
}

/**
 * Open the scene in the real player, in a headless browser, stopped at tick 0.
 * `window.kiln` is ready when this returns.
 */
export async function openPlayer(sceneFile: string, options: LookOptions = {}): Promise<Player> {
  const server = await serve(sceneFile, options.inputFile, 0);
  const browser = options.browser ?? await launch({ args: GPU_SWITCHES });
  const close = async (): Promise<void> => {
    if (!options.browser) await browser.close();
    server.close();
  };
  try {
    // Pictures come from a texture, so WebGPU is not asked to show anything unless the caller wants that.
    const url = `http://127.0.0.1:${server.port}/?paused${options.onscreen ? '' : '&offscreen'}${options.query ? `&${options.query}` : ''}`;
    const page = await browser.open(url, { width: options.width ?? 960, height: options.height ?? 600 });
    const state = await page.eval<{ error: string; ready: boolean }>(`new Promise((done) => {
      const started = Date.now();
      const poll = () => {
        const error = document.getElementById('error')?.textContent ?? '';
        if (window.kiln || error || Date.now() - started > 15000) done({ error, ready: !!window.kiln });
        else setTimeout(poll, 20);
      };
      poll();
    })`);
    if (!state.ready) throw new Error(state.error || page.errors()[0] || 'the player did not start');
    return { page, close };
  } catch (e) {
    await close();
    throw e;
  }
}

/**
 * Step the scene to a tick in the real player and take a picture of the game view.
 * This is how an agent sees what a person would see.
 */
export async function look(sceneFile: string, options: LookOptions = {}): Promise<Look> {
  const player = await openPlayer(sceneFile, options);
  try {
    const shot = await player.page.eval<{ renderer: string; png: string; tick: number; hash: string }>(
      `(async () => { const hash = kiln.runTo(${options.tick ?? 0}); const s = await kiln.shot(); return { ...s, tick: kiln.world.tick, hash }; })()`);
    const png = Buffer.from(shot.png.slice(shot.png.indexOf(',') + 1), 'base64');
    return { png, picture: decodePng(png), renderer: shot.renderer, tick: shot.tick, hash: shot.hash, errors: player.page.errors() };
  } finally {
    await player.close();
  }
}

/** A few lines saying what a picture shows, for a reader who has not opened it. */
export function describe(sceneFile: string, seen: Look): string {
  const s = summarize(seen.picture);
  const lines = [`ok look ${basename(sceneFile)} tick=${seen.tick} hash=${seen.hash} renderer=${seen.renderer} size=${seen.picture.width}x${seen.picture.height}`];
  lines.push(s.box
    ? `drawn ${(s.drawn * 100).toFixed(1)}% of the frame, ${s.colors} colors, inside x=${s.box.x0}..${s.box.x1} y=${s.box.y0}..${s.box.y1}`
    : 'W K401 the frame is one flat color: nothing was drawn (hint: check the camera or eye, and that entities have pos and box)');
  for (const error of seen.errors.slice(0, 5)) lines.push(`W K402 page error: ${error.split('\n')[0]}`);
  return lines.join('\n') + '\n';
}

/** The `look` command: save the picture and say in a few lines what is in it. */
export async function lookCommand(sceneFile: string, out: string | undefined, options: LookOptions): Promise<{ text: string; code: number }> {
  let seen: Look;
  try {
    seen = await look(sceneFile, options);
  } catch (e) {
    return { text: `E K400 look failed: ${(e as Error).message.split('\n')[0]}\n`, code: 2 };
  }
  const file = resolve(out ?? `${basename(sceneFile).replace(/\.kiln$/, '')}.png`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, seen.png);
  return { text: `${describe(sceneFile, seen)}image ${out ?? basename(file)} bytes=${seen.png.length}\n`, code: 0 };
}
