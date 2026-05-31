using System.Numerics;
using Aquarium.Engine;
using Aquarium.Engine.Audio;
using Aquarium.Engine.Input;
using Aquarium.Engine.Render;
using Aquarium.Engine.Ui;

namespace Perlines;

public sealed class PerlinesRuntime : IAquariumRuntime, IAquariumRuntimeServicesReceiver
{
    private const int FftSize = 2048;
    private const int NoteLaneCount = 70;
    private const int HistoryColumns = 96;
    private const string DomainKey = "perlines:domain:whitened-fft";
    private const string ResourceKey = "resource:perlines:whitened-fft";
    private const string ClaimKey = "claim:perlines:whitened-fft:tube";
    private const string CandidateKey = "candidate:perlines:whitened-fft:tube";
    private const string ProducerKey = "perlines:adaptive-whitener";
    private const string LoopbackProfileId = "perlines:system-loopback";

    private readonly PerlinesSignalProcessor signal = new(FftSize, NoteLaneCount, sampleRate: 48000.0f);
    private readonly SmoothNoise danceNoise = new(0xDA7A);
    private readonly Perlin4D flowNoise = new(0xC012);
    private readonly float[] rollingNotes = new float[NoteLaneCount * HistoryColumns];
    private readonly float[] tubeSamples = new float[NoteLaneCount * HistoryColumns];
    private readonly float[] uploadColumn = new float[NoteLaneCount];
    private AquariumRuntimeServices services = AquariumRuntimeServices.Empty;
    private float[] stemMixBuffer = [];
    private float timeSeconds;
    private float previousTimeSeconds;
    private float cameraYaw;
    private float cameraPitch = 0.24f;
    private float cameraDistance = 7.8f;
    private int rollingColumn;
    private ulong resourceVersion = 1;
    private long consumedAudioSequence = -1;
    private bool autoOrbit = true;
    private bool freezeSignal;
    private bool usedAudioStemThisFrame;
    private string audioInputLabel = "synthetic";

    public AquariumRuntimeOptions Options { get; private set; }

    public GraphicsSettings GraphicsSettings { get; set; } = new(
        RenderDebugMode: 0,
        SceneExposure: 0.92f,
        BloomIntensity: 0.82f,
        BloomVeilIntensity: 0.0f,
        FieldReservoirMode: GraphicsSettings.FieldReservoirModeNativeDomain,
        FieldReservoirScale: 0.5f,
        FieldReservoirSpatialReuseBudget: 0.1f);

    public AquariumRenderPlan RenderPlan { get; } = CreateRenderPlan();

    public AquariumUiDocument Ui { get; }

    public AquariumAudioDocument Audio { get; } = new();

    public AquariumSynthDocument Synth { get; } = AquariumSynthDocument.Empty;

    public AquariumFrame Frame
    {
        get
        {
            var target = new Vector3(0.0f, 0.28f, -0.35f);
            return new AquariumFrame(
                new ViewFrame(Vector2.Zero, 7.5f),
                ComposeCamera(target),
                target,
                timeSeconds,
                Vector2.Zero,
                BuildScene());
        }
    }

    public PerlinesRuntime()
    {
        Ui = new AquariumUiDocument()
            .Panel("Perlines", 18.0f, 82.0f, 390.0f, panel =>
            {
                panel.Section("Adaptive FFT Tube Field");
                panel.Toggle("Auto Orbit", () => autoOrbit, value => autoOrbit = value);
                panel.Toggle("Freeze Signal", () => freezeSignal, value => freezeSignal = value);
                panel.Slider("Camera Distance", () => cameraDistance, value => cameraDistance = Math.Clamp(value, 4.5f, 13.0f), 4.5f, 13.0f, "0.00");
                panel.Readout("FFT", () => $"{FftSize} samples / {NoteLaneCount} scale-note lanes / v{resourceVersion}");
                panel.Readout("Key", () => signal.DetectedKeyName);
                panel.Readout("Input", () => audioInputLabel);
                panel.Readout("Whitening", () => $"flux {signal.LastFlux:0.000} / tonal center {signal.LastCentroid:0.000} / energy {signal.LastEnergy:0.000}");
                panel.Readout("Renderer", () => "Fensalir TubeField + shared reservoir + final reconstruction");
            })
            .Command("perlines", _ => $"Perlines: {NoteLaneCount} key-mapped scale-note lanes, {signal.DetectedKeyName}, rolling column {rollingColumn}, v{resourceVersion}.", "Report Perlines signal state.");
    }

