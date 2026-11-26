// Agent cost from a recorded agent run: tokens, time, tool calls, and the failures the agent
// met on the way. Input is the stream-json log of a headless Claude Code run
// (`claude -p ... --output-format stream-json --verbose`).
//   node scripts/agentcost.ts LOG.jsonl [--calls]
import { readFileSync } from 'node:fs';

type Block = { type: string; name?: string; id?: string; input?: Record<string, unknown>; tool_use_id?: string; content?: unknown; is_error?: boolean; text?: string };
type Line = {
  type: string; subtype?: string; model?: string;
  message?: { content?: Block[] | string };
  usage?: Record<string, unknown>; duration_ms?: number; num_turns?: number; total_cost_usd?: number; result?: string;
};

export type Call = { tool: string; cmd: string; failed: boolean; first: string };
export type Cost = {
  model: string; finished: boolean; turns: number; seconds: number;
  input: number; cacheWrite: number; cacheRead: number; output: number; usd: number;
  calls: Call[]; failures: number; byTool: Record<string, number>; failedBy: Record<string, number>;
};

const text = (c: unknown): string =>
  typeof c === 'string' ? c : Array.isArray(c) ? c.map((b) => (b as Block).text ?? '').join('') : '';

// A Kiln reply failed when it carries an error line, a failed expect, or ends in `fail`.
export function kilnFailed(reply: string): boolean {
  const lines = reply.trimEnd().split('\n');
  return lines.some((l) => /^E K\d+/.test(l) || /^FAIL /.test(l)) || /^fail\b/.test(lines[lines.length - 1] ?? '');
}

// A Godot run failed when the engine printed an error (it often still exits 0) or a check said so.
export function godotFailed(reply: string): boolean {
  return reply.split('\n').some((l) => /^\s*(SCRIPT ERROR|ERROR|Parse Error|FAIL(ED)?\b)/.test(l) || /^Exit code [1-9]/.test(l));
}

export function cost(log: string): Cost {
  const out: Cost = {
    model: '', finished: false, turns: 0, seconds: 0, input: 0, cacheWrite: 0, cacheRead: 0, output: 0, usd: 0,
    calls: [], failures: 0, byTool: {}, failedBy: {},
  };
  const open = new Map<string, Call>();
  for (const raw of log.split('\n')) {
    if (!raw.trim()) continue;
    let m: Line;
    try { m = JSON.parse(raw); } catch { continue; }
    if (m.type === 'system' && m.subtype === 'init') out.model = m.model ?? '';
    const blocks = Array.isArray(m.message?.content) ? m.message.content : [];
    for (const b of blocks) {
      if (b.type === 'tool_use' && b.id) {
        const kiln = b.name === 'mcp__kiln__kiln';
        // A shell call is named by the program it runs (`cd game && godot ...` is a godot call).
        const shell = b.name === 'Bash' || b.name === 'PowerShell' ? (/(?:^|&&|;|\|)\s*(?!cd\b)([\w.-]+)/.exec(String(b.input?.command ?? ''))?.[1] ?? '?') : '';
        const call: Call = { tool: kiln ? 'kiln' : shell ? 'shell' : b.name ?? '?', cmd: kiln ? String(b.input?.cmd ?? '?') : shell, failed: false, first: '' };
        open.set(b.id, call);
        out.calls.push(call);
      } else if (b.type === 'tool_result' && b.tool_use_id) {
        const call = open.get(b.tool_use_id);
        if (!call) continue;
        const reply = text(b.content);
        call.failed = !!b.is_error || (call.tool === 'kiln' ? kilnFailed(reply) : call.cmd === 'godot' && godotFailed(reply));
        call.first = (reply.split('\n').find((l) => /^(E K\d+|FAIL |fail\b|\s*(SCRIPT ERROR|ERROR|Parse Error))/.test(l)) ?? reply.split('\n')[0] ?? '').slice(0, 110);
      }
    }
    if (m.type === 'result') {
      const u = m.usage ?? {};
      out.finished = m.subtype === 'success';
      out.turns = m.num_turns ?? 0;
      out.seconds = Math.round((m.duration_ms ?? 0) / 1000);
      out.input = Number(u.input_tokens ?? 0);
      out.cacheWrite = Number(u.cache_creation_input_tokens ?? 0);
      out.cacheRead = Number(u.cache_read_input_tokens ?? 0);
      out.output = Number(u.output_tokens ?? 0);
      out.usd = m.total_cost_usd ?? 0;
    }
  }
  for (const c of out.calls) {
    const key = c.cmd ? `${c.tool} ${c.cmd}` : c.tool;
    out.byTool[key] = (out.byTool[key] ?? 0) + 1;
    if (c.failed) { out.failures++; out.failedBy[key] = (out.failedBy[key] ?? 0) + 1; }
  }
  return out;
}

export function report(c: Cost): string {
  const n = (v: number): string => v.toLocaleString('en-US');
  const list = (r: Record<string, number>): string => Object.entries(r).map(([k, v]) => `${k} ${v}`).join(', ') || 'none';
  return [
    `model            ${c.model}`,
    `ended by itself  ${c.finished ? 'yes' : 'no'}`,
    `time             ${Math.floor(c.seconds / 60)}m ${c.seconds % 60}s`,
    `turns            ${c.turns}`,
    `tokens out       ${n(c.output)}`,
    `tokens in        ${n(c.input + c.cacheWrite + c.cacheRead)} (new ${n(c.input + c.cacheWrite)}, reread from cache ${n(c.cacheRead)})`,
    `cost at API price  $${c.usd.toFixed(2)}`,
    `tool calls       ${c.calls.length}: ${list(c.byTool)}`,
    `failed calls     ${c.failures}: ${list(c.failedBy)}`,
  ].join('\n') + '\n';
}

if (process.argv[1]?.endsWith('agentcost.ts')) {
  const file = process.argv[2];
  if (!file) { console.error('usage: node scripts/agentcost.ts LOG.jsonl [--calls]'); process.exit(2); }
  const c = cost(readFileSync(file, 'utf8'));
  process.stdout.write(report(c));
  if (process.argv.includes('--calls')) {
    c.calls.forEach((k, i) => console.log(`${String(i + 1).padStart(3)} ${k.failed ? 'x' : ' '} ${k.cmd ? k.tool + ' ' + k.cmd : k.tool}${k.failed ? '  ' + k.first : ''}`));
  }
}
