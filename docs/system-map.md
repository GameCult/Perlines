# Perlines System Map

## Objective

Perlines rebuilds the 2012 Aethervis trail demo as a Fensalir client whose
visible form is driven by a key-aware, adaptively whitened FFT reservoir.

The real outcome is not a port of Unity `LineRenderer` state. The outcome is a
below-native spectral field that Fensalir can lower through the same TubeField,
reservoir, denoising, and presentation machinery used by the engine.

## Authority Map

- Owner: `PerlinesSignalProcessor` owns audio synthesis, FFT whitening, key
  detection, and projection from frequency bins into musical scale-note lanes.
- Inputs: frame time and delta time from the Fensalir runtime loop.
- Outputs: one normalized Float32 column of scale-note energy per frame,
  transposed into note-owned TubeField splines for rendering.
- Derived state: detected key, flux, tonal center, and energy are diagnostic
  readouts derived from the same spectral pass.
- Forbidden writers: render passes, UI controls, and tube lowerings do not
  decide spectral content. They only consume the field evidence.
- Shared path: visible splines, TubeField evidence, headless captures, and UI
  telemetry all read the same rolling note reservoir and version counter.
- Deletion line: Unity trail ownership, arbitrary band-to-spline assignment,
  and per-object procedural line state are dead. The renderer owns visibility.

## Pipeline

1. Procedural audio is synthesized as a test signal.
2. A Hann-windowed FFT measures the current frame.
3. Each FFT bin is divided by a smoothed envelope, producing adaptive whitening
   so persistent loud bands stop monopolizing the field.
4. Whitened bins accumulate into chroma energy.
5. Major/minor key templates with hysteresis choose the current key.
6. The detected key defines 70 scale-note lanes across octaves.
7. Each lane samples nearby whitened FFT bins for the note frequency.
8. The rolling note history is transposed into one contiguous curve per note
   lane.
9. Perlines uploads that compact 70 by 96 Float32 field resource.
10. Fensalir lowers each note lane through `AquariumFieldTubeSplineLowering`.
11. A Fensalir spline presentation reads the same note history and gives each
   lane a radial path advected by `cross(position, d/dxyz noise4(position,t))`,
   giving the presentation a divergence-free curl-noise style flow without
   restoring Unity object ownership.
12. The D3D12 TubeField path feeds the shared reservoir and final presentation.

## Invariants

- Musical lanes are keyed scale notes, not arbitrary FFT bins.
- Each TubeField spline belongs to one detected-key note lane.
- Perlines uploads a compact 70 by 96 Float32 resource, not a native-resolution
  buffer.
- The showy dance splines are derived from the same note reservoir. They do not
  own signal truth.
- Low-energy bands fade to invisible brushstroke segments; dead lanes do not
  keep an always-on tube silhouette.
- The rolling spectrum is a field-evidence resource, not private renderer
  geometry.
- Fensalir owns D3D12 buffers, TubeField dispatch, reservoir reuse, bloom, and
  final reconstruction.
- Headless verification must exercise the same client assembly and TubeField
  lowering path as interactive runs.
