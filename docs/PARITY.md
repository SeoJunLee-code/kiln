# Parity scoreboard

Where Kiln stands against Godot 4, Unity 6 and Unreal Engine 5, feature by feature.
This file is the roadmap: work means moving a row to the right.

## The rule

**A feature that can regress without a check failing does not count.**
Keeping what works is worth more than adding what is new.

| Status | Meaning |
|---|---|
| none | not there |
| works | implemented and seen working once, by a person or a manual run |
| **gated** | a check in CI fails if it breaks: a test, a state hash, a reference image or a budget |

Only **gated** rows count toward a gate below. A new feature lands together with
its check; a change that turns a gated check red is fixed or reverted before
anything else is added.

A row whose Kiln cell says **gated** and then names a part in brackets is
**gated in part**: the check is real, but the row is not level with its bar.
Such a row does not close a gate by itself and is counted apart from the rows
gated in full (rule added 2026-11-27).

Counted on 2026-11-28, 62 rows: **23 gated in full, 11 gated in part, 6 works,
21 none**, and one row that is a number (platforms). By the edition column of
the tables:

| Edition | gated in full | gated in part | works | none | number | rows |
|---|---|---|---|---|---|---|
| all | 16 | 1 | 6 | 2 | 0 | 25 |
| Lite | 6 | 6 | 0 | 2 | 0 | 14 |
| Lite? | 0 | 0 | 0 | 2 | 0 | 2 |
| Standard | 1 | 4 | 0 | 8 | 1 | 14 |
| Ultra | 0 | 0 | 0 | 5 | 0 | 5 |
| — | 0 | 0 | 0 | 2 | 0 | 2 |

The edition of a row is the lowest edition whose gate needs it. `all` is the
shared core. `Lite?` waits for the three Lite demos to be named. `—` is what
code cannot close. `tests/parity.test.ts` holds every row to an edition and
these numbers to the tables.

Three kinds of check, because they fail differently:

- **State** is exact. The simulation is integer fixed-point, so the same scene
  and input give the same hash on Linux, macOS and Windows. CI compares hashes.
- **Images** are compared with a tolerance, on one reference environment only
  (Linux CI, software rasterizer). Pixels differ across GPUs, drivers and shader
  compilers, so identical images across machines are not a goal.
- **Speed** is checked in CI by counts that do not jitter (search states, draw
  calls, bytes). Wall-clock time is measured on the reference PC only, by
  [`bench/PROTOCOL.md`](../bench/PROTOCOL.md).

## Editions

Kiln is planned in three editions over one shared core: **Lite**, **Standard**
and **Ultra**. The plan and its rules are in [`EDITIONS.md`](EDITIONS.md). An
edition is defined by the machine a game must run on, not by a rival engine.
Other engines are the bar row by row: each row is held against whichever engine
does that thing best. The agent-first rows belong to the core and hold in all three.

