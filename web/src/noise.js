// Perlin gradient noise (3D) and a divergence-free curl field in 2D, for the CPU-side trail paths.
// Permutation table from a seeded LCG shuffle; gradients are the 12 cube-edge vectors.

const G = [[1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],[1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],[0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1]];

export function makeNoise(seed = 1) {
  const p = new Uint8Array(512), base = Array.from({ length: 256 }, (_, i) => i);
  let s = seed >>> 0 || 1;
  for (let i = 255; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const j = s % (i + 1);
    [base[i], base[j]] = [base[j], base[i]];
  }
  for (let i = 0; i < 512; i++) p[i] = base[i & 255];
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  const dot = (g, x, y, z) => g[0] * x + g[1] * y + g[2] * z;

  /** Perlin noise in [-1, 1]-ish. */
  function noise3(x, y, z) {
    const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
    x -= X; y -= Y; z -= Z;
    const xi = X & 255, yi = Y & 255, zi = Z & 255;
    const u = fade(x), v = fade(y), w = fade(z);
    const A = p[xi] + yi, AA = p[A] + zi, AB = p[A + 1] + zi;
    const B = p[xi + 1] + yi, BA = p[B] + zi, BB = p[B + 1] + zi;
    const l = (a, b, t) => a + t * (b - a);
    return l(
      l(l(dot(G[p[AA] % 12], x, y, z), dot(G[p[BA] % 12], x - 1, y, z), u),
        l(dot(G[p[AB] % 12], x, y - 1, z), dot(G[p[BB] % 12], x - 1, y - 1, z), u), v),
      l(l(dot(G[p[AA + 1] % 12], x, y, z - 1), dot(G[p[BA + 1] % 12], x - 1, y, z - 1), u),
        l(dot(G[p[AB + 1] % 12], x, y - 1, z - 1), dot(G[p[BB + 1] % 12], x - 1, y - 1, z - 1), u), v), w);
  }

  /** Curl of a scalar noise potential: a divergence-free 2D velocity, written into out[0..1]. */
  function curl2(x, y, t, out) {
    const e = 0.01;
    const dx = (noise3(x + e, y, t) - noise3(x - e, y, t)) / (2 * e);
    const dy = (noise3(x, y + e, t) - noise3(x, y - e, t)) / (2 * e);
    out[0] = dy; out[1] = -dx;
    return out;
  }
  return { noise3, curl2 };
}
