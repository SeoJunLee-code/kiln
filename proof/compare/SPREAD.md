# The spread: the development spec, five runs on each engine

[`../lite/SPEC.md`](../lite/SPEC.md) (Gem Vault) was given unchanged to an agent ten times,
five on Kiln and five on Godot, to see how far two runs of the same thing lie apart. This
is the development spec: Kiln was changed after its first run of it, so **nothing here is a
win or a loss**. The numbers set how many times each held-out spec is run, and nothing else.

**The highest price is 1.42 times the lowest on Kiln and 1.39 times on Godot. Neither is
above 2, so each held-out spec is run 3 times per setup, not 5.**

## Conditions

| | |
|---|---|
| Date | 2026-11-27, 09:51 to 10:58 UTC, one run after another, the engines taking turns (kiln1, godot1, kiln2, ...) |
| Agent | Claude Code 2.1.330 headless, `claude-sonnet-5-5`, effort medium |
| Kiln | a copy of commit `7f7c92e` (`git archive`), reached through its MCP server, one tool |
| Godot | official 4.7.2 stable, reached through the `godot` command in a shell tool that allows nothing else. The agent-tools setup of [`GODOT-TOOLS.md`](GODOT-TOOLS.md) was not part of the spread |
| Isolation | `--setting-sources ""`, `--strict-mcp-config`, a new folder with `SPEC.md` and an empty `game/` for every run; the command and the prompts are in [`README.md`](README.md) |
| Ceilings | a price ceiling and a clock ceiling on every run. No run reached either |

## The runs

All ten ended by themselves. Time is start to end / waiting for the model / inside tools.

| Run | Time | Turns | Tokens written / read | Price | Failed calls | Check after the run | Game as left |
|---|---|---|---|---|---|---|---|
| kiln1 | 2:42 / 2:16 / 0:31 | 49 | 19,217 / 384,297 | $0.381 | 3 | `test` 7 of 7, `check --edition lite` 0 warnings | 11 files, 7,519 bytes |
| kiln2 | 2:15 / 2:07 / 0:09 | 43 | 17,950 / 234,095 | $0.336 | 1 | 7 of 7, 0 warnings | 11 files, 6,814 bytes |
| kiln3 | 2:35 / 2:26 / 0:12 | 52 | 20,495 / 287,633 | $0.385 | 0 | 7 of 7, 0 warnings | 13 files, 6,160 bytes |
| kiln4 | 3:17 / 3:06 / 0:14 | 58 | 26,310 / 358,663 | $0.477 | 1 | 7 of 7, 0 warnings | 11 files, 7,907 bytes |
| kiln5 | 2:43 / 2:21 / 0:24 | 46 | 19,790 / 267,588 | $0.365 | 2 | 7 of 7, 0 warnings | 11 files, 7,459 bytes |
| godot1 | 8:59 / 3:54 / 5:07 | 49 | 34,582 / 919,890 | $0.646 | 13 | 169 checks, 0 failed, exit 0 | 10 files, 29,661 bytes |
| godot2 | 5:13 / 4:07 / 1:14 | 57 | 37,598 / 757,047 | $0.669 | 10 | 207 checks, 0 failed, exit 0 | 10 files, 26,736 bytes |
| godot3 | 7:39 / 3:07 / 4:31 | 37 | 27,462 / 497,941 | $0.481 | 8 | 201 checks, 0 failed, exit 0 | 10 files, 23,775 bytes |
| godot4 | 11:31 / 3:48 / 7:44 | 50 | 34,120 / 806,166 | $0.610 | 8 | 167 checks, 0 failed, exit 0 | 11 files, 30,482 bytes |
| godot5 | 20:03 / 3:39 / 16:28 | 42 | 31,854 / 629,178 | $0.573 | 8 | 117 checks, 0 failed, exit 0 | 8 files, 23,683 bytes |

- Tokens and price are the provider's own count from the run log
  (`node scripts/agentcost.ts LOG.jsonl --calls`). The logs hold paths of the machine and
  are not in the repository.
