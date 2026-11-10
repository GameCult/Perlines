// Onset detector bench: synthesises drum patterns with known onset times, runs a detector over them at the
// page's 30 fps feature rate and at full rate (512-sample hop), and scores hit rate, false positives and timing.
// Deterministic (fixed LCG seeds), no network, no dependencies.   node web/tools/onset-bench.mjs [variant ...]
// SYNTHETIC ONLY: nothing here has been listened to, and a score here says nothing about real music.
import { magnitudeSpectrum, OnsetDetector } from '../src/dsp.js';
import { LegacyOnsetDetector } from './onset-legacy.mjs';

export const SR = 48000, FFT = 2048;
export const RATES = { fps30: Math.round(SR / 30), full: 512 };   // hop in samples
const LEAD = 1.0, DURATION = 14, SCORE_FROM = 0.6;              // seconds
const MATCH_EARLY = 0.02, MATCH_LATE = 0.09;                      // a frame at time T (window end) matches an onset at t if t-0.02 <= T <= t+0.09

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1; }

// 16 steps per bar. kick/snare/hat step lists.
export const PATTERNS = {
  rock: { kick: [0, 8, 10], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14] },
  four: { kick: [0, 4, 8, 12], snare: [4, 12], hat: [2, 6, 10, 14] },
  busy: { kick: [0, 3, 6, 10, 13], snare: [4, 12], hat: Array.from({ length: 16 }, (_, i) => i) },
};
export const BEDS = { none: { bass: 0, noise: 0 }, bed: { bass: 0.2, noise: 0.02 }, loud: { bass: 0.4, noise: 0.08 } };
export const LEVELS = { '0dB': 1, '-20dB': 0.1, '-40dB': 0.01 };
export const TEMPOS = [90, 120, 150];

// every voice ends with a 60 ms linear fade so a truncated tail cannot click and read as an onset
const taper = (i, n) => Math.min(1, (n - i) / (0.06 * SR));
function addKick(x, s, r) {
  let ph = 0; const n = Math.round(0.5 * SR);
  for (let i = 0; i < n && s + i < x.length; i++) {
    const t = i / SR; ph += 2 * Math.PI * (45 + 90 * Math.exp(-t / 0.03)) / SR;
    x[s + i] += taper(i, n) * 0.9 * Math.exp(-t / 0.12) * Math.sin(ph);
  }
}
function addSnare(x, s, r) {
  const n = Math.round(0.4 * SR); let p = 0;
  for (let i = 0; i < n && s + i < x.length; i++) {
    const t = i / SR, w = r(), hp = w - p; p = w;
    x[s + i] += taper(i, n) * (0.3 * Math.exp(-t / 0.06) * Math.sin(2 * Math.PI * 185 * t) + 0.5 * Math.exp(-t / 0.09) * hp * 0.7);
  }
}
function addHat(x, s, r, amp) {
  const n = Math.round(0.15 * SR); let p1 = 0, p2 = 0;
  for (let i = 0; i < n && s + i < x.length; i++) {
    const t = i / SR, w = r(), a = w - p1, b = a - p2; p1 = w; p2 = a;
    x[s + i] += taper(i, n) * amp * Math.exp(-t / 0.025) * b * 0.5;
  }
}

/** -> { x: Float32Array, truth: [{ time, inst }] } */
export function synthesize({ pattern, bpm, level, bed, seed = 1 }) {
  const x = new Float32Array(DURATION * SR), r = rng(seed), P = PATTERNS[pattern], B = BEDS[bed];
  const step = 60 / bpm / 4, truth = [];
  const place = (inst, k, fn, ...a) => { const t = LEAD + k * step; truth.push({ time: t, inst }); fn(x, Math.round(t * SR), r, ...a); };
  for (let bar = 0, k0 = 0; LEAD + k0 * step < DURATION - 0.4; bar++, k0 += 16) {
    for (const s of P.kick) if (LEAD + (k0 + s) * step < DURATION - 0.4) place('kick', k0 + s, addKick);
    for (const s of P.snare) if (LEAD + (k0 + s) * step < DURATION - 0.4) place('snare', k0 + s, addSnare);
    for (const s of P.hat) if (LEAD + (k0 + s) * step < DURATION - 0.4) place('hat', k0 + s, addHat, s % 4 === 0 ? 0.7 : 0.4);
  }
  // beds: a bass drone that glides between notes (no onsets) and pink-ish noise, faded in over 0.3 s
  const notes = [55, 55, 65.4, 49], rb = rng(seed + 100);
  let ph = 0, f = 55, pink = 0;
  for (let i = 0; i < x.length; i++) {
    const t = i / SR, target = notes[Math.floor(t / 2) % notes.length];
    f += (target - f) * (1 - Math.exp(-1 / (0.3 * SR)));
    ph += 2 * Math.PI * f / SR;
    const fade = Math.min(1, t / 0.3), trem = 0.85 + 0.15 * Math.sin(2 * Math.PI * 0.25 * t);
    pink = 0.98 * pink + 0.1 * rb();
    x[i] += fade * (B.bass * trem * (Math.sin(ph) + 0.4 * Math.sin(2 * ph)) + B.noise * pink * 3);
  }
  const rf = rng(seed + 200);
  for (let i = 0; i < x.length; i++) x[i] = x[i] * level + rf() * 1e-5;   // dither floor, ~ -100 dBFS
  return { x, truth };
}

/** Magnitude frames the way AnalyserNode hands them over: window ends at 'time', values round-trip through dB clamped at -120. */
export function spectra(x, hop) {
  const frames = [], mags = new Float32Array(FFT >> 1);
  for (let off = 0; off + FFT <= x.length; off += hop) {
    magnitudeSpectrum(x, off, FFT, mags);
    const m = new Float32Array(mags.length);
    for (let k = 0; k < m.length; k++) m[k] = Math.pow(10, Math.max(20 * Math.log10(mags[k] + 1e-12), -120) / 20);
    frames.push({ time: (off + FFT) / SR, mags: m });
  }
  return frames;
}

