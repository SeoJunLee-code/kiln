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