- **Check after the run** was done by us on the game as the agent left it. Kiln: `test` and
  `check --edition lite` of the pinned engine copy. Godot: the test command the agent named
  in its last message (`godot --headless --path game --script res://tests/run_tests.gd` in
  all five), run again. The Godot checks are the agent's own, so their number says how much
  it wrote, not how much is right.
- **Minimum size**: counted from the level files of all ten games. Every level of every run
  has at least the grid, gems, guards and crates the spec asks for.
- Godot's byte counts leave out `.godot/` and the `.uid` files the engine writes.

## How far apart

| | Kiln, 5 runs | Godot, 5 runs |
|---|---|---|
| Price, lowest to highest | $0.336 to $0.477 | $0.481 to $0.669 |
| Highest / lowest | 1.42 | 1.39 |
| Waiting for the model | 2:07 to 3:06 | 3:07 to 4:07 |
| Start to end | 2:15 to 3:17 | 5:13 to 20:03 |
| Turns | 43 to 58 | 37 to 57 |

The two price ranges do not overlap, and the gap between them is $0.003. The two ranges of
model waiting do not overlap, and the gap is 1.2 seconds (186.9 s against 187.1 s). With
five runs a side, a sixth could close either gap. On the development spec that would not
be a result in any case.

## The failed calls

- **Kiln: 7 in five runs.** Three were `test` reporting a defect in the game being built
  (kiln1, kiln2, kiln4), which the agent then repaired: the tool doing its job. Two were
  `solve` giving up after 200,000 states (kiln1, kiln5); that is the limit of the engine's
  solver, and we did not read whether the agent was asking for a route or for proof that
  there is none. Two were `look` called with a scene in the call instead of a file (kiln1,
  kiln5): the tool said so and the agent wrote the file.
- **Godot: 47 in five runs, none of them Godot's.** 29 were shell lines the harness refused
  because the agent was allowed `godot` and nothing else (pipes, `$(...)`, `Copy-Item`,
  script blocks). 18 were `godot` exiting 1: the agent's tests failing while it worked,
  parse errors in its scripts, and an unused variable it planted on purpose to see its test
  fail on a warning.

The refused shell lines belong to this setup, not to Godot: a looser allow rule would
remove most of them, and would also let the agent do things the Kiln setup cannot.

## Godot's time outside the model

Four of the five Godot runs spent more time inside tools than waiting for the model. Read
call by call, it is one thing: **the agent writes its own search for winning inputs in
GDScript and runs it headless**, and one such call takes minutes.

| Run | `godot` calls of 20 s or more |
|---|---|
| godot1 | 253 s |
| godot2 | none (longest 10.8 s) |
| godot3 | 231 s |
| godot4 | 180 s, 240 s |
| godot5 | 108 s, 207 s, 601 s, 32 s |

The 601 s call of godot5 did not end in that time: the harness moved it to the background
after ten minutes and the agent went on with a narrower search. This time costs no tokens.
It is why "start to end" spreads from 5 to 20 minutes on Godot while the price and the
model waiting do not. The Kiln runs' longest tool time was `solve` and `look`, 31 s in a
whole run at most.

## Limits

- **No person has looked at any of the ten games.** "Ended by itself" and the checks above
  are not the pass checks of [`GEMVAULT-CHECKS.md`](GEMVAULT-CHECKS.md); those are judged on
  the screen and have not been done. A run counted here could still fail them.
- **Development spec.** Kiln's guide, components and solver were shaped by earlier runs of
  this very spec. The held-out specs exist because of that.
- **Five runs a side, one model, one machine, one afternoon.**
- **Other work ran on the same machine during the series**: two trial runs of the Godot
  agent tools during the first minute and a half of kiln2; this repository's tests and
  picture checks during the start of godot2 and once more ten minutes later; two short
  trial runs during godot1; a few headless Godot starts of about 15 s each during godot2,
  kiln3 and godot3. This can lengthen tool time and, a little, model waiting. It does not
  change tokens or price. The list is what was written down and may not be complete.
- The Godot setup measured here is the one with file tools. How the agent-tools setup
  spreads is not known.
