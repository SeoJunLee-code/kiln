import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cost, godotFailed, kilnFailed, report } from '../scripts/agentcost.ts';

const line = (o: unknown): string => JSON.stringify(o);
const use = (id: string, name: string, input: Record<string, unknown>): string =>
  line({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } });
const result = (id: string, content: unknown, is_error = false): string =>
  line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content, is_error }] } });

test('a Kiln reply fails on an error line, a failed expect or a last line of fail', () => {
  assert.equal(kilnFailed('E K101 a.kiln:3 unknown component\nfail 1 error\n'), true);
  assert.equal(kilnFailed('pass a.kiln:9 expect gone #gem by 600\nFAIL a.kiln:10 expect event load by 600 -- never\nfail 1/2\n'), true);
  assert.equal(kilnFailed('fail solve: no input found\n'), true);
  assert.equal(kilnFailed('pass a.kiln:9 expect gone #gem by 600\nok 1/1\n'), false);
  assert.equal(kilnFailed('W K310 a.kiln a tag nothing refers to\nok edition=lite\n'), false);
});

test('agent cost: tokens, time, calls and failures are read from a run log', () => {
  const log = [
    line({ type: 'system', subtype: 'init', model: 'some-model' }),
    use('1', 'mcp__kiln__kiln', { cmd: 'guide' }),
    result('1', [{ type: 'text', text: 'KILN GUIDE\n' }]),
    use('2', 'Write', { file_path: 'game/a.kiln' }),
    result('2', 'File created'),
    use('3', 'mcp__kiln__kiln', { cmd: 'check', file: 'game/a.kiln' }),
    result('3', [{ type: 'text', text: 'E K101 game/a.kiln:3 unknown component\nfail 1 error\n' }], true),
    use('4', 'mcp__kiln__kiln', { cmd: 'check', file: 'game/a.kiln' }),
    result('4', [{ type: 'text', text: 'ok edition=lite\n' }]),
    'not json',
    line({ type: 'result', subtype: 'success', num_turns: 5, duration_ms: 61500, total_cost_usd: 0.1234,
      usage: { input_tokens: 10, cache_creation_input_tokens: 2000, cache_read_input_tokens: 30000, output_tokens: 400 } }),
  ].join('\n');
  const c = cost(log);
  assert.equal(c.model, 'some-model');
  assert.equal(c.finished, true);
  assert.equal(c.seconds, 62);
  assert.deepEqual([c.input, c.cacheWrite, c.cacheRead, c.output], [10, 2000, 30000, 400]);
  assert.equal(c.calls.length, 4);
  assert.equal(c.failures, 1);
  assert.deepEqual(c.byTool, { 'kiln guide': 1, Write: 1, 'kiln check': 2 });
  assert.deepEqual(c.failedBy, { 'kiln check': 1 });
  assert.match(c.calls[2].first, /^E K101/);
  const r = report(c);
  assert.match(r, /tokens in +32,010 \(new 2,010, reread from cache 30,000\)/);
  assert.match(r, /failed calls +1: kiln check 1/);
});

test('a run cut off before its result line is not counted as finished', () => {
  const c = cost(use('1', 'mcp__kiln__kiln', { cmd: 'guide' }));
  assert.equal(c.finished, false);
  assert.equal(c.calls.length, 1);
});

test('agent cost: a shell call is named by its program, and a Godot run fails on an engine error or a non-zero exit', () => {
  assert.equal(godotFailed('Godot Engine v4\n\n48 checks, 0 failed\n'), false);
  assert.equal(godotFailed('Godot Engine v4\nSCRIPT ERROR: Parse Error: x\n   at: y\n'), true);
  assert.equal(godotFailed('Exit code 1\nGodot Engine v4\n'), true);
  assert.equal(godotFailed('  FAIL parses cleanly: res://a.gd\n'), true);
  const c = cost([
    use('1', 'PowerShell', { command: 'godot --headless --path game --script res://t.gd' }),
    result('1', 'Godot Engine v4\n48 checks, 0 failed\n'),
    use('2', 'Bash', { command: 'cd game && godot --headless --quit' }),
    result('2', 'Godot Engine v4\nERROR: Failed to load script\n'),
    use('3', 'PowerShell', { command: 'godot --version | Select-String 4' }),
    result('3', 'requires manual approval', true),
    use('4', 'PowerShell', { command: 'Get-ChildItem' }),
    result('4', 'ERROR: this is not Godot speaking\n'),
  ].join('\n'));
  assert.deepEqual(c.byTool, { 'shell godot': 3, 'shell Get-ChildItem': 1 });
  assert.deepEqual(c.failedBy, { 'shell godot': 2 });
});

test('agent cost: time is split into waiting for the model and inside tools, side-by-side calls counted once', () => {
  const at = (s: number): string => new Date(Date.UTC(2026, 0, 1, 0, 0, s)).toISOString();
  const uses = (s: number, ...ids: string[]): string => line({ type: 'assistant', timestamp: at(s),
    message: { content: ids.map((id) => ({ type: 'tool_use', id, name: 'PowerShell', input: { command: id === 'c' ? 'Get-ChildItem' : 'godot --headless' } })) } });
  const answer = (s: number, id: string): string => line({ type: 'user', timestamp: at(s),
    message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } });
  const c = cost([
    uses(0, 'a', 'b'), answer(40, 'a'), answer(60, 'b'),
    uses(100, 'c'), answer(103, 'c'),
    line({ type: 'result', subtype: 'error_max_budget_usd', duration_ms: 200000, duration_api_ms: 90000 }),
  ].join('\n'));
  assert.deepEqual(c.calls.map((k) => k.ms), [40000, 60000, 3000]);
  assert.equal(c.toolSeconds, 63);
  assert.equal(c.modelSeconds, 90);
  assert.deepEqual(c.secondsBy, { 'shell godot': 100, 'shell Get-ChildItem': 3 });
  assert.equal(c.finished, false);
  const r = report(c);
  assert.match(r, /ended by itself +no \(error_max_budget_usd\)/);
  assert.match(r, /for the model +1m 30s/);
  assert.match(r, /inside tools +1m 3s: shell godot 1m 40s, shell Get-ChildItem 0m 3s/);
  // A log without times still counts calls; their time is unknown, not zero.
  assert.equal(cost(use('1', 'Write', {})).calls[0].ms, -1);
});

test('agent cost: a run woken again after its last turn is added up over its result lines', () => {
  const end = (turns: number, ms: number, apiMs: number, usd: number, out: number): string =>
    line({ type: 'result', subtype: 'success', num_turns: turns, duration_ms: ms, duration_api_ms: apiMs, total_cost_usd: usd,
      usage: { input_tokens: 1, cache_creation_input_tokens: 10, cache_read_input_tokens: 100, output_tokens: out } });
  const c = cost([end(42, 541000, 231000, 0.65, 300), end(10, 134000, 262000, 0.75, 40)].join('\n'));
  assert.deepEqual([c.turns, c.seconds, c.modelSeconds, c.usd, c.stretches], [52, 675, 262, 0.75, 2]);
  assert.deepEqual([c.input, c.cacheWrite, c.cacheRead, c.output], [2, 20, 200, 340]);
  assert.match(report(c), /time +11m 15s in 2 stretches/);
});
