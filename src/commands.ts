import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseExpects } from './expect.ts';
import { guideText } from './guide.ts';
import { loadMods } from './load.ts';
import { observe, run, view } from './run.ts';
import { KilnFail, parseScene, schemaText, serialize } from './scene.ts';
import { solve } from './solve.ts';

export const COMMANDS = ['check', 'run', 'test', 'solve', 'schema', 'guide'];

export interface CmdArgs {
  /** scene path; `use` paths resolve relative to it */
  file?: string;
  /** scene text, instead of reading `file` */
  scene?: string;
  input?: string;
  inputFile?: string;
  ticks?: number;
  view?: boolean;
  /** like view, but looking down on the x/z plane (3D floor plan) */
  top?: boolean;
  observe?: boolean;
  events?: boolean;
  out?: string;
  /** solve: ticks each key choice is held (default 5) */
  stepTicks?: number;
  /** solve: give up after this many distinct states (default 200000) */
  maxStates?: number;
}

/** Run one engine command. Shared by the CLI and the MCP server. Exit code: 0 ok, 1 expectation failed, 2 error. */
export async function command(cmd: string, a: CmdArgs): Promise<{ text: string; code: number }> {
  const out: string[] = [];
  const done = (code: number) => ({ text: out.join('\n') + '\n', code });
  if (!COMMANDS.includes(cmd)) return out.push(`E K003 unknown command '${cmd}' (hint: valid: ${COMMANDS.join(' ')})`), done(2);
  if (cmd === 'guide') return { text: guideText(), code: 0 };
  if (cmd === 'schema' && !a.file && a.scene === undefined) return { text: schemaText(), code: 0 };

  // `test DIR`: every scene in the folder, each with the input file of the same name if there is one.
  if (cmd === 'test' && a.file && a.scene === undefined && existsSync(a.file) && statSync(a.file).isDirectory()) {
    const scenes = readdirSync(a.file).filter((f) => f.endsWith('.kiln')).sort();
    if (!scenes.length) return out.push(`E K001 no .kiln files in ${a.file}`), done(2);
    let worst = 0, passed = 0;
    for (const f of scenes) {
      const input = join(a.file, f.replace(/\.kiln$/, '.input'));
      const r = await command('test', { file: join(a.file, f), inputFile: existsSync(input) ? input : undefined });
      const lines = r.text.trimEnd().split('\n');
      // One line per scene when it passes; everything it said when it does not.
      if (r.code === 0) { passed++; out.push(`${f} ${lines.at(-1)}`); }
      else out.push(...lines.map((l) => `${f} ${l}`));
      worst = Math.max(worst, r.code);
    }
    out.push(`${worst ? 'fail' : 'ok'} scenes=${scenes.length} passed=${passed} failed=${scenes.length - passed}`);
    return done(worst);
  }

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
    if (cmd === 'solve') {
      const s = solve(text, { file, mods, stepTicks: a.stepTicks, maxStates: a.maxStates });
      if (!s.ok) {
        out.push(`fail ${s.note}`);
        // Show where the furthest attempt ended, so the level can be fixed without guessing.
        if (s.input) {
          const far = run(text, { input: s.input, file, mods, ticks: s.tick - parseScene(text, file).world.tick });
          out.push(`furthest attempt, tick ${s.tick}:`, view(far.world).trimEnd());
          if (a.out) writeFileSync(a.out, s.input);
        }
        out.push(`fail tick=${s.tick} states=${s.states}${a.out && s.input ? ` wrote=${a.out} (furthest attempt, not a solution)` : ''}`);
        return done(1);
      }
      // Replay the answer through the normal path, so a solution is never reported without being checked.
      const check = run(text, { input: s.input, file, mods, ticks: s.tick - parseScene(text, file).world.tick });
      const broken = check.expects.filter((e) => e.kind !== 'at' && e.kind !== 'count' && e.ok === false);
      if (broken.length) return out.push(`E K131 solver answer failed replay: ${broken[0].text}`), done(2);
      if (a.out) writeFileSync(a.out, s.input);
      out.push(s.input.trimEnd(), `ok solved tick=${s.tick} states=${s.states}${a.out ? ` wrote=${a.out}` : ''}`);
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
    if (a.top) out.push(view(r.world, 'xz').trimEnd());
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
