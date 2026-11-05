// Drive headless Chrome over CDP (no dependencies; needs node >= 22 for global WebSocket).
//   node tools/headless.mjs <chrome.exe> <url> bench            -> prints PERLINES_BENCH json, console errors
//   node tools/headless.mjs <chrome.exe> <url> shot <out.png> [waitMs]
// The page must already be served (tools/serve.mjs). Exit code 1 on page errors.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [chrome, url, mode, out, waitArg] = process.argv.slice(2);
const port = 9300 + Math.floor(Math.random() * 500);
const dir = mkdtempSync(join(tmpdir(), 'perlines-chrome-'));
const proc = spawn(chrome, [`--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, '--headless=new', '--no-first-run',
  '--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1280,720',
  ...(process.env.CHROME_FLAGS ? process.env.CHROME_FLAGS.split(' ') : []), 'about:blank'], { stdio: 'ignore' });
const stop = code => { try { proc.kill(); } catch {} process.exit(code); };
process.on('uncaughtException', e => { console.error(e); stop(1); });   // never leave the browser running if we die first
process.on('exit', () => { try { proc.kill(); } catch {} });
const sleep = ms => new Promise(r => setTimeout(r, ms));

let targets;
for (let i = 0; i < 60; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.some(t => t.type === 'page')) break; } catch {} await sleep(250); }
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let id = 0; const pending = new Map(); let errors = 0, benchLine = null;
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled') {
    const text = m.params.args.map(a => a.value ?? a.description).join(' ');
    if (text.startsWith('PERLINES_BENCH ')) benchLine = text.slice(15); else console.error(`[console.${m.params.type}] ${text}`);
    if (m.params.type === 'error') errors++;
  } else if (m.method === 'Runtime.exceptionThrown') { errors++; console.error('[exception]', JSON.stringify(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text)); }
});
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Runtime.enable'); await send('Page.enable');
await send('Page.navigate', { url });

if (mode === 'bench') {
  for (let i = 0; i < 400 && !benchLine; i++) await sleep(250);
  if (!benchLine) { console.error('no bench result'); stop(1); }
  console.log(benchLine); stop(errors ? 1 : 0);
} else {
  await sleep(+waitArg || 4000);
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(out, Buffer.from(r.result.data, 'base64'));
  stop(errors ? 1 : 0);
}
