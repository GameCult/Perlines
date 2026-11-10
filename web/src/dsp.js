// Perlines v2 analysis: FFT, onset detector, chroma + key estimate.
// Pure ES module, no DOM, no dependencies: the browser and the node tests load the same file.
// Written from the published ideas (spectral flux with a max-filtered reference, adaptive
// median threshold, Krumhansl-Schmuckler key profiles), not from any GPL implementation.

/** In-place radix-2 complex FFT. re/im are Float32Array|Float64Array of power-of-two length. */
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len >> 1; k++) {
        const a = i + k, b = a + (len >> 1);
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

/** Hann-windowed magnitude spectrum (n/2 bins, scaled so a full-scale sine reads ~0.5). */
export function magnitudeSpectrum(samples, offset, n, out) {
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1));
    re[i] = (samples[offset + i] || 0) * w;
  }
  fft(re, im);
  const m = out || new Float32Array(n >> 1);
  for (let k = 0; k < n >> 1; k++) m[k] = Math.hypot(re[k], im[k]) * 2 / n;
  return m;
}

/** Decibel array (as WebAudio getFloatFrequencyData gives) to linear magnitude, in place into out. */
export function dbToLinear(db, out) {
  for (let i = 0; i < db.length; i++) out[i] = Math.pow(10, Math.max(db[i], -160) / 20);
  return out;
}

/**
 * Onset detector: band-split spectral flux in decibels. Each band has its own flux (mean positive dB rise
 * against a max-filtered previous frame, which ignores vibrato wobble) and its own adaptive threshold
 * (median + k * MAD over the last second), so a hat is judged against the hats and a kick against the
 * kick, and the level of the track does not matter. Causal: a flux peak on frame n-1 is confirmed when
 * frame n arrives. Bands are merged behind one refractory period.
 *
 * push(mags, t) -> null | { time, strength, band }   (time = the onset frame's own timestamp, seconds)
 */
export class OnsetDetector {
  constructor(opts = {}) {
    this.binHz = opts.binHz ?? 48000 / 2048;
    this.edgesHz = opts.edgesHz ?? [40, 150, 600, 2500, 12000];
    this.maxBin = opts.maxBin ?? 0;             // 0 = all bins
    this.floorDb = opts.floorDb ?? -110;        // magnitudes below this are silence
    this.history = opts.history ?? 1.0;         // seconds of flux per band for the threshold
    this.k = opts.k ?? 8;                       // threshold = median + k * MAD (MAD scaled to sigma)
    this.minRise = opts.minRise ?? [6, 3, 2, 2]; // and at least this many dB mean rise in the band (per band: the few bass bins are noisy)
    this.refractory = opts.refractory ?? 0.05;  // seconds, all bands
    this.edges = null;
    this.lag = opts.lag ?? 2;                   // reference = per-bin max over this many previous frames (1 or 2)
    this.prev = null; this.prev2 = null;
    this.hist = null;                           // per band: { t[], f[] }
    this.f1 = null; this.f2 = null; this.t1 = 0; // per band flux[n-1], flux[n-2], time[n-1]
    this.last = -1e9;
    this.flux = 0;                              // largest band flux this frame, for display
  }

