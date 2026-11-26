import { readFileSync, writeFileSync } from 'node:fs';
import { parseExpects } from './expect.ts';
import { observe, run, view } from './run.ts';
import { KilnFail, parseScene, schemaText, serialize } from './scene.ts';

const HELP = `kiln <command> [scene] [options]
  check SCENE            parse and validate only
  run SCENE              run headless, print state hash
  test SCENE             run and evaluate the scene's expect lines (exit 1 on failure)
  schema                 print the component reference
options:
  --input FILE           input script (TICK ACTION down|up per line)
  --ticks N              ticks to run (default: last tick any expect needs)
  --view                 print an ASCII picture of the final state
  --observe              print one line per entity
  --events               print emitted events
  --out FILE             write the final state as a scene file
`;

function main(argv: string[]): number {
  const [cmd, ...rest] = argv;
  const opt: Record<string, string> = {};
  const pos: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith('--')) pos.push(a);
    else if (['--input', '--ticks', '--out'].includes(a)) opt[a.slice(2)] = rest[++i] ?? '';
    else opt[a.slice(2)] = '1';
  }
  if (cmd === 'schema') return process.stdout.write(schemaText()), 0;
  if (!['check', 'run', 'test'].includes(cmd) || !pos[0]) return process.stdout.write(HELP), cmd ? 2 : 0;

  const file = pos[0];
  let text: string, input: string | undefined;
  try {
    text = readFileSync(file, 'utf8');
    if (opt.input) input = readFileSync(opt.input, 'utf8');
  } catch (e) {
    console.log(`E K001 cannot read file: ${(e as Error).message}`);
    return 2;
  }
  if (opt.ticks !== undefined && !/^\d+$/.test(opt.ticks)) return console.log(`E K002 --ticks must be a non-negative integer`), 2;

  try {
    if (cmd === 'check') {
      const s = parseScene(text, file);
      parseExpects(s.expects, s.world, file);
      console.log(`ok entities=${s.world.ids.size} expects=${s.expects.length}`);
      return 0;
    }
    const r = run(text, { input, file, inputFile: opt.input, ticks: opt.ticks === undefined ? undefined : +opt.ticks });
    if (cmd === 'test') {
      for (const e of r.expects) console.log(`${e.ok ? 'pass' : 'FAIL'} ${file}:${e.line} ${e.text}${e.note ? ` -- ${e.note}` : ''}`);
      if (!r.expects.length) console.log(`W K300 ${file} has no expect lines`);
    }
    if (opt.events) for (const ev of r.world.events) console.log(`event ${ev.tick} ${ev.name} ${ev.a} ${ev.b}`);
    if (opt.observe) process.stdout.write(observe(r.world));
    if (opt.view) process.stdout.write(view(r.world));
    if (opt.out) writeFileSync(opt.out, serialize(r.world));
    const failed = r.expects.filter((e) => !e.ok).length;
    console.log(`${cmd === 'test' && failed ? 'fail' : 'ok'} tick=${r.world.tick} hash=${r.hash}${cmd === 'test' ? ` passed=${r.expects.length - failed} failed=${failed}` : ''}`);
    return cmd === 'test' && failed ? 1 : 0;
  } catch (e) {
    if (!(e instanceof KilnFail)) throw e;
    console.log(e.message);
    console.log(`fail errors=${e.diags.length}`);
    return 2;
  }
}

process.exitCode = main(process.argv.slice(2));