    public AquariumFrame ComposeFrame(AquariumFrame frame, AquariumFrameInput input)
    {
        return frame;
    }

    public void Start()
    {
        Audio.EnqueueSystemLoopbackCapture(
            LoopbackProfileId,
            "windows-default-render",
            "System mix",
            enabled: true,
            sequence: 1);
        Console.WriteLine("Perlines adaptive FFT tube field booted.");
    }

    public void Update(float deltaSeconds, InputState input)
    {
        previousTimeSeconds = timeSeconds;
        var safeDelta = Math.Max(deltaSeconds, 0.0f);
        timeSeconds += safeDelta;

        if (!freezeSignal)
        {
            usedAudioStemThisFrame = TryAdvanceFromAudioStem(safeDelta, uploadColumn);
            if (!usedAudioStemThisFrame)
            {
                signal.Advance(timeSeconds, safeDelta, uploadColumn);
                audioInputLabel = "synthetic fallback";
            }

            rollingColumn = (rollingColumn + 1) % HistoryColumns;
            Array.Copy(uploadColumn, 0, rollingNotes, rollingColumn * NoteLaneCount, NoteLaneCount);
            resourceVersion++;
        }

        if (autoOrbit)
        {
            cameraYaw += safeDelta * 0.045f;
        }

        if (input.IsKeyDown(KeyCode.A))
        {
            cameraYaw -= safeDelta * 0.85f;
            autoOrbit = false;
        }

        if (input.IsKeyDown(KeyCode.D))
        {
            cameraYaw += safeDelta * 0.85f;
            autoOrbit = false;
        }

        if (input.IsKeyDown(KeyCode.W))
        {
            cameraPitch += safeDelta * 0.36f;
        }

        if (input.IsKeyDown(KeyCode.S))
        {
            cameraPitch -= safeDelta * 0.36f;
        }

        if (MathF.Abs(input.WheelDelta) > 0.0f)
        {
            cameraDistance = Math.Clamp(cameraDistance - input.WheelDelta * MathF.Max(cameraDistance * 0.09f, 0.05f), 4.5f, 13.0f);
        }

        if (input.LeftMouseDown && input.MouseDelta != Vector2.Zero)
        {
            cameraYaw -= input.MouseDelta.X * 0.006f;
            cameraPitch += input.MouseDelta.Y * 0.0035f;
            autoOrbit = false;
        }

        cameraPitch = Math.Clamp(cameraPitch, 0.06f, 0.62f);
    }

    public void FlushState()
    {
    }

    public void Dispose()
    {
    }

    public void AttachServices(AquariumRuntimeServices runtimeServices)
    {
        services = runtimeServices;
    }

    internal void SetOptions(AquariumRuntimeOptions options)
    {
        Options = options;
        if (options.Headless)
        {
            autoOrbit = false;
            cameraYaw = 0.76f;
            cameraPitch = 0.34f;
            cameraDistance = 7.8f;
            for (var frame = 0; frame < HistoryColumns; frame++)
            {
                timeSeconds += 1.0f / 60.0f;
                signal.Advance(timeSeconds, 1.0f / 60.0f, uploadColumn);
                rollingColumn = frame % HistoryColumns;
                Array.Copy(uploadColumn, 0, rollingNotes, rollingColumn * NoteLaneCount, NoteLaneCount);
                resourceVersion++;
            }

            previousTimeSeconds = timeSeconds - (1.0f / 60.0f);
        }
    }

