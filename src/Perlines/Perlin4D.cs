using System.Numerics;

namespace Perlines;

internal sealed class Perlin4D
{
    private readonly int[] permutation = new int[512];

    public Perlin4D(int seed)
    {
        var random = new Random(seed);
        for (var index = 0; index < 256; index++)
        {
            permutation[index] = index;
        }

        for (var index = 255; index > 0; index--)
        {
            var swap = random.Next(index + 1);
            (permutation[index], permutation[swap]) = (permutation[swap], permutation[index]);
        }

        for (var index = 0; index < 256; index++)
        {
            permutation[index + 256] = permutation[index];
        }
    }

    public Vector3 Derivative(Vector4 point)
    {
        var x0 = (int)MathF.Floor(point.X);
        var y0 = (int)MathF.Floor(point.Y);
        var z0 = (int)MathF.Floor(point.Z);
        var w0 = (int)MathF.Floor(point.W);
        var x = point.X - x0;
        var y = point.Y - y0;
        var z = point.Z - z0;
        var w = point.W - w0;
        var fade = new Vector4(Fade(x), Fade(y), Fade(z), Fade(w));
        var fadeDerivative = new Vector4(FadeDerivative(x), FadeDerivative(y), FadeDerivative(z), FadeDerivative(w));
        var derivative = Vector3.Zero;

        for (var cornerX = 0; cornerX <= 1; cornerX++)
        for (var cornerY = 0; cornerY <= 1; cornerY++)
        for (var cornerZ = 0; cornerZ <= 1; cornerZ++)
        for (var cornerW = 0; cornerW <= 1; cornerW++)
        {
            var distance = new Vector4(x - cornerX, y - cornerY, z - cornerZ, w - cornerW);
            var gradient = Gradient(x0 + cornerX, y0 + cornerY, z0 + cornerZ, w0 + cornerW);
            var contribution = Vector4.Dot(gradient, distance);
            var wx = cornerX == 0 ? 1.0f - fade.X : fade.X;
            var wy = cornerY == 0 ? 1.0f - fade.Y : fade.Y;
            var wz = cornerZ == 0 ? 1.0f - fade.Z : fade.Z;
            var ww = cornerW == 0 ? 1.0f - fade.W : fade.W;
            var dwx = cornerX == 0 ? -fadeDerivative.X : fadeDerivative.X;
            var dwy = cornerY == 0 ? -fadeDerivative.Y : fadeDerivative.Y;
            var dwz = cornerZ == 0 ? -fadeDerivative.Z : fadeDerivative.Z;

            derivative.X += (dwx * wy * wz * ww * contribution) + (wx * wy * wz * ww * gradient.X);
            derivative.Y += (wx * dwy * wz * ww * contribution) + (wx * wy * wz * ww * gradient.Y);
            derivative.Z += (wx * wy * dwz * ww * contribution) + (wx * wy * wz * ww * gradient.Z);
        }

        return derivative;
    }

    private Vector4 Gradient(int x, int y, int z, int w)
    {
        var hash = permutation[(x + permutation[(y + permutation[(z + permutation[w & 255]) & 255]) & 255]) & 255];
        var gx = ((hash & 1) == 0 ? 1.0f : -1.0f) * (1.0f + ((hash >> 4) & 1) * 0.5f);
        var gy = ((hash & 2) == 0 ? 1.0f : -1.0f) * (1.0f + ((hash >> 5) & 1) * 0.5f);
        var gz = ((hash & 4) == 0 ? 1.0f : -1.0f) * (1.0f + ((hash >> 6) & 1) * 0.5f);
        var gw = ((hash & 8) == 0 ? 1.0f : -1.0f) * (1.0f + ((hash >> 7) & 1) * 0.5f);
        return Vector4.Normalize(new Vector4(gx, gy, gz, gw));
    }

    private static float Fade(float t) => t * t * t * (t * (t * 6.0f - 15.0f) + 10.0f);

    private static float FadeDerivative(float t) => 30.0f * t * t * (t - 1.0f) * (t - 1.0f);
}

