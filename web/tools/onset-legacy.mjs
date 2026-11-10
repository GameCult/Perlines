// Frozen copy of the v2 onset detector as of commit f53a0d1, kept only so tools/onset-bench.mjs can reproduce the 'before' numbers.
// Not imported by the page. Delete when the baseline stops being interesting.

export class LegacyOnsetDetector {
  constructor(opts = {}) {
    this.compress = opts.compress ?? 200;       // log(1 + compress * mag)
    this.window = opts.window ?? 43;            // median history, frames
    this.delta = opts.delta ?? 0.08;            // absolute floor above the median, in flux units
    this.ratio = opts.ratio ?? 1.6;             // and the flux must exceed ratio * median
    this.refractory = opts.refractory ?? 0.06;  // seconds
    this.minBin = opts.minBin ?? 2;
    this.maxBin = opts.maxBin ?? 0;             // 0 = all bins
    this.bands = opts.bands ?? 6;               // log-spaced flux bands between minBin and maxBin
    this.edges = null;
    this.prev = null;
    this.hist = [];                             // recent flux values
    this.f1 = 0; this.f2 = 0; this.t1 = 0;     // flux[n-1], flux[n-2], time[n-1]
    this.last = -1e9;
    this.flux = 0;                              // latest raw flux, for display
  }

  push(mags, t) {
    const n = this.maxBin || mags.length;
    if (!this.edges) {
      this.edges = Array.from({ length: this.bands + 1 }, (_, i) => Math.round(this.minBin * Math.pow(n / this.minBin, i / this.bands)));
      for (let i = 1; i < this.edges.length; i++) this.edges[i] = Math.max(this.edges[i], this.edges[i - 1] + 1);
    }
    const cur = new Float32Array(n);
    for (let k = 0; k < n; k++) cur[k] = Math.log1p(this.compress * mags[k]);
    let flux = 0;
    if (this.prev) {
      const p = this.prev;
      // flux per log-spaced band, each divided by sqrt(its width): a kick (a few bass bins) then counts
      // as much as a hat (hundreds of treble bins), which one whole-spectrum sum would bury
      for (let b = 0; b < this.edges.length - 1; b++) {
        let bf = 0;
        for (let k = this.edges[b]; k < this.edges[b + 1]; k++) {
          const ref = Math.max(p[k - 1] ?? 0, p[k], p[k + 1] ?? 0);
          const d = cur[k] - ref;
          if (d > 0) bf += d;
        }
        flux += bf / Math.sqrt(this.edges[b + 1] - this.edges[b]);
      }
      flux /= this.edges.length - 1;
    }
    this.prev = cur;
    this.flux = flux;

    // candidate is the previous frame: f1 must be a local maximum over f2 and the new flux
    let out = null;
    const cand = this.f1;
    if (this.hist.length >= 8 && cand > this.f2 && cand >= flux) {
      const sorted = this.hist.slice().sort((a, b) => a - b);
      const med = sorted[sorted.length >> 1];
      if (cand > med * this.ratio + this.delta && this.t1 - this.last >= this.refractory) {
        out = { time: this.t1, strength: Math.min(1, (cand - med) / (cand + 1e-6) * 1.5) };
        this.last = this.t1;
      }
    }
    this.hist.push(flux);
    if (this.hist.length > this.window) this.hist.shift();
    this.f2 = this.f1; this.f1 = flux; this.t1 = t;
    return out;
  }
}
