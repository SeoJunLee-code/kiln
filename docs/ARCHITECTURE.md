# Architecture

How Kiln is put together, and the rules that hold it together. Read this before changing anything under `src/`.

## The one idea

A run is a pure function: **scene text + input script → state**. Everything else follows from keeping that true.

- An agent can check its work without looking at a screen (`test`).
- A bug report is two small text files.
- The engine can search for inputs itself (`solve`), because trying an input costs nothing but CPU and always gives the same answer.
- The browser player and the headless CLI cannot disagree, because they run the same modules.

## Layers

```
            cli.ts   mcp.ts            web/player.ts  (browser)
               \      /                      |
             commands.ts                     |
        /     |      |     \                 |
  load.ts  run.ts  solve.ts  guide.ts        |
               \     |                       |
        scene.ts  expect.ts  sim.ts  <-------+   shared, no Node or DOM APIs
               \     |      /
              world.ts   fx.ts
```

| Module | Job | May use |
|---|---|---|
| `fx.ts` | Q16.16 fixed-point numbers | nothing |
| `world.ts` | entities, component registry, the `World` | `fx` |
| `scene.ts` | text ↔ world, diagnostics | `world`, `fx` |
| `sim.ts` | one tick: `step(world, input)` | `world`, `fx`, `scene` (for hashing) |
| `expect.ts` | parse and evaluate `expect` lines | `sim`, `scene`, `world` |
| `run.ts` | run a scene headless; ASCII view | the above |
| `solve.ts` | search for an input | the above |
| `api.ts` | what a script receives | `fx`, `world` |
| `physics.ts` | the backend interface and the fixed-point boundary; the one place in the simulation with floats | `world`, `fx` |
| `lint.ts`, `edition.ts` | warnings; which edition a scene needs | the shared modules |
| `squeeze.ts`, `png.ts` | smaller engine files in a build; reading and comparing pictures | Node |
| `look.ts`, `chrome.ts` | draw a scene in a headless browser | Node, an installed Chrome or Edge |
| `load.ts`, `serve.ts`, `build.ts`, `new.ts`, `mcp.ts`, `cli.ts`, `commands.ts` | files, HTTP, processes | Node |
| `web/` | drawing, input and sound | DOM, WebGPU, WebGL2, the shared modules |

The shared modules must stay free of Node and DOM APIs: the browser loads them as they are.

## Numbers

All simulation state is an integer. A value like `1.5` is stored as `1.5 * 65536`. Floating-point results can differ between CPUs, compilers and math libraries; integer results cannot.

- Use `mul` and `div` from `fx.ts`, never `*` and `/` on two fixed-point values.
- A per-second amount is split over ticks with `tickShare`, which makes the ticks of one second add up exactly. Plain division loses a little each tick: speed 6 at 60 Hz ended up at 2.99973 after 30 ticks.
- Floats are fine for drawing and for search heuristics that do not change the state.

## A tick

`step` runs these in order, and the order is part of the format:

1. apply input events for this tick
2. `ctrl` sets velocities from held keys
3. `pace` turns pacing entities around
4. script systems registered as `pre`
5. an animated sprite notes which way it faces
6. gravity on every `body`
7. movement, one entity at a time in ascending id, one axis at a time (x, y, z); with a physics backend, rigid bodies are registered first and stop movers
8. the physics backend takes one step
9. turning (`rot`, `quat`)
10. tick counter + 1
11. buttons tapped or whose key was newly pressed
12. triggers: new overlaps emit events and run actions
13. script systems registered as `post`
14. `tally` counts the events of this tick

Movement is swept: the mover's box is stretched along its path and tested against solids, so speed cannot carry it through a wall. Solids come from a coarse grid rebuilt each tick (`buildIndex`). The result of a query is only ever reduced with `min` and `max`, so the order of candidates does not matter; that is what makes the grid safe.

Iteration is always in ascending entity id (`World.query`). Never iterate a `Map` or `Set` whose order depends on history when the result feeds the state.

## State and its hash

`serialize(world)` writes the canonical text of a world: the scene format itself, plus a `state` line for held keys and current trigger overlaps. The hash is FNV-1a over that text. So "same hash" means "would save to the same file", and a saved scene can be loaded and continued.

If you add state, it must appear in `serialize`, or two different worlds will share a hash. Add it as a component field when you can.

`examples/HASHES` pins the final hash of every example. CI checks it on three operating systems. If you change simulation results on purpose, regenerate it and say why.

## Scenes

Line-oriented, indentation-based, parsed in one pass with every error collected (`KilnFail`). Prefabs and tile `spawn` tables are expanded while loading; after that a world is plain entities, which is why saving never spawns twice.

Components are data. A component definition is a name, a doc line and typed fields (`fx`, `int`, `str`); the parser, the serializer, the schema and the guide are all generated from the registry.

## Errors

Every problem a user can cause has a code (`K…`), a `file:line`, a message and, where possible, a hint that says what to do. Output is plain lines that are easy to match and cheap to read. Group codes loosely: K0xx usage and files, K1xx scenes and scripts, K2xx input, K3xx warnings, K9xx internal checks.

## Search

`solve` explores choices of "which keys are held for the next few ticks". Nodes are ordered by open goals, then distance to a goal, then input length, using integers only so the answer is the same everywhere. States are merged by a key that rounds positions to 1/64 of a unit; that merge is approximate, so an answer is replayed exactly before it is reported and a mismatch is an error (K131).

## Rendering

`web/player.ts` draws a world; it never changes one except by calling `step`. Wall-clock time decides how many ticks to run, never what a tick does. 2D uses Canvas; a scene with an `eye` is drawn with WebGPU (`web/gpu.ts`): boxes, OBJ meshes and glTF models, one sun, one shadow map. WebGL2 (`web/gl.ts`) is a frozen fallback that draws neither rotation nor glTF.

## Adding things

- **A component**: `defineComponent` in `world.ts`, behaviour in `sim.ts` at a fixed place in the tick, a test through a scene, a line in the README table if it is user-visible.
- **An `expect` form**: `parseExpects` and `evalTick` in `expect.ts`; if `solve` should pursue it, the heuristic in `solve.ts`.
- **A command**: `commands.ts` if it works on scene text (then the MCP tool gets it too), `cli.ts` if it needs the file system or a process.
