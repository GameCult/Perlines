# Perlines

Perlines is the 2012 Aethervis trail idea rebuilt as a Fensalir client.

The Unity version owned trails through `LineRenderer` and `TrailRenderer`
objects. This version owns only the signal: a procedural audio frame is sent
through an FFT, adaptively whitened per band, written into a rolling Float32
field resource, and lowered through Fensalir's TubeField path. The renderer owns
visibility, reservoir reuse, bloom, and final reconstruction.

## Run

From `E:\Projects\Fensalir`:

```powershell
.\scripts\dev-reload.ps1 -ClientProject E:\Projects\Perlines\src\Perlines\Perlines.csproj
```

Headless smoke test from Fensalir:

```powershell
.\scripts\dev-reload.ps1 -Headless -ClientProject E:\Projects\Perlines\src\Perlines\Perlines.csproj
```

Headless PNG capture from this repo:

```powershell
E:\Projects\Perlines\scripts\capture-headless.ps1
```

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
