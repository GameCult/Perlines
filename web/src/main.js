import { AudioInput } from './audio.js';
import { Analysis, DemoFeed, NB, HIST } from './analysis.js';
import { Feedback } from './gl.js';
import { AuroraDisk } from './scenes/aurora.js';
import { BurningWater } from './scenes/water.js';
import { VectorTrails } from './scenes/trails.js';

const q = new URLSearchParams(location.search);
const $ = id => document.getElementById(id);
const canvas = $('c'), hudEl = $('hud'), msg = $('msg'), ui = $('ui');
const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
if (!gl) { msg.textContent = 'WebGL2 is not available in this browser.'; throw new Error('no webgl2'); }

const bench = q.has('bench');
const fixed = q.has('w') ? [+q.get('w'), +q.get('h') || 720] : null;
const dpr = Math.min(window.devicePixelRatio || 1, +(q.get('dpr') || 1.5));

// spectrum history: NB x HIST, one byte per texel, newest row written each frame
const hist = { tex: gl.createTexture(), row: 0, newest: 0 };
gl.bindTexture(gl.TEXTURE_2D, hist.tex);
gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R8, NB, HIST);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

const fb = new Feedback(gl);
const scenes = [new AuroraDisk(gl), new BurningWater(gl), new VectorTrails(gl)];
let sceneIdx = Math.min(2, Math.max(0, +(q.get('scene') || 0)));

const audio = new AudioInput();
let analysis = new Analysis(48000, 1024);
let demo = null;
const BINS = 1024;

function setScene(i) {
  sceneIdx = i; fb.clear();
  document.querySelectorAll('[data-scene]').forEach(b => b.classList.toggle('on', +b.dataset.scene === i));
}
function startDemo() {
  audio.stop(); demo = new DemoFeed(48000, BINS); analysis = new Analysis(48000, BINS); msg.classList.add('hide');
}
async function useFile(f) {
  if (!f) return;
  await audio.useFile(f, $('audio')); demo = null; analysis = new Analysis(audio.sampleRate, audio.analyser.frequencyBinCount); msg.classList.add('hide');
}
async function useMic() {
  try { await audio.useMic(); } catch (e) { msg.classList.remove('hide'); msg.textContent = 'Microphone unavailable: ' + e.message; return; }
  demo = null; analysis = new Analysis(audio.sampleRate, audio.analyser.frequencyBinCount); msg.classList.add('hide');
}

$('file').onchange = e => useFile(e.target.files[0]);
$('mic').onclick = useMic;
$('demo').onclick = startDemo;
$('full').onclick = () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
document.querySelectorAll('[data-scene]').forEach(b => b.onclick = () => setScene(+b.dataset.scene));
addEventListener('keydown', e => {
  if (e.key >= '1' && e.key <= '3') setScene(+e.key - 1);
  else if (e.key === 'f' || e.key === 'F') $('full').click();
  else if (e.key === 'h' || e.key === 'H') hudEl.style.display = hudEl.style.display === 'none' ? '' : 'none';
});
addEventListener('dragover', e => e.preventDefault());
addEventListener('drop', e => { e.preventDefault(); useFile(e.dataTransfer.files[0]); });
let idleT = 0;
addEventListener('pointermove', () => { ui.classList.remove('idle'); idleT = performance.now(); });