    private AquariumSceneState BuildScene()
    {
        var timestampNs = (long)(timeSeconds * 1_000_000_000.0f);
        var support = new AquariumFieldSupport(
            Center: new Vector3(0.0f, 0.9f, 0.0f),
            Radius: new Vector3(4.8f, 2.2f, 3.2f),
            LocalFrame: Matrix4x4.Identity,
            ConservativeRadius: 5.9f,
            ProjectedError: 1.0f / 128.0f,
            Curvature: 0.2f + signal.LastFlux,
            TemporalUncertainty: 0.016f);
        var proposal = new AquariumFieldProposalPolicy(
            AquariumFieldProposalKind.SensorObservation,
            SourcePdf: 1.0f,
            TargetContribution: Math.Max(0.1f, 2.5f + signal.LastEnergy * 6.0f),
            RepresentedCandidateCount: NoteLaneCount,
            Seed: (uint)(resourceVersion & uint.MaxValue));
        var guide = AquariumFieldGuide.Valid(Math.Clamp(0.68f + signal.LastFlux * 0.3f, 0.1f, 1.0f), 1.0f / 60.0f);

        var resource = new AquariumFieldResourceDeclaration(
            ResourceKey,
            AquariumFieldResourceKind.StructuredBuffer,
            AquariumFieldResourceResidency.GpuResident,
            AquariumFieldShaderAccess.ShaderResource,
            "Float32",
            Width: HistoryColumns,
            Height: NoteLaneCount,
            DepthOrCount: tubeSamples.Length,
            StrideBytes: sizeof(float),
            ValidFromNs: Math.Max(0, timestampNs - 50_000_000),
            ValidUntilNs: timestampNs + 100_000_000,
            Version: resourceVersion,
            NativeHandle: IntPtr.Zero,
            NativeHandleKind: "perlines-rolling-float32");

        var frame = new AquariumFieldEvidenceFrame
        {
            AccumulationWindowSeconds = 0.45f,
            PresentationDelaySeconds = 0.0f,
            Domains =
            [
                new AquariumFieldDomain(
                    DomainKey,
                    "",
                    AquariumFieldDomainKind.RollingBuffer,
                    Matrix4x4.Identity,
                    Matrix4x4.Identity,
                    new Vector3(-3.8f, -0.15f, -2.6f),
                    new Vector3(3.8f, 2.7f, 2.6f),
                    new Vector3(0.0f, 0.0f, HistoryColumns),
                    "Perlines")
            ],
            Resources = [resource, AquariumBuiltInFieldResources.BlackbodyRamp(resourceVersion)],
            ResourceUploads = BuildResourceUploads(),
            Claims =
            [
                new AquariumFieldClaim(
                    ClaimKey,
                    DomainKey,
                    ProducerKey,
                    AquariumFieldLayer.Form,
                    AquariumFieldEncoding.Tube,
                    support,
                    proposal,
                    ResourceKey,
                    timestampNs,
                    guide.Confidence)
            ],
            Candidates =
            [
                new AquariumFieldCandidate(
                    CandidateKey,
                    ClaimKey,
                    AquariumFieldLayer.Form,
                    AquariumFieldEncoding.Tube,
                    proposal,
                    guide)
            ],
            TubeSplineLowerings =
            [
                new AquariumFieldTubeSplineLowering(
                    "lowering:perlines:fft:tube",
                    ClaimKey,
                    ResourceKey,
                    Width: HistoryColumns,
                    Height: NoteLaneCount,
                    StrideBytes: sizeof(float),
                    FirstColumn: 0,
                    ColumnCount: NoteLaneCount,
                    ColumnStride: 1,
                    RollingModulo: 0,
                    RollingOffset: 0,
                    Origin: new Vector3(-3.4f, -0.72f, -2.15f),
                    AxisStep: new Vector3(6.8f / Math.Max(1, HistoryColumns - 1), 0.0f, 0.0f),
                    ColumnStep: new Vector3(0.0f, 0.018f, 4.3f / Math.Max(1, NoteLaneCount - 1)),
                    AmplitudePower: 1.38f,
                    AmplitudeScale: 1.75f,
                    NormalizeMin: 0.0f,
                    NormalizeMax: 1.0f,
                    BaseRadius: 0.002f,
                    RadiusScale: 0.072f,
                    Alpha: 0.86f,
                    Feather: 0.18f,
                    RampTexturePath: "",
                    RampResourceKey: AquariumBuiltInFieldResources.BlackbodyRampResourceKey,
                    EmissionScale: 9.2f,
                    CatmullRomSubdivisions: 4)
            ],
        };

        return new AquariumSceneState
        {
            TraceHeightFieldSurface = false,
            UseStudioBackground = false,
            SdfLights =
            [
                new AquariumSdfLight(new Vector4(-3.2f, -3.8f, 4.2f, 6.0f), new Vector4(0.26f, 0.46f, 0.95f, 12.0f)),
                new AquariumSdfLight(new Vector4(3.6f, 2.8f, 3.4f, 4.0f), new Vector4(1.0f, 0.36f, 0.18f, 5.8f)),
            ],
            FieldEvidenceFrame = frame,
            SplineFrame = BuildDanceSplineFrame(),
        };
    }

