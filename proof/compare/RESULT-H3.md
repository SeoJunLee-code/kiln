# Held-out spec 3: nine runs, before anyone has looked at a screen

[`H3.md`](H3.md) (a rolling ball: 3D and rigid bodies) was given to an agent nine times:
three on Kiln, three on Godot with file tools, three on Godot with agent tools. This file
holds what the run logs and the automatic checks say. It does not say which games pass:
the sixteen screen checks of `H3.md` are judged on a screen by a person, and that has not
been done.

**Verdict: pending the screen checks.**

**All nine runs ended by themselves and all nine games load with no error and no warning.
Kiln was the most expensive setup by a wide margin: $1.133 to $1.761, against $0.527 to
$0.749 for Godot with file tools and $0.606 to $0.633 for Godot with agent tools. Kiln's
range overlaps neither. The runs also exposed a fault of Kiln: its long-lived server kept
running the first version of a game script after the agent had changed it.**

## Conditions

| | |
|---|---|
| Date | 2026-11-27 12:24 to 13:54 UTC, one run after another in three rounds of Kiln, Godot file tools, Godot agent tools. One more run, not counted, on 2026-11-28 (below) |
| Agent | Claude Code 2.1.330 headless, `claude-sonnet-5-5`, effort medium |
| Kiln | the same copy of commit `1f50d8d` as in [`RESULT-H2.md`](RESULT-H2.md), reached through its MCP server, one tool; its `proof/` folder moved out before the series |
| Godot, file tools | official 4.7.2 stable, reached through the `godot` command in a shell tool that allows nothing else |
| Godot, agent tools | the same, plus the MCP server `godot-mcp-runtime` 4.0.1 of [`GODOT-TOOLS.md`](GODOT-TOOLS.md) |
| Isolation | `--setting-sources ""`, `--strict-mcp-config`, a new folder for every run; the command is in [`README.md`](README.md) |
| Ceilings | a price ceiling and a clock ceiling on every run. No run reached either |
| Counted | the first run of each of the nine. Nothing (engine, spec, prompt) was changed after a result was seen. One run was made twice by mistake; see below |

**What a run folder held at the start:** `SPEC.md` (the text between the two lines of
`H3.md`) and an empty `game/`.

**The prompts, word for word.**

Kiln:

```
Read SPEC.md and build the game with the Kiln engine through the `kiln` tool. Put every file in ./game. Nobody will answer questions; keep going until everything under "What done means" holds.
```

Godot, file tools:

```
Read SPEC.md and build the game with the Godot engine (version 4.7; the `godot` command is on the PATH). Put every file in ./game. Nobody will answer questions; keep going until everything under "What done means" holds.
```

Godot, agent tools:

```
Read SPEC.md and build the game with the Godot engine (version 4.7; the `godot` command is on the PATH, and the `godot` MCP tools are connected). Put every file in ./game. Nobody will answer questions; keep going until everything under "What done means" holds.
```

**The run made twice.** godot-mcp-3 started at 13:54 UTC. Its agent gave its last message
at 14:05 and the log holds a successful result line. A `godot` process it had left running
in the background was still alive; the program waits for such processes, the machine went
to sleep while it waited, and the process was closed only the next morning. That looked
like a run broken by the machine, and the run was started again on 2026-11-28 before the
log had been read through. It had not been broken: the agent had finished before anything
went wrong. **The first run is the one counted.** The second cost $0.726, took 5:56, ended
by itself and is shown below for completeness. Counting it instead would move the agent-tools
range to $0.606 to $0.726 and change none of the overlaps stated here.

## The runs

All nine ended by themselves. Time is the program's own running time / waiting for the
model / inside tools.

