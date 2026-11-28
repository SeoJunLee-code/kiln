# Lite proof game: first frame and memory

Measured with `node bench/start.ts` on 2026-11-28, on the reference PC (a laptop with
Intel integrated graphics), headless Chrome, a new browser with an empty profile for each of
10 starts, the built game served over the loopback interface.

| Start scene, browser | First frame, median ms | Lowest to highest ms | JS heap after loading, median MB | Files fetched | KB | KB gzipped |
|---|---|---|---|---|---|---|
| level1, default | 1068 | 651 to 1421 | 1.1 | 12 | 77 | 29 |
| level2, default | 1420 | 955 to 2007 | 1.1 | 12 | 78 | 29 |
| level3, default | 1401 | 901 to 1568 | 1.2 | 12 | 78 | 29 |
| level1, GPU off | 190 | 86 to 377 | 1.0 | 12 | 77 | 29 |
| level2, GPU off | 263 | 91 to 368 | 1.1 | 12 | 78 | 29 |
| level3, GPU off | 234 | 82 to 334 | 1.1 | 12 | 78 | 29 |

"default" is headless Chrome as it comes; "GPU off" is the same with `--disable-gpu`. In a
trial with the requests timed, every file had arrived within 90 ms of navigation, and the
long starts were spent waiting for and inside the first frame callback only when the
browser used the GPU: the cost is in starting it, which a browser already open has paid.

What this does not say: a download over a real network (see the byte columns), a phone, a
visible window, memory held by canvases, images or the GPU. KB are 1,000 bytes. The gzipped
column compresses each file by itself; this server sent them uncompressed.