| Feature | Edition | Kiln | Check |
|---|---|---|---|
| `check` names the lowest edition a game needs, and why | all | **gated** | `tests/edition.test.ts`: the edition of every example is written down; each kind of use is reported with its line; a folder needs the largest edition of its scenes |
| A feature above a given ceiling (`--edition`) is an error | all | **gated** | K140 with the line of every use, also for entities spawned from a prefab; at or under the ceiling the output is unchanged |
| A game ships only the parts it uses | all | **gated** | `tests/edition.test.ts`: a 2D game is built with the player alone, a 3D one adds the two renderers, a model file adds the glTF reader, a physics scene adds the backend. Decided from what the game folder holds; a part a scene asks for and the build lacks is a page error |
| Exported size within a byte budget, per edition | all | **gated** | engine bytes of a built game: 2D Lite 72,000, 3D Lite 102,000, Standard with everything 4,630,000 (2D Lite now 67,497 with sprite animation, state between levels, gamepad, audio and UI; measured 61,108 / 90,484 / 4,491,655 since `build` squeezes engine files; before that 93,775 against 94,000) |
| A game of a lower edition reaches the same hash under a higher one | all | works | browser test: a 2D and a 3D Lite game built without the parts they do not use reach the headless hash (two scenes, 90 ticks, nothing pressed). Not every example, and there is no way yet to run one game under a named edition |
| Lite features drawn by both renderers | Lite | **gated** | the reference images shared by WebGL2 and WebGPU |
| Allocation per tick in the simulation path: Lite no more than measured, Standard and Ultra none | all | none | `bench/alloc.ts` on the reference PC: 1.5 to 2.2 KB per played tick and 1.3 to 1.8 KB per idle tick in four Lite examples (5 to 11 KB before). `tests/alloc.test.ts` holds a ceiling over two of them |
| Parallel simulation reaches the serial hash | Standard | none | no parallel code yet |
| `check` reports the edition per axis (drawing, physics, world, network) | all | **gated** | one line per axis above Lite; nothing sets world or network yet. The scenes drawn only by WebGPU must be exactly those whose drawing is Standard |
| Budgets per edition: exported bytes, memory, time to first frame | all | works (Lite, bytes gated; the other two measured on the PC) | bytes are gated in the row above. Memory after loading and time to the first frame: [`proof/lite/START.md`](../proof/lite/START.md) (`bench/start.ts`), reference PC only, no phone, no limit set |
| A proof game per edition, built by an agent, at 60 fps on that edition's reference machine | all | works (Lite, on the PC; no phone) | `proof/lite`: spec, game and run record; tests replay it headless and in a browser. Frame rate measured on the reference PC by the protocol ([`proof/lite/FPS.md`](../proof/lite/FPS.md), 24 runs of 60 s): 1% low never under 247 fps without a frame cap, with the GPU or with it turned off, and no frame over 16.67 ms on the display. Not measured on a phone; with the page's CPU slowed 4x, one run of three had a 1% low of 52 fps. CI cannot check time; it holds a frame of the largest level to 90 Canvas 2D calls (`tests/proof.test.ts`). Standard and Ultra: none |
| Agent cost per edition: tokens for one spec, failures repaired without a person | all | works (Lite, one run each) | [`proof/lite/COMPARE.md`](../proof/lite/COMPARE.md): the same spec built once on Kiln before its fixes (7 failures repaired, 105 turns, $0.73), once after (0, 44 turns, $0.43) and once on Godot 4.7.2 (0, 45 turns, $0.73, 29 minutes against 4, and three and a half times the bytes of game: the agent wrote the rules, the solver and the test runner itself). One run each, so the spread is unknown; the spec was written by Kiln, and the engine was fixed for it between the two Kiln runs, so it shows nothing about which engine is cheaper. The comparison that counts is planned in [`EDITIONS.md`](EDITIONS.md), "Winning, not only matching" |

## Where Unity is the bar

| Feature | Edition | Unity | Kiln | Check |
|---|---|---|---|---|
| Frame rate on a phone and on a low-end laptop | Lite | yes | none | touch is tested with synthetic events only; never run on a phone |
| 100,000 entities: time per tick | Standard | yes (DOTS) | none | not measured; the largest measured scenes are in `bench/` |
| Number of platforms a game ships to | Standard | 20+ | 1 (web) | build test |
| Assets and plug-ins made by others | — | yes | none | code cannot close this |

## Agent-first (Kiln's own axis)

Neither engine was built for this; these rows are why Kiln exists.

