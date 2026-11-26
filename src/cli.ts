import { COMMANDS, command } from './commands.ts';
import type { CmdArgs } from './commands.ts';

const HELP = `kiln <command> [scene] [options]
  check SCENE            parse and validate only
  run SCENE              run headless, print state hash
  test SCENE             run and evaluate the scene's expect lines (exit 1 on failure)
  schema [SCENE]         print the component reference (with SCENE: including its scripts)
  mcp                    serve these commands as one MCP tool over stdio
  play SCENE             open the scene in a browser (--port N, default 5207; --input FILE replays it)
options:
  --input FILE           input script (TICK ACTION down|up per line)
  --ticks N              ticks to run (default: last tick any expect needs)
  --view                 print an ASCII picture of the final state
  --observe              print one line per entity
  --events               print emitted events
  --out FILE             write the final state as a scene file
`;

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'mcp') {
  await import('./mcp.ts');
} else if (cmd === 'play' && rest[0] && !rest[0].startsWith('--')) {
  const flag = (name: string): string | undefined => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : undefined);
  const { serve } = await import('./serve.ts');
  const { port } = await serve(rest[0], flag('--input'), Number(flag('--port') ?? 5207));
  console.log(`ok play http://localhost:${port}/`);
} else if (!COMMANDS.includes(cmd) || (cmd !== 'schema' && (!rest[0] || rest[0].startsWith('--')))) {
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
    else if (k === '--view' || k === '--observe' || k === '--events') a[k.slice(2) as 'view' | 'observe' | 'events'] = true;
    else { console.log(`E K002 unknown option '${k}'`); process.exit(2); }
  }
  const r = await command(cmd, a);
  process.stdout.write(r.text);
  process.exitCode = r.code;
}
