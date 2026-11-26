# Kiln

An open-source game engine whose primary user is an AI agent, not a person in a GUI editor.

Existing engines assume a human looking at an editor window. An agent using them pays for that in tokens: binary or verbose scene files, results it can only check by looking at pixels, and runs that differ every time. Kiln is designed the other way round:

- **Everything is text.** Scenes are short, diffable files. There is no required editor.
- **Deterministic core.** Fixed tick, fixed-point math, fixed system order. Same scene + same input = same state hash, on every machine.
- **Headless verification.** `kiln test` runs a scene without a window and checks `expect` lines written in the scene itself.
- **Cheap observation.** An ASCII view and one-line-per-entity dumps instead of screenshots.
- **Machine-readable errors.** Every error has a code, a `file:line`, and a hint. All errors are reported in one pass.

Status: **core + scripting + MCP server + 2D browser player**. Early; see the limits below. See [HANDOFF.md](HANDOFF.md) for the roadmap and known limits.

## Try it

Needs Node 24+. No dependencies, no build step.

```
node src/cli.ts test examples/maze.kiln --input examples/maze.input --view
node src/cli.ts test examples/patrol.kiln --input examples/patrol.input
npm test
```

## Scene format

```
world hz=60 gravity=0,0

entity player
  pos 1 1
  box 0.8 0.8
  vel
  ctrl 4

entity exit
  pos 7 1
  box 1 1
  trigger player win

expect reach player exit by 240
```

Component values are positional or `name=value`. `node src/cli.ts schema` prints the full component reference in a form meant to be pasted into an agent's context.

Expectations (`A`/`B` are entity names or `#tags`):

| Form | Passes when |
|---|---|
| `reach A B by N` | A overlaps B at some tick ≤ N |
| `never A B` | A never overlaps B during the run |
| `gone A by N` | A was despawned by tick N |
| `event NAME by N` | a trigger emitted NAME by tick N |
| `at N A.comp.field OP VALUE` | the comparison holds at tick N |

Input scripts are one `TICK ACTION down|up` per line. Actions: `left right up down a b`.

## Play in a browser

```
node src/cli.ts play examples/maze.kiln
```

The page runs the same simulation modules as the headless CLI (the server strips types on request; there is still no build step). What you press is recorded as an input script, so a human play session can be replayed headless with `kiln test SCENE --input FILE` and gives the same state hash.

## Scripts

A scene line `use ./game.ts` loads a script that adds components and systems. See [examples/patrol.ts](examples/patrol.ts).

```ts
export default (k) => {
  k.component('patrol', 'walks between x=min and x=max', [
    { name: 'min', type: 'fx' }, { name: 'max', type: 'fx' }, { name: 'speed', type: 'fx' }]);
  k.system((w) => {
    for (const id of w.query('patrol', 'pos', 'vel')) { /* ... */ }
  });
};
```

Scripts must stay deterministic. `Math.random`, `Date`, timers and similar are rejected at load (K121); use `w.rand()` and `w.tick`.

## Use from an agent (MCP)

```json
{ "mcpServers": { "kiln": { "command": "node", "args": ["/path/to/kiln/src/cli.ts", "mcp"] } } }
```

The server exposes one tool, `kiln`, with a `cmd` argument (`check`, `run`, `test`, `schema`). One tool instead of many keeps the definition the agent carries in context small.

## License

MIT
