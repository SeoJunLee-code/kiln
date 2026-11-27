# Agent tooling for Godot: the candidates

The third setup of the comparison is "the other engine with the best agent tooling there is
for it". This is the survey behind the choice. Read on 2026-11-27 from each project's
GitHub page and README through the GitHub API. Stars are a count of interest, not of
quality. **Only the chosen one was installed and run** (four short trial runs on
2026-11-27, none counted; see "The trial runs"). Every other row is from reading alone.

## What the setup needs

A run starts headless in a folder with an empty `game/`, with nobody at the machine.

1. The server starts from the command line (`--mcp-config`) and needs no open editor and
   no add-on already inside the project: at the start there is no project.
2. Free, with a licence that lets anyone repeat the run.
3. Works with Godot 4.7 on Windows.
4. Gives the agent what the file-tools setup lacks. In the one Godot run so far the agent
   never saw its game and wrote its own test runner; Kiln's agent has `look` (a picture)
   and replayed input. So: run the game, read its output, see it, press keys.

## Candidates

| Project | Stars | Licence | Last push | How it runs | Needs 1-4 |
|---|---|---|---|---|---|
| `Coding-Solo/godot-mcp` | 6,781 | MIT | 2026-04-16 | `npx`, drives the Godot executable | 1, 2, 3 yes. 4 in part: runs the project and returns its output; no picture, no input |
| `Erodenn/godot-mcp-runtime` | 103 | MIT | 2026-11-13 (release v4.0.1, 2026-11-11) | `npx`, drives the Godot executable, Godot 4.5 or later, Node 20 or later | all four: 43 tools; headless scene editing; `run_project` puts a bridge in the running game for screenshots, key and mouse input, the live scene tree, running a script; a background mode that does not show the window on Windows |
| `yurineko73/Godot-MCP-Native` | 882 | MIT | 2026-08-03 | a plug-in inside the editor | fails 1 |
| `youichi-uda/godot-mcp-pro` | 649 | not an open licence (paid) | 2026-11-26 | editor plug-in, 162 tools | fails 1 and 2 |
| `ee0pdt/Godot-MCP` | 624 | MIT | 2025-03-19 | editor plug-in | fails 1; no push in twenty months |
| `tugcantopaloglu/godot-mcp` | 528 | MIT | 2026-10-09 (release v3.1.0, 2026-07-13) | built from a clone (`git clone`, `npm install`, `npm run build`; no package given), drives the Godot executable, Godot 4.4 or later, "tested with 4.7" | all four by its README: 157 tools; headless scene operations; a running game with `game_screenshot`, `game_key_press`, clicks, the scene tree. Not installed |
| `tomyud1/godot-mcp` | 458 | MIT | 2026-10-17 | server and editor plug-in | fails 1 |
| `IvanMurzak/Godot-MCP` | 387 | Apache-2.0 | 2026-11-25 | a C# add-on inside the project, reached through a local or a cloud server; needs the .NET build of the Godot editor and the .NET SDK | fails 1 (an add-on and a C# solution in the project before anything works) and 3 as installed here (the standard build, not the .NET one) |
| `satelliteoflove/godot-mcp` | 193 | MIT | 2026-11-16 | works in the editor | fails 1 |
| `beckettlab/beckett-godot-mcp` | 54 | MIT (the free tier) | 2026-11-01 | a plug-in inside the editor | fails 1 |
| GDAI MCP | n/a | paid | n/a | editor plug-in | fails 1 and 2 |

Comparisons published on the web were found only from a company that sells a competing
product; they were not used.

## Choice

**`godot-mcp-runtime`, pinned to v4.0.1**, as the "agent tools" setup. It is the only
candidate read that meets all four needs, and the fourth is the one that decides whether an
agent can check its own game. `Coding-Solo/godot-mcp` is by far the most used and stays the
fallback. The chosen server worked on this machine with Godot 4.7.2 in the trial runs
below, so the fallback is not used.

**The choice was looked at again after reading `tugcantopaloglu/godot-mcp`, and kept.**
That project also meets the four needs by its README and has about five times the stars
(528 against 103). It was not taken, for reasons that can be checked:

