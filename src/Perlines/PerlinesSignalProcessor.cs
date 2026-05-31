using System.Numerics;

namespace Perlines;

internal sealed class PerlinesSignalProcessor
{
    private static readonly string[] NoteNames = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
    private static readonly int[] MajorScale = [0, 2, 4, 5, 7, 9, 11];
    private static readonly int[] MinorScale = [0, 2, 3, 5, 7, 8, 10];
    private static readonly float[] MajorTemplate = [6.35f, 2.23f, 3.48f, 2.33f, 4.38f, 4.09f, 2.52f, 5.19f, 2.39f, 3.66f, 2.29f, 2.88f];
    private static readonly float[] MinorTemplate = [6.33f, 2.68f, 3.52f, 5.38f, 2.60f, 3.53f, 2.54f, 4.75f, 3.98f, 2.69f, 3.34f, 3.17f];

    private readonly int fftSize;
    private readonly int laneCount;
    private float sampleRate;
    private readonly int binCount;
    private readonly float[] window;
    private readonly float[] envelope;
    private readonly float[] whitenedBins;
    private readonly float[] chroma;
    private readonly float[] smoothedChroma;
    private readonly float[] previousLanes;
    private readonly float[] externalSamples;
    private readonly Complex[] spectrum;
    private readonly SmoothNoise noise = new(0x5EED);
    private float phaseA;
    private float phaseB;
    private float phaseC;
    private int detectedRoot = 9;
    private bool detectedMinor;
    private int externalWriteIndex;
    private int externalSampleCount;

    public float LastEnergy { get; private set; }

    public float LastFlux { get; private set; }

    public float LastCentroid { get; private set; }

    public string DetectedKeyName => $"{NoteNames[detectedRoot]} {(detectedMinor ? "minor" : "major")}";

    public PerlinesSignalProcessor(int fftSize, int laneCount, float sampleRate)
    {
        if (!BitOperations.IsPow2(fftSize))
        {
            throw new ArgumentException("FFT size must be a power of two.", nameof(fftSize));
        }

        this.fftSize = fftSize;
        this.laneCount = laneCount;
        this.sampleRate = sampleRate;
        binCount = fftSize / 2;
        window = new float[fftSize];
        envelope = new float[binCount];
        whitenedBins = new float[binCount];
        chroma = new float[12];
        smoothedChroma = new float[12];
        previousLanes = new float[laneCount];
        externalSamples = new float[fftSize];
        spectrum = new Complex[fftSize];
        Array.Fill(envelope, 0.08f);

        for (var index = 0; index < fftSize; index++)
        {
            window[index] = 0.5f - 0.5f * MathF.Cos(MathF.Tau * index / Math.Max(1, fftSize - 1));
        }
    }

    public void Advance(float timeSeconds, float deltaSeconds, Span<float> output)
    {
        if (output.Length < laneCount)
        {
            throw new ArgumentException("Output span is smaller than the configured lane count.", nameof(output));
        }

        FillSignal(timeSeconds);
        Analyze(deltaSeconds, output);
    }

    public void AdvanceFromSamples(ReadOnlySpan<float> samples, int inputSampleRate, float deltaSeconds, Span<float> output)
    {
        if (output.Length < laneCount)
        {
            throw new ArgumentException("Output span is smaller than the configured lane count.", nameof(output));
        }

        if (samples.IsEmpty || inputSampleRate <= 0)
        {
            Advance(0.0f, deltaSeconds, output);
            return;
        }

        sampleRate = inputSampleRate;
        PushExternalSamples(samples);
        FillExternalWindow();
        Analyze(deltaSeconds, output);
    }

    private void Analyze(float deltaSeconds, Span<float> output)
    {
        Fft(spectrum);
        WhitenBins(Math.Max(deltaSeconds, 1.0f / 240.0f));
        DetectKey();
        ProjectScaleLanes(output);
    }

