# Lite proof game: the same spec, three agent runs

[`SPEC.md`](SPEC.md) was given unchanged to an agent three times: on Kiln before the
fixes the first run led to ([`RUN.md`](RUN.md)), on Kiln after them, and on Godot 4.7.2.
Each was run **once**. One run says nothing about the spread between runs, so a
difference of a few tens of percent here is not a finding.

## Agent cost

| | Kiln, first run | Kiln, second run | Godot 4.7.2 |
|---|---|---|---|
| Date, engine | 2026-11-26, commit `f2d54bf` | 2026-11-27, commit `d7f3869` | 2026-11-27, official 4.7.2 stable |
| Finished by itself | yes | yes | yes |
| Time, start to end | 7 m 4 s | 3 m 36 s | 28 m 47 s |
| of which waiting for the model | not kept | 2 m 52 s | 4 m 27 s |
| Turns | 105 | 44 | 45 |
| Tokens written by the model | 37,711 | 23,980 | 39,061 |
| Tokens read by the model | 794,808 | 263,757 | 723,024 |
| of which new | 69,008 | 42,120 | 68,414 |
| Price at API rates | $0.73 | $0.43 | $0.73 |
| Tool calls | 104 | 43 | 44 |
| Calls that came back failed | 7 | 1 | 4 |
| of which the agent had to repair | 7 | 0 | 0 |
| Game as left by the agent | 14 files, 12,595 bytes | 11 files, 8,365 bytes | 8 files, 29,742 bytes |
| Looked at a picture of the game | 6 times | 5 times | never: it had no way to |

All three: Claude Code 2.1.330 headless, model `claude-sonnet-5-5`, an empty `game/`
folder, the file tools Read, Write, Edit and Glob, no skills, memory or project
instructions, nobody to ask. Tokens are the provider's own count from the run log
(`node scripts/agentcost.ts LOG.jsonl --calls`). The logs hold paths of the machine and
are not in the repository.

### The failed calls, read one by one

- **Kiln, first run: 7**, all real, four kinds of them Kiln's fault. Listed in [`RUN.md`](RUN.md).
- **Kiln, second run: 1**, and it was the answer the agent wanted: it asked `solve` to reach
  the gem behind the crate in a copy of level 3 with the crate fixed in place, and `solve`
  gave up after 200,000 states. Nothing was repaired.
- **Godot: 4**, none a mistake in the game. Two were shell lines the harness refused (a pipe
  into `Select-String`, a string with `$LASTEXITCODE`): the agent was allowed `godot` and
  nothing else. Two were the agent planting an unused variable to see its own test fail
  on a warning, which it did.

So the count of failures repaired without a person is 7, 0 and 0. The first Kiln run is
the only one in which the engine got in the agent's way.

## What differed between the Kiln runs and the Godot run

The spec and the model were the same. These were not:

| | Kiln | Godot |
|---|---|---|
| How the agent reached the engine | The Kiln MCP server, one tool | The `godot` command through a shell tool that allowed nothing else |
| Prompt | Read SPEC.md and build the game with the Kiln engine through the `kiln` tool; every file in `./game`; nobody will answer; keep going until "What done means" holds | The same, with Godot named, and three lines the spec needs on an engine that has no editions: "Lite" means 2D only, the Compatibility renderer, and no errors or warnings when the project is loaded headless; "the engine's test command" means a `godot --headless` command line that exits 0 only when every check passes |
| Turn limit | none in the first run, 400 in the second (not reached) | 400 (not reached) |

A first Godot attempt is not in the table. It was started with a shell tool this build of
Claude Code does not have on Windows, so the agent could not run Godot at all; it wrote
the game blind in 3 m 31 s, said so, and proved nothing. That was a mistake in the setup,
not a result.

## What each agent had to write

- **Kiln, second run**: four scenes, their winning inputs, and three case inputs for B, C and
  D. No script. The rules (walls, gems, the door, guards, crates, the next level) are
  components and triggers the engine already has; the winning inputs came from `solve`.
- **Godot**: the rules as its own code (`src/level_state.gd`, 4,013 bytes), drawing and
  input (`src/main.gd`), a search for winning inputs (`tools/solve.gd`), and a test runner
  with 48 checks (`tests/run_tests.gd`, 14,678 bytes). Godot gave it a scene tree, a
  script language and a headless run; the game's logic and every tool to check it were
  the agent's to write. It also added things the spec does not ask for (an `R` key to
  restart, a gem counter).

The 24 minutes of the Godot run that were not the model were spent inside tool calls,
which for this agent means its 17 `godot` runs (its input search and its tests). Which of
them were slow was not recorded. Run again from this repository, the finished test
command takes about 15 seconds.

## Checked afterwards, not by the agents

- **Kiln, second run** ([`rerun/`](rerun)): `test` on the folder passes 4 scenes and 3 cases;
  `test level1.kiln --follow` goes level 1 to the end screen; `check --edition lite` has no
  errors and no warnings. Sizes: 9 x 7 with 3 gems; 11 x 9 with 4 gems and 2 guards; 13 x 10
  with 4 gems, 2 guards and 2 crates. `tests/proof.test.ts` keeps it passing.
- **Godot** ([`godot/`](godot), without the `.godot` cache): the agent's test command was run
  again from the copy in this repository, `godot --headless --path proof/lite/godot --script
  res://tests/run_tests.gd`: 48 checks, 0 failed, exit code 0, about 15 seconds. Sizes read
  from `src/levels.gd`: 9 x 7 with 3 gems; 11 x 9 with 4 gems and 2 guards; 13 x 9 with 4
  gems, 2 guards and 2 crates, the gem at (11, 1) behind the crate at (9, 3). CI does not
  run it: Godot is not installed there.

## What this does not show

- **One run each.** The Kiln runs differ from each other by more than Kiln differs from
  Godot in tokens; without repeats nobody can say which differences are real.
- **The second Kiln run is not a clean before-and-after.** The engine changed (`solve`
  goes round walls and keeps off forbidden events, a scene ends at its load, case inputs,
  `--follow`, the guide names the scene extension), but it is also a different roll of
  the same model, and it chose simpler levels.
- **Kiln wrote the spec.** Its "done" list asks for recorded inputs, a test command and a
  folder that passes as a whole, which is what Kiln has. A spec that leaned on animation,
  audio or 3D would go the other way: Kiln could not build it at all today.
- **Neither game was played by a person.** The Godot game was never seen, by its agent or
  by anyone; whether it draws correctly is unknown. The Godot tests are the agent's own
  code checking the agent's own rules.
- **Frame rate and size of the Godot game were not measured.** Only the Kiln game has
  frame times ([`FPS.md`](FPS.md)).
- **The Godot agent had no documentation tool**; it wrote from what the model already
  knows of Godot, which is a great deal. The Kiln agent read Kiln's guide (about 5,500
  characters, twice) because nothing about Kiln is in the model.
- The agent in the second Kiln and the Godot runs answered in Korean, so some setting of
  the machine reached it. It did not change the tools it had.
