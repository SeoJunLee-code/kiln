# Parity scoreboard

Where Kiln stands against Godot 4 and Unreal Engine 5, feature by feature.
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

## 2D (Godot 2D is the bar)

| Feature | Godot | Kiln | Check |
|---|---|---|---|
| Sprites, tile maps, camera | yes | **gated** | reference images of 8 scenes |
| Box collision, swept movement | yes | **gated** | tests, hashes |
| Rotation | yes | **gated** (drawn only) | angle is hashed state on 3 OSes; reference image (`windmill`). Collision ignores it |
| Circle and polygon collision | yes | none | |
| Rigid bodies, joints | yes | none in 2D (3D backend only); no joints | |
| Sprite animation | yes | none | |
| Per-tile color and image | yes | none | |
| Particles | yes | none | |
| Audio (samples, music, mixing) | yes | **gated** (event tones only) | test counts tone requests; nobody has listened |
| UI (text, buttons, layout) | yes | **gated** (labels only) | test |
| Gamepad | yes | none | |
| Touch | yes | **gated** | test with synthetic pointer events; not tried on a phone |
| State carried between levels | yes | none | |

## 3D rendering

| Feature | Godot | Unreal | Kiln | Check |
|---|---|---|---|---|
| Boxes and OBJ meshes, one shadowed sun | yes | yes | **gated** | reference images, both renderers |
| WebGPU renderer | — | — | **gated** | held to the WebGL2 reference images; canvas output tested on Windows and macOS |
| Rotation and full transforms | yes | yes | **gated** (WebGPU; no parenting) | quaternion is hashed state on 3 OSes; WebGPU-only reference image (`orrery3d`). Collision ignores it |
| glTF import | yes | yes | **gated** (static models) | reader tests; `check` reports what a model would lose (K315); WebGPU-only reference image (`gallery3d`). No animation, skins or extensions; only this project's own files have been loaded |
| PBR materials, textures | yes | yes | **gated** (WebGPU) | reference image (`gallery3d`): metallic-roughness, base color, normal, occlusion and emissive maps, mipmaps. One sun and a fixed sky/ground ambient; no environment map |
| Many lights, cascaded shadows | yes | yes | none | |
| Skeletal animation, blending, IK | yes | yes | none | |
| GPU-driven culling, automatic LOD (Nanite class) | no | yes | none | |
| Dynamic global illumination (Lumen class) | partial | yes | none | |
| Post effects, temporal upscaling | yes | yes | none | |

## Simulation and world

| Feature | Godot | Unreal | Kiln | Check |
|---|---|---|---|---|
| Deterministic across OSes | no | no | **gated** | hashes on 3 OSes |
| 3D rigid bodies, convex shapes | yes | yes | **gated** (boxes and balls, Rapier backend) | pinned state hash and example hash on 3 OSes; browser replay equals headless; save and restore continue exactly; `solve` through physics; bodies stop, carry and are shoved by the character without overlap, also wedged against a wall; a body at 4 units per tick does not pass a thin wall; `impulse` and `force` from the scene or a script; a script puts a body somewhere or sets its speed, turn and spin, and a mover is stopped by it on that tick; WebGPU reference image (`tumble3d`); a body that runs into the character moves it by their weights, takes it along when a force drives the body, not through a wall, and a state saved meanwhile continues exactly. No joints, no other shapes |
| Navigation | yes | yes | none (`pace` only) | |
| World streaming | no | yes | none | |
| Networking | yes | yes | none | |

## Tools and platforms

| Feature | Godot | Unreal | Kiln | Check |
|---|---|---|---|---|
| Editor for people | yes | yes | none (player page only) | |
| Profiler | yes | yes | none | |
| Web export | yes | no | **gated** | build test; live demo |
| Desktop executable | yes | yes | none | |
| Consoles | via partners | yes | none | needs platform contracts, not code |

## Gates

### Godot 2D class

Three of Godot's official 2D demos rebuilt in Kiln, each solved by `solve`, each
row they use **gated**.

### Godot 3D class

The glTF sample scenes within image tolerance of their references; a
third-person demo at 60 fps on the reference PC.

### Unreal class

Every row measured against UE5 on the **same scene, same settings, same
hardware**, by `bench/PROTOCOL.md`. Numbers are targets, to be revised when the
first measurements exist.

| Axis | Target |
|---|---|
| Geometry | A scene of 100M+ source triangles, no hand-made LODs, 1080p at 60 fps; frame time at or below UE5 |
| Lighting | Dynamic global illumination; perceptual error against a path-traced reference at or below UE5 |
| Characters | Skeletal animation, blending and IK; 100 characters at 60 fps |
| Physics | 10,000 rigid bodies stable; replay from input gives the same hash |
| World | 16 km² streamed with a stated frame-time ceiling during loading |
| Network | A 64-player session demo |
| Tools | glTF and USD import, a viewer and inspector for people, a profiler |
| Platforms | Windows, macOS, Linux executables and the web |
| Shipped | Games made with Kiln by people outside the project |
| **Agent cost** | The same game spec built with UE5 + agent and with Kiln + agent: tokens, time, and whether it was finished |
