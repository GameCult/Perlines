// Turns a frame of dB spectrum into the shared state every scene reads: log-spaced smoothed bands,
// band levels, onset events, chroma, key and the tint colour derived from the key.
import { dbToLinear, OnsetDetector, KeyEstimator } from './dsp.js';

export const NB = 128;          // log-spaced display bands
export const HIST = 128;        // history rows (spectrum texture height)

function hslToRgb(h, s, l) {
  const f = n => { const k = (n + h * 12) % 12, a = s * Math.min(l, 1 - l); return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return [f(0), f(8), f(4)];
}

export class Analysis {
  constructor(sampleRate, binCount) {
    this.sampleRate = sampleRate; this.binCount = binCount;
    this.lin = new Float32Array(binCount);
    this.onsets = new OnsetDetector({ maxBin: Math.min(binCount, Math.round(8000 / (sampleRate / 2 / binCount))) });
    this.keyEst = new KeyEstimator(sampleRate, binCount);
    this.bands = new Float32Array(NB);
    this.row = new Uint8Array(NB);            // newest row, as texture bytes
    this.bass = 0; this.mid = 0; this.treble = 0; this.level = 0;
    this.onset = { count: 0, strength: 0, time: -1 };   // count increments per onset; scenes diff it
    this.flux = 0;
    this.key = this.keyEst.key;
    this.hue = 0.6; this.tint = hslToRgb(0.6, 0.7, 0.55);
    this.time = 0; this.dt = 1 / 60;
    // band -> bin edges, log spaced 40 Hz .. 16 kHz
    const hz = sampleRate / 2 / binCount, lo = 40, hi = Math.min(16000, sampleRate / 2 - hz);
    this.edges = Array.from({ length: NB + 1 }, (_, i) => Math.min(binCount - 1, Math.round(lo * Math.pow(hi / lo, i / NB) / hz)));
  }

  /** db: Float32Array in decibels (AnalyserNode.getFloatFrequencyData); t: seconds. */
  update(db, t) {
    const dt = Math.min(0.1, Math.max(1e-3, t - this.time || 1 / 60));
    this.time = t; this.dt = dt;
    const lin = dbToLinear(db, this.lin);

    const o = this.onsets.push(lin, t);
    this.flux = this.onsets.flux;
    if (o) { this.onset.count++; this.onset.strength = o.strength; this.onset.time = t; }

    // bands: peak of dB inside each band, mapped -90..-25 dB to 0..1, fast attack / slow release
    let b = 0, m = 0, tr = 0, nb = 0, nm = 0, nt = 0;
    for (let i = 0; i < NB; i++) {
      const a = this.edges[i], z = Math.max(a + 1, this.edges[i + 1]);
      let pk = -160;
      for (let k = a; k < z; k++) if (db[k] > pk) pk = db[k];
      const v = Math.max(0, Math.min(1, (pk + 90) / 65));
      const cur = this.bands[i];
      this.bands[i] = v > cur ? cur + (v - cur) * 0.8 : cur + (v - cur) * (1 - Math.pow(0.02, dt));
      this.row[i] = Math.round(this.bands[i] * 255);
      if (i < NB * 0.2) { b += this.bands[i]; nb++; } else if (i < NB * 0.6) { m += this.bands[i]; nm++; } else { tr += this.bands[i]; nt++; }
    }
    this.bass = b / nb; this.mid = m / nm; this.treble = tr / nt;
    this.level = (this.bass + this.mid + this.treble) / 3;

    const key = this.keyEst.push(lin, dt);
    this.key = key;
    // tint: hue walks the circle of fifths so related keys sit near each other; confidence gates the move
    const target = ((key.tonic * 7) % 12) / 12;
    let d = target - this.hue; d -= Math.round(d);
    this.hue = (this.hue + d * Math.min(1, dt * (0.15 + key.confidence * 0.8)) + 1) % 1;
    const major = key.mode === 'major';
    this.tint = hslToRgb(this.hue, major ? 0.8 : 0.6, major ? 0.58 : 0.5);
    return this;
  }
}

/** Synthetic spectrum for demo mode and benchmarks: a 120 bpm kick/hat pattern over an A-minor pad. */
export class DemoFeed {
  constructor(sampleRate, binCount) { this.sr = sampleRate; this.n = binCount; this.db = new Float32Array(binCount); }
  frame(t) {
    const { db, n, sr } = this, hz = sr / 2 / n, beat = 0.5;
    const ph = t % beat, kick = Math.exp(-ph * 9), hat = Math.exp(-((t + beat / 2) % beat) * 40) * ((Math.floor(t / (beat / 2)) % 2) ? 1 : 0.4);
    const snare = Math.floor(t / beat) % 2 ? Math.exp(-ph * 14) : 0;
    const chord = [220, 261.63, 329.63, 440, 523.25, 659.25];
    for (let k = 0; k < n; k++) {
      const f = k * hz + 1;
      let v = -105 + 12 * Math.sin(k * 12.9898 + t * 3) * 0.3;
      v += 78 * kick * Math.exp(-Math.pow(Math.log2(f / 55), 2) * 1.5);
      v += 62 * snare * Math.exp(-Math.pow(Math.log2(f / 1800), 2) * 0.35);
      v += 55 * hat * Math.exp(-Math.pow(Math.log2(f / 9000), 2) * 0.5);
      for (const c of chord) v += 55 * Math.exp(-Math.pow((f - c) / (hz * 0.8 + c * 0.01), 2));
      db[k] = v;
    }
    return db;
  }
}
