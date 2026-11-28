// One engine command in a thread of its own. Node keeps an imported module for as long as
// the thread lives, so a long-lived server that imported a game's scripts itself would go
// on running the first version of a script after the file had changed.
import { parentPort, workerData } from 'node:worker_threads';
import { format } from 'node:util';
import { command } from './commands.ts';
import type { CmdArgs } from './commands.ts';

// What a script prints goes into the reply, not into the server's protocol stream.
const printed: string[] = [];
let dropped = 0;
for (const name of ['log', 'info', 'warn', 'error', 'debug'] as const) {
  console[name] = (...parts: unknown[]) => {
    if (printed.length < 40) printed.push(`log: ${format(...parts).slice(0, 200)}`);
    else dropped++;
  };
}

const { cmd, args } = workerData as { cmd: string; args: CmdArgs };
const reply = await command(cmd, args);
if (dropped) printed.push(`log: (${dropped} more lines)`);
// Printed lines go first: the last line of a reply is its verdict.
parentPort!.postMessage({ text: printed.map((l) => `${l}\n`).join('') + reply.text, code: reply.code });
