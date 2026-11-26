import { COMMANDS, command } from './commands.ts';
import type { CmdArgs } from './commands.ts';

const HELP = `kiln <command> [scene] [options]
  check SCENE            parse and validate only
  run SCENE              run headless, print state hash
  test SCENE|DIR         run and evaluate the scene's expect lines (exit 1 on failure);
                         with a folder: every scene in it, each with its NAME.input if present
  solve SCENE            search for an input script that meets the scene's reach/gone/event expects
                         (--step N ticks per key choice, --max-states N, --out FILE saves the input)
  schema [SCENE]         print the component reference (with SCENE: including its scripts)
  guide                  print the whole manual, sized for an agent to read in one call
  mcp                    serve these commands as one MCP tool over stdio
  play SCENE             open the scene in a browser (--port N, default 5207; --input FILE replays it)
  new DIR                start a game: starter scene, agent instructions, MCP config
  build SCENE --out DIR  write a folder any static web host can serve (player, engine, the scene's folder)
options:
  --input FILE           input script (TICK ACTION down|up per line)
  --ticks N              ticks to run (default: last tick any expect needs)
  --view                 print an ASCII picture of the final state
  --top                  the same, looking down on the x/z plane (3D scenes)
  --observe              print one line per entity
  --events               print emitted events
  --out FILE             write the final state as a scene file
`;

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'mcp') {
  await import('./mcp.ts');
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
    const b = build(rest[0], out);
    if (b.skipped.length) console.log(`W K301 not copied (not a game asset): ${b.skipped.join(' ')}`);
    console.log(`ok built files=${b.written.length} out=${out}`);
  } catch (e) {
    console.log(`E K001 build failed: ${(e as Error).message}`);
    process.exitCode = 2;
  }
} else if (cmd === 'play' && rest[0] && !rest[0].startsWith('--')) {
  const flag = (name: string): string | undefined => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : undefined);
  const { serve } = await import('./serve.ts');
  const { port } = await serve(rest[0], flag('--input'), Number(flag('--port') ?? 5207));
  console.log(`ok play http://localhost:${port}/`);
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
    else if (k === '--ticks') a.ticks = /^\d+$/.test(rest[++i] ?? '') ? +rest[i] : -1;
    else if (k === '--step' || k === '--max-states') {
      const n = /^[1-9]\d*$/.test(rest[++i] ?? '') ? +rest[i] : NaN;
      if (Number.isNaN(n)) { console.log(`E K002 ${k} must be a positive integer`); process.exit(2); }
      a[k === '--step' ? 'stepTicks' : 'maxStates'] = n;
    }
    else if (k === '--view' || k === '--top' || k === '--observe' || k === '--events') a[k.slice(2) as 'view' | 'top' | 'observe' | 'events'] = true;
    else { console.log(`E K002 unknown option '${k}'`); process.exit(2); }
  }
  const r = await command(cmd, a);
  process.stdout.write(r.text);
  process.exitCode = r.code;
}
