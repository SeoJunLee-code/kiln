import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * A headless Chrome (or Edge) driven over the DevTools protocol, with no
 * dependency: the browser is one already installed on the machine, and the
 * protocol runs over Node's own WebSocket.
 *
 * It exists so that what the player draws can be checked without a person
 * looking at it: load a page, run an expression in it, take a screenshot.
 */

const CANDIDATES: Record<string, string[]> = {
  win32: [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ],
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ],
  linux: [
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium',
    '/usr/bin/chromium-browser', '/snap/bin/chromium', '/usr/bin/microsoft-edge',
  ],
};

/** The browser to drive: `KILN_CHROME` if set, else the first well-known install found. */
export function findChrome(): string | undefined {
  const named = process.env.KILN_CHROME;
  if (named) return existsSync(named) ? named : undefined;
  return (CANDIDATES[process.platform] ?? []).find((p) => existsSync(p));
}

export interface Page {
  /** Run an expression in the page. A promise is awaited; the value must be JSON-serializable. */
  eval<T = unknown>(expression: string): Promise<T>;
  /** The page as PNG bytes. */
  screenshot(): Promise<Buffer>;
  /** Console errors and uncaught exceptions seen so far. */
  errors(): string[];
  /** A DevTools protocol call on this page, for what the calls above do not cover. */
  send(method: string, params?: object): Promise<any>;
}

export interface Browser {
  /** `size: null` leaves the page at the size of its window (a browser with a window only). */
  open(url: string, size?: { width: number; height: number } | null): Promise<Page>;
  close(): Promise<void>;
}

export interface LaunchOptions {
  /** Extra command-line switches, e.g. the ones that pick a GPU backend. */
  args?: string[];
  /** Show a real window instead of running headless: frames then go to the display, as they do for a player. */
  window?: { width: number; height: number };
  /** Milliseconds to wait for the browser to start and for each protocol call. */
  timeout?: number;
}

export async function launch(options: LaunchOptions = {}): Promise<Browser> {
  const exe = findChrome();
  if (!exe) throw new Error('no Chrome or Edge found; set KILN_CHROME to the browser executable');
  const timeout = options.timeout ?? 30000;
  const profile = mkdtempSync(join(tmpdir(), 'kiln-chrome-'));
  const child = spawn(exe, [
    ...(options.window ? [`--window-size=${options.window.width},${options.window.height}`, '--window-position=0,0'] : ['--headless=new']),
    '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars',
    '--force-device-scale-factor=1', '--force-color-profile=srgb',
    // A CI container has no user namespace for the sandbox; the pages opened here are the engine's own.
    ...(process.env.CI ? ['--no-sandbox'] : []),
    ...(options.args ?? []),
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  const endpoint = await new Promise<string>((ok, fail) => {
    let seen = '';
    const timer = setTimeout(() => fail(new Error(`browser did not start in ${timeout}ms: ${seen.slice(-300)}`)), timeout);
    child.stderr.on('data', (chunk: Buffer) => {
      seen += chunk.toString('utf8');
      const found = /DevTools listening on (ws:\/\/\S+)/.exec(seen);
      if (found) { clearTimeout(timer); ok(found[1]); }
    });
    child.once('exit', (code) => { clearTimeout(timer); fail(new Error(`browser exited with ${code}: ${seen.slice(-300)}`)); });
  });

  const socket = new WebSocket(endpoint);
  await new Promise<void>((ok, fail) => {
    socket.addEventListener('open', () => ok(), { once: true });
    socket.addEventListener('error', () => fail(new Error('could not connect to the browser')), { once: true });
  });

  let nextId = 1;
  const waiting = new Map<number, { ok: (v: any) => void; fail: (e: Error) => void }>();
  const listeners = new Set<(method: string, params: any, session: string | undefined) => void>();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id !== undefined) {
      const entry = waiting.get(message.id);
      if (!entry) return;
      waiting.delete(message.id);
      if (message.error) entry.fail(new Error(message.error.message));
      else entry.ok(message.result);
    } else {
      for (const listener of listeners) listener(message.method, message.params, message.sessionId);
    }
  });

  const send = (method: string, params: object = {}, sessionId?: string): Promise<any> =>
    new Promise((ok, fail) => {
      const id = nextId++;
      const timer = setTimeout(() => { waiting.delete(id); fail(new Error(`${method} did not answer in ${timeout}ms`)); }, timeout);
      waiting.set(id, {
        ok: (v) => { clearTimeout(timer); ok(v); },
        fail: (e) => { clearTimeout(timer); fail(e); },
      });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });

  return {
    async open(url, size = { width: 800, height: 600 }) {
      const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
      const errors: string[] = [];
      let loaded: () => void = () => {};
      const load = new Promise<void>((ok) => { loaded = ok; });
      listeners.add((method, params, session) => {
        if (session !== sessionId) return;
        if (method === 'Page.loadEventFired') loaded();
        if (method === 'Runtime.exceptionThrown') errors.push(params.exceptionDetails?.exception?.description ?? params.exceptionDetails?.text ?? 'exception');
        if (method === 'Runtime.consoleAPICalled' && params.type === 'error') errors.push(params.args.map((a: any) => a.value ?? a.description ?? '').join(' '));
      });
      await send('Page.enable', {}, sessionId);
      await send('Runtime.enable', {}, sessionId);
      if (size) await send('Emulation.setDeviceMetricsOverride', { ...size, deviceScaleFactor: 1, mobile: false }, sessionId);
      await send('Page.navigate', { url }, sessionId);
      await load;
      return {
        async eval(expression) {
          const reply = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
          if (reply.exceptionDetails) throw new Error(reply.exceptionDetails.exception?.description ?? reply.exceptionDetails.text);
          return reply.result.value;
        },
        async screenshot() {
          const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
          return Buffer.from(data, 'base64');
        },
        errors: () => errors.slice(),
        send: (method, params = {}) => send(method, params, sessionId),
      };
    },
    async close() {
      try { await send('Browser.close'); } catch { /* already gone */ }
      await new Promise<void>((ok) => { if (child.exitCode !== null) ok(); else { child.once('exit', () => ok()); setTimeout(() => { child.kill(); ok(); }, 3000); } });
      // The browser can hold the profile open for a moment after it exits.
      try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* a temp folder left behind is harmless */ }
    },
  };
}
