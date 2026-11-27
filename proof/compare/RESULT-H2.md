# Held-out spec 2: nine runs, before anyone has looked at a screen

[`H2.md`](H2.md) (three repairs and three additions to an existing Gem Vault) was given to an
agent nine times: three on Kiln, three on Godot with file tools, three on Godot with agent
tools. This file holds what the run logs and the automatic checks say. It does not say
which games pass: the twenty-seven pass checks of `H2.md` are judged on a screen by a
person, and that has not been done.

**Verdict: pending the screen checks.**

**All nine runs ended by themselves, and all nine games pass their own tests and load with
no error and no warning. Kiln's price range ($0.424 to $0.660) overlaps the range of Godot
with file tools ($0.508 to $0.534) and lies below the range of Godot with agent tools
($0.686 to $0.719) by $0.026.**

## Conditions

| | |
|---|---|
| Date | 2026-11-27, 11:05 to 12:16 UTC, one run after another in three rounds of Kiln, Godot file tools, Godot agent tools |
| Agent | Claude Code 2.1.330 headless, `claude-sonnet-5-5`, effort medium |
| Kiln | a copy of commit `1f50d8d` (`git archive`), reached through its MCP server, one tool. The copy's `proof/` folder (the specs, [`H2-PLANTED.md`](H2-PLANTED.md), the starting games before the defects) was moved out of it before the series, so no agent could come across it; the engine's code is as committed |
| Godot, file tools | official 4.7.2 stable, reached through the `godot` command in a shell tool that allows nothing else |
| Godot, agent tools | the same, plus the MCP server `godot-mcp-runtime` 4.0.1 of [`GODOT-TOOLS.md`](GODOT-TOOLS.md) |
| Isolation | `--setting-sources ""`, `--strict-mcp-config`, a new folder for every run; the command is in [`README.md`](README.md) |
| Ceilings | a price ceiling and a clock ceiling on every run. No run reached either |
| Counted | the first run of each of the nine, and nothing else. No run was repeated, none was thrown out, and nothing (engine, spec, starting game, prompt) was changed after a result was seen |

