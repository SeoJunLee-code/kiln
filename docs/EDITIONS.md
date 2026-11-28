# Editions

A plan, decided 2026-11-26. Read each row's state before assuming a thing exists: most of this page is not built.

Kiln will come in three editions, **Lite**, **Standard** and **Ultra**, so that a small game does not carry what a large one needs. They are not three engines. There is one repository, one scene format and one set of agent tools; an edition is a name for how much of the engine a game uses.

## Words

| Word | Meaning |
|---|---|
| **core** | What every edition shares: `src/` (fixed-point simulation, scenes, `check`, `solve`, `guide`, MCP) and the player. No dependencies. |
| **Lite**, **Standard**, **Ultra** | Editions. In code: `'lite' \| 'standard' \| 'ultra'`. |
| **backend** | An optional part with its own pinned dependencies, loaded only when a scene asks for it (`backends/rapier`). |

The first draft of this page called the editions Lite, Core and Pro and the shared part "the kernel". "Core" then meant two things and "Pro" read as a price, so the names changed the same day.

## An edition is defined by the machine

Not by a rival engine. Games do not sit on one ladder: a 2D game can have five thousand bodies, a beautiful one can have no physics. So an edition is the answer to one question that can be measured: **what must this game run on, and how big may it be?**

| | Lite | Standard | Ultra |
|---|---|---|---|
| Must run on | A machine without WebGPU: an old laptop, a phone browser | An integrated GPU with WebGPU, at 60 fps | A discrete GPU |
| Dependencies | None | Pinned backends | Pinned backends |
| For | 2D games and simple 3D | Most games | Large worlds, high-end graphics, heavy simulation |

Other engines are the bar **row by row** in [`PARITY.md`](PARITY.md): each feature is held against whichever engine does it best. Godot for 2D and for being light; Unity for phones, low-end hardware, entity counts and platform reach; Unreal for geometry, lighting and world size.

## Axes

Inside the engine a game is measured on four axes, and its edition is the highest of them.

| Axis | Lite | Standard | Ultra |
|---|---|---|---|
| Drawing | Canvas 2D; boxes and OBJ meshes with one shadowed sun, on WebGL2 and WebGPU | WebGPU: glTF, PBR, many lights, skeletal animation | GPU-driven geometry, dynamic global illumination, upscaling |
| Physics | The fixed-point box core | A rigid-body backend (Rapier): shapes, joints | Tens of thousands of bodies, destruction |
| World | Levels; thousands of entities | Navigation; a hundred thousand entities | Streaming |
| Network | None | Sessions built on replay and rollback | 64 players |

`check` reports each axis and the lines that set it (`physics standard: physics=rapier (line 1)`, one line per axis above Lite). The axes are why the three names are presets and not walls: a game that is Lite in drawing and Standard in physics ships the Lite renderer and the physics backend, nothing else.

**Built (2026-11-26):** `check` does this for one scene or a folder, and `--edition` is the ceiling (error K140). A component names its axis and edition where it is defined (`defineComponent` in `src/world.ts`); features of a value or of a combination are listed in `src/edition.ts`. What sets an axis today: `physics=rapier`, `rigid`, `impulse`, `force` (physics); a glTF mesh, `quat`, and `rot` in a scene drawn in 3D (drawing, because the WebGL2 renderer does not turn boxes). Nothing sets the world or network axis yet. `build` ships parts by what the game folder holds (the renderers if anything has `eye`, the glTF reader if there is a model file, samples and music if anything has `sound`, a backend if a scene names it), and the engine bytes of a built game are held to a budget in `tests/edition.test.ts`.

What is the same in all three: the scene text, the simulation rules, determinism, `check`, `solve`, `look`, `guide`, MCP, and the rule that a feature counts only when a check guards it. **An edition never changes how much the agent can do, only how much the game can show and simulate.**

## Rules

These exist so that three editions do not become three incompatible engines, which is what happened to Unity's render pipelines.

1. **Each edition contains the one below it.** A Lite game is a Standard game and an Ultra game. Moving up changes nothing in the game's files.
2. **The same input gives the same state hash in every edition.**
3. **The edition is worked out, not declared.** `check` reports it per axis. A ceiling can be given (`--edition lite`); a feature above it is then an error with a code.
4. **A game ships only what it uses.** `build` already copies the Rapier backend only for scenes that name it. The same rule extends to renderer features and loaders.
5. **Each edition has budgets** (below).
6. **Lite features draw on both renderers. Standard and Ultra features need WebGPU.** The frozen WebGL2 renderer is Lite's renderer for machines without WebGPU.
7. **All three editions are open under one license.** The names are sizes, not prices.

