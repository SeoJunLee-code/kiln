import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { EDITIONS, isEdition, lowest, needs, over, why } from './edition.ts';
import { fmtWarn, lint } from './lint.ts';
import { sidecars } from './build.ts';
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
import { fmtFx } from './fx.ts';
import { hash } from './sim.ts';
import { registry } from './world.ts';
import type { World } from './world.ts';

/** --follow gives up after this many scenes: a scene that loads itself would go on for ever. */
const FOLLOW_MAX = 64;

/** "a.kiln x3, b.kiln x2": how often each scene ran. */
function tally(path: string[]): string {
  const n = new Map<string, number>();
  for (const p of path) n.set(p, (n.get(p) ?? 0) + 1);
  return [...n].map(([name, times]) => `${name} x${times}`).join(', ');
}

export const COMMANDS = ['check', 'run', 'test', 'solve', 'schema', 'guide', 'apply', 'diff'];

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
  /** solve: seconds before it gives up and reports the furthest attempt (default 60) */
  budget?: number;
  /** run, test, apply: values to print as the run goes: "ball.pos,lives.tally.n" */
  watch?: string;
  /** with watch: the ticks to print them at, "0,60,120" (default: every second, ten at most, and the end) */
  at?: string;
  /** diff: the other run: an input file (same scene) or a scene file (same input) */
  against?: string;
  /** apply: files to write whole, and exact replacements in files that exist; paths inside the game folder */
  files?: { path: string; content: string }[];
  edits?: { path: string; old: string; new: string }[];
  /** apply: false writes and checks without running the tests */
  test?: boolean;
}

/** One line of watched values: `watch TICK a.pos=1,2,0 lives.tally.n=3`. An entity that is not there reads `gone`. */
function watched(w: World, paths: string[]): string {
  const part = (path: string): string => {
    const [name, comp, field] = path.split('.');
    const id = w.ids.get(name);
    if (id === undefined) return `${path}=gone`;
    const c = comp ? w.get(id, comp) : undefined, def = registry.get(comp ?? '');
    if (!c || !def) return `${path}=none`;
    const show = (f: { name: string; type: string }): string => (f.type === 'fx' ? fmtFx(c[f.name] as number) : String(c[f.name]));
    if (field === undefined) return `${path}=${def.fields.map(show).join(',')}`;
    const fd = def.fields.find((f) => f.name === field);
    return `${path}=${fd ? show(fd) : 'none'}`;
  };
  return `watch ${w.tick} ${paths.map(part).join(' ')}`;
}

/** Where two worlds differ, as `name.comp.field a -> b` lines. */
function differences(a: World, b: World, most = 12): string[] {
  const out: string[] = [];
  for (const name of new Set([...a.ids.keys(), ...b.ids.keys()])) {
    const ia = a.ids.get(name), ib = b.ids.get(name);
    if (ia === undefined || ib === undefined) { out.push(`${name}: only in the ${ia === undefined ? 'second' : 'first'}`); continue; }
    for (const def of registry.values()) {
      const ca = a.get(ia, def.name), cb = b.get(ib, def.name);
      if (!ca && !cb) continue;
      if (!ca || !cb) { out.push(`${name}.${def.name}: only in the ${ca ? 'first' : 'second'}`); continue; }
      for (const f of def.fields) if (ca[f.name] !== cb[f.name]) {
        const show = (v: number | string): string => (f.type === 'fx' ? fmtFx(v as number) : String(v));
        out.push(`${name}.${def.name}.${f.name} ${show(ca[f.name])} -> ${show(cb[f.name])}`);
      }
    }
  }
  return out.length > most ? [...out.slice(0, most), `(${out.length - most} more)`] : out;
}

/** What a scene run threw, as an error line that says where: in the game's script when the
 * stack passes through a file of the game's folder, in the engine when it does not. */
