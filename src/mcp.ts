// Minimal MCP server over stdio (newline-delimited JSON-RPC 2.0), no dependencies.
// It exposes a single tool on purpose: every tool definition costs the agent context on every turn.
import { createInterface } from 'node:readline';
import { COMMANDS, command } from './commands.ts';

const TOOL = {
  name: 'kiln',
  description:
    'Kiln game engine. Call cmd=guide first: it returns the whole manual. cmd: check (validate a scene), run (simulate headless, returns state hash), ' +
    'test (run and evaluate the scene\'s expect lines), solve (search for an input script that meets the expects), ' +
    'schema (component reference), guide (manual), look (draw the scene in a headless browser and return the picture; ticks = tick to stop at). ' +
    'Output is compact text; errors are lines starting with "E CODE file:line".',
  inputSchema: {
    type: 'object',
    properties: {
      cmd: { type: 'string', enum: [...COMMANDS, 'look'] },
      file: { type: 'string', description: 'scene file path' },
      scene: { type: 'string', description: 'scene text, instead of file' },
      input: { type: 'string', description: 'input script text: "TICK ACTION down|up" lines' },
      input_file: { type: 'string' },
      ticks: { type: 'integer', minimum: 0 },
      step: { type: 'integer', minimum: 1, description: 'solve: ticks per key choice (default 5)' },
      view: { type: 'boolean', description: 'append ASCII picture of the final state' },
      top: { type: 'boolean', description: 'append ASCII floor plan (x/z plane) for 3D scenes' },
      observe: { type: 'boolean', description: 'append one line per entity' },
      events: { type: 'boolean', description: 'append emitted events' },
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
        if (typeof a.file !== 'string') return { content: [{ type: 'text', text: 'E K002 look needs file\n' }], isError: true };
        const { look, describe } = await import('./look.ts');
        try {
          const seen = await look(a.file, { tick: a.ticks as number | undefined, inputFile: a.input_file as string | undefined });
          return { content: [{ type: 'text', text: describe(a.file, seen) }, { type: 'image', data: seen.png.toString('base64'), mimeType: 'image/png' }] };
        } catch (e) {
          return { content: [{ type: 'text', text: `E K400 look failed: ${(e as Error).message.split('\n')[0]}\n` }], isError: true };
        }
      }
      const r = await command(String(a.cmd), {
        file: a.file as string | undefined,
        scene: a.scene as string | undefined,
        input: a.input as string | undefined,
        inputFile: a.input_file as string | undefined,
        ticks: a.ticks as number | undefined,
        stepTicks: a.step as number | undefined,
        view: !!a.view, top: !!a.top, observe: !!a.observe, events: !!a.events,
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
