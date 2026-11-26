# Editions

A plan, decided 2026-11-26. Nothing on this page is built yet except where it says so.

Kiln will come in three editions, **Lite**, **Core** and **Pro**, so that a small game does not carry what a large one needs. They are not three engines. There is one repository, one scene format and one set of agent tools; an edition is a name for how much of the engine a game uses.

## Words

"Core" already meant two things in this project, so the names are fixed here.

| Word | Meaning |
|---|---|
| **kernel** | What every edition shares: `src/` (fixed-point simulation, scenes, `check`, `solve`, `guide`, MCP) and the player. No dependencies. Older notes call this "the core". |
| **Lite**, **Core**, **Pro** | Editions. Core is the middle edition, not the shared base. |
| **backend** | An optional part with its own pinned dependencies, loaded only when a scene asks for it (`backends/rapier`). |

## What the editions are for

| | Lite | Core | Pro |
|---|---|---|---|
| For | 2D games and simple 3D; small download, old hardware | Most games | Large worlds, high-end graphics, heavy simulation |
| Bar | Godot 2D | Godot 3D | Unreal |
| Drawing | Canvas 2D; boxes and OBJ meshes with one shadowed sun, on WebGL2 and WebGPU | WebGPU: glTF, PBR, many lights, skeletal animation | WebGPU or beyond: GPU-driven geometry, dynamic global illumination, upscaling |
| Physics | The fixed-point box core | A rigid-body backend (Rapier): shapes, joints | Thousands of bodies, destruction |
| World | Levels | Navigation, networking | Streaming |
| Hardware | Integrated GPU, no WebGPU needed | A GPU with WebGPU | A discrete GPU |
| Dependencies | None | Pinned backends | Pinned backends |

What is the same in all three: the scene text, the simulation rules, determinism, `check`, `solve`, `look`, `guide`, MCP, and the rule that a feature counts only when a check guards it. **An edition never changes how much the agent can do, only how much the game can show and simulate.**

## Rules

These exist so that three editions do not become three incompatible engines, which is what happened to Unity's render pipelines.

1. **Each edition contains the one below it.** A Lite game is a Core game and a Pro game. Moving up changes nothing in the game's files.
2. **The same input gives the same state hash in every edition.** A Lite game run with Core or Pro parts present ends on the hash it has today.
3. **The edition is worked out, not declared.** `check` reports the lowest edition a game needs and the lines that make it so ("needs Core: `physics=rapier`, level2.kiln line 1"). A ceiling can be given (`--edition lite`); a feature above the ceiling is then an error with a code. Nothing has to be kept in sync by hand.
4. **A game ships only what it uses.** `build` already copies the Rapier backend only for scenes that name it. The same rule extends to renderer features and loaders.
5. **Each edition has a size budget checked in CI**, in bytes, like the guide's character budget. The numbers are set from the first measurement, not guessed.
6. **Lite features draw on both renderers. Core and Pro features need WebGPU.** This gives the frozen WebGL2 renderer a fixed job: it is Lite's renderer for machines without WebGPU.
7. **All three editions are open under one license.** "Pro" is a size, not a price.

## Where the line falls today

Measured on the working tree of 2026-11-26:

| Part | Size |
|---|---|
| `src/` (kernel and tools) | 146 KB of source |
| `web/` (player, both renderers, glTF reader) | 75 KB of source |
| Rapier deterministic build, the file a game ships | 4,372 KB |

So today the choice of edition is, in bytes, the choice of whether Rapier is present: it is twenty times the rest. `build` already leaves it out of games that do not use it. The player still loads the WebGPU renderer and the glTF reader for a 2D game (about 40 KB of source); rule 4 would remove that.

Existing features by edition:

- **Lite**: everything gated in the 2D table, boxes and OBJ meshes with one sun, rotation as drawn in 2D, the fixed-point box core, web export.
- **Core**: `physics=rapier` and everything under `rigid`, glTF, PBR materials, 3D rotation by quaternion.
- **Pro**: nothing yet.

## What each weakness of the other engines asks of Kiln

The editions were chosen with these in mind. The last column is the present state, not the hope.