function runtimeError(e: Error, folder: string): string {
  // Node names a module by its real path, so a linked folder (macOS /var) is followed first.
  const game = `${pathToFileURL(existsSync(folder) ? realpathSync(folder) : resolve(folder)).href}/`, engine = new URL('.', import.meta.url).href;
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
        const r = await command(cmd, cmd === 'test' ? { file: join(a.file, f), inputFile: existsSync(input) ? input : undefined, watch: a.watch, at: a.at, events: a.events, follow: a.follow, ticks: a.ticks } : { file: join(a.file, f), edition: a.edition });
        const lines = r.text.trimEnd().split('\n');
        runs++;
        if (label !== f) cases++;
        if (r.code === 0) passed++;
        // `test`: one line per run when it passes; everything it said when it does not. `check` is short already.
        if (r.code === 0 && cmd === 'test') out.push(...lines.slice(0, -1).filter((l) => /^(watch|event) /.test(l)).map((l) => `${label} ${l}`), `${label} ${lines.at(-1)}`);
        else out.push(...lines.map((l) => `${label} ${l}`));
        edition = Math.max(edition, EDITIONS.indexOf((/ edition=(\w+)/.exec(lines.at(-1)!)?.[1] ?? 'lite') as never));
        worst = Math.max(worst, r.code);
      }
    }
    // A game is its folder, so its edition is the largest any of its scenes needs.
    out.push(`${worst ? 'fail' : 'ok'} scenes=${scenes.length}${cases ? ` cases=${cases}` : ''} passed=${passed} failed=${runs - passed}${cmd === 'check' && !worst ? ` edition=${EDITIONS[edition]}` : ''}`);
    return done(worst);
  }

  // `apply`: write, check and test in one call, so that a change and its verdict are one turn.
  if (cmd === 'apply') {
    const target = a.file ?? '.';
    const base = resolve(existsSync(target) && statSync(target).isDirectory() ? target : dirname(target));
    const inside = (p: string): string | null => {
      const full = resolve(base, p);
      return full === base || !full.startsWith(base + sep) ? null : full;
    };
    let wrote = 0, edited = 0, bad = 0;
    for (const f of a.files ?? []) {
      const full = typeof f?.path === 'string' && typeof f.content === 'string' ? inside(f.path) : null;
      if (!full) { out.push(`E K006 apply: '${f?.path}' is not a path inside the game folder with content`); bad++; continue; }
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, f.content);
      wrote++;
    }
    for (const e of a.edits ?? []) {
      const full = typeof e?.path === 'string' && typeof e.old === 'string' && typeof e.new === 'string' ? inside(e.path) : null;
      if (!full || !existsSync(full)) { out.push(`E K006 apply: cannot edit '${e?.path}': ${full ? 'no such file' : 'not a path inside the game folder with old and new'}`); bad++; continue; }
      const now = readFileSync(full, 'utf8'), n = e.old ? now.split(e.old).length - 1 : 0;
      if (n !== 1) { out.push(`E K007 apply: edit of '${e.path}' ${n ? `matches ${n} places` : 'matches nothing'} (hint: ${n ? 'give more of the surrounding text in old' : 'old must be the exact text now in the file; write the whole file with files instead'})`); bad++; continue; }
      writeFileSync(full, now.replace(e.old, () => e.new));
      edited++;
    }
    out.push(`wrote ${wrote} file${wrote === 1 ? '' : 's'}${edited ? `, edited ${edited}` : ''}`);
    if (!existsSync(target)) return out.push(`E K001 apply: nothing at '${target}' to check (hint: file is the game folder or one of its scenes)`, 'fail errors=1'), done(2);
    const checked = await command('check', { file: target, edition: a.edition });
    const lines = checked.text.trimEnd().split('\n');
    // Of a check that passes, only what it warns about and its verdict are worth reading again.
    out.push(...lines.slice(0, -1).filter((l) => checked.code !== 0 || /(^| )[WE] K\d/.test(l)), `check ${lines.at(-1)}`);
    if (checked.code === 2 || bad) return out.push(`fail ${bad ? `apply errors=${bad}` : 'check'}`), done(2);
    if (a.test === false) return out.push('ok applied, not tested'), done(0);
    const tested = await command('test', { file: target, inputFile: a.inputFile, follow: a.follow, watch: a.watch, at: a.at, events: a.events, ticks: a.ticks });
    out.push(...tested.text.trimEnd().split('\n').map((l) => `test ${l}`));
    return done(tested.code);
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
      const isModel = (id: number): boolean => /\.(gltf|glb)$/i.test((s.world.get(id, 'sprite')?.mesh as string) ?? '');
      for (const id of s.world.query('clip')) if (!isModel(id)) warnings.push({ code: 'K315', file, line: s.at.get(`${id} clip`) ?? 0, msg: `'clip' on '${s.world.names[id]}' needs a glTF mesh` });
      if (a.scene === undefined) for (const id of s.world.query('sprite')) {
        const mesh = s.world.get(id, 'sprite')!.mesh as string, at = join(dirname(file), mesh);
        if (!isModel(id) || !existsSync(at)) continue;
        const said = (msg: string): void => {
          if (!warnings.some((w) => w.msg === msg)) warnings.push({ code: 'K315', file, line: 0, msg });
        };
        for (const uri of sidecars(basename(at), new Uint8Array(readFileSync(at))).refused) said(`mesh '${mesh}': names the file '${uri}', which play and build do not serve`);
        try {
          const model = await loadGltf(new Uint8Array(readFileSync(at)), async (uri) => new Uint8Array(readFileSync(join(dirname(at), uri))));
          for (const w of model.warnings) said(`mesh '${mesh}': ${w}`);
          const clip = s.world.get(id, 'clip')?.name as string | undefined, has = model.clips.map((c) => c.name);
          if (clip !== undefined && !has.includes(clip)) said(`mesh '${mesh}' has no animation '${clip}' (it has: ${has.join(', ') || 'none'})`);
        } catch (e) { said(`mesh '${mesh}' cannot be read: ${(e as Error).message}`); }
      }
      for (const d of warnings) out.push(fmtWarn(d));
      // The edition is worked out from what the scene uses. Over the ceiling, each use is an error.
      const need = needs(s), above = a.edition ? over(need, a.edition as Edition, file) : [];
      if (above.length) return out.push(...above.map(fmtDiag), `fail errors=${above.length}`), done(2);
      // A script is tried for a second of game time, so a method that does not exist or a field
      // left out is found here, with its line, and not in the middle of the first test.
      if (s.uses.length) {
        try { run(text, { file, mods, ticks: Math.min(60, s.world.hz) }); }
        catch (e) {
          if (e instanceof KilnFail) throw e;
          return out.push(runtimeError(e as Error, dirname(file)), 'fail errors=1'), done(2);
        }
      }
      out.push(...why(need));
      out.push(`ok entities=${s.world.ids.size} expects=${s.expects.length} scripts=${s.uses.length} edition=${lowest(need)} warnings=${warnings.length}`);
      return done(0);
    }
    if (cmd === 'solve') {
      // The scripts say which of the other buttons the game reads (already loaded, so they can be read).
      const scripts = parseScene(text, file).uses.map((u) => readFileSync(join(dirname(file), u), 'utf8')).join('\n');
      const s = solve(text, { file, mods, stepTicks: a.stepTicks, maxStates: a.maxStates, scripts, budgetMs: (a.budget ?? 60) * 1000 });
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
    if (cmd === 'diff') {
      if (!a.against || !existsSync(a.against)) return out.push(`E K002 diff needs against: an input file (the same scene played another way) or a scene file (another version, the same input)`), done(2);
      const other = readFileSync(a.against, 'utf8'), scene2 = a.against.endsWith('.kiln');
      const text2 = scene2 ? other : text, input2 = scene2 ? input : other, file2 = scene2 ? a.against : file;
      const mods2 = scene2 ? await loadMods(text2, file2) : mods;
      if (scene2) await loadBackend(physicsOf(text2), file2);
      const trace = (t: string, i: string | undefined, f: string, m: typeof mods, ticks?: number): { hashes: string[]; world: World } => {
        const hashes: string[] = [];
        const r = run(t, { input: i, file: f, mods: m, ticks, each: (w) => void hashes.push(hash(w)) });
        return { hashes, world: r.world };
      };
      const one = trace(text, input, file, mods, a.ticks), two = trace(text2, input2, file2, mods2, a.ticks ?? one.hashes.length - 1);
      const n = Math.min(one.hashes.length, two.hashes.length);
      let t = 0;
      while (t < n && one.hashes[t] === two.hashes[t]) t++;
      if (t === n) return out.push(`ok same ticks=${n - 1} hash=${one.hashes[n - 1]}`), done(0);
      const wa = trace(text, input, file, mods, t).world, wb = trace(text2, input2, file2, mods2, t).world;
      const start = wa.tick - t;
      out.push(`differ first at tick ${start + t}${t ? ` (same through tick ${start + t - 1})` : ' (from the start)'}`, ...differences(wa, wb));
      const said = (w: World): string => w.events.filter((e) => e.tick === w.tick).map((e) => e.name).join(',') || 'none';
      out.push(`events at that tick: first ${said(wa)}; second ${said(wb)}`, `fail differ tick=${start + t}`);
      return done(1);
    }
    const paths = a.watch ? a.watch.split(',').map((x) => x.trim()).filter(Boolean) : [];
    const ats = a.at ? new Set(a.at.split(',').map((x) => +x)) : null, samples: string[] = [];
    let last = '';
    const each = !paths.length ? undefined : (w: World): void => {
      last = '';
      if (ats ? ats.has(w.tick) : w.tick % w.hz === 0 && samples.length < 10) samples.push(watched(w, paths));
      else last = watched(w, paths);
    };
    let r = run(text, { input, file, inputFile: a.inputFile, ticks: a.ticks, mods, each });
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
    // A run depends only on the scene, its input and what was kept: the same load twice is a circle.
    const seen = new Map<string, number>();
    while (a.follow && r.load !== undefined && r.ok) {
      if (a.scene !== undefined) return out.push('E K002 follow needs a scene file, not scene text'), done(2);
      const state = JSON.stringify([r.load, r.kept]), first = seen.get(state);
      if (first !== undefined) return out.push(`E K132 the game goes round for ever: ${[...path.slice(first), r.load].join(' > ')}, each time with the same input and kept state (hint: the input of one of these scenes ends in the same load again; give it an input that moves on)`), done(2);
      if (path.length >= FOLLOW_MAX) return out.push(`E K132 still loading after ${FOLLOW_MAX} scenes: ${tally(path)}; last ${path.slice(-3).join(' > ')} (hint: a scene that loads itself with a kept value that always changes never ends)`), done(2);
      seen.set(state, path.length);
      const next = `${dirname(file)}/${r.load}`, nextInput = next.replace(/\.kiln$/, '.input');
      if (!existsSync(next)) return out.push(`E K001 ${path.at(-1)} loads '${r.load}', which is not next to it`), done(2);
      out.push(`scene ${path.at(-1)} tick=${r.world.tick} hash=${r.hash} passed=${r.expects.length} load=${r.load}`);
      const t = readFileSync(next, 'utf8'), m = await loadMods(t, next);
      await loadBackend(physicsOf(t), next);
      r = run(t, { input: existsSync(nextInput) ? readFileSync(nextInput, 'utf8') : undefined, file: next, inputFile: nextInput, ticks: a.ticks, mods: m, kept: r.kept });
      report(r, next);
      path.push(basename(next));
    }
    if (paths.length) out.push(...samples, ...(last ? [last] : []));
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
