import { existsSync } from 'node:fs';
import { COMMANDS, command } from './commands.ts';
import type { CmdArgs } from './commands.ts';

const HELP = `kiln <command> [scene] [options]
  check SCENE|DIR        parse and validate only; says the edition (lite, standard, ultra) the game needs,
                         by axis, and why. --edition lite|standard|ultra: needing more is an error
  run SCENE              run headless, print state hash
  test SCENE|DIR         run and evaluate the scene's expect lines (exit 1 on failure);
                         with a folder: every scene in it, each with its NAME.input if present,
                         and once more for each NAME.CASE.input (an input with its own expect lines)
  solve SCENE            search for an input script that meets the scene's reach/gone/event expects
                         (--step N ticks per key choice, --max-states N, --out FILE saves the input)
  schema [SCENE]         print the component reference (with SCENE: including its scripts)
  guide [TOPIC]          print the manual, sized for an agent to read in one call;
                         with TOPIC: a part only some games need (the guide lists them)
  mcp                    serve these commands as one MCP tool over stdio
  play SCENE             open the scene in a browser (--port N, default 5207; --input FILE replays it);
                         step through it tick by tick and look into its entities
                         (--before OLD.kiln|GITREV: the game as it was beside the game as it is)
  look SCENE             draw the scene in a headless browser and save a picture of the game view
                         (--tick N, --input FILE, --out FILE.png, --size WxH,
                         --renderer webgpu|webgl2 for 3D; needs Chrome or Edge)
  relay                  pass the inputs of a network game between its players (--port N, default 8787;
                         --host 0.0.0.0 to be reached from other machines). play has one built in
  new DIR                start a game: starter scene, agent instructions, MCP config
  build SCENE --out DIR  write a folder any static web host can serve (player, engine, the scene's folder;
                         --panel keeps the developer's side panel, which ?panel also shows)
  desktop SCENE --out FILE
                         one executable that runs the game in a window of the installed
                         Chrome or Edge (needs Node 25.5+ to build; --node PATH, --console, --panel)
options:
  --input FILE           input script (TICK ACTION down|up per line)
  --ticks N              ticks to run (default: last tick any expect needs); a scene ends early
                         at the tick a trigger loads another one
  --before OLD           test, run: run OLD.kiln or the git revision OLD beside it, say the first
                         tick that differs and what differs there
  --follow               test, run: go on in the scene that was loaded, with its NAME.input
  --view                 print an ASCII picture of the final state
  --top                  the same, looking down on the x/z plane (3D scenes)
  --observe              print one line per entity
  --events               print emitted events
  --out FILE             write the final state as a scene file
`;

