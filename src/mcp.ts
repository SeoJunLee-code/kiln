// Minimal MCP server over stdio (newline-delimited JSON-RPC 2.0), no dependencies.
// It exposes a single tool on purpose: every tool definition costs the agent context on every turn.
import { createInterface } from 'node:readline';
import { COMMANDS, command } from './commands.ts';

const TOOL = {
  name: 'kiln',
  description:
    'Kiln game engine. cmd: check (validate a scene), run (simulate headless, returns state hash), ' +
    'test (run and evaluate the scene\'s expect lines), schema (component reference). ' +
    'Output is compact text; errors are lines starting with "E CODE file:line".',
  inputSchema: {
    type: 'object',
    properties: {
      cmd: { type: 'string', enum: COMMANDS },
      file: { type: 'string', description: 'scene file path' },
      scene: { type: 'string', description: 'scene text, instead of file' },
      input: { type: 'string', description: 'input script text: "TICK ACTION down|up" lines' },
      input_file: { type: 'string' },
      ticks: { type: 'integer', minimum: 0 },
      view: { type: 'boolean', description: 'append ASCII picture of the final state' },
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
      const r = await command(String(a.cmd), {
        file: a.file as string | undefined,
        scene: a.scene as string | undefined,
        input: a.input as string | undefined,
        inputFile: a.input_file as string | undefined,
        ticks: a.ticks as number | undefined,
        view: !!a.view, observe: !!a.observe, events: !!a.events,
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
