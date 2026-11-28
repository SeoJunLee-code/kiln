import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { EDITIONS, isEdition, lowest, needs, over, why } from './edition.ts';
import { fmtWarn, lint } from './lint.ts';
import { loadGltf } from '../web/gltf.ts';
import { parseExpects } from './expect.ts';
import { TOPICS, guideText, topicText } from './guide.ts';
import { loadMods } from './load.ts';
import type { Edition } from './world.ts';
import { loadBackend, physicsOf } from './physics.ts';
import { observe, run, view } from './run.ts';
import type { RunResult } from './run.ts';
import { KilnFail, fmtDiag, parseScene, schemaText, serialize } from './scene.ts';
import { solve } from './solve.ts';

/** --follow gives up after this many scenes: a scene that loads itself would go on for ever. */
const FOLLOW_MAX = 64;

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
  /** test, run: when the scene loads another, go on in that one with its NAME.input */
  follow?: boolean;
  /** solve: ticks each key choice is held (default 5) */
  stepTicks?: number;
  /** solve: give up after this many distinct states (default 200000) */
  maxStates?: number;
  /** guide: print this part of the manual instead of the core */
  topic?: string;
  /** check: the largest edition the game may need (lite, standard, ultra); more is an error */
  edition?: string;
}

/** What a scene run threw, as an error line that says where: in the game's script when the
 * stack passes through a file of the game's folder, in the engine when it does not. */
function runtimeError(e: Error, folder: string): string {
  const game = `${pathToFileURL(resolve(folder)).href}/`, engine = new URL('.', import.meta.url).href;
  const at = (e.stack ?? '').split('\n').map((l) => /(file:\/\/\/[^\s)]+):(\d+):\d+/.exec(l))
    .find((m) => m && m[1].startsWith(game) && !m[1].startsWith(engine));
  const msg = String(e.message ?? e).split('\n')[0];
  return at ? `E K124 ${at[1].slice(game.length)}:${at[2]} script failed while running: ${msg}` : `E K125 the engine failed: ${msg}`;
}

