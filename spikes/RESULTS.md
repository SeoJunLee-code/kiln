# Spike results

Measured 2026-11-26. Each line is one run unless it says otherwise.

## WebGPU in a headless browser: yes

`node spikes/webgpu/probe.ts [software]` draws a triangle to a texture, runs a
compute pass, and reads both back.

| Machine | Mode | Browser | Adapter | Result |
|---|---|---|---|---|
| Windows laptop, integrated GPU | default | Chrome 158 | intel gen-12lp (hardware) | pass |
| Windows laptop, integrated GPU | software | Chrome 158 | SwiftShader | pass |
| GitHub ubuntu-latest | default | Chrome 157 | SwiftShader | pass |
| GitHub ubuntu-latest | software | Chrome 157 | SwiftShader | pass |
| GitHub macos-latest | default | Chrome 157 | apple (hardware) | pass |
| GitHub macos-latest | software | Chrome 157 | SwiftShader | pass |
| GitHub windows-latest | default | Chrome 157 | SwiftShader | pass |
| GitHub windows-latest | software | Chrome 157 | none | **fail**: `requestAdapter` returned null |

Render, compute and `timestamp-query` were available wherever an adapter was.

Decisions:

- WebGPU becomes the main renderer. The WebGL2 renderer stays as it is, as a fallback.
- Reference images are produced on **ubuntu-latest with SwiftShader** and nowhere else.
- The software switches are fragile across platforms and versions (the one failure
  above; and on the Windows laptop, adding `--enable-features=Vulkan` or
  `--use-angle=swiftshader` also returned no adapter). Image checks therefore run on
  the reference environment only; other machines only smoke-test that drawing works.

Not tested: Firefox, Safari, any discrete GPU, the speed of SwiftShader on a real scene.

## Existing physics engine: yes, with one constraint

`node spikes/physics/rapier.ts` drops 300 spinning boxes and balls into a walled
pit for 600 ticks, using Rapier 0.21.0's deterministic WebAssembly build.

| Machine | End state | Snapshot | Step | Save + load |
|---|---|---|---|---|
| Windows x64, Node 24.18 | 3f35f884 | 9da34797 | 1.4–1.5 ms | 1.6–1.7 ms |
| ubuntu-latest x64, Node 24.22 | 3f35f884 | 9da34797 | 2.2 ms | 1.9 ms |
| macos-latest arm64, Node 24.22 | 3f35f884 | 9da34797 | 1.7 ms | 1.8 ms |

- Same steps twice gave the same state.
- The state and the bytes of a mid-run snapshot were identical on all three, including x64 against arm64.
- A world restored from the snapshot finished in the same state as the one that was never saved.

Decisions:

- Kiln does not write a 3D rigid-body solver. Rigid bodies go behind a backend
  interface, with Rapier's deterministic build as the first backend.
- The fixed-point box core stays for grid and platform games: it is exact, has
  no dependency, and its state is a few hundred bytes.
- **Constraint for `solve`:** a snapshot of this scene is 872 kB (about 2.9 kB a
  body). A search that keeps 200,000 states cannot keep 200,000 of these. A
  physics scene has to be searched by keeping input paths and re-simulating, or
  with a small bounded set of snapshots. This is unsolved.

Not tested: joints, character controllers, continuous collision, more than 300
bodies, a JS engine other than V8, and Jolt (the other candidate).
