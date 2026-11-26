# Lite proof game: frame rate

Written by `node bench/frames.ts`; do not edit by hand. Rules: [`bench/PROTOCOL.md`](../../bench/PROTOCOL.md).
What these numbers do and do not show is in [`RUN.md`](RUN.md).

Measured 2026-11-26, Chrome/158.0.0.0, in a window (not headless), game view 924x705 pixels, drawn by Canvas 2D.
Each row is 60 seconds of the level's recorded play, looped, after 5 seconds of warm-up.
Every run of every configuration is listed. The page was visible in all of them: yes.

## Machine

- CPU: 12th Gen Intel(R) Core(TM) i5-12500H (16 threads)
- Memory: 16 GB
- OS: win32 10.0.26300
- GPU: Intel(R) Iris(R) Xe Graphics, driver 31.0.101.4502, drives the display at 1920x1080, 144 Hz
- GPU: NVIDIA GeForce RTX 3050 Ti Laptop GPU, driver 32.0.16.1091, not driving a display
- Power: on mains, Windows power plan Balanced
- GPU the browser used: ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x000046A6) Direct3D11 vs_5_0 ps_5_0, D3D11) (display); ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x000046A6) Direct3D11 vs_5_0 ps_5_0, D3D11) (uncapped); ANGLE (Microsoft, Microsoft Basic Render Driver (0x0000008C) Direct3D11 vs_5_0 ps_5_0, D3D11) (software); ANGLE (Microsoft, Microsoft Basic Render Driver (0x0000008C) Direct3D11 vs_5_0 ps_5_0, D3D11) (software-slow4)

## Result

- **This PC, no frame cap, with and without its GPU** (`uncapped`, `software`; 12 runs): the slowest 1% low is **247.1 fps**; 0 runs fell under 60.
- **As shown on the display** (`display`; 9 runs): 0 of 77764 frames took longer than 16.67 ms.
- **A slower machine, imitated** (`software-slow4`; 3 runs): the slowest 1% low is **51.8 fps**; 1 of 3 runs fell under 60. This is the browser slowing this PC's page down, not a slower machine.

## display

As a player gets it: vertical sync on, one frame per display refresh.

| Level | Run | Frames | Average FPS | 1% low | Frame ms, median | Frame ms, 99th | Longest frame ms | Frames over 16.67 ms | CPU ms, median | CPU ms, 99th | CPU ms, mean |
|---|---|---|---|---|---|---|---|---|---|---|---|
| level1 | 1 | 8641 | 144.0 | 133.1 | 6.90 | 7.30 | 9.3 | 0 (0.000%) | 0.20 | 0.60 | 0.255 |
| level1 | 2 | 8640 | 144.0 | 133.0 | 6.90 | 7.30 | 12.9 | 0 (0.000%) | 0.20 | 0.50 | 0.249 |
| level1 | 3 | 8640 | 144.0 | 130.6 | 6.90 | 7.30 | 13.8 | 0 (0.000%) | 0.20 | 0.50 | 0.250 |
| level2 | 1 | 8639 | 144.0 | 131.2 | 6.90 | 7.40 | 11.1 | 0 (0.000%) | 0.30 | 0.70 | 0.308 |
| level2 | 2 | 8641 | 144.0 | 124.4 | 7.00 | 7.40 | 12.6 | 0 (0.000%) | 0.30 | 0.60 | 0.291 |
| level2 | 3 | 8640 | 144.0 | 128.1 | 6.90 | 7.40 | 9.6 | 0 (0.000%) | 0.30 | 0.60 | 0.287 |
| level3 | 1 | 8642 | 144.0 | 131.9 | 6.90 | 7.40 | 8.9 | 0 (0.000%) | 0.30 | 0.60 | 0.305 |
| level3 | 2 | 8641 | 144.0 | 131.6 | 6.90 | 7.40 | 9.3 | 0 (0.000%) | 0.30 | 0.70 | 0.314 |
| level3 | 3 | 8640 | 144.0 | 127.6 | 6.90 | 7.40 | 10.8 | 0 (0.000%) | 0.30 | 0.60 | 0.307 |

## uncapped