    private bool TryAdvanceFromAudioStem(float deltaSeconds, Span<float> output)
    {
        var frame = services.AudioStems
            .DrainPublishedFrames(maxFrames: 16)
            .Where(candidate => candidate.Channels.Count > 0 && candidate.FrameCount > 0 && candidate.SampleRate > 0)
            .OrderBy(candidate => candidate.Sequence)
            .LastOrDefault();
        if (frame is null || frame.Sequence == consumedAudioSequence)
        {
            return false;
        }

        consumedAudioSequence = frame.Sequence;
        var frameCount = frame.FrameCount;
        if (stemMixBuffer.Length < frameCount)
        {
            stemMixBuffer = new float[frameCount];
        }

        Array.Clear(stemMixBuffer, 0, frameCount);
        var mixedChannels = 0;
        foreach (var channel in frame.Channels)
        {
            if (channel.Samples.Length == 0)
            {
                continue;
            }

            var count = Math.Min(frameCount, channel.Samples.Length);
            for (var index = 0; index < count; index++)
            {
                stemMixBuffer[index] += channel.Samples[index];
            }

            mixedChannels++;
        }

        if (mixedChannels == 0)
        {
            return false;
        }

        var scale = 1.0f / mixedChannels;
        for (var index = 0; index < frameCount; index++)
        {
            stemMixBuffer[index] = Math.Clamp(stemMixBuffer[index] * scale, -1.0f, 1.0f);
        }

        signal.AdvanceFromSamples(stemMixBuffer.AsSpan(0, frameCount), frame.SampleRate, deltaSeconds, output);
        var stem = frame.Channels[0];
        var source = string.IsNullOrWhiteSpace(stem.DisplayName) ? stem.StemId : stem.DisplayName;
        audioInputLabel = $"{frame.ProfileId} / {source} / seq {frame.Sequence}";
        return true;
    }

    private AquariumSplineFrame BuildDanceSplineFrame()
    {
        var splines = new List<AquariumSpline3D>(NoteLaneCount);
        var style = new AquariumSplineStyle(
            radius: 0.012f,
            emission: 10.0f,
            alpha: 1.0f,
            normalExponent: 0.42f,
            feather: 0.08f);

        const int pointCount = 56;
        for (var note = 0; note < NoteLaneCount; note++)
        {
            var vertices = new AquariumSplineVertex[pointCount];
            var note01 = note / Math.Max(1.0f, NoteLaneCount - 1.0f);
            var baseAngle = note01 * MathF.Tau * 3.0f + note * 0.37f;
            var lanePhase = timeSeconds * (0.22f + note01 * 0.18f) + note * 11.13f;
            var laneHue = note % 7;
            var radial = Vector3.Normalize(new Vector3(MathF.Cos(baseAngle), 0.18f * MathF.Sin(baseAngle * 1.7f), MathF.Sin(baseAngle)));
            var position = radial * (0.18f + note01 * 0.4f);
            for (var point = 0; point < pointCount; point++)
            {
                var t = point / Math.Max(1.0f, pointCount - 1.0f);
                var historyIndex = Math.Clamp((int)MathF.Round(t * (HistoryColumns - 1)), 0, HistoryColumns - 1);
                var physicalColumn = (rollingColumn + 1 + historyIndex) % HistoryColumns;
                var energy = rollingNotes[physicalColumn * NoteLaneCount + note];
                var visibility = EnergyVisibility(energy);
                var brushTaper = BrushTaper(t);
                var strokeAlpha = visibility * brushTaper;
                var lift = MathF.Pow(Math.Clamp(energy, 0.0f, 1.0f), 0.55f) * strokeAlpha;
                var flare = MathF.Pow(Math.Clamp(energy, 0.0f, 1.0f), 1.5f) * strokeAlpha;
                var derivative = flowNoise.Derivative(new Vector4(
                    position.X * 0.58f + note * 0.013f,
                    position.Y * 0.72f + note01 * 2.0f,
                    position.Z * 0.58f - note * 0.017f,
                    timeSeconds * 0.22f + t * 1.8f));
                var curl = Vector3.Cross(position, derivative);
                if (curl.LengthSquared() > 0.0001f)
                {
                    curl = Vector3.Normalize(curl);
                }

                var pulse = lift * (0.18f + energy * 0.42f);
                var drift = 0.010f + lift * 0.15f;
                var jitter = danceNoise.Fractal(note * 1.7f + point * 0.23f + timeSeconds * 0.5f, 2.1f) * 0.025f * (0.2f + lift);
                position += radial * (drift + pulse) + curl * (0.055f + lift * 0.20f) + Vector3.UnitY * jitter;
                vertices[point] = new AquariumSplineVertex(position, HotColor(flare, laneHue, strokeAlpha));
            }

            splines.Add(new AquariumSpline3D($"perlines:dance:{note:00}", vertices, style, CatmullRomSubdivisions: 5));
        }

        return new AquariumSplineFrame { Splines = splines };
    }