| Run | Time | Turns | Tokens written / read | Price | Failed calls | Check after the run | Game as left |
|---|---|---|---|---|---|---|---|
| kiln-1 | 12:05 / 6:28 / 5:56 | 109 | 53,607 / 2,341,867 | $1.136 | 15 | `test` 6 of 6, `check` standard, 0 warnings | 13 files, 19,114 bytes |
| kiln-2 | 10:47 / 9:00 / 2:17 | 165 | 75,889 / 4,443,206 | $1.761 | 36 | 11 of 11, 0 warnings | 22 files, 22,515 bytes |
| kiln-3 | 7:45 / 6:39 / 1:29 | 118 | 54,832 / 1,918,897 | $1.133 | 14 | 13 of 13, 0 warnings | 23 files, 19,673 bytes |
| godot-file-1 | 11:15 / 4:22 / 6:57 | 52 | 38,664 / 1,173,151 | $0.749 | 9 | loads clean; no test left in `game/` | 7 files, 18,934 bytes |
| godot-file-2 | 25:47 / 3:26 / 22:21 | 44 | 30,485 / 738,299 | $0.589 | 6 | loads clean; no test left in `game/` | 6 files, 17,444 bytes |
| godot-file-3 | 4:27 / 3:07 / 1:32 | 41 | 29,735 / 367,567 | $0.527 | 6 | loads clean; its test exits 0, "ALL PASSED" | 7 files, 28,010 bytes |
| godot-mcp-1 | 4:38 / 3:06 / 1:43 | 51 | 28,430 / 1,054,389 | $0.606 | 7 | loads clean; no test left in `game/` | 6 files, 18,614 bytes |
| godot-mcp-2 | 5:27 / 3:18 / 2:19 | 54 | 30,167 / 1,137,321 | $0.633 | 6 | loads clean; no test left in `game/` | 7 files, 20,234 bytes |
| godot-mcp-3 | 11:31 / 3:21 / 8:17 | 44 | 31,037 / 822,326 | $0.609 | 6 | loads clean; no test left in `game/` | 9 files, 20,313 bytes |
| *godot-mcp-3, second run, not counted* | *5:56 / 3:14 / 2:49* | *46* | *29,962 / 1,146,654* | *$0.726* | *4* | *not checked* | *not counted* |

- Tokens and price are the provider's own count from the run log
  (`node scripts/agentcost.ts LOG.jsonl --calls`). The logs hold paths of the machine and
  are not in the repository.
- **godot-file-1 and godot-file-2 have two result lines each.** A command left running in
  the background finished after the agent's last turn and woke it again. `agentcost` read
  only the last stretch's tokens, turns and time; it was fixed to add the stretches up
  before this file was written. Price and model time are running totals in the log and were
  right already. All nine H2 logs have one result line, so [`RESULT-H2.md`](RESULT-H2.md)
  is not affected. Time here leaves out the wait between stretches (godot-file-2: 33:25 from
  start to end).
- **Check after the run** was done by us, on the game in the folder it was left in. Kiln:
  `test` and `check` of the pinned copy; both exited 0 in all three. `H3.md` asks for no
  edition, so `check` was run with none; the games need `standard` (3D and physics).
  "6 of 6" and the like are scenes plus input cases. Godot: "loads clean" is
  `godot --headless --path game --quit` exiting 0 and printing no line with "error" or
  "warning". Only godot-file-3 left a test in `game/` (`H3.md` does not ask for one); the
  other agents tested with scripts in the program's scratch folder, outside the run folder,
  which we did not run again.
- **Game as left** leaves out `.godot/`, the `.uid` files and `.mcp/`. kiln-1 also left a
  `probe/` folder beside `game/` (its own trial scenes).

## How far apart

| | Kiln, 3 runs | Godot file tools, 3 runs | Godot agent tools, 3 runs |
|---|---|---|---|
| Price, lowest to highest | $1.133 to $1.761 | $0.527 to $0.749 | $0.606 to $0.633 |
| Highest / lowest | 1.55 | 1.42 | 1.04 |
| Waiting for the model | 6:28 to 9:00 | 3:07 to 4:22 | 3:06 to 3:21 |
| Time | 7:45 to 12:05 | 4:27 to 25:47 | 4:38 to 11:31 |
| Turns | 109 to 165 | 41 to 52 | 44 to 54 |

- **Price.** Kiln overlaps neither Godot setup; the gap to the nearest Godot run is $0.384
  ($0.749 against $1.133). The two Godot setups overlap: the agent-tools range lies inside
  the file-tools range.
