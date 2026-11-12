// bench.mjs - bandwidth + server CPU per stream at 1 / 25 / 100 concurrent 8-second streams (clients are bare ws, no inflate)
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import { readFileSync, writeFileSync } from 'node:fs';
const items = JSON.parse(readFileSync('out/manifest.json', 'utf8')).items;
const PORT = 8766, srv = spawn('node', ['server.mjs'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1200));
const cpu = async () => (await (await fetch(`http://127.0.0.1:${PORT}/stats`)).json());
const out = [];
for (const conc of [1, 25, 100]) {
  const c0 = await cpu(); const t0 = performance.now(); const ends = [];
  await Promise.all(Array.from({ length: conc }, (_, k) => new Promise((res) => {
    const m = items[k % items.length]; const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    ws.on('open', () => ws.send(JSON.stringify({ start: { q: m.q, options: m.shown, qIdx: k, wallet: 'w' + k, secs: 8, dots: 12000, life: 4, coherence: 0.9, speed: 1.5 } })));
    ws.on('message', (d, bin) => { if (!bin) { const j = JSON.parse(String(d)); if (j.end) { ends.push(j.end); ws.close(); res(); } } });
  })));
  const c1 = await cpu(); const wall = (performance.now() - t0) / 1000;
  const procCpuS = ((c1.cpu.user + c1.cpu.system) - (c0.cpu.user + c0.cpu.system)) / 1e6;
  const wire = ends.reduce((s, e) => s + e.wireBytes, 0) / ends.length, raw = ends.reduce((s, e) => s + e.rawBytes, 0) / ends.length;
  out.push({ concurrent: conc, wallS: +wall.toFixed(1), kbPer8sQuestion: +(wire / 1024).toFixed(0), kbPerSecond: +(wire / 1024 / 8).toFixed(1), mbps: +(wire * 8 / 8 / 1e6).toFixed(2), rawKbUncompressed: +(raw / 1024).toFixed(0), serverCpuMsPerStream: +(ends.reduce((s, e) => s + e.serverCpuMs, 0) / ends.length).toFixed(1), processCpuSPerStreamSecond: +(procCpuS / conc / 8).toFixed(4) });
  console.log(JSON.stringify(out.at(-1)));
}
srv.kill(); writeFileSync('out/bench.json', JSON.stringify(out, null, 1));
