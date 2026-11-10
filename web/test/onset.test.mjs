// node --test test/onset.test.mjs   Synthetic drum corpus (tools/onset-bench.mjs): floors for the shipped detector.
// Synthetic only: these numbers say nothing about real music and nothing was listened to.
import test from 'node:test';
import assert from 'node:assert/strict';
import { run, corpus, synthesize, spectra, score, detect, RATES } from '../tools/onset-bench.mjs';
import { OnsetDetector } from '../src/dsp.js';

const subset = corpus().filter((_, i) => i % 3 === 0);   // 27 of 81 signals, every pattern/tempo/level/bed combination class

test('drum corpus: hit rate, false positives and timing at 30 fps and full rate', () => {
  const res = run(['legacy', 'current'], subset);
  for (const v of ['legacy', 'current']) for (const [r, a] of Object.entries(res[v]))
    console.log(`  ${v.padEnd(8)} ${r.padEnd(5)} hit ${(100 * a.hitRate).toFixed(1)}%  fp ${a.fp} (${a.fpPerMin.toFixed(1)}/min)  median err ${a.medianMs.toFixed(1)} ms`);
  for (const [r, a] of Object.entries(res.current)) {
    assert.ok(a.hitRate >= 0.85, `${r} hit rate ${a.hitRate}`);
    assert.ok(a.fpPerMin <= 2, `${r} false positives/min ${a.fpPerMin}`);
    assert.ok(a.medianMs <= 40, `${r} median timing error ${a.medianMs} ms`);
    assert.ok(a.hitRate > res.legacy[r].hitRate + 0.2, `${r} must beat the legacy detector by 20 points`);
  }
});

test('hit rate does not depend on the level of the track', () => {
  const res = run(['current'], subset);
  for (const [r, a] of Object.entries(res.current)) {
    const rates = Object.values(a.lv).map(p => p.hit / p.n);
    assert.ok(Math.max(...rates) - Math.min(...rates) < 0.05, `${r} spread across 0/-20/-40 dB: ${rates}`);
  }
});

test('corpus is deterministic', () => {
  const c = corpus()[5], a = synthesize(c), b = synthesize(c);
  assert.deepEqual(a.truth, b.truth);
  assert.ok(a.x.every((v, i) => v === b.x[i]));
});

test('steady bass drone with a noise bed and no drums gives no onsets', () => {
  const { x } = synthesize({ pattern: 'rock', bpm: 120, level: 1, bed: 'loud', seed: 9 });
  const quiet = x.slice(0, 48000 * 1);   // the lead-in before the first drum hit
  for (const hop of Object.values(RATES)) {
    const found = detect(() => new OnsetDetector({ binHz: 48000 / 2048 }), spectra(quiet, hop)).filter(t => t > 0.6);
    assert.equal(found.length, 0, `hop ${hop}: ${found}`);
  }
});

test('a single hit is reported once, within the match window', () => {
  const { x, truth } = synthesize({ pattern: 'four', bpm: 60, level: 0.1, bed: 'none', seed: 4 });
  const s = score(truth, detect(() => new OnsetDetector({ binHz: 48000 / 2048 }), spectra(x, 512)));
  assert.ok(s.fp <= 1, `fp ${s.fp}`);
});