- **Waiting for the model.** Kiln overlaps neither (the gap to file tools is 2:06). The two
  Godot setups overlap.
- **Time.** All three ranges overlap.

## The failed calls

**Kiln: 65 in three runs.**

| Kind | kiln-1 | kiln-2 | kiln-3 | What it is |
|---|---|---|---|---|
| `test` failing on the game | 10 | 22 | 3 | the agent's own expects, while it changed the game; some of them ran old script code (below) |
| `E K132 still loading after 64 scenes` | 0 | 6 | 3 | following scene loads ran past the limit; we did not read why in each |
| `run`, `look`: `duplicate entity '...'` | 1 | 1 | 4 | an error with no code, file or line |
| a script component's missing field (`K105`) | 1 | 2 | 2 | the agent's mistake, named with a hint |
| the harness refusing a search in the engine's folder | 1 | 1 | 1 | setup |
| other | 2 | 4 | 1 | kiln-1: a `solve` call that ended with `Connection closed` after 5 minutes, and a probe for a script that does not exist. kiln-2: `look` needs a file, an unknown `guide` topic, `solve` with nothing to solve, an `Edit` that matched nothing. kiln-3: `script './game.ts?2' not found` |

**The fault of the engine.** The server that Kiln's one tool talks to stays alive for the
whole session and imports a script with `import()`, which Node answers from its cache from
the second time on. A changed script was therefore not read again: `run`, `test`, `check`
and `solve` went on running the first version. We reproduced it with the pinned copy (two
versions of a script, one process: the second `run` reports the first version). kiln-3
tried `use ./game.ts?2` to get around it. Counted from the logs, engine calls made after a
script that had already been loaded was changed:

| Run | Such calls / all `run`, `test`, `check`, `solve` calls | Of them failed |
|---|---|---|
| H3 kiln-1 | 8 / 40 | 0 |
| H3 kiln-2 | 46 / 50 | 30 |
| H3 kiln-3 | 29 / 34 | 9 |
| H2 kiln-1 | 3 / 20 | 1 |
| H2 kiln-2, kiln-3 | none | |
| the five Kiln runs of [`SPREAD.md`](SPREAD.md) | none | |

The count says the calls were exposed to the fault, not that each failed because of it.
How much of the price it explains is not measured: kiln-1, with few exposed calls, still
cost $1.136. **The results stand as measured.** A held-out spec is run once with the pinned
engine; the fault is fixed afterwards and H3 is not run again for this comparison. H1 is
run with the same pinned copy, fault included.

**Godot, file tools: 21 in three runs.** 14 were shell lines the harness refused because
the agent was allowed `godot` and nothing else, 7 were `godot` calls that failed. We did
not open each one. **Godot, agent tools: 19 in three runs** (counted runs): 13 refused,
6 failed `godot` calls; no call of a `godot` MCP tool failed. No failed Godot call was read
as a fault of the engine.

## What the agent tools were used for

godot-mcp-1 made 18 calls of the `godot` MCP tools and godot-mcp-2 made 20 (running the
game, screenshots, simulated input, scripts); godot-mcp-3 made one (`validate`).

## Limits

- **No person has looked at any of the nine games.** "Ended by itself" and a clean load are
  not the pass checks of [`H3.md`](H3.md). No run is called complete and no setup is called
  ahead.
- **What was checked differs by engine.** The Kiln games carry tests (the engine has a test
  command); most Godot games do not.
- **Three runs a side, one model, one machine, one afternoon.**
- **The Kiln runs were made with the fault above.**
- **A run was made twice** (above). No run ended on a usage limit, a network error or a
  dead process.
- **The machine** was also in use: another session read logs and files while runs went on,
  and the machine may have slept after the last counted run had ended (godot-mcp-3). The
  long times of godot-file-2 are two `godot` commands that each ran into the 10-minute tool
  limit, not sleep.
- **Kept outside the repository**: the game folders as left (without `.godot/`) and the
  logs, the second godot-mcp-3 run included.
