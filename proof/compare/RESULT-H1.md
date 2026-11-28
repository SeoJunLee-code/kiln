# Held-out spec 1: nine runs, before anyone has looked at a screen

[`H1.md`](H1.md) (a gravity-flip room puzzle, 2D, with sound) was given to an agent nine
times: three on Kiln, three on Godot with file tools, three on Godot with agent tools.
This file holds what the run logs and the automatic checks say. It does not say which
games pass: the screen checks of `H1.md` are judged on a screen by a person, and that has
not been done.

**Verdict: pending the screen checks.**

**All nine runs ended by themselves. The three price ranges all overlap: Kiln $0.936 to
$1.191, Godot with file tools $0.798 to $1.196, Godot with agent tools $0.956 to $1.290.
Waiting for the model overlaps too. The Kiln runs were made with the fault that
[`RESULT-H3.md`](RESULT-H3.md) describes (a changed script was not read again), and they
were exposed to it heavily.**

## Conditions

| | |
|---|---|
| Date | 2026-11-28, 00:58 to 03:04 UTC, one run after another in three rounds of Kiln, Godot file tools, Godot agent tools |
| Agent | Claude Code 2.1.330 headless, `claude-sonnet-5-5`, effort medium |
| Kiln | the same copy of commit `1f50d8d` as in [`RESULT-H2.md`](RESULT-H2.md), reached through its MCP server, one tool; its `proof/` folder moved out before the series. The fault found in H3 is in this copy; it was not changed |
| Godot, file tools | official 4.7.2 stable, reached through the `godot` command in a shell tool that allows nothing else |
| Godot, agent tools | the same, plus the MCP server `godot-mcp-runtime` 4.0.1 of [`GODOT-TOOLS.md`](GODOT-TOOLS.md) |
| Isolation | `--setting-sources ""`, `--strict-mcp-config`, a new folder for every run; the command is in [`README.md`](README.md) |
| Ceilings | a price ceiling and a clock ceiling on every run. No run reached either |
| Counted | the first run of each of the nine, and nothing else. No run was repeated, none was thrown out |

**What a run folder held at the start:** `SPEC.md` (the text between the two lines of
`H1.md`) and `game/sounds/` with the five files of [`h1-sounds/`](h1-sounds).

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

## The runs

All nine ended by themselves. Time is the program's own running time / waiting for the
model / inside tools.

| Run | Time | Turns | Tokens written / read | Price | Failed calls | Check after the run | Game as left |
|---|---|---|---|---|---|---|---|
| kiln-1 | 9:43 / 7:15 / 2:39 | 107 | 62,354 / 1,541,450 | $1.191 | 12 | `test` 10 of 10, `check` lite, 0 warnings | 33 files, 20,418 bytes |
| kiln-2 | 6:22 / 6:14 / 0:14 | 84 | 53,568 / 880,758 | $0.936 | 5 | 8 of 8, 0 warnings | 25 files, 21,758 bytes |
| kiln-3 | 9:58 / 7:36 / 2:28 | 90 | 64,837 / 1,482,296 | $1.172 | 20 | 8 of 8, 0 warnings | 17 files, 16,117 bytes |
| godot-file-1 | 13:55 / 6:16 / 7:42 | 56 | 54,037 / 1,601,856 | $1.044 | 12 | loads clean; 2 tests exit 0 | 7 files, 41,113 bytes |
| godot-file-2 | 38:05 / 7:49 / 30:23 | 72 | 65,366 / 1,835,325 | $1.196 | 16 | loads clean; 3 tests exit 0 | 9 files, 41,015 bytes |
| godot-file-3 | 13:22 / 5:13 / 8:11 | 50 | 43,977 / 1,046,344 | $0.798 | 7 | loads clean; 1 test exits 0 | 8 files, 31,462 bytes |
| godot-mcp-1 | 9:02 / 5:53 / 3:16 | 49 | 50,315 / 1,536,437 | $0.956 | 8 | loads clean; 1 test exits 0 | 7 files, 38,852 bytes |
| godot-mcp-2 | 16:51 / 6:42 / 10:22 | 93 | 56,881 / 3,240,461 | $1.290 | 12 | loads with one warning at exit (below); no test left in `game/` | 6 files, 21,173 bytes |
| godot-mcp-3 | 8:17 / 5:33 / 2:49 | 70 | 49,937 / 2,128,614 | $1.049 | 9 | loads clean; 1 test exits 0 | 7 files, 33,851 bytes |

