# Benchmarks

- `size.ts`: text size against Godot (below).
- `perf.ts`, `physics.ts`: simulation speed (`PERF.md`, `PHYSICS.md`).
- `frames.ts`: frame rate of the Lite proof game in a browser window, by `PROTOCOL.md`. Result in `proof/lite/FPS.md`, per-frame times in `raw/`; `--summary raw/FILE.json.gz` recomputes a row.

# Size benchmark: Kiln vs Godot

The same small game (`examples/maze.kiln`: a walled room, a coin, an exit, a recorded
play-through, and five checks) written for Godot 4 as a `.tscn` scene, three GDScript
files and a GUT test.

Run `node bench/size.ts`. It writes `RESULTS.md`.

## What this does and does not show

- It measures **how much text an agent has to read and write** to express the game and
  its checks. Characters and bytes are exact. The token column is an estimate
  (characters / 4); no tokenizer was run.
- The Godot files were written by hand in the format the editor saves. **They were not
  opened or run in Godot**, so they may contain mistakes. The Godot test also needs the
  GUT addon and a `project.godot`, which are not counted.
- One small game is not a general result. A game that leans on things Godot has and Kiln
  lacks (animation, tilemaps, 3D, audio) cannot be written in Kiln at all today.
- It says nothing about the cost of engine documentation, tool calls, or looking at
  results, which also matter for an agent.
