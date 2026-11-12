// capture.mjs - builds the 40-item red-team set. Browser modes come from the REAL canvas in headless Chrome; dec* modes from a node bot that reads the socket.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { inflateRawSync } from 'node:zlib';
import WebSocket from 'ws';
import { drawCard, glyphMask, rngFrom, seedFrom } from './lib.mjs';
import { decode, toPng, auc } from './decoder.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const N = Number(process.argv[2] || 40), PORT = 8765, DOTS = 12000, LIFE = 4, SPEED = 1.5, COH = 0.9;
mkdirSync('out/img', { recursive: true });
// ---- pick items: those whose card fits the 960x540 layout; seeded ----
const bank = JSON.parse(readFileSync(process.env.QUESTIONS || './sample-questions.json', 'utf8')).items;
const rnd = rngFrom(seedFrom('redteam-2026-10-09'));
const shuf = (a) => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
let fitCount = 0; const fitting = [];
for (const it of bank) { if (drawCard(it.q, it.o).fits) { fitCount++; fitting.push(it); } }
const chosen = shuf(fitting).slice(0, N);
const manifest = chosen.map((it, i) => { const perm = shuf([0, 1, 2, 3]); const shown = perm.map((p) => it.o[p]); return { i, id: it.id, topic: it.topic, q: it.q, shown, right: perm.indexOf(it.c), words: it.q.split(/\s+/).length }; });
writeFileSync('out/manifest.json', JSON.stringify({ bankItems: bank.length, fit: fitCount, params: { DOTS, LIFE, SPEED, COH }, items: manifest }, null, 1));
console.log('bank', bank.length, 'fit layout', fitCount, 'chosen', manifest.length);

// control: static text card
for (const m of manifest) { const { canvas } = drawCard(m.q, m.shown); writeFileSync(`out/img/${m.i}_control.png`, canvas.toBuffer('image/png')); }

const srv = spawn('node', ['server.mjs'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'inherit' });
await new Promise((r) => setTimeout(r, 1200));
const startMsg = (m) => ({ q: m.q, options: m.shown, qIdx: m.i, gameId: 'redteam', wallet: 'bot', secs: 6, dots: DOTS, life: LIFE, coherence: COH, speed: SPEED });

// ---- browser modes ----
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = []; let idx = 0;
async function worker() {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
  while (idx < manifest.length) {
    const m = manifest[idx++]; const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${PORT}/`);
    await page.evaluate((s) => { window.__p = window.__start(s); }, startMsg(m));
    await page.waitForFunction(() => window.__q.frames >= 70, null, { timeout: 20000 });
    const caps = await page.evaluate(() => ({ single: window.__single(), avg5: window.__capture('avg', 5), max5: window.__capture('max', 5), avg30: window.__capture('avg', 30), max30: window.__capture('max', 30) }));
    for (const [k, v] of Object.entries(caps)) writeFileSync(`out/img/${m.i}_${k}.png`, Buffer.from(v.split(',')[1], 'base64'));
    const end = await page.evaluate(() => window.__p);
    const dm = await page.evaluate(() => { const a = window.__q.drawMs.slice(); a.sort((x, y) => x - y); return { median: a[a.length >> 1], p95: a[Math.floor(a.length * 0.95)], n: a.length }; });
    results.push({ i: m.i, end, drawMs: dm }); await page.close();
  }
}
await Promise.all([worker(), worker(), worker(), worker()]);
await browser.close();

// ---- bot modes: a node client reads the socket and integrates frames itself ----
async function botRun(m) {
  return new Promise((res) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`); const frames = []; const t0 = performance.now(); const arrive = [];
    ws.on('open', () => ws.send(JSON.stringify({ start: startMsg(m) })));
    ws.on('message', (d, bin) => { if (!bin) { if (JSON.parse(String(d)).end) { ws.close(); res({ frames, arrive }); } return; } frames.push(inflateRawSync(d.subarray(5))); arrive.push(performance.now() - t0); });
  });
}
const bot = [];
for (const m of manifest) {
  const { frames, arrive } = await botRun(m); const { mask } = glyphMask(m.q, m.shown);
  const rec = { i: m.i };
  for (const K of [4, 8, 16]) {
    const r = decode(frames.slice(20, 20 + K + 1), { blur: 2 }); let a = auc(r.D, mask); a = Math.max(a, 1 - a);
    rec['dec' + K] = { auc: +a.toFixed(3), ms: +r.ms.toFixed(0), d1: r.d1.slice(0, 2), d2: r.d2 && r.d2.slice(0, 2), waitMs: Math.round(arrive[20 + K] - arrive[20]) }; // time the stream had to run to deliver K+1 frames
    if (K !== 4) writeFileSync(`out/img/${m.i}_dec${K}.png`, toPng(r.D));
  }
  bot.push(rec);
}
srv.kill();
writeFileSync('out/capture-results.json', JSON.stringify({ browser: results, bot }, null, 1));
console.log('done');