    private static float EnergyVisibility(float energy) => SmoothStep(0.08f, 0.46f, energy);

    private static float BrushTaper(float t) =>
        MathF.Pow(SmoothStep(0.0f, 0.10f, t) * (1.0f - SmoothStep(0.88f, 1.0f, t)), 0.55f);

    private static float SmoothStep(float edge0, float edge1, float value)
    {
        var t = Math.Clamp((value - edge0) / Math.Max(edge1 - edge0, 0.0001f), 0.0f, 1.0f);
        return t * t * (3.0f - 2.0f * t);
    }

    private static Vector4 HotColor(float energy, int laneHue, float alpha)
    {
        var e = Math.Clamp(energy, 0.0f, 1.0f);
        var red = Math.Clamp(e * 5.7f, 0.0f, 6.0f);
        var green = Math.Clamp(e * 1.35f, 0.0f, 1.6f);
        var blue = Math.Clamp(e * e * 0.18f, 0.0f, 0.45f);
        if (laneHue == 0)
        {
            green += e * 1.35f;
            blue += 0.08f;
        }
        else if (laneHue == 4)
        {
            blue += e * 1.2f;
            red *= 0.72f;
        }

        return new Vector4(red, green, blue, Math.Clamp(alpha, 0.0f, 1.0f));
    }

    private AquariumFieldResourceUpload[] BuildResourceUploads()
    {
        RefreshTubeSamples();
        return
        [
            new AquariumFieldResourceUpload
            {
                ResourceKey = ResourceKey,
                Version = resourceVersion,
                ElementOffset = 0,
                Float32Data = tubeSamples.ToArray(),
            }
        ];
    }

    private void RefreshTubeSamples()
    {
        for (var note = 0; note < NoteLaneCount; note++)
        {
            var noteOffset = note * HistoryColumns;
            for (var age = 0; age < HistoryColumns; age++)
            {
                var physicalColumn = (rollingColumn + 1 + age) % HistoryColumns;
                tubeSamples[noteOffset + age] = rollingNotes[physicalColumn * NoteLaneCount + note];
            }
        }
    }

    private Vector3 ComposeCamera(Vector3 target)
    {
        var horizontal = MathF.Cos(cameraPitch) * cameraDistance;
        return new Vector3(
            MathF.Sin(cameraYaw) * horizontal,
            -MathF.Cos(cameraYaw) * horizontal,
            target.Z + MathF.Sin(cameraPitch) * cameraDistance);
    }

    private static AquariumRenderPlan CreateRenderPlan()
    {
        var app = new AquariumApp();
        var scene = app.RenderTargets.Hdr("scene");
        app.Cameras.Perspective("main");
        app.Graph.Pass("scene").Fullscreen();
        app.Features.Bloom(scene.Color);
        app.Features.Presentation(scene.Color);
        app.Features.DirectWriteOverlay();
        app.Debug.View("Scene", scene.Color);
        return app.Plan;
    }
}

public sealed class PerlinesRuntimeFactory : IAquariumRuntimeFactory
{
    public IAquariumRuntime Create(AquariumRuntimeOptions options)
    {
        var runtime = new PerlinesRuntime();
        runtime.SetOptions(options);
        return runtime;
    }
}