/** Run one engine command. Shared by the CLI and the MCP server. Exit code: 0 ok, 1 expectation failed, 2 error. */
export async function command(cmd: string, a: CmdArgs): Promise<{ text: string; code: number }> {
  const out: string[] = [];
  const done = (code: number) => ({ text: out.join('\n') + '\n', code });
  if (!COMMANDS.includes(cmd)) return out.push(`E K003 unknown command '${cmd}' (hint: valid: ${COMMANDS.join(' ')})`), done(2);
  if (cmd === 'guide') {
    if (a.topic === undefined) return { text: guideText(), code: 0 };
    if (!Object.hasOwn(TOPICS, a.topic)) return out.push(`E K003 unknown guide topic '${a.topic}' (hint: valid: ${Object.keys(TOPICS).join(' ')})`), done(2);
    return { text: topicText(a.topic), code: 0 };
  }
  if (cmd === 'schema' && !a.file && a.scene === undefined) return { text: schemaText(), code: 0 };
  if (a.edition !== undefined && !isEdition(a.edition)) return out.push(`E K002 edition must be one of: ${EDITIONS.join(' ')}`), done(2);

  // `test DIR`, `check DIR`: every scene in the folder; `test` gives each the input file of the same name if there is one.
  if ((cmd === 'test' || cmd === 'check') && a.file && a.scene === undefined && existsSync(a.file) && statSync(a.file).isDirectory()) {
    const all = readdirSync(a.file).sort();
    const scenes = all.filter((f) => f.endsWith('.kiln'));
    if (!scenes.length) return out.push(`E K001 no .kiln files in ${a.file}`), done(2);
    let worst = 0, passed = 0, edition = 0, runs = 0, cases = 0;
    for (const f of scenes) {
      const stem = f.replace(/\.kiln$/, '');
      // NAME.input is the scene's own input. NAME.CASE.input is one more run of the same scene,
      // with the expect lines written in that file (unless a scene NAME.CASE.kiln owns it).
      const extra = cmd === 'test' ? all.filter((x) => x.startsWith(`${stem}.`) && x.endsWith('.input') && x !== `${stem}.input` && !scenes.includes(x.replace(/\.input$/, '.kiln'))) : [];
      for (const inp of [`${stem}.input`, ...extra]) {
        const input = join(a.file, inp), label = inp === `${stem}.input` ? f : inp;
        const r = await command(cmd, cmd === 'test' ? { file: join(a.file, f), inputFile: existsSync(input) ? input : undefined } : { file: join(a.file, f), edition: a.edition });
        const lines = r.text.trimEnd().split('\n');
        runs++;
        if (label !== f) cases++;
        if (r.code === 0) passed++;
        // `test`: one line per run when it passes; everything it said when it does not. `check` is short already.
        if (r.code === 0 && cmd === 'test') out.push(`${label} ${lines.at(-1)}`);
        else out.push(...lines.map((l) => `${label} ${l}`));
        edition = Math.max(edition, EDITIONS.indexOf((/ edition=(\w+)/.exec(lines.at(-1)!)?.[1] ?? 'lite') as never));
        worst = Math.max(worst, r.code);
      }
    }
    // A game is its folder, so its edition is the largest any of its scenes needs.
    out.push(`${worst ? 'fail' : 'ok'} scenes=${scenes.length}${cases ? ` cases=${cases}` : ''} passed=${passed} failed=${runs - passed}${cmd === 'check' && !worst ? ` edition=${EDITIONS[edition]}` : ''}`);
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
    await loadBackend(physicsOf(text), file);
    if (cmd === 'schema') return { text: schemaText(), code: 0 };
    if (cmd === 'check') {
      const s = parseScene(text, file);
      parseExpects(s.expects, s.world, file);
      // Files can only be checked when the scene came from disk.
      const warnings = lint(s, file, a.scene === undefined ? (name) => existsSync(join(dirname(file), name)) : undefined, text);
      // A model is read the way the player will read it, so what it would lose shows up here.
      if (a.scene === undefined) for (const id of s.world.query('sprite')) {
        const mesh = s.world.get(id, 'sprite')!.mesh as string, at = join(dirname(file), mesh);
        if (!/\.(gltf|glb)$/i.test(mesh) || !existsSync(at)) continue;
        const said = (msg: string): void => {
          if (!warnings.some((w) => w.msg === msg)) warnings.push({ code: 'K315', file, line: 0, msg });
        };
        try {
          const model = await loadGltf(new Uint8Array(readFileSync(at)), async (uri) => new Uint8Array(readFileSync(join(dirname(at), uri))));
          for (const w of model.warnings) said(`mesh '${mesh}': ${w}`);
        } catch (e) { said(`mesh '${mesh}' cannot be read: ${(e as Error).message}`); }
      }
      for (const d of warnings) out.push(fmtWarn(d));
      // The edition is worked out from what the scene uses. Over the ceiling, each use is an error.
      const need = needs(s), above = a.edition ? over(need, a.edition as Edition, file) : [];
      if (above.length) return out.push(...above.map(fmtDiag), `fail errors=${above.length}`), done(2);
      out.push(...why(need));
      out.push(`ok entities=${s.world.ids.size} expects=${s.expects.length} scripts=${s.uses.length} edition=${lowest(need)} warnings=${warnings.length}`);
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
    let r = run(text, { input, file, inputFile: a.inputFile, ticks: a.ticks, mods });
    const report = (r: RunResult, file: string): void => {
      if (cmd !== 'test') return;
      // Following a game through its scenes, only what failed is worth a line.
      for (const e of r.expects) if (!e.ok || !a.follow) out.push(`${e.ok ? 'pass' : 'FAIL'} ${r.from}:${e.line} ${e.text}${e.note ? ` -- ${e.note}` : ''}`);
      if (!r.expects.length) out.push(`W K300 ${file} has no expect lines`);
    };
    report(r, file);
    // --follow: when the scene loads another, go on in that one with its own NAME.input, as a
    // player would, until a scene ends without loading or one fails. A game played end to end.
    const path = [basename(file)];
    while (a.follow && r.load !== undefined && r.ok) {
      if (a.scene !== undefined) return out.push('E K002 follow needs a scene file, not scene text'), done(2);
      if (path.length >= FOLLOW_MAX) return out.push(`E K132 still loading after ${FOLLOW_MAX} scenes: ${path.slice(-3).join(' > ')} (hint: a scene that loads itself with the same input never ends)`), done(2);
      const next = `${dirname(file)}/${r.load}`, nextInput = next.replace(/\.kiln$/, '.input');
      if (!existsSync(next)) return out.push(`E K001 ${path.at(-1)} loads '${r.load}', which is not next to it`), done(2);
      out.push(`scene ${path.at(-1)} tick=${r.world.tick} hash=${r.hash} passed=${r.expects.length} load=${r.load}`);
      const t = readFileSync(next, 'utf8'), m = await loadMods(t, next);
      await loadBackend(physicsOf(t), next);
      r = run(t, { input: existsSync(nextInput) ? readFileSync(nextInput, 'utf8') : undefined, file: next, inputFile: nextInput, ticks: a.ticks, mods: m, kept: r.kept });
      report(r, next);
      path.push(basename(next));
    }
    if (a.events) for (const ev of r.world.events) out.push(`event ${ev.tick} ${ev.name} ${ev.a} ${ev.b}`.trimEnd());
    if (a.observe) out.push(observe(r.world).trimEnd());
    if (a.view) out.push(view(r.world).trimEnd());
    if (a.top) out.push(view(r.world, 'xz').trimEnd());
    if (a.out) writeFileSync(a.out, serialize(r.world, [], r.uses));
    const failed = r.expects.filter((e) => !e.ok).length;
    const bad = cmd === 'test' && failed > 0;
    out.push(`${bad ? 'fail' : 'ok'} tick=${r.world.tick} hash=${r.hash}${cmd === 'test' ? ` passed=${r.expects.length - failed} failed=${failed}` : ''}${r.load !== undefined ? ` load=${r.load}` : ''}${path.length > 1 ? ` path=${path.join('>')}` : ''}`);
    return done(bad ? 1 : 0);
  } catch (e) {
    if (e instanceof KilnFail) return out.push(e.message, `fail errors=${e.diags.length}`), done(2);
    out.push(runtimeError(e as Error, dirname(file)), 'fail errors=1');
    return done(2);
  }
}
