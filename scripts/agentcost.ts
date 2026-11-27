// Agent cost from a recorded agent run: tokens, time, tool calls, and the failures the agent
// met on the way. Input is the stream-json log of a headless Claude Code run
// (`claude -p ... --output-format stream-json --verbose`).
//   node scripts/agentcost.ts LOG.jsonl [--calls]
// Lines of the log carry the time they were written, so a call's time is the gap between the
// line that asked for it and the line that answered.
import { readFileSync } from 'node:fs';

type Block = { type: string; name?: string; id?: string; input?: Record<string, unknown>; tool_use_id?: string; content?: unknown; is_error?: boolean; text?: string };
type Line = {
  type: string; subtype?: string; model?: string; timestamp?: string; duration_api_ms?: number;
  message?: { content?: Block[] | string };
  usage?: Record<string, unknown>; duration_ms?: number; num_turns?: number; total_cost_usd?: number; result?: string;
};

// ms: from the line that asked for the call to the line that answered it; -1 when the log has no times.
export type Call = { tool: string; cmd: string; failed: boolean; first: string; ms: number };
export type Cost = {
  model: string; finished: boolean; ended: string; turns: number; seconds: number;
  // The run's time in two parts: waiting for the model (the provider's own figure) and inside
  // tool calls (calls that ran side by side are counted once). The rest is the harness.
  modelSeconds: number; toolSeconds: number; secondsBy: Record<string, number>;
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
    model: '', finished: false, ended: 'cut off', turns: 0, seconds: 0, modelSeconds: 0, toolSeconds: 0, secondsBy: {}, input: 0, cacheWrite: 0, cacheRead: 0, output: 0, usd: 0,
    calls: [], failures: 0, byTool: {}, failedBy: {},
  };
  const open = new Map<string, Call>();
  const began = new Map<string, number>();
  const spans: [number, number][] = [];
  for (const raw of log.split('\n')) {
    if (!raw.trim()) continue;
    let m: Line;
    try { m = JSON.parse(raw); } catch { continue; }
    if (m.type === 'system' && m.subtype === 'init') out.model = m.model ?? '';
    const at = m.timestamp ? Date.parse(m.timestamp) : NaN;
    const blocks = Array.isArray(m.message?.content) ? m.message.content : [];
    for (const b of blocks) {
      if (b.type === 'tool_use' && b.id) {
        const kiln = b.name === 'mcp__kiln__kiln';
        // A shell call is named by the program it runs (`cd game && godot ...` is a godot call).
        const shell = b.name === 'Bash' || b.name === 'PowerShell' ? (/(?:^|&&|;|\|)\s*(?!cd\b)([\w.-]+)/.exec(String(b.input?.command ?? ''))?.[1] ?? '?') : '';
        const call: Call = { tool: kiln ? 'kiln' : shell ? 'shell' : b.name ?? '?', cmd: kiln ? String(b.input?.cmd ?? '?') : shell, failed: false, first: '', ms: -1 };
        open.set(b.id, call);
        began.set(b.id, at);
        out.calls.push(call);
      } else if (b.type === 'tool_result' && b.tool_use_id) {
        const call = open.get(b.tool_use_id);
        if (!call) continue;
        const from = began.get(b.tool_use_id) ?? NaN;
        if (at >= from) { call.ms = at - from; spans.push([from, at]); }
        const reply = text(b.content);
        call.failed = !!b.is_error || (call.tool === 'kiln' ? kilnFailed(reply) : call.cmd === 'godot' && godotFailed(reply));
        call.first = (reply.split('\n').find((l) => /^(E K\d+|FAIL |fail\b|\s*(SCRIPT ERROR|ERROR|Parse Error))/.test(l)) ?? reply.split('\n')[0] ?? '').slice(0, 110);
      }
    }
    if (m.type === 'result') {
      const u = m.usage ?? {};
      out.finished = m.subtype === 'success';
      out.ended = m.subtype ?? '?';
      out.modelSeconds = Math.round((m.duration_api_ms ?? 0) / 1000);
      out.turns = m.num_turns ?? 0;
      out.seconds = Math.round((m.duration_ms ?? 0) / 1000);
      out.input = Number(u.input_tokens ?? 0);
      out.cacheWrite = Number(u.cache_creation_input_tokens ?? 0);
      out.cacheRead = Number(u.cache_read_input_tokens ?? 0);
      out.output = Number(u.output_tokens ?? 0);
      out.usd = m.total_cost_usd ?? 0;
    }
  }
  let ms = 0, end = -Infinity;
  for (const [a, b] of spans.sort((x, y) => x[0] - y[0])) { if (b > end) { ms += b - Math.max(a, end); end = b; } }
  out.toolSeconds = Math.round(ms / 1000);
  const msBy: Record<string, number> = {};
  for (const c of out.calls) {
    const key = c.cmd ? `${c.tool} ${c.cmd}` : c.tool;
    if (c.ms > 0) msBy[key] = (msBy[key] ?? 0) + c.ms;
    out.byTool[key] = (out.byTool[key] ?? 0) + 1;
    if (c.failed) { out.failures++; out.failedBy[key] = (out.failedBy[key] ?? 0) + 1; }
  }
  for (const [k, v] of Object.entries(msBy).sort((x, y) => y[1] - x[1])) if (v >= 500) out.secondsBy[k] = Math.round(v / 1000);
  return out;
}

export function report(c: Cost): string {
  const n = (v: number): string => v.toLocaleString('en-US');
  const list = (r: Record<string, number>): string => Object.entries(r).map(([k, v]) => `${k} ${v}`).join(', ') || 'none';
  const t = (v: number): string => `${Math.floor(v / 60)}m ${v % 60}s`;
  return [
    `model            ${c.model}`,
    `ended by itself  ${c.finished ? 'yes' : `no (${c.ended})`}`,
    `time             ${t(c.seconds)}`,
    `  for the model  ${t(c.modelSeconds)}`,
    `  inside tools   ${t(c.toolSeconds)}${Object.keys(c.secondsBy).length ? ': ' + Object.entries(c.secondsBy).map(([k, v]) => `${k} ${t(v)}`).join(', ') : ''}`,
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
    c.calls.forEach((k, i) => console.log(`${String(i + 1).padStart(3)} ${k.failed ? 'x' : ' '} ${k.cmd ? k.tool + ' ' + k.cmd : k.tool}${k.ms >= 0 ? ` ${(k.ms / 1000).toFixed(1)}s` : ''}${k.failed ? '  ' + k.first : ''}`));
  }
}