| Feature | Edition | Kiln | Check |
|---|---|---|---|
| Scene as plain text, round-trips exactly | all | **gated** | tests |
| Every error at once, with codes and hints | all | **gated** | tests |
| Headless run with the same result as the browser | all | **gated** | all 21 examples replay in a browser to the headless hash, on 3 OSes |
| `solve`: the engine finds the input that wins a level | all | **gated** | tests, including a level won by pushing a rigid body, and one with gems in a maze, a door that opens last and guards that must not be touched (`count NAME == 0`). Distance follows the walls on top-down tile maps only; platformers and 3D still use the straight line |
| A scene ends headless where it loads another; `--follow` plays a game through its scenes | all | **gated** | `tests/cases.test.ts`: the run stops at the tick of the load and names the scene; counts asked for later are final; `--follow` replays the Lite proof game from level 1 to its ending in one command, stops at a failing scene, and gives up on a scene that loads itself. `solve` does not walk on through a load. Nothing is carried from one scene to the next |
| One scene checked for several things without copying it | all | **gated** | `tests/cases.test.ts`: `expect` lines in an input replace the scene's; `test DIR` runs each `NAME.CASE.input`; the three checks the first agent needed copied levels for pass against the levels themselves |
| `check` warns about parts that silently do nothing | all | **gated** | tests |
| One-call guide for an agent, kept small | all | **gated** | size budget in tests |
| MCP server | all | **gated** (protocol) | JSON-RPC test. One real client has used it (Claude Code, headless): [`proof/lite/RUN.md`](../proof/lite/RUN.md) |
| `look`: an agent sees what was drawn | all | **gated** | tests; over MCP the picture comes back in the reply |
| Real token cost of building a game, measured | all | works | one run, one model: 37,711 tokens written, 794,808 read (725,800 of them from cache), 7 m 4 s for the first run. `scripts/agentcost.ts` reads it from the run log (tested). Repeated runs and runs on Godot are in [`proof/compare`](../proof/compare/README.md); CI does not repeat them |
| A real agent builds a game to the end and repairs its own failures | all | works | twice: the Lite proof game. First run: 7 failures repaired without a person, 4 kinds of them Kiln's fault (listed in `proof/lite/RUN.md`). Second run, after those were fixed: none (`proof/lite/COMPARE.md`). Both games are kept working by `tests/proof.test.ts`; the runs themselves are not repeated by CI |
| The first tick where two runs differ is reported | all | none | |

## 2D (Godot 2D is the bar)

