# Notes from reading Godot's source

Read 2026-11-28 from the tag `4.7.2-stable` of `godotengine/godot` (MIT), the version the
comparison in [`proof/compare`](../proof/compare) ran against. Paths below are in that
tree. The areas are in the order of Kiln's weak points as
[`PLAN-NEXT.ko.md`](../PLAN-NEXT.ko.md) lists them.

**What "bring" means here.** A design, an algorithm, a default value or the shape of an
API, written again in Kiln's TypeScript. No code was copied: nothing in Kiln is a
translation of a Godot function, so [`THIRD-PARTY.md`](../THIRD-PARTY.md) has no entry for
Godot beyond the acknowledgement. Nothing was read for reuse under Godot's `thirdparty/`
(Jolt included), whose licences are their own. What Kiln keeps whatever Godot does: scenes
as text, one deterministic fixed-point simulation, checking without a screen, errors a
machine can read, no dependency in the core.

**What this is not.** Nothing here was measured. Godot was not built or run for these
notes; they say how its code is arranged, not how fast it is.

## Summary

| # | From Godot | Kiln before | Status |
|---|---|---|---|
| 1 | Static bodies keep their rotation (`StaticBody3D` is a body like any other) | a fixed collider ignored `quat` and `rot`: a ramp had to be a welded rigid body or a script | **brought**: a `solid` with `quat` or `rot` is a turned fixed collider for rigid bodies |
| 2 | Linear and angular damping on every body, default 0.1 each (`physics/3d/default_linear_damp`) | none; "slows down by itself" needed a script | **brought** as `rigid ... damp= spin=`; Kiln's default stays 0 so no hash changes |
| 3 | `apply_impulse(impulse, position)`: an impulse off the centre turns the body | impulses and forces through the centre only | **brought** as the `ox oy oz` fields of `impulse` and `force` |
| 4 | Input is an action map; `ui_accept` is Enter and Space by default | six fixed actions; Enter was not one | **brought**: action `enter` (Enter, pad Start) |
| 4b | Nothing in Godot: its agents wrote `apply_central_force` in a script | a ball pushed by the keys needed a script (4% of script bytes in H3) | **added** beside the above: `drive POWER` on a rigid |
| 5 | `Timer` node: `wait_time`, `one_shot`, `autostart`, a `timeout` signal | no timer; a script counted ticks | **brought** as component `timer` |
| 6 | Signals wired in the scene file (`[connection signal= from= to= method=]`) | only `trigger` and `button` could act | **brought**, narrowly, as component `when EVENT ACTION` |
| 7 | `CanvasLayer`: 2D interface drawn over a 3D view | `pin`, `label`, `button` were 2D only | **brought**: they draw over the 3D view too |
| 8 | `SceneTree.reload_current_scene()` | starting a level again needed a script or a `load:` of itself | **brought** as action `reset:REF` and `reset:all` |
| 9 | Jolt's continuous collision is a per-body flag (`RigidBody3D.continuous_cd`) | soft CCD for all, no flag | **brought** as `rigid ... ccd=1` |
| 10 | `CharacterBody3D.move_and_slide`: slide along what is hit, floor by angle, snap, step | movers stop per axis; no slopes or steps | **not brought** (reasons below) |
| 11 | `--headless --fixed-fps --quit-after`, `--write-movie` | already headless and tick-exact | nothing to bring; one idea noted |
| 12 | Scene tree with parent transforms; packed scenes with inheritance | flat entities, `prefab` | **not brought** |
| 13 | `TileSet` terrains, atlas, per-tile physics polygons | characters in a grid | **not brought** |
| 14 | `AnimationTree` blending and state machines | clip playback | **not brought now** |
| 15 | Two renderers by capability: Compatibility (GLES3) and Forward+ / Mobile (RenderingDevice) | the same split already: WebGL2 frozen, WebGPU main | confirms the choice; clustered lights noted |
| 16 | glTF import through a document, a state and extension objects | one reader, static plus clips and skins | one idea noted |

## 1. Physics in 3D and moving a character