// Node announces each experimental API once on stderr. An agent pays for every line it reads,
// so that notice is dropped; any other warning is still printed.
process.removeAllListeners('warning');
process.on('warning', (w) => { if (w.name !== 'ExperimentalWarning') console.error(`${w.name}: ${w.message}`); });

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'mcp') {
  await import('./mcp.ts');
} else if (cmd === 'relay') {
  const flag = (name: string, other: string): string => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : other);
  const { relay } = await import('./relay.ts');
  try {
    const host = flag('--host', '127.0.0.1');
    const { port } = await relay(Number(flag('--port', '8787')), host);
    console.log(`ok relay ws://${host}:${port}/relay`);
  } catch (e) {
    console.log(`E K004 ${(e as Error).message}`);
    process.exitCode = 2;
  }
} else if (cmd === 'new' && rest[0] && !rest[0].startsWith('--')) {
  const { newGame } = await import('./new.ts');
  try {
    console.log(`ok created ${rest[0]}: ${newGame(rest[0]).join(' ')}`);
  } catch (e) {
    console.log(`E K004 ${(e as Error).message}`);
    process.exitCode = 2;
  }
} else if (cmd === 'build' && rest[0] && !rest[0].startsWith('--')) {
  const out = rest.includes('--out') ? rest[rest.indexOf('--out') + 1] : undefined;
  if (!out) { console.log('E K002 build needs --out DIR'); process.exit(2); }
  const { build } = await import('./build.ts');
  try {
    const b = build(rest[0], out, { panel: rest.includes('--panel') });
    if (b.skipped.length) console.log(`W K301 not copied (not a game asset): ${b.skipped.join(' ')}`);
    console.log(`ok built files=${b.written.length} engine_bytes=${b.engineBytes} parts=${b.parts.join(',') || 'none'} out=${out}`);
  } catch (e) {
    console.log(`E K001 build failed: ${(e as Error).message}`);
    process.exitCode = 2;
  }
} else if (cmd === 'desktop' && rest[0] && !rest[0].startsWith('--')) {
  const flag = (name: string): string | undefined => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : undefined);
  const out = flag('--out');
  if (!out) { console.log('E K002 desktop needs --out FILE'); process.exit(2); }
  const { desktop } = await import('./desktop.ts');
  try {
    const d = desktop(rest[0], out, { node: flag('--node'), console: rest.includes('--console'), panel: rest.includes('--panel') });
    if (d.skipped.length) console.log(`W K301 not copied (not a game asset): ${d.skipped.join(' ')}`);
    console.log(`ok desktop files=${d.files} bytes=${d.bytes} out=${d.out}`);
  } catch (e) {
    console.log(`E K001 desktop failed: ${(e as Error).message}`);
    process.exitCode = 2;
  }
} else if (cmd === 'look' && rest[0] && !rest[0].startsWith('--')) {
  const flag = (name: string): string | undefined => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : undefined);
  const size = /^(\d+)x(\d+)$/.exec(flag('--size') ?? '960x600');
  const tick = flag('--tick') ?? '0';
  if (!size || !/^\d+$/.test(tick)) { console.log('E K002 look takes --tick N and --size WxH'); process.exit(2); }
  const { lookCommand } = await import('./look.ts');
  const renderer = flag('--renderer');
  if (renderer !== undefined && renderer !== 'webgpu' && renderer !== 'webgl2') { console.log('E K002 --renderer is webgpu or webgl2'); process.exit(2); }
  const r = await lookCommand(rest[0], flag('--out'), { tick: +tick, inputFile: flag('--input'), width: +size[1], height: +size[2], query: renderer && `renderer=${renderer}` });
  process.stdout.write(r.text);
  // The headless browser can keep the event loop alive for a moment after it closes.
  process.exit(r.code);
} else if (cmd === 'play' && rest[0] && !rest[0].startsWith('--')) {
  const flag = (name: string): string | undefined => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : undefined);
  const { serve } = await import('./serve.ts');
  const before = rest.includes('--before') ? flag('--before') ?? '' : undefined;
  // A comparison of two idle games says little, so it takes the scene's own input if there is one.
  const own = rest[0].replace(/\.kiln$/, '.input');
  const input = flag('--input') ?? (before !== undefined && existsSync(own) ? own : undefined);
  try {
    const { port } = await serve(rest[0], input, Number(flag('--port') ?? 5207), before);
    console.log(`ok play http://localhost:${port}/${before === undefined ? '' : 'compare'}`);
  } catch (e) {
    console.log((e as Error).message.startsWith('E ') ? (e as Error).message : `E K004 ${(e as Error).message}`);
    process.exitCode = 2;
  }
} else if (!COMMANDS.includes(cmd) || (cmd !== 'schema' && cmd !== 'guide' && (!rest[0] || rest[0].startsWith('--')))) {
  process.stdout.write(HELP);
  process.exitCode = cmd ? 2 : 0;
} else {
  const a: CmdArgs = {};
  for (let i = 0; i < rest.length; i++) {
    const k = rest[i];
    if (!k.startsWith('--')) a.file ??= k;
    else if (k === '--input') a.inputFile = rest[++i];
    else if (k === '--out') a.out = rest[++i];
    else if (k === '--before') a.before = rest[++i] ?? '';
    else if (k === '--edition') a.edition = rest[++i] ?? '';
    else if (k === '--ticks') a.ticks = /^\d+$/.test(rest[++i] ?? '') ? +rest[i] : -1;
    else if (k === '--step' || k === '--max-states') {
      const n = /^[1-9]\d*$/.test(rest[++i] ?? '') ? +rest[i] : NaN;
      if (Number.isNaN(n)) { console.log(`E K002 ${k} must be a positive integer`); process.exit(2); }
      a[k === '--step' ? 'stepTicks' : 'maxStates'] = n;
    }
    else if (k === '--view' || k === '--top' || k === '--observe' || k === '--events' || k === '--follow') a[k.slice(2) as 'view' | 'top' | 'observe' | 'events' | 'follow'] = true;
    else { console.log(`E K002 unknown option '${k}'`); process.exit(2); }
  }
  if (cmd === 'guide') { a.topic = a.file; a.file = undefined; }
  const r = await command(cmd, a);
  process.stdout.write(r.text);
  process.exitCode = r.code;
}