    private void FillSignal(float timeSeconds)
    {
        var rootMidi = 45 + ((detectedRoot + 3) % 12);
        var baseFrequency = MidiToFrequency(rootMidi) * (1.0f + 0.035f * noise.Fractal(timeSeconds * 0.041f, 2.1f));
        var formant = 0.5f + 0.5f * noise.Fractal(timeSeconds * 0.071f + 17.0f, 3.4f);
        var pulse = MathF.Pow(0.5f + 0.5f * MathF.Sin(timeSeconds * 1.7f + noise.Fractal(timeSeconds * 0.19f, 4.0f) * 2.0f), 3.0f);

        for (var index = 0; index < fftSize; index++)
        {
            var t = index / sampleRate;
            var localTime = timeSeconds + t;
            var fm = 1.0f + 0.028f * noise.Fractal(localTime * 0.8f, 8.0f);
            phaseA += MathF.Tau * baseFrequency * fm / sampleRate;
            phaseB += MathF.Tau * (baseFrequency * (1.5f + formant * 0.5f)) / sampleRate;
            phaseC += MathF.Tau * (baseFrequency * (2.0f + formant)) / sampleRate;
            var sample =
                MathF.Sin(phaseA) * 0.50f +
                MathF.Sin(phaseB + MathF.Sin(phaseA) * 0.45f) * 0.30f +
                MathF.Sin(phaseC + phaseB * 0.12f) * (0.12f + pulse * 0.24f) +
                noise.Fractal(localTime * 4.0f, 11.0f) * 0.03f;
            spectrum[index] = new Complex(sample * window[index], 0.0f);
        }
    }

    private void PushExternalSamples(ReadOnlySpan<float> samples)
    {
        foreach (var sample in samples)
        {
            externalSamples[externalWriteIndex] = Math.Clamp(sample, -1.0f, 1.0f);
            externalWriteIndex = (externalWriteIndex + 1) % fftSize;
            externalSampleCount = Math.Min(externalSampleCount + 1, fftSize);
        }
    }

    private void FillExternalWindow()
    {
        var available = Math.Max(0, Math.Min(externalSampleCount, fftSize));
        var first = (externalWriteIndex - available + fftSize) % fftSize;
        var pad = fftSize - available;
        for (var index = 0; index < pad; index++)
        {
            spectrum[index] = Complex.Zero;
        }

        for (var index = 0; index < available; index++)
        {
            var sourceIndex = (first + index) % fftSize;
            var targetIndex = pad + index;
            spectrum[targetIndex] = new Complex(externalSamples[sourceIndex] * window[targetIndex], 0.0f);
        }
    }

    private void WhitenBins(float safeDelta)
    {
        Array.Clear(chroma);
        for (var bin = 1; bin < binCount; bin++)
        {
            var frequency = bin * sampleRate / fftSize;
            var magnitude = (float)spectrum[bin].Magnitude;
            var attack = 1.0f - MathF.Exp(-safeDelta * 22.0f);
            var release = 1.0f - MathF.Exp(-safeDelta * 2.8f);
            var coefficient = magnitude > envelope[bin] ? attack : release;
            envelope[bin] += (magnitude - envelope[bin]) * coefficient;
            var whitened = magnitude / Math.Max(envelope[bin], 0.0001f);
            var shaped = Math.Clamp(0.5f + MathF.Tanh((whitened - 0.62f) * 1.25f) * 0.5f, 0.0f, 1.0f);
            whitenedBins[bin] = MathF.Pow(shaped, 1.12f);

            if (frequency >= 48.0f && frequency <= 6000.0f)
            {
                var midi = 69.0f + 12.0f * MathF.Log2(frequency / 440.0f);
                var chromaIndex = PositiveModulo((int)MathF.Round(midi), 12);
                var octaveWeight = 1.0f - Math.Clamp(MathF.Abs(midi - 67.0f) / 60.0f, 0.0f, 0.75f);
                chroma[chromaIndex] += whitenedBins[bin] * octaveWeight;
            }
        }

        for (var note = 0; note < 12; note++)
        {
            smoothedChroma[note] = smoothedChroma[note] * 0.92f + chroma[note] * 0.08f;
        }
    }