| Feature | Edition | Godot | Unity | Kiln | Check |
|---|---|---|---|---|---|
| Sprites, tile maps, camera | Lite | yes | yes | **gated** | reference images of 11 2D scenes |
| Box collision, swept movement | Lite | yes | yes | **gated** | tests, hashes |
| Rotation | Lite | yes | yes | **gated** (drawn only) | angle is hashed state on 3 OSes; reference image (`windmill`). Collision ignores it |
| Circle and polygon collision | Lite? | yes | yes | none | |
| Rigid bodies, joints | Standard | yes | yes | none in 2D (3D backend only); no joints | |
| Sprite animation | Lite | yes | yes | **gated** (one row of frames) | `anim FRAMES [fps] [idle]` on a sprite whose image is a row of frames: the frame is a function of the tick and the state (headless test), a browser test reads the frame color at six ticks and sees the mirror when the entity looks left; the facing is hashed state; reference image (`stroll`). No named clips, no atlas with rows, no per-frame timing, no events on a frame |
| Per-tile color and image | Lite | yes | yes | **gated** | `tiles paint=CHAR:COLOR,CHAR:IMAGE`: reference image (`garden`); browser test counts each painted color's cells in 2D and sees painted walls in both 3D renderers (colors only there); `check` rejects a malformed entry and warns about a character in no row, a missing image, an image in a 3D scene (K317, K312, K318). One image per character: no atlas, no auto-tiling, no animated tiles |
| Particles | Lite? | yes | yes | none | |
| Audio (samples, music, mixing) | Lite | yes | yes | **gated** (a sample per event, one looping track, two volumes) | `sound EVENT:FILE,... [music=FILE] [vol] [mvol]`: the player starts the file when the event is emitted, and the track at the first key. Browser test: the files started in the player match the events of a replay; the part is rendered to a buffer (`OfflineAudioContext`) and the peaks show the sample at its loudness, `vol` halving it, the music still playing after its first pass, `mvol=0` and mute silencing it, a missing file reported. A game without `sound` ships without the part (1,224 bytes) and keeps the event tones. `check` warns about a malformed pair, a wrong file type, an event no trigger emits, a second sound line, a missing file (K325 to K327, K312). No positional or pitched sound, no per-sample volume, no fades or crossfade between scenes, no buses beyond the two; nobody has listened on a phone |
| UI (text, buttons, layout) | Lite | yes | yes | **gated** (labels, buttons, nine screen anchors) | `button EVENT [action] [key=]`: a click or tap on its box, or the named key, emits the event and does a trigger's actions (`load:FILE` for a title screen); it is input (`TICK NAME tap`), so it is recorded and replays headless. `pin WHERE [dx] [dy]`: drawn against an edge, a corner or the centre of the view in units of a twelfth of its shorter side, whatever the camera does. Headless test: tap, key, every tap counts, actions, a tap on a non-button is an error (K201), warnings K328 to K331. Browser test at two view sizes (wide and tall): the pinned boxes are where the rule puts them before and after the camera moves, clicks on and beside a pinned button and on one in the world, the recorded taps replay to the same hash; the title example draws its label inside the button and starts on the key. Reference image (`title`). No containers, rows or grids (every entity is placed by itself), no text wrapping or measured sizes, no hover or pressed look, no focus moving between buttons, no sliders, text fields or scrolling; 2D only; `solve` does not tap |
| Gamepad | Lite | yes | yes | **gated** (standard layout, actions only) | the player asks the Gamepad API once a frame: d-pad or left stick past half way, button 0 is `a`, button 1 is `b`; a change becomes the same input line a key makes. Browser test with a synthetic pad: d-pad, stick under and over the threshold, both buttons, a pad that goes away, and the recorded input replays headless to the same hash. No analog values (the simulation has six on/off actions), no remapping, no rumble, no pad button for pause or restart; never tried with a real pad |
| Touch | Lite | yes | yes | **gated** | test with synthetic pointer events; not tried on a phone |
| State carried between levels | Lite | yes | yes | **gated** (named components of named entities) | `keep A,B` on an entity of the same name in both scenes: at a `load:` it starts the next scene with those components as they were at the tick of the load. `tally EVENT [n] [by]` is the built-in value (a score, lives), shown by a label as `%`. Headless test: handed over or not, save round trip, what is taken and what is refused; `--follow` and the browser player reach the same hash in the second level (browser test), and a restart there starts from what was handed over. No save to disk, no globals outside entities, nothing carried back to a scene left earlier |

## 3D rendering

| Feature | Edition | Godot | Unity | Unreal | Kiln | Check |
|---|---|---|---|---|---|---|
| Boxes and OBJ meshes, one shadowed sun | Lite | yes | yes | yes | **gated** | reference images, both renderers |
| WebGPU renderer | Standard | — | — | — | **gated** | held to the WebGL2 reference images; canvas output tested on Windows and macOS |
| Rotation and full transforms | Standard | yes | yes | yes | **gated** (WebGPU; no parenting) | quaternion is hashed state on 3 OSes; WebGPU-only reference image (`orrery3d`). Collision ignores it |
| glTF import | Standard | yes | yes | yes | **gated** (static models) | reader tests; `check` reports what a model would lose (K315); WebGPU-only reference image (`gallery3d`). No animation, skins or extensions; only this project's own files have been loaded |
| PBR materials, textures | Standard | yes | yes | yes | **gated** (WebGPU) | reference image (`gallery3d`): metallic-roughness, base color, normal, occlusion and emissive maps, mipmaps. One sun and a fixed sky/ground ambient; no environment map |
| Many lights, cascaded shadows | Standard | yes | yes | yes | none | |
| Skeletal animation, blending, IK | Standard | yes | yes | yes | none | |
| GPU-driven culling, automatic LOD (Nanite class) | Ultra | no | partial | yes | none | |
| Dynamic global illumination (Lumen class) | Ultra | partial | partial | yes | none | |
| Post effects, temporal upscaling | Ultra | yes | yes | yes | none | |

## Simulation and world

