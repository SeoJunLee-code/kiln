# Spikes

Small tests that answer one question before the engine commits to a direction.
Nothing here is imported by the engine. Results are recorded in `RESULTS.md`.

| Folder | Question |
|---|---|
| `webgpu/` | Can a headless browser give us WebGPU (render and compute), on a developer machine and on CI without a GPU? |
| `physics/` | Is an existing rigid-body engine deterministic across OSes, and can its state be saved and restored exactly, as `solve` needs? |

`physics/` has its own `package.json`; the engine itself still has no dependencies.
