// Minimal MCP server over stdio (newline-delimited JSON-RPC 2.0), no dependencies.
// It exposes a single tool on purpose: every tool definition costs the agent context on every turn.
import { createInterface } from 'node:readline';
import { Worker } from 'node:worker_threads';
import { COMMANDS, command } from './commands.ts';
import type { CmdArgs } from './commands.ts';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A client gives up on a call after some minutes and drops the server with it, so the
// server gives up first and says why.
const LIMIT_MS = Number(process.env.KILN_TIMEOUT_MS) || 240_000;

type Reply = { text: string; code: number };

/** Run a command that loads the game's scripts in a new thread (see worker.ts). */
function fresh(cmd: string, args: CmdArgs): Promise<Reply> {
  return new Promise((ok) => {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { workerData: { cmd, args }, stdout: true });
    worker.stdout.resume();
    let done = false;
    const end = (r: Reply): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      ok(r);
      void worker.terminate();
    };
    const fail = (why: string, hint: string): void => end({ text: `E K005 ${cmd} ${why} (hint: ${hint})\nfail\n`, code: 2 });
    const timer = setTimeout(() => fail(`stopped after ${LIMIT_MS / 1000} s`,
      cmd === 'solve' ? 'solve a smaller scene, or give a larger step' : 'run fewer ticks, or look for a loop that never ends in a script'), LIMIT_MS);
    worker.once('message', end);
    worker.once('error', (e: Error) => fail(`crashed: ${e.message.split('\n')[0]}`, 'the server is still up'));
    worker.once('exit', (code) => fail(`stopped without a reply, exit ${code}`, 'a script must not end the process'));
  });
}

