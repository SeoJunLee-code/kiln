# Measurement protocol

How speed is measured when Kiln is compared with another engine. A result that
does not follow this file is not quoted in the README or in `docs/PARITY.md`.

## Machines

| Role | Use |
|---|---|
| **Reference PC** | The comparison itself. Every Kiln-vs-engine number comes from this one machine, both engines measured in the same session. |
| **Additional hardware** | Generalization only: does the result hold elsewhere? Never mixed into the reference numbers, never used to compare engines across machines. |

Each result file records the machine: CPU class, GPU, driver version, OS, display
refresh rate, power mode. No serial numbers, user names or paths.

## Same scene, same settings: required

A comparison is valid only if both engines run:

- the same scene (same meshes, materials, lights, camera path);
- the same output resolution, with no dynamic resolution or upscaling unless both use the same one at the same ratio;
- vertical sync off, frame cap off;
- the same quality options, listed in the result file, each matched by name to the other engine's setting; an option with no counterpart is turned off on both sides or the row is marked not comparable;
- the same warm-up (shaders compiled, assets streamed in) before recording starts.

If any of these differ, the result is labelled *not comparable* and is not used.

## What is recorded

Per run, over a fixed camera path of at least 60 seconds after warm-up:

| Metric | Definition |
|---|---|
| Average FPS | frames ÷ seconds over the whole recording |
| 1% low | the average frame rate of the slowest 1% of frames |
| GPU frame time | time the GPU spent per frame: median and 99th percentile, in ms |
| CPU frame time | same, for the main thread |

Kiln records GPU time with WebGPU timestamp queries; Unreal with its own
profiler exported to CSV. Frame times are kept per frame, so every summary
number can be recomputed from the raw file.

Each configuration is run three times; all three are reported, not the best one.

## In CI

CI machines are shared and their timing jitters, so CI never checks wall-clock
time. It checks counts that are the same on every run: search states visited,
draw calls, triangles submitted, bytes of output. A change that raises one of
these past its budget fails the build.

## Honesty

- A number measured once is written as measured once.
- An engine that was not actually run is not in the table.
- Tokens are counted by the model provider's counter, not estimated from characters.