- Tokens and price are the provider's own count from the run log
  (`node scripts/agentcost.ts LOG.jsonl --calls`). The logs hold paths of the machine and
  are not in the repository. No log has more than one result line.
- **Check after the run** was done by us after the series, on the game as the agent left
  it. Kiln: `test` and `check` of the pinned copy, all exit 0; `H1.md` asks for no edition,
  `check` was run with none and reports `lite` for all three. "10 of 10" is scenes plus
  input cases. Godot: "loads clean" is `godot --headless --path game --quit` exiting 0 and
  printing no line with "error" or "warning"; then the test commands the agent named in its
  last message, run again with `--headless`. The tests are the agent's own, so their number
  says how much it wrote, not how much is right.
- **godot-mcp-2's warning:** `WARNING: 2 ObjectDB instances were leaked at exit`, printed
  by the headless quit. We did not look into whether it shows when a person plays.
- **Game as left** counts the agent's files and bytes: without the five sound files,
  `.godot/`, `.import`, `.uid` and `.mcp/`. kiln-1's 33 files include probe scripts and an
  `art/` folder that its last message says it emptied because it could not delete them;
  kiln-3 names two emptied probe files the same way. The Kiln setup has no way to delete a
  file.

## How far apart

| | Kiln, 3 runs | Godot file tools, 3 runs | Godot agent tools, 3 runs |
|---|---|---|---|
| Price, lowest to highest | $0.936 to $1.191 | $0.798 to $1.196 | $0.956 to $1.290 |
| Highest / lowest | 1.27 | 1.50 | 1.35 |
| Waiting for the model | 6:14 to 7:36 | 5:13 to 7:49 | 5:33 to 6:42 |
| Time | 6:22 to 9:58 | 13:22 to 38:05 | 8:17 to 16:51 |
| Turns | 84 to 107 | 50 to 72 | 49 to 93 |

- **Price.** All three ranges overlap.
- **Waiting for the model.** All three ranges overlap.
- **Time.** Kiln lies below Godot file tools (the gap is 3:24). Kiln and Godot agent tools
  overlap, and so do the two Godot setups. The time inside tools is where the difference
  is.

## The failed calls

- **Kiln: 37 in three runs.** 30 were `test` failing on the game while the agent changed
  it. 3 were `check` refusing a scene because a script spawned an entity whose name was
  already taken. 2 were `solve` finding no route (one at its tick limit, one at 200,000
  states). 1 was `look` called with scene text instead of a file. 1 was a probe in which
  the agent printed what the script object holds, to find out what it can do.
- **Godot, file tools: 35 in three runs.** 16 were shell lines the harness refused, 19 were
  `godot` calls that failed. We did not open each one.
- **Godot, agent tools: 29 in three runs.** 17 refused shell lines, 12 failed `godot`
  calls. No call of a `godot` MCP tool failed (36 such calls: 13, 17, 6).

**The script fault.** Engine calls made after a script that had already been loaded was
changed (see [`RESULT-H3.md`](RESULT-H3.md)):

| Run | Such calls / all `run`, `test`, `check`, `solve` calls | Of them failed |
|---|---|---|
| kiln-1 | 28 / 29 | 11 |
| kiln-2 | 14 / 15 | 5 |
| kiln-3 | 23 / 25 | 19 |

Exposed is not the same as failed because of it, and what share of the failures or of the
price the fault explains was not measured. The results stand as measured. H1 is not run
again for this comparison.

## Limits

- **No person has looked at any of the nine games**, and sound cannot be checked in a
  headless run. "Ended by itself", the game's own tests and a clean load are not the pass
  checks of [`H1.md`](H1.md). No run is called complete and no setup is called ahead.
- **The Kiln runs were made with a known fault of Kiln** (above).
- **The tests are the agent's.**
- **Three runs a side, one model, one machine, one night.**
- **Runs repeated or thrown out: none.** No run ended on a usage limit, a network error or
  a dead process.
- **Other work on the same machine during the series**: the session that watched the runs
  read source files while they went on. The checks after the run were done after the last
  run had ended. This can lengthen tool time and, a little, model waiting. It does not
  change tokens or price.
- **Kept outside the repository**: the nine game folders as left (without `.godot/`) and
  the nine logs.