**Godot.** `servers/physics_3d/physics_server_3d.h` is an abstract server: bodies, shapes,
areas and joints are opaque ids (`RID`), and the scene's nodes are a thin layer over it.
Two servers implement it: Godot's own (`modules/godot_physics_3d/`: `godot_space_3d.cpp`,
`godot_body_3d.cpp`, a BVH broad phase, SAT and GJK/EPA narrow phase, a sequential-impulse
solver in `godot_step_3d.cpp`) and Jolt (`modules/jolt_physics/`, with
`jolt_physics_server_3d.cpp` mapping the same server calls onto Jolt objects,
`spaces/jolt_space_3d.cpp` stepping, `objects/jolt_body_3d.cpp` keeping Godot's body
state). The project picks one by a setting; scenes do not change.

Defaults worth knowing (all from the source): 60 physics ticks a second and at most 8
steps a frame (`main/main.cpp`), gravity 9.8, linear and angular damping 0.1, sleep under
0.1 m/s (`physics_server_3d.cpp`); a `RigidBody3D` has mass 1, friction 1 and bounce 0
(`scene/3d/physics/rigid_body_3d.h`, `scene/resources/physics_material.h`); for Jolt
(`jolt_project_settings.cpp`) 10 velocity and 2 position steps, penetration slop 0.02,
bounce only above 1 m/s, sleep under 0.03 m/s for 0.5 s, CCD when a body moves more than
0.75 of its size in a step, at most 10,240 bodies by default.

A character is a kinematic body moved by the game: `CharacterBody3D::move_and_slide`
(`scene/3d/physics/character_body_3d.cpp`). It first moves by the velocity of the platform
it stands on, then up to `max_slides` (6) times casts the body along what is left of the
motion (`body_test_motion` in the server, with a `safe_margin` of 0.001 and a recovery
pass that pushes it out of what it overlaps), and slides the rest along the surface hit.
A surface is a floor when its normal is within `floor_max_angle` (45°) of up, otherwise a
wall or a ceiling. `floor_stop_on_slope` keeps a standing body from creeping down,
`floor_snap_length` (0.1) pulls it back onto a floor it would leave going downhill,
`floor_block_on_wall` stops it climbing walls, and on leaving a moving platform the
platform's velocity is added.

**Kiln.** One interface (`src/physics.ts`) with one backend behind it (`backends/rapier`),
the same idea as the server with its two implementations, already arrived at separately.
Bodies are dynamic (`rigid`), kinematic (anything the fixed-point core moves) or fixed
(`solid`). A character is moved by the fixed-point core one axis at a time and asks the
backend how far it may go before a rigid body (`src/rigid.ts`, `sweep`).

**Bring.**
- *Fixed bodies keep their turn.* In Godot nothing is special about a static body's
  transform. In Kiln `describe` zeroed the rotation of everything not dynamic, so a ramp
  could not be a `solid`; the three H3 runs spent 5% of their script bytes fixing ramps in
  place ([`PRETEST-RESULT.ko.md`](../PRETEST-RESULT.ko.md)). Now `solid` + `quat` (or
  `rot`) turns the fixed collider. The fixed-point core still sees the unturned box, and
  `check` says so when a scene has both a turned solid and a mover (`K334`).
- *Damping.* Godot's bodies lose 10% of their speed a second unless told otherwise.
  `rigid` gets `damp` and `spin`; the default stays 0 because changing it would change
  every physics hash. The guide names 0.1 as the usual value.
- *Impulse at a point*, as `apply_impulse(impulse, position)`.
- *CCD as a flag on the body.*

**Do not bring.**
- *`move_and_slide` as it is.* It is float geometry against arbitrary shapes, iterated
  with a recovery pass; Kiln's movers are fixed-point boxes whose positions enter the hash
  and `solve`'s state keys. A second, float character would make two movers with two sets
  of rules, which is what the Rapier character controller was turned down for
  ([`HANDOFF.md`](../HANDOFF.md), physics design). What Kiln lacks from it (slopes, steps,
  snapping) should be written in fixed-point against boxes and tiles; that is not done
  here and stays on the list.
- *A second physics server.* Jolt behind the interface would be the Godot arrangement, but
  what a backend must be for Kiln is deterministic across machines, and only the Rapier
  build has been shown to be ([`spikes/RESULTS.md`](../spikes/RESULTS.md)).
