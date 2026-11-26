# Lite proof game: the first agent run

2026-11-26. The first time a real agent has been connected to Kiln. It built
[`SPEC.md`](SPEC.md) to the end without a person; the result is [`game/`](game) as the
agent left it, minus one stray file (see below).

## How it was run

| | |
|---|---|
| Agent | Claude Code 2.1.330, headless (`-p`), model `claude-sonnet-5-5` |
| What it had | `SPEC.md`, an empty `game/` folder, the Kiln MCP server (one tool, `kiln`), and four file tools: Read, Write, Edit, Glob |
| What it did not have | A shell, the Kiln repository, the examples, any skill, memory or project instructions, a person to ask |
| Prompt | Read SPEC.md and build the game with the Kiln engine through the `kiln` tool; put every file in `./game`; nobody will answer questions; keep going until everything under "What done means" holds |
| Engine | commit `f2d54bf` plus nothing: the run came before any change it led to |

The log is not in the repository (it holds paths of the machine it ran on). The numbers
below come from it through `node scripts/agentcost.ts LOG.jsonl --calls`.

## Agent cost

| | |
|---|---|
| Finished by itself | yes |
| Time | 7 m 4 s |
| Turns | 105 |
| Tokens written by the model | 37,711 |
| Tokens read by the model | 794,808: 69,008 new, 725,800 the same context read again from cache |
| Price at API rates | $0.73 |
| Tool calls | 104: Edit 47, Write 21, `solve` 10, `test` 8, `check` 6, `look` 6, `guide` 2, `schema` 1, Read 1, Glob 2 |
| Failures met and repaired without a person | 7: `solve` 3, `test` 3, Edit 1 |

One run, one model. It says nothing yet about spread between runs or about other
models, and nothing about another engine: the same spec has not been built on Godot.

## The seven failures

| # | Call | What went wrong | Whose fault |
|---|---|---|---|
| 1 | `solve` | Named its first scene `level1.scene`; `load:level2.scene` was refused (K104). The guide never said scenes are `NAME.kiln` | Kiln: fixed in the guide after this run |
| 2, 3 | `solve` | Level 2 (four gems, two guards): gave up after 200,000 states with no gem collected. The agent rewrote the level until `solve` could win it | Kiln: `solve` measured distance in a straight line, so the door, still closed, was the nearest goal. Fixed after this run: distance follows the walls (`tests/fixtures/vault.kiln` is this level; it now solves in 7,987 states) |
| 4, 5 | `test` | The winning input walked through guards (`caught` 3 times). `solve` had met every goal it was given and "not caught" was not one of them | Kiln: no way to give `solve` an event that must not happen. Fixed after this run: `solve` keeps `count NAME == 0 at N` |
| 6 | `test` | `reach hero guard1` failed with a gap of 0.00002: the trigger fired but the overlap test did not agree | Kiln: the trigger removed the hero in the step of the contact, so `reach` had nothing left to measure. For the same reason `never hero #guard` passed for a hero a guard had just removed. Fixed after this run (`tests/contact.test.ts`) |
| 7 | Edit | Text to replace was not in the file | The agent |

## What was checked afterwards, not by the agent

- `node src/cli.ts test proof/lite/game` → 7 scenes pass. `check proof/lite/game --edition lite` → no errors, no warnings, `edition=lite`.
- The spec's minimum sizes hold (level 2 and 3 are 11 x 10 and 13 x 10; gems 3, 4, 4; guards 0, 2, 2; crates 0, 2). The vault gem of level 3 is walled in with the crate in the only gap.
- In a real browser (`tests/proof.test.ts`): level 1 won opens level 2, level 2 opens level 3, level 3 opens the end screen; touching a guard opens level 2 again; a closed door opens nothing. The agent could not see any of this: a headless run emits `load` and goes on in the same scene.
- The build of the game carries no optional engine part and is inside the 2D Lite byte budget.

## What the run does not show

- **Frame rate: measured on the reference PC, not on a phone** ([`FPS.md`](FPS.md), `node bench/frames.ts`, 2026-11-26). The game draws with Canvas 2D, so it never asks for WebGPU; "WebGPU turned off" changes nothing for it, and the run with the GPU turned off altogether stands in for that machine. Without a frame cap the slowest 1% low of 12 runs was 247 fps; on the 144 Hz display no frame of 77,764 took longer than 16.67 ms.
  - The Lite proof-game row stays open until a real phone has run it. The nearest thing here is the browser slowing the page's CPU 4x with the GPU off: 150 to 169 fps on average, but one run of three had a 1% low of 52 fps (71 frames of 9,019 over 16.67 ms). That is an imitation, not a phone, and it says a slow phone may drop frames.
  - What was timed is the player as `kiln play` serves it, side panel included, looping each level's recorded input; the load at the end of a level is never reached. A level change, the end screen and the built folder were not timed.
  - GPU frame time is not recorded (Canvas 2D has no timestamp queries). The browser's clock is coarsened to 0.1 ms, so per-frame times under about 0.2 ms are averages only.
  - The window has to stay in front. In the first attempt two runs covered 18 and 26 of their 60 seconds because the window lost the screen; the script now refuses such a run and measures it again (it did so once in the final set).
  - Nothing compares this with another engine: the same game does not exist on Godot yet.
- Nobody has played it by hand. Whether it is any fun, or the guards are fair, is unknown.
- The test scenes for B, C and D are copies of the levels with other expects. Change a level and its copy goes stale; Kiln has no way to run one scene under several inputs and expects.
- The `count caught == 0 at 886` expects carry a tick the agent read off a run. They break if the level changes.
- The agent could not delete the misnamed `level1.scene`, so it overwrote it with an empty scene. That file was removed by hand; nothing else in `game/` was touched.
