import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), 'cli.ts').replace(/\\/g, '/');

const SCENE = `# Starter level. Change the picture, keep the expects true.
world hz=60

prefab hero
  box 0.8 0.8
  vel
  ctrl 4
  sprite @
prefab coin
  box 0.5 0.5
  tag coin
  trigger hero coin despawn-self
  sprite o gold
prefab exit
  box 0.8 0.8
  trigger hero win
  sprite E limegreen

entity map
  pos 0 0
  tiles spawn=@:hero,o:coin,E:exit
    #########
    #@..#..o#
    #.#.#.#.#
    #o#...#E#
    #########

expect gone #coin by 600
expect event win by 600
`;

const agents = (cli: string): string => `# Working on this game

This is a [Kiln](https://github.com/SeoJunLee-code/kiln) game: text scenes, run headless, checked by \`expect\` lines.

Read the manual first. It is one short page:

\`\`\`
node ${cli} guide
\`\`\`

If the \`kiln\` MCP tool is available (see \`.mcp.json\`), use it instead of the shell: \`cmd=guide\`, then \`check\`, \`solve\`, \`test\`.

## Loop

1. Say what "working" means as \`expect\` lines in the scene, before building it.
2. \`check\` the scene. Fix every \`E\` line it prints, then check again.
3. \`solve\` it. If it fails, the message says which goal is still open; fix the level, not the check.
4. Save the answer with \`--out game.input\` and keep \`test game.kiln --input game.input\` passing after every change.
5. Look with \`--view\` (ASCII) rather than a screenshot. \`play\` is for a person.

## Commands

\`\`\`
node ${cli} check game.kiln
node ${cli} solve game.kiln --out game.input
node ${cli} test game.kiln --input game.input --view
node ${cli} play game.kiln
node ${cli} build game.kiln --out dist
\`\`\`

## Rules

- Game logic goes in components and triggers first; write a script only when they cannot express the rule.
- In scripts: fixed-point numbers only, no \`Math.random\` or clocks, state lives in components.
- A level is not done until \`solve\` or a recorded input proves it can be finished.
`;

/** Create a game folder that an agent can start working in: a starter scene, instructions, and the MCP server wired up. */
export function newGame(dir: string): string[] {
  if (existsSync(dir) && readdirSync(dir).length) throw new Error(`'${dir}' exists and is not empty`);
  mkdirSync(dir, { recursive: true });
  const files: Record<string, string> = {
    'game.kiln': SCENE,
    'AGENTS.md': agents(CLI),
    'CLAUDE.md': '@AGENTS.md\n',
    '.mcp.json': JSON.stringify({ mcpServers: { kiln: { command: 'node', args: [CLI, 'mcp'] } } }, null, 2) + '\n',
  };
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return Object.keys(files);
}
