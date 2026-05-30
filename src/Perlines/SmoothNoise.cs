namespace Perlines;

internal sealed class SmoothNoise
{
    private readonly float[] values = new float[512];
    private readonly int[] permutation = new int[512];

    public SmoothNoise(int seed)
    {
        var random = new Random(seed);
        for (var index = 0; index < 256; index++)
        {
            values[index] = (float)(random.NextDouble() * 2.0 - 1.0);
            permutation[index] = index;
        }

        for (var index = 255; index > 0; index--)
        {
            var swap = random.Next(index + 1);
            (permutation[index], permutation[swap]) = (permutation[swap], permutation[index]);
        }

        for (var index = 0; index < 256; index++)
        {
            values[index + 256] = values[index];
            permutation[index + 256] = permutation[index];
        }
    }

    public float Fractal(float x, float lacunarity)
    {
        var amplitude = 0.5f;
        var frequency = 1.0f;
        var value = 0.0f;
        for (var octave = 0; octave < 5; octave++)
        {
            value += Noise(x * frequency) * amplitude;
            frequency *= lacunarity;
            amplitude *= 0.5f;
        }

        return value;
    }

    private float Noise(float x)
    {
        var floor = (int)MathF.Floor(x);
        var t = x - floor;
        var a = values[permutation[floor & 255]];
        var b = values[permutation[(floor + 1) & 255]];
        var s = t * t * (3.0f - 2.0f * t);
        return a + (b - a) * s;
    }
}