## What closes an edition's gate

Four things, the same four for each edition. A feature list alone does not close a gate.

1. **Rows.** The scoreboard rows of that edition are gated.
2. **Budgets.** Numbers are set from the first measurement, then only tightened on purpose.

   | Budget | Checked where |
   |---|---|
   | Exported bytes of the engine for a game of that edition | CI (bytes do not jitter) |
   | Memory after loading the proof game | Reference machine |
   | Time from opening the page to the first frame | Reference machine |
   | Allocation per tick in the simulation path. Lite: no more than what is measured today. Standard and Ultra: none | CI (`tests/alloc.test.ts`, a ceiling); reference machine for the figures |

   The allocation budget changed on 2026-11-27. What it protects is frame time without pauses for garbage collection. Lite's proof game allocated 5 to 11 KB per tick when this was decided and its frame time showed no such pause ([`FPS.md`](../proof/lite/FPS.md)), so Lite only keeps that number from growing. It has to reach none where it can hurt: Standard's hundred thousand entities. For Lite the budget that is still unmeasured and matters is the time to the first frame on its reference phone.

3. **A proof game.** One game per edition, built by an agent from a written spec, running at 60 fps on that edition's reference machine, by [`bench/PROTOCOL.md`](../bench/PROTOCOL.md). The spec, the game and the measurement are in the repository.

   | Edition | Reference machine | Proof game |
   |---|---|---|
   | Lite | The reference PC with WebGPU turned off; one real phone | Gem Vault, a top-down game of three levels: [`proof/lite`](../proof/lite). Built once by an agent. On the PC: far above 60 fps, with the GPU and without ([`FPS.md`](../proof/lite/FPS.md)). On a phone: not measured |
   | Standard | The reference PC (integrated GPU) | To be chosen: a third-person 3D game with physics |
   | Ultra | A machine with a discrete GPU. **None is available yet** | To be chosen |

4. **Agent cost.** For the proof game: tokens used, time taken, failures the agent repaired without a person, and whether it finished. The same spec is then built with an agent on the engine that is the bar. This is the number Kiln exists for, and it is reported before any graphics number.

### Winning, not only matching

Planned 2026-11-27. **State on 2026-11-28:** the spread is measured ([`proof/compare/SPREAD.md`](../proof/compare/SPREAD.md)), two of the three held-out specs have been run ([H2](../proof/compare/RESULT-H2.md), [H3](../proof/compare/RESULT-H3.md)), the third has not, and no screen check has been judged, so there is no verdict. The four things above show that an edition is as good as its bar. A gate also asks that building with Kiln costs an agent less. The one comparison made so far ([`proof/lite/COMPARE.md`](../proof/lite/COMPARE.md)) does not show that: before its fixes Kiln cost the same $0.73 as Godot, and the cheaper second run was on a spec the engine had just been fixed for. So:

- **Runs are isolated.** An empty settings folder, a pinned engine commit, the same model, tools and starting folder for every run. Time is recorded in two parts: waiting for the model, and inside tools.
- **A spec carries its own pass checks**, written before any run and independent of the engine: given this input, the screen shows that. The same checks judge every game built from the spec.
- **A spec the engine was changed for does not count.** It is a development spec; Gem Vault is one. A counted spec is held out: it is run for the first time on a pinned commit, and a rerun after a fix is not counted.
- **Held-out specs of the first comparison:** a room puzzle with flipped gravity, taken from a public list of game challenges; a task that changes and repairs an existing game; a small 3D game with physics, because the claim has to hold above Lite as well.
- **Three setups:** Kiln with file tools and its MCP server; the other engine with file tools and its own command; the other engine with the best agent tooling there is for it. Kiln has to beat the better of the other two.
- **Fixed for every run** (settled by the owner, 2026-11-27): one model and one version of the agent program, an empty `game/` folder, the same spec text, sound files and prompt except for the engine's name. A price ceiling and a clock ceiling per run; reaching either is a game that did not pass. A failure of the infrastructure is recorded and the run repeated; a failure caused by the engine counts. Runs go one after another, engines taking turns.
- **Passing** means every pass check holds on the game exactly as the agent left it. A person judges on the screen with the keyboard, in each engine's ordinary way of running a game, and records it.
- **The spread comes first.** The development spec is run on each engine. Three runs per setup for a held-out spec; five if the spread showed the dearest run at more than twice the cheapest.
- **Who wins a spec:** the side that passes at least two more times. Otherwise the side whose passing runs are all cheaper than every passing run of the other (API price, cached reads priced as cached). If the prices overlap, the same rule on time waiting for the model. If that overlaps too, no difference.
- **Who wins the comparison:** two specs of three won and none lost.
- **Frame rate and size decide nothing for Lite.** They are recorded, but a 2D game of this size is not expected to separate the engines (Godot's frame rate and exported size have not been measured). From Standard on they are winning conditions: same scene and settings by [`bench/PROTOCOL.md`](../bench/PROTOCOL.md), and compressed size and time to first frame.

## Where the line falls today

Measured on the working tree of 2026-11-26:

| Part | Size |
|---|---|
| `src/` (core and tools) | 146 KB of source |
| `web/` (player, both renderers, glTF reader) | 75 KB of source |
| Rapier deterministic build, the file a game ships | 4,372 KB |

So today the choice of edition is, in bytes, the choice of whether Rapier is present: it is twenty times the rest. `build` leaves it out of games that do not use it, and since 2026-11-26 also the renderers and the glTF reader.

Engine bytes in a built game, as shipped. Since 2026-11-27 `build` squeezes engine files (`src/squeeze.ts`: comments, indentation, blank lines and the spaces stripped types leave are removed; names are not shortened, nothing is compressed). The budgets were tightened in the same change; the 2D one keeps about 11,000 bytes for the Lite rows still to come.

| Game | Engine bytes | Budget | Before squeezing (first measured → last) |
|---|---|---|---|
| 2D, Lite | 61,108 (63,997 with sprite animation and state between levels) | 72,000 | 90,703 → 93,775, budget 94,000 |
| 3D with boxes and OBJ meshes, Lite (both renderers) | 90,484 | 102,000 | 128,480, budget 133,000 |
| Everything: glTF and Rapier, Standard | 4,491,655 | 4,630,000 | 4,537,594, budget 4,680,000 |

Since then the 2D Lite game has grown to 67,497 bytes with gamepad, audio and UI (budgets unchanged).

Existing features by edition:

- **Lite**: everything gated in the 2D table, boxes and OBJ meshes with one sun, rotation as drawn in 2D, the fixed-point box core, web export.
- **Standard**: `physics=rapier` and everything under `rigid`, glTF, PBR materials, 3D rotation by quaternion.
- **Ultra**: nothing yet.

## What each weakness of the other engines asks of Kiln

The last column is the present state, not the hope.

| Weakness | Kiln's answer | State |
|---|---|---|
| Unreal: hard to learn, many modules | One text format; a guide with a size budget; errors all at once with hints | Gated. The budget will be under pressure as editions grow; topic guides are the outlet |
| Unreal: heavy editor and renderer | Editions; no editor needed to run or test | Lite is light today; the byte budget is checked; memory and start-up time are measured on the PC ([`START.md`](../proof/lite/START.md)), not gated |
| Unreal: slow compile, shader compile, cook | No build step; assets are read as they are | True today. **Ultra geometry will need offline processing of meshes.** It must be incremental and keyed by content |
| Unreal: Blueprint overhead | One script language, no second visual layer | True today. Script speed in JavaScript has not been measured |
| Unreal: Nanite and Lumen are costly | Only Ultra pays for them | Not built |
| Unreal, Unity, Godot: not built for agents | The core | Gated. Agents have built games with it; not yet shown to be cheaper than another engine, and on the 3D spec (H3) it cost more |
| Unity: garbage collection pauses | **Kiln runs on JavaScript and has the same problem.** Answer: the allocation budget above | 1.3 to 2.4 KB a tick in four Lite examples (it was 5 to 11 KB); a test holds a ceiling |
| Unity: GameObject and ECS side by side | One entity model. A second is never added | True today |
| Unity: recompile and domain reload | State is text; reloading is parsing | True today |
| Unity: three render pipelines | Rules 1, 2 and 6 | WebGL2 already cannot draw two of the 3D examples; rule 6 makes that a stated boundary instead of a gap |
| Unity: package versions | Core has no dependencies; backends are pinned with a lockfile | True today |
| Unity: licence trust | Rule 7; the licence question is settled before outside contributions | **Open: the owner has not decided** |
| Godot: high-end 3D gap | Ultra | Not built |
| Godot: consoles | Needs platform contracts; also needs a runtime that is not a browser | Not started |
| Godot: C# limits per platform | One script language everywhere | True today |
| Godot: cinematic and large-production tools | A timeline, in Ultra | Not built |
| Godot: large-scene optimisation | Profiler; Ultra gates measured by `bench/PROTOCOL.md` | Not built |
| Godot: small ecosystem | Code cannot fix this. Games made by people outside the project are the measure | None |

## Where the plan is in tension with itself

- **Determinism against parallelism.** Every edition promises a deterministic simulation; Standard and Ultra promise parallel work. The Rapier build Kiln uses runs on one thread, and its documentation is remembered as saying the deterministic mode excludes threads and SIMD (to be confirmed before relying on it). Parallel simulation is accepted only with a check that it reaches the same hash as the serial run. Parallel work that does not touch state (drawing, loading, search) is free of this.
- **`solve` at Ultra scale.** Search works by copying and restoring the world. It will not search a scene of ten thousand bodies; what "the same agent tools" means there is replay, `expect`, `look` and solving a reduced scene.
- **The browser against Ultra.** WebGPU in a browser has no mesh shaders or hardware ray tracing, limits memory, and threads need page headers some hosts cannot send. The Ultra targets may need a native runtime that runs the same scenes. This is decided by a measured spike. Since 2026-11-27 the spike comes right after the first comparison instead of near Standard's gate, and it asks the costlier question first: the simulation core is TypeScript, so where does it run in a native runtime (a JavaScript engine carried inside it, or a second implementation that must reach the same hashes)? That part needs no new machine. What a browser cannot draw is measured once a machine with a discrete GPU exists. The target is not lowered.
- **Lite first, but Standard work already exists.** Rapier, glTF and PBR are built and gated. They stay. "Lite first" means the Lite gate is the next one to close.
- **Rigid bodies in 2D.** Godot 2D has them. Any solver is megabytes. With axes this is no longer a wall: a 2D game with rigid bodies is Lite in drawing and Standard in physics, and ships exactly that.
- **Phones.** Lite names a phone as a reference machine. Nothing has ever been run on one.

## Order of work

1. **Draw the line in code.** Each component and scene feature names its axis and edition; `check` reports per axis and why; `--edition` ceiling; the byte budget in CI; every example replayed under each edition to one hash.
2. **Prove the core with a real agent.** Write the Lite proof game's spec, connect an agent over MCP, build it to the end, record the agent cost. Every edition rests on this. Run once (2026-11-26, [`proof/lite/RUN.md`](../proof/lite/RUN.md)): finished without a person. Since then ([`proof/lite/COMPARE.md`](../proof/lite/COMPARE.md)): what the run showed `solve` cannot do is fixed, a second run met no failure it had to repair, and the same spec was built once on Godot. Still open: repeats, so that the spread between runs is known.
3. **The first comparison** (moved ahead of the rest of Lite on 2026-11-27), by the rules under "Winning, not only matching": isolation and the pass checks, the spread, then the held-out specs. All three held-out specs have been run; the screen checks are left.
4. **The runtime spike**, its first half (where the simulation core runs natively).
5. **Close the Lite gate**: sprite animation, per-tile art, audio, UI, gamepad, state between levels (all done); name the three Godot demos and rebuild them; the scoreboard's edition column and its count of rows gated in part (done); the remaining budgets; a run on a phone. Tools for the person who supervises start here, not in Ultra: a before-and-after view of a change, stepping through a replay, looking into a scene.
6. **Close the Standard gate**: glTF from other tools, animation and skins, lights, shapes and joints, navigation, networking, a hundred thousand entities with no allocation per tick, a desktop executable; its proof game and agent cost.
7. **Ultra**, with the rest of the runtime spike and the study of other engines' architecture.

Beside these, and waiting on the owner: the licence, then an install in one line and a first tutorial, then one person outside the project building a game without help. Nothing is said in public about cost until the held-out comparison has a result.

The study of Godot, Unity and Unreal feeds steps 3 to 5 as each is reached. Godot's code is MIT. Unity's and Unreal's sources are under licences that do not allow copying into a public project; only structure, behaviour and numbers are taken from them, and each licence is read before starting.