- Its 157 tool definitions are read by the model on every turn. The 43 of the chosen
  server measured 26,261 tokens (below); at the same size per tool 157 would be near
  96,000. That is an estimate, not a measurement. It would load the Godot setup with a
  cost that says nothing about Godot.
- It has no published package: a run would build it from a clone, and a clone is pinned
  by commit only.
- Neither is the tool most people use; that is `Coding-Solo/godot-mcp`, which lacks the
  picture and the input.

This is a judgment and the owner of the comparison can overrule it before the counted
runs. After the first counted run it is fixed.

## The configuration

The package is installed once, outside the run folders, at the pinned version
(`npm install godot-mcp-runtime@4.0.1` in an empty folder `GMR`; installed: 4.0.1, MIT),
and started from that copy, as Kiln's engine is started from a copy at a pinned commit.
`npx -y` would ask the registry on every run.

```json
{ "mcpServers": { "godot": { "command": "node",
  "args": ["GMR/node_modules/godot-mcp-runtime/dist/index.js"],
  "env": { "GODOT_PATH": "PATH/TO/Godot_v4.7.2-stable_win64.exe", "GODOT_MCP_DISABLE_ELICITATION": "true" } } } }
```

`TOOLS` is `Read,Write,Edit,Glob,PowerShell` and `ALLOWED` is
`PowerShell(godot:*),mcp__godot` (the server's name allows all 43 of its tools; they are
named `mcp__godot__run_project` and so on). `GODOT_PATH` is the windowed executable; the
`godot` command on the PATH stays the console one.

## The trial runs (2026-11-27, not counted)

The command of [`README.md`](README.md), `--max-budget-usd 1`, Claude Code 2.1.330,
`claude-sonnet-5-5`, effort medium, Godot 4.7.2, Windows 11, a logged-in desktop session.
All four together cost $0.34.

| Run | Setup | Asked for | Result |
|---|---|---|---|
| T0 | no server | the one word `OK`, no tool | 1 turn, 9,204 tokens read, $0.01 |
| T1 | the server | the same | server `connected`, 43 tools on the first line of the log; 1 turn, 35,465 tokens read, $0.14 |
| B | the server | a project with a red rectangle and a label; run it in background mode, screenshot, one press of space, screenshot, debug output, stop | all six steps worked. 34 s, 14 turns, $0.11 |
| C | the server without `GODOT_MCP_DISABLE_ELICITATION` | the same as B | `run_project` came back failed: "confirmation was cancelled without an explicit choice". The game never ran. 25 s, 11 turns, $0.08 |

- **It starts under `--strict-mcp-config --setting-sources ""`.** The first line of the log
  lists the server as connected and its 43 tools beside the five file tools.
- **`run_project` works with no window shown.** It took 7.8 s to start the game and its
  bridge; each screenshot, the key press and the debug output took 0.1 s or less. The
  screenshots came back as pictures (640 x 360, the project's size) with pixel statistics.
  The second one, opened by hand afterwards, shows the red rectangle and the word
  `PRESSED`. The key press reported the label's change itself, and the debug output held
  the line `pressed` once.
- **The variable is needed.** Without it the launch is refused in a headless run (run C);
  with it the call carries a warning and goes on (run B).
- **What 43 tool definitions cost.** 26,261 tokens more are read on the first turn (35,465
  against 9,204), and again on every later turn from the cache. Run T1's single turn cost
  $0.14 against $0.01 because all of it was new. This belongs to the setup and is counted,
  as Kiln's one tool and its guide are.
- **What it leaves in the project.** A `.mcp/` folder with the screenshots and a
  `.gitignore` the agent did not write; an autoload for the bridge is added to
  `project.godot` while the game runs and removed when it stops. A size count of a game
  made with this setup leaves `.mcp/` out.
- In both B and C the agent's first shell line (a folder listing) was refused, as in the
  file-tools setup: only lines that start with `godot` are allowed.
- Not tried: a machine with nobody logged in to a desktop session, mouse input, the
  profiler, a long session. Run B is one run of a toy project.

## Open

- The choice between the two servers that meet the four needs (above) is a judgment; it
  can be overruled until the first counted run.
- The trial was a toy project. Whether an agent building a whole game uses the runtime
  tools well, or drowns in 43 tools, is what the counted runs measure.