| Feature | Edition | Godot | Unity | Unreal | Kiln | Check |
|---|---|---|---|---|---|---|
| Deterministic across OSes | all | no | no | no | **gated** | hashes on 3 OSes |
| 3D rigid bodies, convex shapes | Standard | yes | yes | yes | **gated** (boxes and balls, Rapier backend) | pinned state hash and example hash on 3 OSes; browser replay equals headless; save and restore continue exactly; `solve` through physics; bodies stop, carry and are shoved by the character without overlap, also wedged against a wall; a body at 4 units per tick does not pass a thin wall; `impulse` and `force` from the scene or a script; a script puts a body somewhere or sets its speed, turn and spin, and a mover is stopped by it on that tick; WebGPU reference image (`tumble3d`); a body that runs into the character moves it by their weights, takes it along when a force drives the body, not through a wall, and a state saved meanwhile continues exactly; bodies a script writes to every tick stop a mover to a pinned hash. Measured, not gated: about 500 bodies fit a 60 Hz tick on the reference laptop (`bench/PHYSICS.md`). No joints, no other shapes |
| Navigation | Standard | yes | yes | yes | none (`pace` only) | |
| World streaming | Ultra | no | partial | yes | none | |
| Networking | Standard | yes | yes | yes | none | |

## Tools and platforms

| Feature | Edition | Godot | Unity | Unreal | Kiln | Check |
|---|---|---|---|---|---|---|
| Editor for people | Lite | yes | yes | yes | none (player page only) | |
| Profiler | Ultra | yes | yes | yes | none | |
| Web export | all | yes | yes | no | **gated** | build test; live demo |
| Desktop executable | Standard | yes | yes | yes | none | |
| Consoles | — | via partners | yes | yes | none | needs platform contracts, not code |

## Gates

Each gate also needs the edition rows above **gated** for that edition: its budgets, its proof game and its agent cost.

Since 2026-11-27 a gate also has a winning condition: on specs the engine was not fixed for, an agent finishes at least as often with Kiln as with the bar engine and for less. From Standard on, frame rate and size are held to the same rule. How that is measured is in [`EDITIONS.md`](EDITIONS.md), "Winning, not only matching". All three held-out specs have been run and none has been judged on a screen.

### Lite

Runs without WebGPU and with no dependencies. Bars: Godot for 2D features, Unity for low-end and phone frame rate. Three of Godot's official 2D demos rebuilt in Kiln, each solved by `solve`, each
row they use **gated**.

Open, and the gate cannot be judged until they are settled: the three demos
have not been named, and the choice decides whether circle and polygon
collision and particles (both **none**) are Lite rows. Rigid bodies in 2D are
not: they are Standard on the physics axis.

### Standard

Runs at 60 fps on an integrated GPU with WebGPU. Bars: Godot for 3D features, Unity for entity counts and platforms.

The glTF sample scenes within image tolerance of their references; a
third-person demo at 60 fps on the reference PC.

### Ultra

Needs a discrete GPU. Bar: Unreal.

Every row measured against UE5 on the **same scene, same settings, same
hardware**, by `bench/PROTOCOL.md`. Numbers are targets, to be revised when the
first measurements exist.

| Axis | Target |
|---|---|
| Geometry | A scene of 100M+ source triangles, no hand-made LODs, 1080p at 60 fps; frame time at or below UE5 |
| Lighting | Dynamic global illumination; perceptual error against a path-traced reference at or below UE5 |
| Characters | Skeletal animation, blending and IK; 100 characters at 60 fps |
| Physics | 10,000 rigid bodies stable; replay from input gives the same hash; destruction of bodies into pieces under the same rule |
| World | 16 km² streamed with a stated frame-time ceiling during loading |
| Network | A 64-player session demo |
| Tools | glTF and USD import, a viewer and inspector for people, a profiler, a timeline for cinematics |
| Platforms | Windows, macOS, Linux executables and the web |
| Shipped | Games made with Kiln by people outside the project |
| **Agent cost** | The same game spec built with UE5 + agent and with Kiln + agent: tokens, time, and whether it was finished |
