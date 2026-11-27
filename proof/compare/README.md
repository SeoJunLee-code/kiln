# The comparison: how a run is started

The rules are in [`docs/EDITIONS.md`](../../docs/EDITIONS.md), "Winning, not only matching".
This folder holds what those rules need before any counted run: the command that starts an
isolated run, the pass checks, the spread, the tools the other engine gets, and the held-out
specs.

| File | What |
|---|---|
| this file | The isolated run command and the trial runs that settled it |
| [`GEMVAULT-CHECKS.md`](GEMVAULT-CHECKS.md) | Screen pass checks of the development spec |
| `SPREAD.md` | The development spec run several times on each engine. Being run; not written yet |
| [`GODOT-TOOLS.md`](GODOT-TOOLS.md) | Agent tooling for Godot: the candidates and the one chosen |
| [`H2.md`](H2.md), [`H3.md`](H3.md) | Held-out specs two and three. Not run |

## Isolation: what the trial runs found (2026-11-27)

Five short runs, none of them counted. Claude Code 2.1.330 headless, `claude-sonnet-5-5`,
started in an empty folder outside the repository, on a machine whose user instructions
say to answer in another language than English. The prompt was in English and asked for
one call of the `kiln` tool and a two-sentence answer.

| Run | Flags beside the common ones | Answer | `kiln` tool |
|---|---|---|---|
| A, A2 | `--setting-sources project` (the flags of the earlier comparison) | in the user's language: **leaked** | connected |
| B | `--setting-sources project --safe-mode` | English | **gone**: no MCP server at all |
| D | `--setting-sources ""` | English | connected |
| D2 | the same; asked to quote every instruction from a settings, memory or instruction file | `NONE` | connected |

- **The leak in the earlier comparison is explained.** `--setting-sources project` reads
  project instructions from the folders above the working folder. The run folder was under
  the user's home folder, so the user's own instruction file was found as if it were a
  project's. Hooks were not loaded in any run (0 registered).
- **`--safe-mode` cannot be used.** It turns off MCP servers, the one given with
  `--mcp-config` included. A Kiln run would have no engine.
- **`--setting-sources ""` isolates and keeps the engine.** No user, project or local
  settings; with `--strict-mcp-config` only the servers named on the command line.
- **A separate settings folder was not used.** On this machine the login lives in the
  settings folder, so an empty one would need a copy of the login. The flags above gave the
  same result without one.
- What still reaches a run and is the same for every run: the login, the built-in plugins
  of the program, the system prompt's lines about the machine (folder, system, date), and
  an auto-memory folder that is named after the run folder and therefore starts empty.
  Each run gets a new folder.

## The command

`claude.exe` is the one the desktop app ships (it is not on the PATH). `RUN` is a new
folder holding the spec, the sound files if the spec has them, and an empty `game/`.

```
cd RUN
claude -p "$(cat PROMPT)" --model claude-sonnet-5-5 --effort medium \
  --setting-sources "" --strict-mcp-config --mcp-config MCP.json \
  --tools TOOLS --allowedTools ALLOWED --permission-mode acceptEdits \
  --disable-slash-commands --no-session-persistence \
  --output-format stream-json --verbose --max-budget-usd CEILING \
  < /dev/null > LOG.jsonl
```

wrapped in `timeout SECONDS`, the clock ceiling. Per setup:

| Setup | `MCP.json` | `TOOLS` | `ALLOWED` |
|---|---|---|---|
| Kiln | `{"mcpServers":{"kiln":{"command":"node","args":["ENGINE/src/cli.ts","mcp"]}}}` | `Read,Write,Edit,Glob` | `mcp__kiln__kiln` |
| Godot, file tools | `{"mcpServers":{}}` | `Read,Write,Edit,Glob,PowerShell` | `PowerShell(godot:*)` |
| Godot, agent tools | see [`GODOT-TOOLS.md`](GODOT-TOOLS.md) | the same | the same, and the server's tools |

- `ENGINE` is a copy of the repository at the pinned commit (`git archive COMMIT | tar -x`),
  not the working tree, so work on the engine during a series cannot reach a run.
- For Godot a folder with a one-line `godot.cmd` that calls the official 4.7.2 console
  executable is put first on the PATH. This build of Claude Code has no Bash tool on
  Windows; the shell tool is PowerShell, and only lines that start with `godot` are allowed.
- Prompts, word for word. Kiln: `Read SPEC.md and build the game with the Kiln engine
  through the `kiln` tool. Put every file in ./game. Nobody will answer questions; keep
  going until everything under "What done means" holds.` Godot: the same with `the Godot
  engine (version 4.7; the `godot` command is on the PATH)` in place of the engine and the
  tool. For a spec that speaks of editions or of the engine's test command (Gem Vault does),
  the Godot prompt adds: `Godot has no editions: "Lite" means 2D only, the Compatibility
  renderer, and no errors or warnings when the project is loaded headless. "The engine's
  test command" means one `godot --headless` command line that exits 0 only when every
  check passes.`

## Reading a log

`node scripts/agentcost.ts LOG.jsonl --calls` prints tokens, price, calls and failures, and
since 2026-11-27 the time in two parts:

- **for the model**: the provider's own figure in the log's last line.
- **inside tools**: every line of the log carries the time it was written, so a call's time
  is the gap between the line that asked for it and the line that answered. Calls that ran
  side by side are counted once in the total; the list by tool adds each call's own time.

What is left of the run's time after both is the harness. A run that stopped at the price
ceiling or was cut off by the clock is reported as not ended by itself, with the reason.

Logs hold paths of the machine and are not in the repository.