- *Godot's defaults of friction 1 and mass 1.* Kiln's bodies take mass from density and
  size, which a scene written as text states once; changing defaults breaks hashes.

## 2. Scenes, nodes and signals

**Godot.** A scene is a tree of `Node`s (`scene/main/node.cpp`) saved as text
(`scene/resources/resource_format_text.cpp`): `[node name= type= parent=]` sections with
properties, `[ext_resource]` and `[sub_resource]` for what they point at, and
`[connection signal= from= to= method=]` lines that wire a signal to a method. A node's
transform is relative to its parent. Signals are declared on classes and emitted by name
(`core/object/object.cpp`), with flags such as one-shot and deferred. A scene can be
instanced inside another and inherited from (`scene/resources/packed_scene.cpp`).
`SceneTree` (`scene/main/scene_tree.cpp`) runs the frame, changes and reloads scenes,
pauses, and owns timers. `Timer` (`scene/main/timer.cpp`) counts `wait_time` down and
emits `timeout`.

**Kiln.** Entities are flat and named; components are lines; `prefab` is a component list
that tiles stamp out. Events are plain names in one list per run. A `trigger` or a
`button` emits one and may act (`despawn`, `load:`). Anything else was a script.

**Bring.**
- *A connection as a line of the scene.* Not signals in general: one component,
  `when EVENT ACTION`, which does an action when an event is emitted, whoever emitted it.
  With it a rule like "falling costs a life and starts the level again" is three lines
  that `check` can read, in place of a script it cannot.
- *`Timer`* as `timer SECONDS EVENT`: state in a component, so it is saved, hashed and
  seen by `solve`.
- *Reloading the scene* as an action, `reset:REF` and `reset:all`: entities go back to
  what the scene held when it began, the ones despawned since included.
- The pre-test of a general rule layer failed its own threshold
  ([`PRETEST-RESULT.ko.md`](../PRETEST-RESULT.ko.md): the five commonest kinds of rule
  cover 47% of script bytes, and the two specs share almost no kind), so no general
  layer is built: only these parts, which are the kinds both specs had.

**Do not bring.**
- *The tree and parent transforms.* It is the largest thing Kiln lacks from Godot and the
  first thing a person with an editor wants. It is also what makes a Godot scene file hard
  for a model to write correctly by hand (node paths, resource ids). Flat named entities
  are the reason a Kiln scene can be checked line by line. Left out on purpose; a joint or
  a `ride` covers the common cases of "this moves with that".
- *Signals on every object, deferred calls, groups with method calls.* They need a general
  object model. Events by name already do what the scenes need.

## 3. Resources and import (glTF)

**Godot.** Importing is a step of the editor: a source file gets a `.import` file beside
it with its settings, and the result is cached in `.godot/imported/`
(`editor/import/`). glTF goes through `GLTFDocument` (`modules/gltf/gltf_document.cpp`),
which parses into a `GLTFState` of plain structures (`modules/gltf/structures/`: nodes,
meshes, skins, animations, cameras, lights) and then builds a scene from it; the same
classes write glTF. Extensions are objects that hook each stage
(`modules/gltf/extensions/`, e.g. lights, physics shapes, WebP and KTX textures,
`KHR_materials_emissive_strength`, `KHR_materials_unlit`). `skin_tool.cpp` repairs skins
whose joints are not one tree.

**Kiln.** `web/gltf.ts` reads `.glb` and `.gltf` at load, bakes node transforms, and
returns parts by material; clips and skins since `78e4535`; what it does not read it
lists as warnings (`K315`). There is no import step and no cache.

**Bring.** Nothing now. One idea is noted for when it pays: Godot's split of *parse into
plain structures* from *build*, which would let `check` report on a model without a
browser's types in the way; Kiln's reader already runs in Node, so the gain is small.

**Do not bring.** The import cache and `.import` files: they are state beside the scene
that a text diff does not show, and a build step is what Kiln does without.

## 4. Renderers

