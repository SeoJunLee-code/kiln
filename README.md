# Kiln

[![ci](https://github.com/SeoJunLee-code/kiln/actions/workflows/ci.yml/badge.svg)](https://github.com/SeoJunLee-code/kiln/actions/workflows/ci.yml)

English | [한국어](README.ko.md)

An open-source game engine whose primary user is an AI agent, not a person in a GUI editor.

**[Play the examples in your browser](https://seojunlee-code.github.io/kiln/)** — built from this repository by `kiln build`; pick a scene from the menu. It has on-screen buttons on a phone.

Game engines assume a human looking at an editor window. An agent using them pays for that: verbose scene files, results it can only check by looking at pixels, and runs that differ every time. Kiln is designed the other way round.

- **Everything is text.** Scenes are short, diffable files. There is no required editor.
- **Deterministic core.** Fixed tick, fixed-point math, fixed system order. The same scene and input give the same state hash; CI checks this on Linux, macOS and Windows.
- **Headless verification.** `kiln test` runs a scene without a window and checks `expect` lines written in the scene itself.
- **Cheap observation.** An ASCII view and one line per entity instead of screenshots.
- **Machine-readable errors.** Every error has a code, a `file:line` and a hint, and all errors are reported in one pass. `check` also warns about parts of a scene that load but silently do nothing, such as a controller without a velocity or a trigger that points at a name nobody has.
- **The engine can play its own levels.** `kiln solve` searches for an input that meets a scene's goals, so a level is shown to be finishable without anyone playing it.
- **One MCP tool.** An agent connects over MCP and gets the whole engine as a single tool.

![The 3D example in the browser player: lit boxes and OBJ meshes with shadows, and the live state, checks and controls beside it](docs/arena3d.jpg)

## Where it stands

Kiln is a few days old. The long-term aim is an engine that agents can take from prototype to a shipped, good-looking game — the role Unreal and Godot play for human teams. Today it is a small core: box-shaped worlds in 2D and 3D, with first steps into models, materials and rigid bodies.

| Works today | Not yet |
|---|---|
| Text scenes, 26 built-in components, levels drawn as character grids with prefabs | Skeletal animation, custom shaders, more than one light |
| Fixed-point simulation on x, y and z; swept box collision; triggers that emit events and remove things (keys, doors, pickups); pacing guards; pushable crates; moving platforms that carry what stands on them | Circle or polygon collision, collision that follows rotation |
| Rotation as fixed-point state: an angle (`rot`) or a quaternion (`quat`), drawn in 2D and by WebGPU | Parent-child transforms |
| Rigid bodies (boxes and balls) through an optional backend, Rapier's deterministic build: same hash on Linux, macOS and Windows, they block and shove the character, and `solve` searches through them | 2D rigid bodies, joints, other shapes |
| 2D: sprites and sprite-sheet animation, a color or an image per tile character, labels, buttons, entities pinned to the screen | Particles, layout containers, text input |
| Sound files on events and one looping music track | Positional sound, fades |
| Keyboard, touch and gamepad | Remapping, analog values |
| Several levels (a trigger loads the next scene) and a score or lives that go along (`tally`, `keep`) | Saving to disk |
| `expect` checks with explanations on failure; TypeScript scripts with a determinism check | Asset pipeline |
| Browser player: Canvas 2D, and lit, shadowed boxes and OBJ meshes for 3D scenes, drawn with WebGPU (WebGL2 where the browser has none) | Images, glyphs and labels in 3D |
| glTF 2.0 models (.glb, .gltf) with metallic-roughness materials and textures, on WebGPU | glTF animation and skins; files from other exporters are untested; environment lighting |
| `look`: the scene drawn in a headless browser, returned to the agent as a picture | An editor for people, a profiler |
| `solve`: automatic search for a winning input | `solve` does not tap buttons |
| `build`: export to a static web folder; MCP server and CLI | Networking, desktop and mobile export |

Claude Code has built games with Kiln over its MCP server ([proof/lite](proof/lite/RUN.md), [proof/compare](proof/compare/README.md)). A comparison with Godot on held-out specs is under way and has no verdict yet. No human has play-tested a game yet. See [HANDOFF.md](HANDOFF.md) (Korean) for the detailed status and known limits.

## Try it

Needs Node 24 or newer. No dependencies, no build step. (Rigid-body scenes need one optional package: `npm ci --prefix backends/rapier`.)

```
git clone https://github.com/SeoJunLee-code/kiln
cd kiln
npm test
node src/cli.ts test examples/platformer.kiln --input examples/platformer.input --view
node src/cli.ts play examples/platformer.kiln
```

For the 3D example, open the printed URL with `?scene=arena3d.kiln` (arrows or WASD to walk, Space to jump).

`play` prints a local URL; add `?scene=cave.kiln` to open another scene from the same folder. What you press there is recorded as an input script, so a play session can be replayed headless with `kiln test SCENE --input FILE` and gives the same state hash.

The same page is where a person checks what an agent did. Step through the run one tick at a time, back as well as forward (`,` and `.`), and click an entity to read its components. `play SCENE --before OLD.kiln` (or `--before HEAD`, any git revision) puts the game as it was beside the game as it is, runs both on the same input and lists what differs.

## Start a game with an agent

```
node src/cli.ts new ../mygame
```

This writes a starter scene, an `AGENTS.md` (and `CLAUDE.md`) that tells an agent how to work with Kiln, and a `.mcp.json` that connects the engine as an MCP tool. Open the folder in Claude Code, or any agent that reads those files, and ask for a game.

## Ship it

```
node src/cli.ts build mygame/level1.kiln --out dist
```

`dist` then holds the player, the engine modules it needs and everything next to the scene, as plain files any static host can serve (GitHub Pages, itch.io, an S3 bucket). The demo linked at the top is produced this way on every push.

## A scene

```
world hz=60 gravity=0,30

entity hero
  pos 1 9
  box 0.8 1
  vel
  body
  ctrl 5 12

entity ground
  pos 0 10
  box 20 1
  solid

entity flag
  pos 15 9
  box 1 1
  trigger hero win

expect event win by 300
expect at 300 hero.body.grounded == 1
```

Levels can be drawn as a grid, one character per cell. Characters named in `spawn` become entities built from a prefab (see [examples/dungeon.kiln](examples/dungeon.kiln)):

```
prefab coin
  box 0.5 0.5
  tag coin
  trigger hero coin despawn-self

entity map
  pos 0 0
  tiles spawn=@:hero,o:coin,D:door
    #########
    #@..#..o#
    #.#.#.#.#
    #o#...#D#
    #########

expect gone #coin by 600
```

Values are positional or `name=value`. `node src/cli.ts schema` prints the component reference in a compact form meant to be pasted into an agent's context.

Expectations (`A` and `B` are entity names or `#tags`):

| Form | Passes when |
|---|---|
| `reach A B by N` | A overlaps B at some tick ≤ N |
| `never A B` | A never overlaps B during the run |
| `gone A by N` | A was despawned by tick N |
| `event NAME by N` | a trigger emitted NAME by tick N |
| `count NAME OP VALUE at N` | the number of NAME events by tick N compares true |
| `at N A.comp.field OP VALUE` | the comparison holds at tick N |

When a check fails, the output says what happened instead:

```
FAIL examples/maze.kiln:45 reach player exit by 240 -- closest gap 5.2 at tick 0, player at 1,1
```

Input scripts are one `TICK ACTION down|up` per line. Actions: `left right up down a b`.

**One scene, several checks.** An input file may carry `expect` lines of its own; they replace the scene's for that run. `kiln test DIR` runs every scene with its `NAME.input`, and once more for each `NAME.CASE.input` beside it, so "the door stays shut with two gems" is one small file ([examples/level1.wait.input](examples/level1.wait.input)) and not a copy of the level.

**A scene ends where it loads another.** A trigger with `load:FILE` ends the scene at that tick, headless as in the player: the run stops, the last line says `load=FILE`, an event count asked for at a later tick is final and a field asked for at a later tick has no value. `kiln test SCENE --input FILE --follow` goes on into the loaded scene with that scene's `NAME.input`, and so on, which plays a whole game from its first level to its ending in one command:

```
scene level1.kiln tick=426 hash=6023ce5f passed=3 load=level2.kiln
scene level2.kiln tick=886 hash=900348c1 passed=8 load=level3.kiln
scene level3.kiln tick=671 hash=4ab2b31b passed=8 load=end.kiln
ok tick=1 hash=505dfab4 passed=1 failed=0 path=level1.kiln>level2.kiln>level3.kiln>end.kiln
```

**Values go along.** `tally coin` on an entity counts the `coin` events, and `keep tally` on the entity of the same name in both scenes starts the next one with the number the last one ended on ([examples/level1.kiln](examples/level1.kiln)). `--follow` and the browser player carry it the same way and reach the same hash; a scene run by itself starts from its own file. See `kiln guide levels`.

`solve` treats a load the same way: a route through a trigger that restarts the level is not an answer.

## Let the engine prove a level can be finished

```
$ node src/cli.ts solve examples/cave.kiln --out cave.input
0 right down
...
ok solved tick=255 states=267 wrote=cave.input
```

Because a run is fully determined by scene and input, the engine can search the input space: over which keys are held for the next few ticks, merging states that are the same. An answer is replayed through the normal path before it is reported. If nothing works it says which goal is still open and draws where its furthest attempt ended:

```
fail no input reaches the goals by tick 120; best run met 0/1, still open: gone gem by 120
furthest attempt, tick 20:
origin 0,0
#######
#.h#.g#
#######
fail tick=20 states=94
```

Twenty of the twenty-one examples solve on one laptop, each in under two seconds (the one left is a title screen, which needs a tap); the one that takes the most search is [examples/quest.kiln](examples/quest.kiln): a key, a door and a guard sweeping the corridor. They include the 3D one, a crate-pushing puzzle ([examples/sokoban.kiln](examples/sokoban.kiln)), a gap that can only be crossed by riding a lift ([examples/lift.kiln](examples/lift.kiln)), a key-and-door puzzle ([examples/vault.kiln](examples/vault.kiln)) and a corridor of pacing guards where the crossing has to be timed ([examples/gauntlet.kiln](examples/gauntlet.kiln)). The search tries inputs that get nearer to a goal first; it has only been tried with one controllable character in small levels, and it gives up (and says so) when it runs out of states. `at` expectations are not searched for.

## 3D

`pos`, `vel` and `box` take an optional third value, and a scene that uses it is simulated on three axes with the same code and the same guarantees. Adding an `eye` component makes the player draw it in perspective (see [examples/arena3d.kiln](examples/arena3d.kiln)):

```
world hz=60 gravity=0,30

entity hero
  pos 1 -1 1
  box 0.8 1 0.8
  vel
  body
  ctrl 5 10 xz
  eye 0 -8 9

entity floor
  pos 0 0 0
  box 12 1 12
  solid
```

A 3D level can also be drawn as a floor plan. `plane=xz` lays a tile map flat, with `depth` as the wall height ([examples/crypt3d.kiln](examples/crypt3d.kiln)):

```
entity map
  pos 0 -1 0
  tiles plane=xz spawn=@:hero,k:key,D:door,E:exit
    ###########
    #@..#.....#
    #.#.#.###.#
    #.#...#E#.#
    #.#####D#.#
    #k........#
    ###########
```

![The floor plan above, drawn by the player](docs/crypt3d.jpg)

`--top` prints the same picture back as text, so an agent can check a 3D level without a screenshot.

`y` grows downward, so things above the floor have negative `y`. A sprite can name an OBJ file (`sprite color=gold mesh=gem.obj`); OBJ is text, so an agent can write one. The mesh is drawn fitted to the entity's box, while collision stays the box. One sun with shadows.

A sprite can also name a glTF model (`mesh=crate.glb`, or a `.gltf` with its `.bin` and images beside it). WebGPU draws it with its metallic-roughness materials and textures ([examples/gallery3d.kiln](examples/gallery3d.kiln)); `clip NAME` plays one of its animations, skinned or not, as a function of the tick ([examples/rig3d.kiln](examples/rig3d.kiln)). `check` reports anything in the file that would not be drawn. `rot 25 axis=y` turns an entity about one axis and `quat` holds a full orientation; both are simulation state, in fixed-point, and both can spin ([examples/orrery3d.kiln](examples/orrery3d.kiln)).

Rigid bodies come from a physics backend. `world ... physics=rapier` turns it on and `rigid` marks a body; bodies stop the character, who shoves them along and can stand on them; `impulse x y z` gives a body one shove and `force x y z` a steady push (a script kicks a body by adding `impulse`); and `solve` finds the push that wins ([examples/tumble3d.kiln](examples/tumble3d.kiln)):

```
world hz=60 gravity=0,30 physics=rapier

entity ball
  pos 3.5 -0.8 4
  box 0.8 0.8 0.8
  rigid ball bounce=0.3
  sprite color=tomato mesh=ball.glb
```

## Scripts

A scene line `use ./game.ts` loads a script that adds components and systems. See [examples/patrol.ts](examples/patrol.ts).

```ts
export default (k) => {
  k.component('patrol', 'walks between x=min and x=max', [
    { name: 'min', type: 'fx' }, { name: 'max', type: 'fx' }, { name: 'speed', type: 'fx' }]);
  k.system((w) => {
    for (const id of w.query('patrol', 'pos', 'vel')) { /* ... */ }
  });
};
```

Scripts must stay deterministic. `Math.random`, `Date`, timers and similar are rejected at load (K121); use `w.rand()` and `w.tick`. The check is a simple text scan, so it catches the obvious cases only.

## Use from an agent (MCP)

```json
{ "mcpServers": { "kiln": { "command": "node", "args": ["/path/to/kiln/src/cli.ts", "mcp"] } } }
```

The server exposes one tool, `kiln`, with a `cmd` argument (`check`, `run`, `test`, `solve`, `schema`, `guide`). `guide` returns the core manual in one call (about 5,100 characters; a test keeps it under 5,600). Parts only some games need (`guide physics`, `guide view`, `guide script`; over MCP `topic=physics`) are named there in one line each and read on demand, so a new component does not make every agent's first call longer. With that an agent does not have to read this README or the source. One tool instead of many keeps the definition an agent carries in context small.

## Is it actually smaller?

One measurement so far: the maze example, with its play-through and checks, is 729 characters in Kiln and 4,937 in a hand-written Godot 4 equivalent (scene, scripts and a GUT test). That is one small game, the Godot files were not run in Godot, and tokens were not counted with a real tokenizer. Details and caveats are in [bench/](bench/README.md).

## How fast is it?

On one laptop, single thread, no rendering, at the speed the laptop sustains (its first seconds are about three times faster): 1,000 falling bodies among 1,000 solid blocks take about 3 ms per tick, and 5,000 among 1,000 about 12 ms, inside a 60 Hz frame; 10,000 among 5,000 take about 31 ms, which is not. Collision candidates come from a coarse grid rebuilt each tick. The script and the full table are in [bench/PERF.md](bench/PERF.md).

Rigid bodies (the Rapier backend) on the same laptop: a pile of 500 crates and balls with four characters walking through it takes about 8 ms per tick, 1,000 take about 22 ms. Roughly three quarters of that is the solver. The table, with what a save and a restore cost, is in [bench/PHYSICS.md](bench/PHYSICS.md). All of these are one run on one machine.

## Roadmap

The aim is Godot's feature set first, then Unreal's, kept in a form an agent can
write and check. [docs/PARITY.md](docs/PARITY.md) is the scoreboard: every feature
against both engines, and one rule — a feature counts only when a check in CI fails
if it breaks. Comparisons of speed follow [bench/PROTOCOL.md](bench/PROTOCOL.md):
same scene, same settings, same machine; average FPS, 1% low and GPU frame time.

The plan is three editions over one shared core, so a small game does not carry
what a large one needs: **Lite** (runs without WebGPU, no dependencies),
**Standard** (an integrated GPU with WebGPU) and **Ultra** (a discrete GPU). One
scene format and the same agent tools in all three. Each edition is done when an
agent has built its proof game and the cost of doing so is on record. So far
`check` says which edition a game needs and why (`--edition lite` makes more an
error), and `build` ships only the parts a game uses, within a byte budget
(a 2D game carries about 90 KB of engine). The Lite proof game has been built once by an agent with no person helping (7 minutes, 37,711 tokens written, 7 failures it repaired itself: [proof/lite/RUN.md](proof/lite/RUN.md)); its frame rate on the reference machines is not measured, and the other two proof games are not built. See [docs/EDITIONS.md](docs/EDITIONS.md).

Next:

1. Finish what just landed: glTF files from other tools, animation and skins, environment lighting; bodies that move the character, more shapes, joints.
2. Sprite animation, per-tile art, audio, UI.
3. Connect a real agent over MCP and build a complete small game with it; measure the tokens.
4. Export targets and networking built on the deterministic core (rollback, replays).

## Safety

A scene can load a script with `use`, and a script is ordinary code that runs with your permissions. Treat a scene from someone else the way you would treat a program. `play` listens on localhost only, and both `play` and `build` take only game assets (scenes, scripts, images, meshes, sounds) from the scene's folder; other files there are not served or copied.

## Contributing

Issues and pull requests are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## License

MIT
