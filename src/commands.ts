import { readFileSync, writeFileSync } from 'node:fs';
import { parseExpects } from './expect.ts';
import { loadMods } from './load.ts';
import { observe, run, view } from './run.ts';
import { KilnFail, parseScene, schemaText, serialize } from './scene.ts';

export const COMMANDS = ['check', 'run', 'test', 'schema'];

export interface CmdArgs {
  /** scene path; `use` paths resolve relative to it */
  file?: string;
  /** scene text, instead of reading `file` */
  scene?: string;
  input?: string;
  inputFile?: string;
  ticks?: number;
  view?: boolean;
  observe?: boolean;
  events?: boolean;
  out?: string;
}

/** Run one engine command. Shared by the CLI and the MCP server. Exit code: 0 ok, 1 expectation failed, 2 error. */
export async function command(cmd: string, a: CmdArgs): Promise<{ text: string; code: number }> {
  const out: string[] = [];
  const done = (code: number) => ({ text: out.join('\n') + '\n', code });
  if (!COMMANDS.includes(cmd)) return out.push(`E K003 unknown command '${cmd}' (hint: valid: ${COMMANDS.join(' ')})`), done(2);
  if (cmd === 'schema' && !a.file && a.scene === undefined) return { text: schemaText(), code: 0 };

  const file = a.file ?? 'scene';
  let text = a.scene, input = a.input;
  try {
    text ??= readFileSync(file, 'utf8');
    if (input === undefined && a.inputFile) input = readFileSync(a.inputFile, 'utf8');
  } catch (e) {
    return out.push(`E K001 cannot read file: ${(e as Error).message}`), done(2);
  }
  if (a.ticks !== undefined && !(Number.isInteger(a.ticks) && a.ticks >= 0)) return out.push('E K002 ticks must be a non-negative integer'), done(2);

  try {
    const mods = await loadMods(text, file);
    if (cmd === 'schema') return { text: schemaText(), code: 0 };
    if (cmd === 'check') {
      const s = parseScene(text, file);
      parseExpects(s.expects, s.world, file);
      out.push(`ok entities=${s.world.ids.size} expects=${s.expects.length} scripts=${s.uses.length}`);
      return done(0);
    }
    const r = run(text, { input, file, inputFile: a.inputFile, ticks: a.ticks, mods });
    if (cmd === 'test') {
      for (const e of r.expects) out.push(`${e.ok ? 'pass' : 'FAIL'} ${file}:${e.line} ${e.text}${e.note ? ` -- ${e.note}` : ''}`);
      if (!r.expects.length) out.push(`W K300 ${file} has no expect lines`);
    }
    if (a.events) for (const ev of r.world.events) out.push(`event ${ev.tick} ${ev.name} ${ev.a} ${ev.b}`.trimEnd());
    if (a.observe) out.push(observe(r.world).trimEnd());
    if (a.view) out.push(view(r.world).trimEnd());
    if (a.out) writeFileSync(a.out, serialize(r.world, [], r.uses));
    const failed = r.expects.filter((e) => !e.ok).length;
    const bad = cmd === 'test' && failed > 0;
    out.push(`${bad ? 'fail' : 'ok'} tick=${r.world.tick} hash=${r.hash}${cmd === 'test' ? ` passed=${r.expects.length - failed} failed=${failed}` : ''}`);
    return done(bad ? 1 : 0);
  } catch (e) {
    if (!(e instanceof KilnFail)) throw e;
    out.push(e.message, `fail errors=${e.diags.length}`);
    return done(2);
  }
}
