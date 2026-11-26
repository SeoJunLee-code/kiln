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

| Feature | Kiln | Check |
|---|---|---|
| `check` names the lowest edition a game needs, and why | none | |
| A feature above a given ceiling (`--edition`) is an error | none | |
| A game ships only the parts it uses | works (physics backend only) | build test covers the backend; the player still loads the WebGPU renderer and glTF reader for a 2D game |
| Exported size within a byte budget, per edition | none | |
| A game of a lower edition reaches the same hash under a higher one | none | |
| Lite features drawn by both renderers | **gated** | the reference images shared by WebGL2 and WebGPU |
| No allocation per tick in the simulation path | none | not measured; Kiln runs on a garbage-collected language |
| Parallel simulation reaches the serial hash | none | no parallel code yet |
| `check` reports the edition per axis (drawing, physics, world, network) | none | |
| Budgets per edition: exported bytes, memory, time to first frame | none | bytes in CI; memory and time on the reference machine only |
| A proof game per edition, built by an agent, at 60 fps on that edition's reference machine | none | |
| Agent cost per edition: tokens for one spec, failures repaired without a person | none | |

## Where Unity is the bar

| Feature | Unity | Kiln | Check |
|---|---|---|---|
| Frame rate on a phone and on a low-end laptop | yes | none | touch is tested with synthetic events only; never run on a phone |
| 100,000 entities: time per tick | yes (DOTS) | none | not measured; the largest measured scenes are in `bench/` |
| Number of platforms a game ships to | 20+ | 1 (web) | build test |
| Assets and plug-ins made by others | yes | none | code cannot close this |

## Agent-first (Kiln's own axis)

Neither engine was built for this; these rows are why Kiln exists.

| Feature | Kiln | Check |
|---|---|---|
| Scene as plain text, round-trips exactly | **gated** | tests |
| Every error at once, with codes and hints | **gated** | tests |
| Headless run with the same result as the browser | **gated** | all 18 examples replay in a browser to the headless hash, on 3 OSes |
| `solve`: the engine finds the input that wins a level | **gated** | tests, including a level won by pushing a rigid body |
| `check` warns about parts that silently do nothing | **gated** | tests |
| One-call guide for an agent, kept small | **gated** | size budget in tests |
| MCP server | **gated** (protocol) | JSON-RPC test; no real client run yet |
| `look`: an agent sees what was drawn | **gated** | tests; over MCP the picture comes back in the reply |
| Real token cost of building a game, measured | none | one size estimate only |
| A real agent builds a game to the end and repairs its own failures | none | no real client has connected; count the failures fixed without a person |
| The first tick where two runs differ is reported | none | |

## 2D (Godot 2D is the bar)

| Feature | Godot | Unity | Kiln | Check |
|---|---|---|---|---|
| Sprites, tile maps, camera | yes | yes | **gated** | reference images of 8 scenes |
| Box collision, swept movement | yes | yes | **gated** | tests, hashes |
| Rotation | yes | yes | **gated** (drawn only) | angle is hashed state on 3 OSes; reference image (`windmill`). Collision ignores it |
| Circle and polygon collision | yes | yes | none | |
| Rigid bodies, joints | yes | yes | none in 2D (3D backend only); no joints | |
| Sprite animation | yes | yes | none | |
| Per-tile color and image | yes | yes | none | |
| Particles | yes | yes | none | |
| Audio (samples, music, mixing) | yes | yes | **gated** (event tones only) | test counts tone requests; nobody has listened |
| UI (text, buttons, layout) | yes | yes | **gated** (labels only) | test |
| Gamepad | yes | yes | none | |
| Touch | yes | yes | **gated** | test with synthetic pointer events; not tried on a phone |
| State carried between levels | yes | yes | none | |

## 3D rendering

| Feature | Godot | Unity | Unreal | Kiln | Check |
|---|---|---|---|---|---|
| Boxes and OBJ meshes, one shadowed sun | yes | yes | yes | **gated** | reference images, both renderers |
| WebGPU renderer | — | — | — | **gated** | held to the WebGL2 reference images; canvas output tested on Windows and macOS |
| Rotation and full transforms | yes | yes | yes | **gated** (WebGPU; no parenting) | quaternion is hashed state on 3 OSes; WebGPU-only reference image (`orrery3d`). Collision ignores it |
| glTF import | yes | yes | yes | **gated** (static models) | reader tests; `check` reports what a model would lose (K315); WebGPU-only reference image (`gallery3d`). No animation, skins or extensions; only this project's own files have been loaded |
| PBR materials, textures | yes | yes | yes | **gated** (WebGPU) | reference image (`gallery3d`): metallic-roughness, base color, normal, occlusion and emissive maps, mipmaps. One sun and a fixed sky/ground ambient; no environment map |
| Many lights, cascaded shadows | yes | yes | yes | none | |
| Skeletal animation, blending, IK | yes | yes | yes | none | |
| GPU-driven culling, automatic LOD (Nanite class) | no | partial | yes | none | |
| Dynamic global illumination (Lumen class) | partial | partial | yes | none | |
| Post effects, temporal upscaling | yes | yes | yes | none | |

## Simulation and world

| Feature | Godot | Unity | Unreal | Kiln | Check |
|---|---|---|---|---|---|
| Deterministic across OSes | no | no | no | **gated** | hashes on 3 OSes |
| 3D rigid bodies, convex shapes | yes | yes | yes | **gated** (boxes and balls, Rapier backend) | pinned state hash and example hash on 3 OSes; browser replay equals headless; save and restore continue exactly; `solve` through physics; bodies stop, carry and are shoved by the character without overlap, also wedged against a wall; a body at 4 units per tick does not pass a thin wall; `impulse` and `force` from the scene or a script; a script puts a body somewhere or sets its speed, turn and spin, and a mover is stopped by it on that tick; WebGPU reference image (`tumble3d`); a body that runs into the character moves it by their weights, takes it along when a force drives the body, not through a wall, and a state saved meanwhile continues exactly; bodies a script writes to every tick stop a mover to a pinned hash. Measured, not gated: about 500 bodies fit a 60 Hz tick on the reference laptop (`bench/PHYSICS.md`). No joints, no other shapes |
| Navigation | yes | yes | yes | none (`pace` only) | |
| World streaming | no | partial | yes | none | |
| Networking | yes | yes | yes | none | |

## Tools and platforms

| Feature | Godot | Unity | Unreal | Kiln | Check |
|---|---|---|---|---|---|
| Editor for people | yes | yes | yes | none (player page only) | |
| Profiler | yes | yes | yes | none | |
| Web export | yes | yes | no | **gated** | build test; live demo |
| Desktop executable | yes | yes | yes | none | |
| Consoles | via partners | yes | yes | none | needs platform contracts, not code |

## Gates

Each gate also needs the edition rows above **gated** for that edition: its budgets, its proof game and its agent cost.

### Lite

Runs without WebGPU and with no dependencies. Bars: Godot for 2D features, Unity for low-end and phone frame rate. Three of Godot's official 2D demos rebuilt in Kiln, each solved by `solve`, each
row they use **gated**.

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