    private void DetectKey()
    {
        var bestRoot = detectedRoot;
        var bestMinor = detectedMinor;
        var bestScore = float.NegativeInfinity;
        for (var root = 0; root < 12; root++)
        {
            var majorScore = KeyScore(root, MajorTemplate);
            if (majorScore > bestScore)
            {
                bestScore = majorScore;
                bestRoot = root;
                bestMinor = false;
            }

            var minorScore = KeyScore(root, MinorTemplate);
            if (minorScore > bestScore)
            {
                bestScore = minorScore;
                bestRoot = root;
                bestMinor = true;
            }
        }

        var currentScore = KeyScore(detectedRoot, detectedMinor ? MinorTemplate : MajorTemplate);
        if (bestScore > currentScore * 1.035f + 0.02f)
        {
            detectedRoot = bestRoot;
            detectedMinor = bestMinor;
        }
    }

    private float KeyScore(int root, float[] template)
    {
        var score = 0.0f;
        for (var offset = 0; offset < 12; offset++)
        {
            score += smoothedChroma[(root + offset) % 12] * template[offset];
        }

        return score;
    }

    private void ProjectScaleLanes(Span<float> output)
    {
        var scale = detectedMinor ? MinorScale : MajorScale;
        var baseMidi = 36 + detectedRoot;
        var energy = 0.0f;
        var flux = 0.0f;
        var centroid = 0.0f;

        for (var lane = 0; lane < laneCount; lane++)
        {
            var octave = lane / scale.Length;
            var degree = lane % scale.Length;
            var midi = baseMidi + octave * 12 + scale[degree];
            var frequency = MidiToFrequency(midi);
            var bin = Math.Clamp((int)MathF.Round(frequency * fftSize / sampleRate), 1, binCount - 2);
            var value =
                whitenedBins[bin] * 0.56f +
                whitenedBins[bin - 1] * 0.22f +
                whitenedBins[bin + 1] * 0.22f;
            var scaleDegreeAccent = degree is 0 or 2 or 4 ? 1.0f : 0.82f;
            var shaped = Math.Clamp(MathF.Pow(value * scaleDegreeAccent, 1.06f), 0.0f, 1.0f);
            output[lane] = shaped;
            energy += shaped;
            flux += Math.Max(0.0f, shaped - previousLanes[lane]);
            centroid += shaped * (lane / Math.Max(1.0f, laneCount - 1.0f));
            previousLanes[lane] = shaped;
        }

        LastEnergy = energy / laneCount;
        LastFlux = flux / laneCount;
        LastCentroid = centroid / Math.Max(energy, 0.0001f);
    }

    private static float MidiToFrequency(int midi) =>
        440.0f * MathF.Pow(2.0f, (midi - 69.0f) / 12.0f);

    private static int PositiveModulo(int value, int modulo)
    {
        var result = value % modulo;
        return result < 0 ? result + modulo : result;
    }

    private static void Fft(Complex[] values)
    {
        var n = values.Length;
        var j = 0;
        for (var i = 1; i < n; i++)
        {
            var bit = n >> 1;
            for (; (j & bit) != 0; bit >>= 1)
            {
                j ^= bit;
            }

            j ^= bit;
            if (i < j)
            {
                (values[i], values[j]) = (values[j], values[i]);
            }
        }

        for (var length = 2; length <= n; length <<= 1)
        {
            var angle = -MathF.Tau / length;
            var wLength = new Complex(MathF.Cos(angle), MathF.Sin(angle));
            for (var i = 0; i < n; i += length)
            {
                var w = Complex.One;
                for (var k = 0; k < length / 2; k++)
                {
                    var u = values[i + k];
                    var v = values[i + k + length / 2] * w;
                    values[i + k] = u + v;
                    values[i + k + length / 2] = u - v;
                    w *= wLength;
                }
            }
        }
    }
}
