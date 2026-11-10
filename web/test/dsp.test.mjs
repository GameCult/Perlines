// node --test web/test   (node >= 20). Synthetic-signal checks of the onset detector and key estimate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { magnitudeSpectrum, OnsetDetector, KeyEstimator } from '../src/dsp.js';

const SR = 44100, FFT = 2048;

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1; }

function clickTrack(times, seconds, noiseAmp = 0.003) {
  const x = new Float32Array(Math.ceil(seconds * SR)), r = rng(7);
  for (let i = 0; i < x.length; i++) x[i] = r() * noiseAmp;
  for (const t of times) {
    const s = Math.round(t * SR);
    for (let i = 0; i < 900 && s + i < x.length; i++) x[s + i] += r() * 0.8 * Math.exp(-i / 180);
  }
  return x;
}

function detect(x, hopSec, opts) {
  const det = new OnsetDetector(opts), hop = Math.round(hopSec * SR), found = [];
  const mags = new Float32Array(FFT >> 1);
  for (let off = 0; off + FFT <= x.length; off += hop) {
    magnitudeSpectrum(x, off, FFT, mags);
    // the analyser window ends at "now", so a frame's time is its window end, like AnalyserNode
    const o = det.push(mags, (off + FFT) / SR);
    if (o) found.push(o.time);
  }
  return found;
}

function score(truth, found, tol) {
  // an onset in the window ending at time T is visible from T-FFT/SR .. T; allow that window plus tol
  const used = new Set(); let hit = 0;
  for (const t of truth) {
    const i = found.findIndex((f, j) => !used.has(j) && f >= t - tol && f <= t + FFT / SR + tol);
    if (i >= 0) { used.add(i); hit++; }
  }
  return { recall: hit / truth.length, falsePositives: found.length - used.size };
}

const TRUTH = [0.5, 1.0, 1.4, 2.1, 2.6, 3.3, 3.8, 4.6, 5.0, 5.7];

for (const hop of [512 / SR, 1 / 60]) {
  test(`clicks found at hop ${(hop * 1000).toFixed(1)} ms`, () => {
    const x = clickTrack(TRUTH, 6.5);
    const found = detect(x, hop);
    const s = score(TRUTH, found, 0.03);
    console.log(`  hop ${(hop * 1000).toFixed(1)}ms: recall ${s.recall}, false positives ${s.falsePositives}, found ${found.length}/${TRUTH.length}`);
    assert.ok(s.recall >= 0.9, `recall ${s.recall}`);
    assert.ok(s.falsePositives <= 1, `false positives ${s.falsePositives}`);
  });
}

test('silence and steady noise give no onsets', () => {
  assert.equal(detect(new Float32Array(SR * 4), 1 / 60).length, 0);
  const r = rng(3), x = new Float32Array(SR * 4).map(() => r() * 0.1);
  assert.equal(detect(x, 1 / 60).length, 0);
});

test('a sustained tone does not retrigger', () => {
  const x = new Float32Array(SR * 4).map((_, i) => 0.3 * Math.sin(2 * Math.PI * 440 * i / SR));
  assert.ok(detect(x, 1 / 60).length <= 1);   // the very first rise may count once
});

test('refractory period merges a doublet 20 ms apart', () => {
  const x = clickTrack([0.5, 1.5, 2.5, 3.0, 3.02], 4.5);
  const found = detect(x, 512 / SR).filter(t => t > 2.9 && t < 3.4);
  assert.equal(found.length, 1);
});

function chord(midis, seconds) {
  const x = new Float32Array(Math.ceil(seconds * SR));
  for (const m of midis) {
    const f = 440 * 2 ** ((m - 69) / 12);
    for (let h = 1; h <= 4; h++) for (let i = 0; i < x.length; i++) x[i] += Math.sin(2 * Math.PI * f * h * i / SR) * 0.1 / h;
  }
  return x;
}

function keyOf(x) {
  const k = new KeyEstimator(SR, FFT >> 1), mags = new Float32Array(FFT >> 1), hop = 735;
  for (let off = 0; off + FFT <= x.length; off += hop) { magnitudeSpectrum(x, off, FFT, mags); k.push(mags, hop / SR); }
  return k.key;
}

test('key: C major scale-ish progression reads C major', () => {
  // C-F-G-C triads, then lingering C major
  const parts = [[60, 64, 67], [65, 69, 72], [67, 71, 74], [60, 64, 67], [60, 64, 67]];
  const x = new Float32Array(SR * 15);
  parts.forEach((p, i) => x.set(chord(p, 3), i * 3 * SR));
  const k = keyOf(x);
  assert.equal(k.name, 'C');
  assert.ok(k.confidence > 0.2, `confidence ${k.confidence}`);
});

test('key: A minor progression reads A minor, and key tracks a transposition', () => {
  // i - iv - i - V - i - i: the E major chord's G# is the leading tone that separates A minor from C major
  const am = [[57, 60, 64], [62, 65, 69], [57, 60, 64], [64, 68, 71], [57, 60, 64], [57, 60, 64]];
  const x = new Float32Array(SR * 18);
  am.forEach((p, i) => x.set(chord(p, 3), i * 3 * SR));
  assert.equal(keyOf(x).name, 'Am');
  const up = am.map(p => p.map(m => m + 2));      // B minor
  const y = new Float32Array(SR * 18);
  up.forEach((p, i) => y.set(chord(p, 3), i * 3 * SR));
  assert.equal(keyOf(y).name, 'Bm');
});
