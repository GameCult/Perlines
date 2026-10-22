# Perlines

Perlines is the 2012 Aethervis trail idea rebuilt as a Fensalir client: audio becomes a rolling field resource that Fensalir's renderer draws as a storm of curl-noise trails, with no private line renderer in the client.

**Valuable here:** the signal path. `src/Perlines/PerlinesSignalProcessor.cs` turns audio into FFT energy, adaptively whitens it per band, detects the key, and projects bins onto musical scale-note lanes. `src/Perlines/PerlinesRuntime.cs` writes one Float32 column per frame into a rolling field resource and hands it to Fensalir (`Perlin4D.cs` and `SmoothNoise.cs` supply the noise). It is a worked example of a Fensalir client that owns a signal and leaves visibility, reservoir reuse, bloom and reconstruction to the renderer.

**Problem it solves:** the Unity version owned trails through `LineRenderer` and `TrailRenderer` objects, so the renderer could not reason about them. Here the renderer owns the trails and Perlines owns only the signal.

**Entry points:** client project `src/Perlines/Perlines.csproj` (solution `Perlines.sln`); design and authority map in `docs/system-map.md`; launched through Fensalir's `scripts/dev-reload.ps1`. Requires a sibling checkout of `GameCult/Fensalir` (Windows, D3D12).

**Status:** live as a demo. Input is a Fensalir-owned Windows system-loopback stem when one is available, otherwise a procedural fallback signal. Last commit 2026-05-31.

## Run

From the root of the Fensalir checkout (Perlines checked out beside it):

```powershell
.\scripts\dev-reload.ps1 -ClientProject ..\Perlines\src\Perlines\Perlines.csproj
```

Headless smoke test, also from Fensalir:

```powershell
.\scripts\dev-reload.ps1 -Headless -ClientProject ..\Perlines\src\Perlines\Perlines.csproj
```

`scripts/run-dev.ps1` and `scripts/capture-headless.ps1` in this repo wrap the same launch and a headless PNG capture, but both hardcode the Fensalir location as `E:\Projects\Fensalir`, which does not exist on current workstations. Edit that path before running them.

## Live Model

- Perlines owns procedural audio/FFT/whitening and field-resource uploads.
- Fensalir owns the Win32 host, D3D12 renderer, TubeField compute/render
  lowering, shared reservoir, and presentation denoising.
- The rolling spectrum is a below-native field evidence source, not a private
  line renderer.
- The spline lanes are assigned to notes in the detected key instead of
  arbitrary spectrum bins.
- Each rendered spline is one note lane evolving over the rolling time window.
- A Fensalir spline presentation turns that reservoir into the old radial
  Perlines trail storm with a divergence-free curl-noise flow, while TubeField
  evidence remains available to the shared reservoir path.
- Low-energy bands taper and fade out instead of leaving permanent bright
  strokes.