**What a run folder held at the start:** `TASK.md` (the text between the two lines of
`H2.md`), `SPEC.md` (Gem Vault's, [`../lite/SPEC.md`](../lite/SPEC.md)), and `game/` holding
the starting game of that engine with the three defects in it:
[`h2-start/kiln`](h2-start/kiln), 11 files and 8,379 bytes, or
[`h2-start/godot`](h2-start/godot), 8 files and 29,752 bytes (without the `.uid` files).

**The prompts, word for word.**

Kiln:

```
Read TASK.md and SPEC.md and do what TASK.md asks, in the game in ./game, with the Kiln engine through the `kiln` tool. Every file of the game stays in ./game. Nobody will answer questions; keep going until everything under "What done means" holds.
```

Godot, file tools:

```
Read TASK.md and SPEC.md and do what TASK.md asks, in the game in ./game, with the Godot engine (version 4.7; the `godot` command is on the PATH). Every file of the game stays in ./game. Nobody will answer questions; keep going until everything under "What done means" holds. Godot has no editions: "Lite" means 2D only, the Compatibility renderer, and no errors or warnings when the project is loaded headless. "The engine's test command" means one `godot --headless` command line that exits 0 only when every check passes.
```

Godot, agent tools:

```
Read TASK.md and SPEC.md and do what TASK.md asks, in the game in ./game, with the Godot engine (version 4.7; the `godot` command is on the PATH, and the `godot` MCP tools are connected). Every file of the game stays in ./game. Nobody will answer questions; keep going until everything under "What done means" holds. Godot has no editions: "Lite" means 2D only, the Compatibility renderer, and no errors or warnings when the project is loaded headless. "The engine's test command" means one `godot --headless` command line that exits 0 only when every check passes.
```

## The runs

All nine ended by themselves. Time is start to end / waiting for the model / inside tools.

| Run | Time | Turns | Tokens written / read | Price | Failed calls | Check after the run | Game as left |
|---|---|---|---|---|---|---|---|
| kiln-1 | 4:11 / 4:00 / 0:23 | 81 | 34,189 / 657,078 | $0.660 | 8 | `test` 14 of 14, `check --edition lite` 0 warnings | 21 files, 15,978 bytes |
| kiln-2 | 2:30 / 2:19 / 0:25 | 65 | 20,896 / 338,298 | $0.424 | 4 | 13 of 13, 0 warnings | 20 files, 14,409 bytes |
| kiln-3 | 3:05 / 2:43 / 0:33 | 63 | 23,965 / 333,568 | $0.466 | 2 | 14 of 14, 0 warnings | 21 files, 16,218 bytes |
| godot-file-1 | 5:41 / 2:59 / 2:49 | 44 | 27,244 / 454,176 | $0.534 | 5 | loads clean; 112 checks, 0 failed, exit 0 | 8 files, 41,836 bytes |
| godot-file-2 | 5:32 / 2:47 / 2:56 | 51 | 25,610 / 337,254 | $0.508 | 5 | loads clean; 104 checks, 0 failed, exit 0 | 8 files, 42,705 bytes |
| godot-file-3 | 21:54 / 2:48 / 19:19 | 55 | 26,214 / 467,301 | $0.534 | 6 | loads clean; 117 checks, 0 failed, exit 0 | 8 files, 40,430 bytes |
| godot-mcp-1 | 10:37 / 3:19 / 7:29 | 71 | 29,922 / 1,367,672 | $0.710 | 5 | loads clean; 89 checks, 0 failed, exit 0 | 8 files, 41,526 bytes |
| godot-mcp-2 | 9:27 / 3:31 / 6:10 | 67 | 31,505 / 1,301,570 | $0.719 | 6 | loads clean; 121 checks, 0 failed, exit 0 | 8 files, 41,395 bytes |
| godot-mcp-3 | 7:48 / 3:25 / 4:32 | 49 | 31,541 / 1,248,794 | $0.686 | 6 | loads clean; 99 checks, 0 failed, exit 0 | 8 files, 41,539 bytes |

- Tokens and price are the provider's own count from the run log
  (`node scripts/agentcost.ts LOG.jsonl --calls`). The logs hold paths of the machine and
  are not in the repository. godot-file-1 is $0.53403 and godot-file-3 is $0.53374.
- **Check after the run** was done by us after the series, on the game as the agent left
  it, in the folder it was left in. Kiln: `test` and `check --edition lite` of the pinned
  engine copy; both exited 0 in all three, and "14 of 14" is scenes plus input cases.
  Godot: "loads clean" is `godot --headless --path game --quit` exiting 0 and printing no
  line with "error" or "warning"; then the test command the agent named in its last message
  (`godot --headless --path game --script res://tests/run_tests.gd` in all six), run again.
  The checks on both engines are the game's own tests as the agent changed them, so their
  number says how much it wrote, not how much is right.
- **Game as left** leaves out `.godot/`, the `.uid` files and `.mcp/`. Every run folder
  holds `TASK.md`, `SPEC.md` and `game/` at the end and nothing else.

## How far apart

| | Kiln, 3 runs | Godot file tools, 3 runs | Godot agent tools, 3 runs |
|---|---|---|---|
| Price, lowest to highest | $0.424 to $0.660 | $0.508 to $0.534 | $0.686 to $0.719 |
| Highest / lowest | 1.56 | 1.05 | 1.05 |
| Waiting for the model | 2:19 to 4:00 | 2:47 to 2:59 | 3:19 to 3:31 |
| Start to end | 2:30 to 4:11 | 5:32 to 21:54 | 7:48 to 10:37 |
| Turns | 63 to 81 | 44 to 55 | 49 to 71 |

Whether the ranges overlap, and nothing more:

- **Price.** Kiln and Godot file tools overlap: the whole file-tools range lies inside
  Kiln's. Kiln and Godot agent tools do not overlap; the gap is $0.026 ($0.660 against
  $0.686). The two Godot setups do not overlap; the gap is $0.152.
- **Waiting for the model.** Kiln overlaps both Godot setups: each of their ranges lies
  inside Kiln's (139.0 s to 240.4 s). The two Godot setups do not overlap; the gap is
  20.2 s (179.2 s against 199.4 s).
- **Start to end.** Kiln's range lies below both Godot ranges (4:11 against 5:32 and 7:48).
  The two Godot ranges overlap.

