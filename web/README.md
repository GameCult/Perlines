# Perlines v2 (browser)

Zero-install audio visualizer: one static folder, WebAudio for analysis, WebGL2 for drawing, no build step, no dependencies, no network calls.

**Status, plainly: no human has watched this run.** It was written and tested by an agent. The DSP is checked by synthetic-signal tests (below). The renderers were exercised only by headless-Chrome captures and a frame-time script; nobody has listened to music through it, looked at it on a real display, or tried the microphone path. Expect rough looks and tuning mistakes.

## Run

```sh
node web/tools/serve.mjs 8080      # then open http://localhost:8080/
```

Any static server works (`python3 -m http.server -d web`). `localhost` counts as a secure context, so the microphone prompt works; opened from `file://` the mic may be refused. Then: drop an audio file on the page, press Microphone, or press Demo (a silent synthetic 120 bpm spectrum, for looking at scenes without sound). Keys: `1` `2` `3` scenes, `F` fullscreen, `H` HUD.

## What is in it

| Piece | File | What it does |
|---|---|---|
| Onset detector | `web/src/dsp.js` `OnsetDetector` | Log-compressed spectral flux against a max-filtered previous frame, moving-median adaptive threshold, local-peak pick, refractory period. Causal: confirms an onset one frame late. |
| Key estimate | `web/src/dsp.js` `KeyEstimator` | Peak-based chroma (parabolic-interpolated spectral peaks folded to 12 pitch classes, 4 s half-life) correlated against the 24 Krumhansl-Kessler key profiles. The key picks the scene tint: tonic walks the circle of fifths for hue, mode sets warmth. |
| Analysis state | `web/src/analysis.js` | One object all scenes read: 128 log bands, bass/mid/treble, onset counter, chroma, key, tint. Also `DemoFeed`. |
| Perlin noise | `web/src/noise.js` | Classic 3D Perlin and a 2D curl field (divergence-free flow) for the CPU-side paths. |
| Scenes | `web/src/scenes/` | Aurora disk, burning water, vector trails (below). |
| Persistence | `web/src/gl.js` `Feedback` | Two render targets; each frame fades the previous one and the scene adds on top. |

### Scenes

- **Aurora disk** (`aurora.js`): spectrum-to-mesh extrusion. A 112 x 224 polar mesh; angle is frequency (mirrored), radius is age, vertex height is the band level from a 128-row spectrum-history texture, modulated by noise. Onsets pulse and spin it.
- **Burning water** (`water.js`): a ripple plane lit in flame colours, plus an onset-driven spray. Particles are stateless: onsets write `(birth, seed, strength, lane)` into a ring buffer, and the vertex shader computes every position from age.
- **Vector trails** (`trails.js`): 96 heads, one per spectrum lane, ride a Perlin curl field; each leaves a 72-point polyline. An onset kicks the speed and respawns a spray of heads from the centre.

## Tests and measurements

```sh
cd web && npm test        # node --test test/dsp.test.mjs (node >= 20, nothing to install)
```

Covers: ten synthetic clicks found at two hop sizes (11.6 ms and 16.7 ms) with no false positives; silence, steady noise and a sustained tone give no onsets; a 20 ms doublet merges under the refractory period; the key estimate reads C major, A minor and (transposed) B minor from synthesized chord progressions. Fixtures are deliberately plain: the estimate is known to confuse relative major/minor when a clip leans on the dominant, and one test fixture was rewritten to put its tonic in more chords (the estimator was not tuned to the fixture).

Frame time: the HUD shows rolling p50/p95 of requestAnimationFrame intervals against the 16.7 ms budget and CPU submit time. `?bench` runs the three scenes on the synthetic feed and prints JSON (`?w=1920&h=1080` fixes the drawing-buffer size, `&sync` times each frame with `gl.finish()` so vsync does not hide cost, `&ms=` sets seconds per scene). `web/tools/headless.mjs` drives headless Chrome over CDP to collect it. Results of the last run are in `web/BENCH.md`.

## Provenance

The ideas come from the 2013 Unity "Aethervis" project (Perlin-noise paths with spray and trails; spectrum-driven mesh extrusion; the Aurora, BurningWater and vectortrails scenes) and from the author's analysis-vocabulary notes (onsets, chroma, key). No source, shader or asset was copied; this is fresh code under the repository's licence. The analysis is written from published techniques (spectral flux, Krumhansl-Kessler profiles) and does not port Vamp/aubio/QM-DSP code, which is GPL-family.

## Not done

Beat/tempo tracking, per-note lanes (the C# client has them), audio-worklet capture (onsets are quantized to the render frame rate), mobile tuning, a quality auto-scaler.