/** Coincident hits (a kick and a snare on one step) are one onset: a detector emits one event per moment.
 *  Greedy one-to-one match in time order; each onset takes the earliest unused detection in its window.
 *  Per-instrument rows count an instrument as hit when the event it sounds in was hit. */
export function score(truth, found) {
  const events = [];
  for (const t of truth.slice().sort((p, q) => p.time - q.time)) {
    const e = events[events.length - 1];
    if (e && t.time - e.time < 0.005) e.insts.push(t.inst); else events.push({ time: t.time, insts: [t.inst] });
  }
  const used = new Set(), errs = [], per = {};
  let n = 0;
  for (const e of events) {
    if (e.time < SCORE_FROM) continue;
    n++;
    const i = found.findIndex((f, j) => !used.has(j) && f >= e.time - MATCH_EARLY && f <= e.time + MATCH_LATE);
    if (i >= 0) { used.add(i); errs.push(found[i] - e.time); }
    for (const inst of e.insts) { const p = per[inst] ??= { n: 0, hit: 0 }; p.n++; if (i >= 0) p.hit++; }
  }
  return { n, hit: errs.length, fp: found.filter((f, j) => !used.has(j) && f >= SCORE_FROM).length, errs, per };
}

export function detect(make, frames) {
  const det = make(), out = [];
  for (const fr of frames) { const o = det.push(fr.mags, fr.time); if (o) out.push(o.time); }
  return out;
}

export function corpus() {
  const cases = [];
  for (const pattern of Object.keys(PATTERNS)) for (const bpm of TEMPOS) for (const [lv, level] of Object.entries(LEVELS)) for (const bed of Object.keys(BEDS))
    cases.push({ pattern, bpm, lv, level, bed, seed: cases.length + 1 });
  return cases;
}

// detector as Analysis builds it: bins up to 8 kHz
const maxBin = Math.round(8000 / (SR / 2 / (FFT / 2)));   // what the legacy Analysis passed
export const VARIANTS = {
  legacy: () => new LegacyOnsetDetector({ maxBin }),
  current: () => new OnsetDetector({ binHz: SR / FFT }),
};

const median = a => { if (!a.length) return NaN; const s = a.slice().sort((p, q) => p - q); return s[s.length >> 1]; };

/** run variants over the corpus -> { [variant]: { [rate]: { n, hit, fp, minutes, medianMs, byInst, byBed, byLevel } } } */
export function run(variantNames = Object.keys(VARIANTS), cases = corpus()) {
  const acc = {};
  for (const v of variantNames) { acc[v] = {}; for (const r of Object.keys(RATES)) acc[v][r] = { n: 0, hit: 0, fp: 0, seconds: 0, errs: [], inst: {}, bed: {}, lv: {} }; }
  for (const c of cases) {
    const { x, truth } = synthesize(c);
    for (const [rate, hop] of Object.entries(RATES)) {
      const frames = spectra(x, hop);
      for (const v of variantNames) {
        const s = score(truth, detect(VARIANTS[v], frames)), a = acc[v][rate];
        a.n += s.n; a.hit += s.hit; a.fp += s.fp; a.seconds += DURATION - SCORE_FROM; a.errs.push(...s.errs);
        for (const [k, p] of Object.entries(s.per)) { const q = a.inst[k] ??= { n: 0, hit: 0 }; q.n += p.n; q.hit += p.hit; }
        for (const key of ['bed', 'lv']) { const q = a[key][c[key]] ??= { n: 0, hit: 0, fp: 0 }; q.n += s.n; q.hit += s.hit; q.fp += s.fp; }
      }
    }
  }
  const out = {};
  for (const v of variantNames) { out[v] = {}; for (const [r, a] of Object.entries(acc[v])) out[v][r] = { ...a, hitRate: a.hit / a.n, fpPerMin: a.fp / (a.seconds / 60), medianMs: median(a.errs) * 1000 }; }
  return out;
}

const pct = (h, n) => (100 * h / n).toFixed(1).padStart(5) + '%';
export function report(res) {
  const lines = [];
  for (const [v, rates] of Object.entries(res)) for (const [r, a] of Object.entries(rates)) {
    const i = Object.entries(a.inst).map(([k, p]) => `${k} ${pct(p.hit, p.n)}`).join('  ');
    const b = Object.entries(a.bed).map(([k, p]) => `${k} ${pct(p.hit, p.n)}/${p.fp}fp`).join('  ');
    const l = Object.entries(a.lv).map(([k, p]) => `${k} ${pct(p.hit, p.n)}/${p.fp}fp`).join('  ');
    lines.push(`${v.padEnd(9)} ${r.padEnd(5)} hit ${pct(a.hit, a.n)} (${a.hit}/${a.n})  fp ${a.fp} (${a.fpPerMin.toFixed(1)}/min)  median err ${a.medianMs.toFixed(1)} ms`);
    lines.push(`          by instrument: ${i}`, `          by bed: ${b}`, `          by level: ${l}`);
  }
  return lines.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(VARIANTS);
  const cs = corpus();
  console.log(`corpus: ${cs.length} signals x ${DURATION} s, ${Object.keys(RATES).map(r => `${r}=hop ${RATES[r]}`).join(', ')}, SR ${SR}, FFT ${FFT}; match window -${MATCH_EARLY * 1000}..+${MATCH_LATE * 1000} ms of window end`);
  console.log(report(run(names, cs)));
}