Kiln's spread is the widest of the three, and one run makes it: kiln-1 cost 1.4 times
kiln-3 and took 81 turns. With three runs a side, one more run could open or close any of
these gaps.

## The failed calls

- **Kiln: 14 in three runs.** Three were the first `test` of each run reporting the three
  planted defects ("passed 4, failed 3"): the starting game's own tests, left failing on
  purpose. Five were `test` failing on the game while the agent changed it (two in kiln-1,
  three in kiln-2). Five were `test` on probe scenes kiln-1 wrote for itself, four of them
  in the harness's scratch folder outside the run folder; we did not read why each failed.
  One was the harness refusing kiln-3 a file search in the engine copy's source folder,
  which lies outside the run folder.
- **Godot file tools: 16 in three runs.** 12 were shell lines the harness refused because
  the agent was allowed `godot` and nothing else (`Get-Content`, `Copy-Item`, `Test-Path`,
  a `godot` line with a pipe or a `$(...)`). 4 were `godot` exiting 1. One of those in each
  run is a call of about 10 s near the start; by its place and by the agents' last messages
  ("before my changes 10 of 48 failed") that is the game's own tests showing the planted
  defects. The fourth is a later run in godot-file-2. We did not open each one.
- **Godot agent tools: 17 in three runs.** 11 were refused shell lines of the same kinds
  (and `Remove-Item`). 6 were `godot` calls that failed: the same first test run in each, a
  later failing run in godot-mcp-2, and in godot-mcp-3 a parse error and a script error in
  what the agent had just written. No call of a `godot` MCP tool failed.

No failed call was read as a fault of either engine. The refused shell lines belong to the
setup, as in [`SPREAD.md`](SPREAD.md).

## Godot's time outside the model

As in the spread, the long calls are one thing: the starting game carries a search for
winning inputs (`tools/solve.gd`, written by the agent that built it), and the agent runs
it headless after changing the levels.

| Run | `godot` calls of 20 s or more |
|---|---|
| godot-file-1 | 131 s |
| godot-file-2 | 131 s |
| godot-file-3 | 373 s, 367 s, 385 s |
| godot-mcp-1 | 195 s, 197 s |
| godot-mcp-2 | 276 s, 24 s |
| godot-mcp-3 | 162 s, 26 s, 25 s |

The three calls under 30 s are scripts the agent wrote in the harness's scratch folder,
outside the run folder, and ran against the game. This time costs no tokens. The Kiln runs
spent 23 s to 33 s inside tools in a whole run.

## What the agent tools were used for

godot-mcp-1 made 10 calls of the `godot` MCP tools (`run_project`, `run_script` three
times, `take_screenshot` three times, `simulate_input`, `get_debug_output`,
`stop_project`) and godot-mcp-2 made 8 (the same without `simulate_input` and
`get_debug_output`). godot-mcp-3 made none and worked through the `godot` command alone.
All three read 1.2 to 1.4 million tokens against 0.34 to 0.47 million in the file-tools
runs. The setup puts 48 tool descriptions in front of the model where the file-tools setup
puts 5; we did not measure how much of the difference that is.

## Limits

- **No person has looked at any of the nine games.** "Ended by itself", the game's own
  tests and a clean load are not the pass checks of [`H2.md`](H2.md). A run counted here
  could fail them, so no run is called complete yet and no setup is called ahead.
- **The tests are the agent's.** Each agent changed the tests it was given and added its
  own. That they pass says the game agrees with what the agent believes it built.
- **Three runs a side, one model, one machine, one afternoon.**
- **The starting games are not the same size** (8,379 against 29,752 bytes) and were built
  from the development spec, which Kiln was changed for. `H2.md` says why they were left so.
- **Runs repeated or thrown out: none.** No run ended on a usage limit, a network error or
  a dead process.
- **Other work on the same machine during the series**: the session that watched the runs
  read one finished log with `agentcost` during kiln-2 and read documents of this
  repository; a second session was open on the same machine and what it ran is not written
  down here. The checks after the run were done after the last run had ended. This can
  lengthen tool time and, a little, model waiting. It does not change tokens or price.
- **Kept outside the repository**: the nine game folders as left (without `.godot/`) and
  the nine logs.