function resize() {
  const w = fixed ? fixed[0] : Math.max(2, Math.floor(canvas.clientWidth * dpr));
  const h = fixed ? fixed[1] : Math.max(2, Math.floor(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  fb.resize(w, h);
}

// ---- frame-time bookkeeping: rolling window for the HUD, full record for the bench
const ring = new Float32Array(240); let ri = 0, rn = 0, last = 0, cpuMs = 0, gpuMs = 0;
const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
let pendingQ = [];
function pct(a, n, p) { const s = Array.from(a.subarray(0, n)).sort((x, y) => x - y); return s[Math.min(n - 1, Math.floor(p * n))] || 0; }

const record = { scenes: [] };
let benchScene = -1, benchStart = 0, benchDt = [], benchCpu = [], benchGpu = [];
const BENCH_MS = +(q.get('ms') || 6000), WARM_MS = 1000;
const sync = q.has('sync'), syncPx = new Uint8Array(4);

function frame(now) {
  const t0 = performance.now();
  resize();
  const t = now / 1000;
  let db;
  if (demo) db = demo.frame(t);
  else if (audio.mode !== 'none') db = audio.frame();
  else { db = new Float32Array(BINS).fill(-140); }
  const A = analysis.update(db, t);
  hist.row = (hist.row + 1) % HIST; hist.newest = (hist.row + 0.5) / HIST;
  gl.bindTexture(gl.TEXTURE_2D, hist.tex);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, hist.row, NB, 1, gl.RED, gl.UNSIGNED_BYTE, A.row);

  const sc = scenes[sceneIdx];
  let qy = null;
  if (timer && bench) { qy = gl.createQuery(); gl.beginQuery(timer.TIME_ELAPSED_EXT, qy); }
  fb.begin(sc.persistence);
  sc.draw(gl, A, canvas.width, canvas.height, hist);
  fb.present();
  if (qy) { gl.endQuery(timer.TIME_ELAPSED_EXT); pendingQ.push(qy); }
  if (sync) gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, syncPx);   // gl.finish() does not block under ANGLE; reading a pixel does
  cpuMs = performance.now() - t0;

  const dt = last ? now - last : 16.7; last = now;
  if (!document.hidden) { ring[ri] = dt; ri = (ri + 1) % ring.length; rn = Math.min(ring.length, rn + 1); }

  // resolve finished GPU timer queries without stalling
  while (pendingQ.length) {
    const p = pendingQ[0];
    if (!gl.getQueryParameter(p, gl.QUERY_RESULT_AVAILABLE)) break;
    if (!gl.getParameter(timer.GPU_DISJOINT_EXT)) { gpuMs = gl.getQueryParameter(p, gl.QUERY_RESULT) / 1e6; if (bench && benchScene >= 0) benchGpu.push(gpuMs); }
    gl.deleteQuery(p); pendingQ.shift();
  }

  if (bench) stepBench(now, dt, cpuMs);
  if (now - idleT > 3000 && (demo || audio.mode !== 'none')) ui.classList.add('idle');

  if ((ri & 7) === 0) {
    const k = analysis.key;
    hudEl.textContent =
      `${sc.name}   ${canvas.width}x${canvas.height}\n` +
      `frame ${(rn ? pct(ring, rn, 0.5) : 0).toFixed(1)} ms p50  ${pct(ring, rn, 0.95).toFixed(1)} p95  (budget 16.7)  cpu ${cpuMs.toFixed(2)} ms` +
      (timer && gpuMs ? `  gpu ${gpuMs.toFixed(2)} ms` : '') + '\n' +
      `key ${k.name} (${(k.confidence * 100) | 0}%)   onsets ${analysis.onset.count}   flux ${analysis.flux.toFixed(2)}   ` +
      `source ${demo ? 'synthetic demo' : audio.mode}`;
  }
  requestAnimationFrame(frame);
}

function stepBench(now, dt, cpu) {
  if (benchScene === 99) return;
  if (benchScene < 0) { benchScene = 0; benchStart = now; setScene(0); }
  const el = now - benchStart;
  if (el > WARM_MS) { benchDt.push(sync ? cpu : dt); benchCpu.push(cpu); }
  if (el > BENCH_MS + WARM_MS) {
    const stat = a => { const s = a.slice().sort((x, y) => x - y); return a.length ? { n: a.length, mean: a.reduce((x, y) => x + y, 0) / a.length, p50: s[s.length >> 1], p95: s[Math.floor(s.length * 0.95)], p99: s[Math.floor(s.length * 0.99)], max: s[s.length - 1] } : null; };
    record.scenes.push({ scene: scenes[sceneIdx].name, frameMs: stat(benchDt), cpuMs: stat(benchCpu), gpuMs: stat(benchGpu), over16_7: benchDt.filter(x => x > 16.7 * 1.2).length });
    benchDt = []; benchCpu = []; benchGpu = [];
    if (sceneIdx < 2) { setScene(sceneIdx + 1); benchStart = now; }
    else {
      record.canvas = [canvas.width, canvas.height]; record.sync = sync; record.gpuTimer = !!timer; record.ua = navigator.userAgent;
      record.renderer = (() => { const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown'; })();
      const out = JSON.stringify(record, null, 1);
      $('bench').style.display = 'block'; $('bench').textContent = out;
      console.log('PERLINES_BENCH ' + JSON.stringify(record));
      benchScene = 99;
    }
  }
}

setScene(sceneIdx);
if (bench || q.has('demo')) startDemo();
requestAnimationFrame(frame);
window.__perlines = { setScene, startDemo, analysis: () => analysis };