| Weakness | Kiln's answer | State |
|---|---|---|
| Unreal: hard to learn, many modules | One text format; a guide with a size budget; errors all at once with hints | Gated. The budget will be under pressure as Core and Pro grow; topic guides are the outlet |
| Unreal: heavy editor and renderer | Editions; no editor needed to run or test | Lite is light today; budgets are not yet checked |
| Unreal: slow compile, shader compile, cook | No build step; assets are read as they are | True today. **Pro geometry will need offline processing of meshes.** It must be incremental and keyed by content |
| Unreal: Blueprint overhead | One script language, no second visual layer | True today. Script speed in JavaScript has not been measured |
| Unreal: Nanite and Lumen are costly | Only Pro pays for them | Not built |
| Unreal, Unity, Godot: not built for agents | The kernel | Gated, but **no real agent has yet built a game with it** |
| Unity: garbage collection pauses | **Kiln runs on JavaScript and has the same problem.** Answer: no allocation per tick in the simulation path, checked by a budget | Not measured, not checked |
| Unity: GameObject and ECS side by side | One entity model. A second is never added | True today |
| Unity: recompile and domain reload | State is text; reloading is parsing | True today |
| Unity: three render pipelines | Rules 1, 2 and 6 | WebGL2 already cannot draw two of the 3D examples; rule 6 makes that a stated boundary instead of a gap |
| Unity: package versions | Kernel has no dependencies; backends are pinned with a lockfile | True today |
| Unity: licence trust | Rule 7; the licence question is settled before outside contributions | **Open: the owner has not decided** |
| Godot: high-end 3D gap | Pro | Not built |
| Godot: consoles | Needs platform contracts; also needs a runtime that is not a browser | Not started |
| Godot: C# limits per platform | One script language everywhere | True today |
| Godot: cinematic and large-production tools | A timeline, in Pro | Not built |
| Godot: large-scene optimisation | Profiler; Pro gates measured by `bench/PROTOCOL.md` | Not built |
| Godot: small ecosystem | Code cannot fix this. Games made by people outside the project are the measure | None |

## Where the plan is in tension with itself

Stated so they are decided on purpose rather than discovered.

- **Determinism against parallelism.** Every edition promises a deterministic simulation; Core and Pro promise parallel work. The Rapier build Kiln uses runs on one thread, and its documentation is remembered as saying the deterministic mode excludes threads and SIMD (to be confirmed before relying on it). Parallel simulation is accepted only with a check that it reaches the same hash as the serial run. Parallel work that does not touch state (drawing, loading, search) is free of this.
- **`solve` at Pro scale.** Search works by copying and restoring the world. It has been tried with about five bodies. It will not search a scene of ten thousand bodies; what "the same agent tools" means there is replay, `expect`, `look` and solving a reduced scene.
- **The browser against Pro.** WebGPU in a browser has no mesh shaders or hardware ray tracing, limits memory, and threads need page headers some hosts cannot send. The Pro targets may need a native runtime that runs the same scenes. This is decided by a measured spike when Core's gate is near, not now. The target is not lowered.
- **Lite first, but Core work already exists.** The plan says Lite, then Core, then Pro. Rapier, glTF and PBR are already built and gated. They stay. "Lite first" means the Lite gate is the next one to close, not that Core work is undone.
- **Rigid bodies in 2D.** Godot 2D has them. Any solver is megabytes. Proposed: rigid bodies of any dimension are Core, and Lite's gate uses demos that do not need them. Not yet agreed.

## Order of work

1. **Draw the line in code.** Each component and scene feature names its edition; `check` reports the lowest edition and why; `--edition` ceiling; size budgets in CI; every example replayed under each edition to one hash.
2. **Prove the kernel with a real agent.** Connect an agent over MCP, build a small Lite game to the end, measure tokens and how many failures it repaired without a person. Every edition rests on this and it has never been run.
3. **Close the Lite gate**: sprite animation, per-tile art, audio, UI, gamepad, state between levels; allocation budget; three Godot 2D demos rebuilt and solved.
4. **Close the Core gate**: glTF from other tools, animation and skins, lights, shapes and joints, navigation, networking, a desktop executable.
5. **Pro**, starting with the runtime spike and the study of other engines' architecture.

The study of Godot, Unity and Unreal feeds steps 3 to 5 as each is reached. Godot's code is MIT. Unity's and Unreal's sources are under licences that do not allow copying into a public project; only structure, behaviour and numbers are taken from them, and each licence is read before starting.