**Godot.** Two families. *Compatibility* (`drivers/gles3/`: `rasterizer_scene_gles3.cpp`,
`rasterizer_canvas_gles3.cpp`) is OpenGL ES 3 / WebGL2, forward, one pass per light type
with limits, for old and web targets. *Forward+* and *Mobile*
(`servers/rendering/renderer_rd/forward_clustered/`, `forward_mobile/`) run on
`RenderingDevice`, an abstraction over Vulkan, D3D12 and Metal; Forward+ bins lights,
decals and probes into clusters (`cluster_builder_rd.cpp`) so a pixel shades only the
lights that reach it. The scene asks one `RenderingServer` whatever is underneath.

**Kiln.** The same cut, made for the same reason: WebGL2 (`web/gl.ts`) is frozen as the
renderer that runs anywhere, WebGPU (`web/gpu.ts`) is where features go; both sit behind
`Renderer3` in `web/mesh.ts`.

**Bring.** Nothing now; the reading confirms the edition line (Lite draws on both,
Standard on WebGPU). Clustered light binning is the known way past Kiln's "32 nearest
lights", and is noted on the scoreboard's lighting row for when lights are worked on.

**Do not bring.** A third renderer, and the shader-language layer that feeds Godot's
three.

## 5. 2D tiles and animation

**Godot.** `TileSet` (`scene/resources/2d/tile_set.cpp`, 7,200 lines) holds atlases,
per-tile collision polygons, navigation and custom data, and terrains that pick a tile
from its neighbours; `TileMapLayer` (`scene/2d/tile_map_layer.cpp`) stores cells and
batches them in quadrants. Animation is `AnimationMixer` playing tracks over any property
(`scene/animation/animation_mixer.cpp`), with `AnimationTree` blending and state machines
on top, `Tween` for code-driven easing, and `AnimatedSprite2D` for frames.

**Kiln.** `tiles` is rows of characters with `solid=`, `spawn=`, `paint=`; `anim` picks a
frame from the tick; `clip` plays a glTF animation.

**Bring.** Nothing in this round. A level drawn as characters is the form a model writes
most reliably, and it is where Kiln was cheaper ([`SPREAD.md`](../proof/compare/SPREAD.md)).

**Do not bring.** Terrains and atlases (an editor's tools). Property tracks: they animate
state, and state in Kiln changes only in the tick.

## 6. The input map

**Godot.** `core/input/input_map.cpp`: named actions, each a list of events (keys, pad
buttons, axes) and a deadzone (0.2 by default). Built-in `ui_*` actions exist in every
project: `ui_accept` is Enter, keypad Enter and Space. Games ask
`Input.is_action_pressed`, `is_action_just_pressed`, `get_axis`, `get_vector`
(`core/input/input.cpp`).

**Kiln.** Six actions, `left right up down a b`, bound in the player; an input script
names them by tick. Every menu in the held-out specs said "press Enter", and Enter was
not bound: the three H3 runs each wrote a script to pass it on (4.6% of script bytes).

**Bring.** The action `enter` (Enter and the pad's Start), usable as `button ... key=enter`
and in input scripts. Not a remappable map: six plus one fixed names are what keeps an
input script readable, and nothing measured asks for more.

## 7. Headless running and tests

**Godot.** `main/main.cpp`: `--headless` (no window, dummy audio), `--fixed-fps N` with
`--quit-after N` for a run of exact length, `--script` to run one script,
`--check-only`, `--write-movie` to render frames to a file at a fixed rate,
`--import`. The engine's own tests are doctest cases compiled into the binary and run
with `--test` (`tests/`, about 77 files under `tests/scene`), with a mock display server.
There is no built-in harness for testing a *game*; projects use add-ons.

**Kiln.** Headless is the ordinary way to run; `expect` lines are the game's tests;
`solve` finds the input. This is where Kiln is ahead in kind, and the comparison's Godot
agents wrote their own search programs to make up for it.

**Bring.** Nothing. `--write-movie` is the model for the frames the automatic screen
judge needs from a Godot game ([`scripts/autojudge.ts`](../scripts/autojudge.ts) asks
Godot for them that way).

## What was not read

The editor, GDScript's compiler, networking (`scene/main/multiplayer_api.cpp`), audio
servers, navigation servers and the 2D physics server. They come up when their rows do.