const TOOL = {
  name: 'kiln',
  description:
    'Kiln game engine. Call cmd=guide first: it returns the manual. cmd: check (validate a scene), run (simulate headless, returns state hash), ' +
    'test (run and evaluate the scene\'s expect lines), solve (search for an input script that meets the expects), ' +
    'schema (component reference), guide (manual), look (draw the scene in a headless browser and return the picture; ticks = tick to stop at), ' +
    'apply (write files and/or exact edits, then check and test the game folder, all in this one call: use it for every change), ' +
    'diff (first tick at which two runs differ, and in what). ' +
    'Output is compact text; errors are lines starting with "E CODE file:line".',
  inputSchema: {
    type: 'object',
    properties: {
      cmd: { type: 'string', enum: [...COMMANDS, 'look'] },
      file: { type: 'string', description: 'scene file path' },
      scene: { type: 'string', description: 'scene text, instead of file' },
      input: { type: 'string', description: 'input script text: "TICK ACTION down|up" lines' },
      input_file: { type: 'string' },
      topic: { type: 'string', description: 'guide: a part of the manual the guide lists (physics, view)' },
      edition: { type: 'string', description: 'check: lite, standard or ultra; needing more is an error' },
      ticks: { type: 'integer', minimum: 0 },
      step: { type: 'integer', minimum: 1, description: 'solve: ticks per key choice (default 5)' },
      view: { type: 'boolean', description: 'append ASCII picture of the final state' },
      top: { type: 'boolean', description: 'append ASCII floor plan (x/z plane) for 3D scenes' },
      observe: { type: 'boolean', description: 'append one line per entity' },
      events: { type: 'boolean', description: 'append emitted events' },
      follow: { type: 'boolean', description: 'test, run: when the scene loads another, go on in it with its NAME.input' },
      files: { type: 'array', description: 'apply: files to write whole, paths inside the game folder', items: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
      edits: { type: 'array', description: 'apply: exact replacements in existing files; old must match once', items: { type: 'object', properties: { path: { type: 'string' }, old: { type: 'string' }, new: { type: 'string' } }, required: ['path', 'old', 'new'] } },
      test: { type: 'boolean', description: 'apply: false = write and check only' },
      watch: { type: 'string', description: 'run, test, apply: values to print during the run, e.g. "ball.pos,lives.tally.n"' },
      at: { type: 'string', description: 'with watch: ticks, e.g. "0,60,120" (default: each second)' },
      against: { type: 'string', description: 'diff: the other input file (same scene) or scene file (same input)' },
      budget: { type: 'integer', minimum: 1, description: 'solve: seconds before giving up with the furthest attempt (default 60)' },
    },
    required: ['cmd'],
  },
};

type Msg = { id?: unknown; method?: string; params?: Record<string, unknown> };
const send = (m: unknown): void => void process.stdout.write(JSON.stringify(m) + '\n');

async function handle(msg: Msg): Promise<unknown> {
  switch (msg.method) {
    case 'initialize':
      return {
        protocolVersion: (msg.params?.protocolVersion as string) ?? '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'kiln', version: '0.0.1' },
      };
    case 'ping':
      return {};
    case 'tools/list':
      return { tools: [TOOL] };
    case 'tools/call': {
      if (msg.params?.name !== 'kiln') throw { code: -32602, message: `unknown tool '${msg.params?.name}'` };
      const a = (msg.params.arguments ?? {}) as Record<string, unknown>;
      // look answers with the picture itself, so the agent sees the frame without a second call.
      if (a.cmd === 'look') {
        if (typeof a.file !== 'string' && typeof a.scene !== 'string') return { content: [{ type: 'text', text: 'E K002 look needs file or scene\n' }], isError: true };
        const { look, describe } = await import('./look.ts');
        // Scene text is drawn from a file of its own, outside the game: a use or an image path in it finds nothing.
        const dir = typeof a.file === 'string' ? undefined : mkdtempSync(join(tmpdir(), 'kiln-look-'));
        const file = dir ? join(dir, 'scene.kiln') : a.file as string;
        try {
          if (dir) writeFileSync(file, a.scene as string);
          const seen = await look(file, { tick: a.ticks as number | undefined, inputFile: a.input_file as string | undefined });
          return { content: [{ type: 'text', text: describe(file, seen) }, { type: 'image', data: seen.png.toString('base64'), mimeType: 'image/png' }] };
        } catch (e) {
          return { content: [{ type: 'text', text: `E K400 look failed: ${(e as Error).message.split('\n')[0]}\n` }], isError: true };
        } finally {
          if (dir) rmSync(dir, { recursive: true, force: true });
        }
      }
      const cmd = String(a.cmd);
      // guide reads no game; every other command may import scripts.
      const r = await (cmd === 'guide' ? command : fresh)(cmd, {
        file: a.file as string | undefined,
        scene: a.scene as string | undefined,
        input: a.input as string | undefined,
        inputFile: a.input_file as string | undefined,
        ticks: a.ticks as number | undefined,
        topic: a.topic as string | undefined,
        edition: a.edition as string | undefined,
        stepTicks: a.step as number | undefined,
        files: a.files as CmdArgs['files'], edits: a.edits as CmdArgs['edits'], test: a.test as boolean | undefined,
        watch: a.watch as string | undefined, at: a.at as string | undefined, against: a.against as string | undefined, budget: a.budget as number | undefined,
        view: !!a.view, top: !!a.top, observe: !!a.observe, events: !!a.events, follow: !!a.follow,
      });
      return { content: [{ type: 'text', text: r.text }], isError: r.code === 2 };
    }
    default:
      throw { code: -32601, message: `method not found: ${msg.method}` };
  }
}

// Requests are answered in arrival order.
let queue = Promise.resolve();
createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return;
  let msg: Msg;
  try { msg = JSON.parse(line); } catch { return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }); }
  if (msg.id === undefined) return; // notification
  queue = queue.then(async () => {
    try { send({ jsonrpc: '2.0', id: msg.id, result: await handle(msg) }); }
    catch (e) {
      const err = e as { code?: number; message?: string };
      send({ jsonrpc: '2.0', id: msg.id, error: { code: err.code ?? -32603, message: err.message ?? String(e) } });
    }
  });
});
