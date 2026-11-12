// bot2.mjs - stronger integrator: K=40 frames (2 s of stream), plus a binarised variant. Writes dec40 / dec40b images.
import { readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { inflateRawSync } from 'node:zlib';
import WebSocket from 'ws';
import { glyphMask, GW, GH, W, H } from './lib.mjs';
import { decode, toPng, auc } from './decoder.mjs';
import { createCanvas } from '@napi-rs/canvas';
const man = JSON.parse(readFileSync('out/manifest.json', 'utf8')); const items = man.items, P = man.params, PORT = 8767;
const srv = spawn('node', ['server.mjs'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' }); await new Promise((r) => setTimeout(r, 1200));
const run = (m) => new Promise((res) => { const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`); const fr = []; const arr = []; const t0 = performance.now();
  ws.on('open', () => ws.send(JSON.stringify({ start: { q: m.q, options: m.shown, qIdx: m.i, gameId: 'redteam', wallet: 'bot', secs: 6, dots: P.DOTS, life: P.LIFE, coherence: P.COH, speed: P.SPEED } })));
  ws.on('message', (d, bin) => { if (!bin) { if (JSON.parse(String(d)).end) { ws.close(); res({ fr, arr }); } return; } fr.push(inflateRawSync(d.subarray(5))); arr.push(performance.now() - t0); }); });
function binar(D) { // Otsu on D then 3x3 majority clean, text dark on white
  const N = D.length; let pos = 0; for (let c = 0; c < N; c++) if (D[c] > 0) pos++; const sign = pos < N / 2 ? 1 : -1;
  const v = Float32Array.from(D, (x) => sign * x); const s = Float32Array.from(v).sort(); const lo = s[Math.floor(N * .02)], hi = s[Math.floor(N * .98)];
  let best = 0, bt = 0; for (let t = lo; t < hi; t += (hi - lo) / 64) { let n0 = 0, n1 = 0, s0 = 0, s1 = 0; for (let c = 0; c < N; c += 2) { if (v[c] < t) { n0++; s0 += v[c]; } else { n1++; s1 += v[c]; } } if (!n0 || !n1) continue; const m0 = s0 / n0, m1 = s1 / n1, bc = n0 * n1 * (m0 - m1) ** 2; if (bc > best) { best = bc; bt = t; } }
  const b = new Uint8Array(N); for (let c = 0; c < N; c++) b[c] = v[c] > bt ? 1 : 0; // 1 = text
  const o = new Uint8Array(N); for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) { let k = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) k += b[((y + dy + GH) % GH) * GW + (x + dx + GW) % GW]; o[y * GW + x] = k >= 5 ? 1 : 0; }
  const cv = createCanvas(W, H), ctx = cv.getContext('2d'), img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const g = o[(y >> 1) * GW + (x >> 1)] ? 0 : 255, q = (y * W + x) * 4; img.data[q] = img.data[q + 1] = img.data[q + 2] = g; img.data[q + 3] = 255; } ctx.putImageData(img, 0, 0); return cv.toBuffer('image/png');
}
const rec = [];
for (const m of items) { const { fr, arr } = await run(m); const { mask } = glyphMask(m.q, m.shown); const r = decode(fr.slice(20, 61), { blur: 2 }); let a = auc(r.D, mask); a = Math.max(a, 1 - a);
  writeFileSync(`out/img/${m.i}_dec40.png`, toPng(r.D)); writeFileSync(`out/img/${m.i}_dec40b.png`, binar(r.D)); rec.push({ i: m.i, auc: +a.toFixed(3), ms: +r.ms.toFixed(0), waitMs: Math.round(arr[60] - arr[20]) }); }
srv.kill(); const med = (a) => a.sort((x, y) => x - y)[a.length >> 1];
console.log('dec40 auc median', med(rec.map((r) => r.auc)), 'decode ms median', med(rec.map((r) => r.ms)), 'stream wait ms', med(rec.map((r) => r.waitMs)));
writeFileSync('out/bot2.json', JSON.stringify(rec));