  push(mags, t) {
    const n = Math.min(this.maxBin || mags.length, mags.length);
    if (!this.edges) {
      this.edges = this.edgesHz.map(h => Math.min(n, Math.max(1, Math.round(h / this.binHz))));
      for (let i = 1; i < this.edges.length; i++) this.edges[i] = Math.min(n, Math.max(this.edges[i], this.edges[i - 1] + 1));
      const nb = this.edges.length - 1;
      this.hist = Array.from({ length: nb }, () => ({ t: [], f: [] }));
      this.f1 = new Float64Array(nb); this.f2 = new Float64Array(nb);
    }
    const nb = this.edges.length - 1, lo = Math.pow(10, this.floorDb / 20);
    const cur = new Float32Array(n);
    for (let k = 0; k < n; k++) cur[k] = 20 * Math.log10(Math.max(mags[k], lo));
    const flux = new Float64Array(nb);
    if (this.prev) {
      const p = this.prev, q = this.lag > 1 ? this.prev2 : null;
      for (let b = 0; b < nb; b++) {
        const a = this.edges[b], z = this.edges[b + 1];
        let sum = 0;
        for (let k = a; k < z; k++) {
          let ref = Math.max(p[k - 1] ?? this.floorDb, p[k], p[k + 1] ?? this.floorDb);
          if (q) ref = Math.max(ref, q[k - 1] ?? this.floorDb, q[k], q[k + 1] ?? this.floorDb);
          const d = cur[k] - ref;
          if (d > 0) sum += d;
        }
        flux[b] = sum / (z - a);
      }
    }
    this.prev2 = this.prev; this.prev = cur;
    this.flux = Math.max(...flux);

    // per band: the previous frame is a candidate when it is a local flux maximum over the threshold
    let best = null;
    for (let b = 0; b < nb; b++) {
      const h = this.hist[b], cand = this.f1[b];
      if (h.f.length >= 8 && cand > this.f2[b] && cand >= flux[b] && cand >= this.minRise[b]) {
        const sorted = h.f.slice().sort((x, y) => x - y), med = sorted[sorted.length >> 1];
        const dev = h.f.map(v => Math.abs(v - med)).sort((x, y) => x - y), mad = dev[dev.length >> 1] * 1.4826;
        if (cand > med + this.k * mad && (!best || cand > best.flux)) best = { flux: cand, band: b };
      }
      h.t.push(t); h.f.push(flux[b]);
      while (h.t.length > 2 && t - h.t[0] > this.history) { h.t.shift(); h.f.shift(); }
    }
    let out = null;
    if (best && this.t1 - this.last >= this.refractory) {
      out = { time: this.t1, strength: Math.min(1, best.flux / 15), band: best.band };
      this.last = this.t1;
    }
    this.f2.set(this.f1); this.f1.set(flux); this.t1 = t;
    return out;
  }
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export { NOTE_NAMES };
// Krumhansl-Kessler probe-tone profiles (published psychology data).
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function corr(a, b, rot) {
  let ma = 0, mb = 0;
  for (let i = 0; i < 12; i++) { ma += a[(i + rot) % 12]; mb += b[i]; }
  ma /= 12; mb /= 12;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < 12; i++) {
    const x = a[(i + rot) % 12] - ma, y = b[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  return da > 1e-12 && db > 1e-12 ? num / Math.sqrt(da * db) : 0;
}

/**
 * Chroma accumulator + key estimate. Each frame folds spectral peaks between lowHz and highHz into
 * 12 pitch classes, a slow exponential average (halfLife seconds) smooths them, and the key is the
 * best of 24 rotations of the Krumhansl profiles by correlation.
 */
export class KeyEstimator {
  constructor(sampleRate, binCount, opts = {}) {
    this.halfLife = opts.halfLife ?? 4;
    this.lowHz = opts.lowHz ?? 80;
    this.highHz = opts.highHz ?? 2000;
    this.chroma = new Float32Array(12);
    this.key = { tonic: 0, mode: 'major', confidence: 0, name: 'C' };
    this.hzPerBin = sampleRate / 2 / binCount;
    this.lo = Math.max(2, Math.floor(this.lowHz / this.hzPerBin));
    this.hi = Math.min(binCount - 2, Math.ceil(this.highHz / this.hzPerBin));
  }

  // Peak-based: bins are wider than a semitone below ~250 Hz, so each spectral peak is refined by
  // parabolic interpolation and its energy goes to the pitch class of the refined frequency.
  push(mags, dt) {
    const frame = new Float32Array(12);
    let top = 0;
    for (let k = this.lo; k <= this.hi; k++) if (mags[k] > top) top = mags[k];
    const floor = top * 0.05;
    for (let k = this.lo; k <= this.hi; k++) {
      const m = mags[k];
      if (m < floor || m < 1e-5 || m < mags[k - 1] || m <= mags[k + 1]) continue;
      const a = Math.log(mags[k - 1] + 1e-9), b = Math.log(m + 1e-9), c = Math.log(mags[k + 1] + 1e-9);
      const d = 0.5 * (a - c) / (a - 2 * b + c);
      const midi = 69 + 12 * Math.log2((k + d) * this.hzPerBin / 440);
      const near = Math.round(midi);
      frame[((near % 12) + 12) % 12] += Math.sqrt(m) * (1 - Math.min(0.5, Math.abs(midi - near)));   // sqrt tames loud-bass dominance
    }
    const a = Math.pow(0.5, dt / this.halfLife);
    for (let i = 0; i < 12; i++) this.chroma[i] = this.chroma[i] * a + frame[i] * (1 - a);
    this.key = this.estimate();
    return this.key;
  }

  estimate() {
    let best = { tonic: 0, mode: 'major', score: -2 }, second = -2;
    for (let r = 0; r < 12; r++) {
      for (const [mode, prof] of [['major', MAJOR], ['minor', MINOR]]) {
        const s = corr(this.chroma, prof, r);
        if (s > best.score) { second = best.score; best = { tonic: r, mode, score: s }; }
        else if (s > second) second = s;
      }
    }
    const energy = this.chroma.reduce((x, y) => x + y, 0);
    const confidence = energy < 1e-4 ? 0 : Math.max(0, Math.min(1, (best.score - second) * 4 + best.score * 0.3));
    return { tonic: best.tonic, mode: best.mode, confidence, name: NOTE_NAMES[best.tonic] + (best.mode === 'minor' ? 'm' : '') };
  }
}
