// streamq/server.mjs - local prototype: GET / -> client.html ; WS /ws -> {start:{q,options,seed,secs,dots,...}} -> binary frames
// Frame = [u8 type=1][u32 seq][u16 payload...] then zlib deflateRaw(bitmap). The question/option text is read here, rasterised to a
// private mask and NEVER written to the socket. The browser receives only dot occupancy bitmaps.
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { WebSocketServer } from 'ws';
import { DotField, glyphMask, rngFrom, seedFrom, GW, GH } from './lib.mjs';

const FPS = 20;
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/stats')) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(globalStats())); }
  res.setHeader('content-type', 'text/html'); res.end(readFileSync(new URL('./client.html', import.meta.url)));
});
const wss = new WebSocketServer({ server, path: '/ws' });
const stats = { streams: 0, frames: 0, bytesRaw: 0, bytesWire: 0, cpuUs: 0 };
const globalStats = () => ({ ...stats, cpu: process.cpuUsage() });

wss.on('connection', (ws) => {
  ws.on('message', (m) => {
    let msg; try { msg = JSON.parse(String(m)); } catch { return; }
    if (!msg.start) return;
    const s = msg.start;
    const t0 = process.cpuUsage();
    const { mask, fits } = glyphMask(s.q, s.options);           // text consumed here, never sent
    const rng = rngFrom(seedFrom(s.secret || 'dev-secret', s.gameId || 'g', s.wallet || 'w', String(s.qIdx ?? 0)));
    const field = new DotField({ mask, rng, dots: s.dots || 12000, life: s.life || 6, coherence: s.coherence ?? 0.9, speed: s.speed || 1.5 });
    const maskCpu = process.cpuUsage(t0);
    ws.send(JSON.stringify({ hello: { gw: GW, gh: GH, fps: FPS, fits } })); // note: no text, no mask, no direction
    const nFrames = Math.round((s.secs || 8) * FPS); let seq = 0, cpuUs = maskCpu.user + maskCpu.system, raw = 0, wire = 0;
    const start = performance.now();
    const tick = () => {
      if (ws.readyState !== 1) return;
      const c0 = process.cpuUsage();
      const bits = field.step();
      const z = deflateRawSync(bits, { level: 1 });
      const buf = Buffer.allocUnsafe(5 + z.length); buf[0] = 1; buf.writeUInt32LE(seq, 1); z.copy(buf, 5);
      ws.send(buf, { binary: true });
      const c1 = process.cpuUsage(c0); cpuUs += c1.user + c1.system; raw += bits.length; wire += buf.length;
      seq++;
      if (seq >= nFrames) { ws.send(JSON.stringify({ end: { frames: seq, rawBytes: raw, wireBytes: wire, serverCpuMs: +(cpuUs / 1000).toFixed(1), maskMs: +((maskCpu.user + maskCpu.system) / 1000).toFixed(1) } })); stats.streams++; stats.frames += seq; stats.bytesRaw += raw; stats.bytesWire += wire; stats.cpuUs += cpuUs; return; }
      const due = start + (seq * 1000) / FPS; setTimeout(tick, Math.max(0, due - performance.now()));
    };
    tick();
  });
});
const port = Number(process.env.PORT || 8765);
server.listen(port, '127.0.0.1', () => console.log('streamq listening on', port));