Vertical sync off, frame cap off (the protocol's setting).

| Level | Run | Frames | Average FPS | 1% low | Frame ms, median | Frame ms, 99th | Longest frame ms | Frames over 16.67 ms | CPU ms, median | CPU ms, 99th | CPU ms, mean |
|---|---|---|---|---|---|---|---|---|---|---|---|
| level1 | 1 | 50383 | 839.6 | 384.2 | 1.10 | 2.30 | 4.5 | 0 (0.000%) | 0.20 | 0.50 | 0.210 |
| level1 | 2 | 51742 | 862.2 | 370.9 | 1.10 | 2.20 | 16.5 | 0 (0.000%) | 0.20 | 0.60 | 0.215 |
| level1 | 3 | 47737 | 795.4 | 351.4 | 1.20 | 2.50 | 5.6 | 0 (0.000%) | 0.20 | 0.50 | 0.218 |
| level2 | 1 | 72129 | 1201.8 | 341.3 | 0.80 | 2.30 | 8.7 | 0 (0.000%) | 0.20 | 0.70 | 0.235 |
| level2 | 2 | 42493 | 708.0 | 316.0 | 1.30 | 2.60 | 19.3 | 1 (0.002%) | 0.30 | 0.60 | 0.279 |
| level2 | 3 | 64129 | 1068.6 | 330.0 | 0.80 | 2.40 | 6.9 | 0 (0.000%) | 0.20 | 0.70 | 0.265 |
| level3 | 1 | 44017 | 733.5 | 336.5 | 1.30 | 2.60 | 7.6 | 0 (0.000%) | 0.20 | 0.60 | 0.254 |
| level3 | 2 | 40163 | 669.4 | 312.5 | 1.40 | 2.80 | 6.5 | 0 (0.000%) | 0.30 | 0.70 | 0.283 |
| level3 | 3 | 43968 | 732.8 | 319.2 | 1.30 | 2.70 | 5.3 | 0 (0.000%) | 0.20 | 0.60 | 0.254 |

## software

Uncapped, GPU off (`--disable-gpu`): the browser draws and composites on the CPU.

| Level | Run | Frames | Average FPS | 1% low | Frame ms, median | Frame ms, 99th | Longest frame ms | Frames over 16.67 ms | CPU ms, median | CPU ms, 99th | CPU ms, mean |
|---|---|---|---|---|---|---|---|---|---|---|---|
| level3 | 1 | 36381 | 606.3 | 275.3 | 1.50 | 3.10 | 11.9 | 0 (0.000%) | 0.20 | 0.50 | 0.234 |
| level3 | 2 | 38399 | 639.9 | 302.5 | 1.50 | 2.80 | 10.2 | 0 (0.000%) | 0.20 | 0.50 | 0.222 |
| level3 | 3 | 36563 | 609.4 | 247.1 | 1.50 | 3.50 | 6.9 | 0 (0.000%) | 0.20 | 0.60 | 0.234 |

## software-slow4

As `software`, with the page's CPU slowed 4x by the browser (DevTools CPU throttling).

| Level | Run | Frames | Average FPS | 1% low | Frame ms, median | Frame ms, 99th | Longest frame ms | Frames over 16.67 ms | CPU ms, median | CPU ms, 99th | CPU ms, mean |
|---|---|---|---|---|---|---|---|---|---|---|---|
| level3 | 1 | 9019 | 150.3 | 51.8 | 5.90 | 16.00 | 38.8 | 71 (0.787%) | 1.20 | 4.60 | 1.485 |
| level3 | 2 | 10115 | 168.6 | 75.7 | 5.60 | 11.40 | 25.8 | 8 (0.079%) | 1.10 | 4.00 | 1.282 |
| level3 | 3 | 9883 | 164.7 | 68.1 | 5.70 | 12.10 | 28.7 | 23 (0.233%) | 1.20 | 3.70 | 1.319 |

## Columns

- Average FPS: frames ÷ seconds. 1% low: the average frame rate of the slowest 1% of frames.
- Frame ms: time from one frame callback to the next. CPU ms: time inside the callback (simulation ticks, drawing calls, the side panel), main thread only.
- The browser's clock is coarsened to 0.1 ms, so a single frame under about 0.2 ms is not resolved; averages over a run are.
- GPU frame time is not recorded: Canvas 2D has no timestamp queries.
