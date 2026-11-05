# Frame-time record

**No GPU measurement exists yet.** The only run so far used headless Chrome with the SwiftShader *software* rasterizer on a shared Linux box. Those numbers say nothing about a real GPU; they show that the scenes run without GL errors and what the JavaScript side costs. The intended target machine (Starfire, GTX 1070) was unreachable (sshd reset every connection) when this was written.

Run 2026-11-05, 1280x720 drawing buffer, synthetic feed, `?bench&sync&w=1280&h=720&ms=4000` (a 1-pixel readback each frame, so the number is cost, not vsync-capped). 16.7 ms is the 60 Hz budget.

| Scene | frame p50 | p95 | max | GPU timer p50 (software) |
|---|---|---|---|---|
| Aurora disk | 21.3 ms | 27.1 | 38.6 | 17.9 |
| Burning water | 46.1 ms | 52.6 | 80.7 | 42.5 |
| Vector trails | 12.2 ms | 17.9 | 21.4 | 9.2 |

JavaScript submit cost (analysis, uploads, draw calls) was 0.8 ms p50 and under 2.7 ms p95 per frame in the vsync run. Software rasterization is CPU-bound by pixels and vertices, so the water scene (full-screen 3 x fbm per pixel) is the one to watch on a real GPU, particularly at 4K or high-dpi. Run `node web/tools/serve.mjs` and open `/?bench&sync&w=1920&h=1080` in Chrome, or use `web/tools/headless.mjs`, on the target to replace this table.
