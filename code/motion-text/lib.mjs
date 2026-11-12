// streamq/lib.mjs - motion-defined text: server-side glyph mask + kinematogram dot field.
// Nothing here ever sends text to a client. The only thing on the wire is an occupancy bitmap per frame.
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { createHash } from 'node:crypto';

export const W = 960, H = 540;          // display pixels
export const GS = 2;                    // one grid cell = 2x2 display pixels
export const GW = W / GS, GH = H / GS;  // 480 x 270 grid
GlobalFonts.registerFromPath(process.env.CARD_FONT || (process.platform === 'win32' ? 'C:/Windows/Fonts/arialbd.ttf' : '/usr/share/fonts/truetype/msttcorefonts/Arial_Bold.ttf'), 'ArialBold'); // any bold sans TTF works

// ---- seeded RNG (xoshiro-ish via sfc32), seeded from sha256(secret|gameId|wallet|qIdx) ----
export function seedFrom(...parts) {
  const h = createHash('sha256').update(parts.join('|')).digest();
  return [h.readUInt32LE(0), h.readUInt32LE(4), h.readUInt32LE(8), h.readUInt32LE(12)];
}
export function rngFrom(seed) {
  let [a, b, c, d] = seed;
  const next = () => { a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0; let t = (a + b) | 0; a = b ^ (b >>> 9); b = (c + (c << 3)) | 0; c = (c << 21) | (c >>> 11); d = (d + 1) | 0; t = (t + d) | 0; c = (c + t) | 0; return (t >>> 0) / 4294967296; };
  for (let i = 0; i < 12; i++) next();
  return next;
}

// ---- layout: question on top (wrapped), four options A-D in a 2x2 grid ----
function wrap(ctx, text, maxW) {
  const words = text.split(/\s+/); const lines = []; let cur = '';
  for (const w of words) { const t = cur ? cur + ' ' + w : w; if (ctx.measureText(t).width <= maxW || !cur) cur = t; else { lines.push(cur); cur = w; } }
  if (cur) lines.push(cur); return lines;
}
/** Draw the card on a W x H canvas. Returns {canvas, fits}. black text on white by default (control image) */
export function drawCard(question, options, { fg = '#000', bg = '#fff' } = {}) {
  const canvas = createCanvas(W, H); const ctx = canvas.getContext('2d');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H); ctx.fillStyle = fg; ctx.textBaseline = 'top';
  let fits = true;
  // question: shrink 60 -> 44 until <= 3 lines
  let qs = 60, qlines;
  for (; qs >= 44; qs -= 4) { ctx.font = `${qs}px ArialBold`; qlines = wrap(ctx, question, W - 80); if (qlines.length <= 3) break; }
  if (qlines.length > 3) fits = false;
  ctx.font = `${qs}px ArialBold`;
  let y = 24; for (const l of qlines.slice(0, 3)) { ctx.fillText(l, 40, y); y += Math.round(qs * 1.12); }
  // options
  const L = ['A', 'B', 'C', 'D']; let os = 48, olines;
  const cellW = (W - 80) / 2 - 10;
  for (; os >= 36; os -= 4) { ctx.font = `${os}px ArialBold`; olines = options.map((o, i) => wrap(ctx, `${L[i]}  ${o}`, cellW)); if (olines.every((l) => l.length <= 2)) break; }
  if (!olines.every((l) => l.length <= 2)) fits = false;
  ctx.font = `${os}px ArialBold`;
  const lh = Math.round(os * 1.12), top = y + 14;
  const rowLines = [0, 1].map((r) => Math.max(...[2 * r, 2 * r + 1].map((i) => Math.min(2, olines[i].length))));
  const rowY = [top, top + rowLines[0] * lh + 26];
  if (rowY[1] + rowLines[1] * lh > H - 6) fits = false;
  options.forEach((o, i) => {
    const cx = 40 + (i % 2) * (cellW + 20), cy = rowY[Math.floor(i / 2)];
    olines[i].slice(0, 2).forEach((l, j) => ctx.fillText(l, cx, cy + j * lh));
  });
  return { canvas, fits, qs, os };
}
/** Server-side glyph mask on the dot grid (1 = inside text). */
export function glyphMask(question, options) {
  const { canvas, fits } = drawCard(question, options, { fg: '#fff', bg: '#000' });
  const px = canvas.getContext('2d').getImageData(0, 0, W, H).data;
  const m = new Uint8Array(GW * GH);
  for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) m[gy * GW + gx] = px[((gy * GS + 1) * W + gx * GS + 1) * 4] > 128 ? 1 : 0;
  return { mask: m, fits };
}

// ---- kinematogram dot field ----
export class DotField {
  /** opts: dots (count), life (frames), coherence (0..1), speed (cells/frame), rng, mask */
  constructor({ mask, rng, dots = 12000, life = 6, coherence = 0.9, speed = 1.5 }) {
    this.mask = mask; this.rng = rng; this.n = dots; this.life = life; this.coh = coherence;
    // per-question random motion axis + speed so the decoder cannot hard-code a direction
    const th = rng() * Math.PI * 2; this.speed = speed * (0.8 + 0.4 * rng());
    this.ux = Math.cos(th); this.uy = Math.sin(th); this.theta = th;
    this.x = new Float32Array(dots); this.y = new Float32Array(dots); this.vx = new Float32Array(dots); this.vy = new Float32Array(dots); this.age = new Uint8Array(dots);
    for (let i = 0; i < dots; i++) { this.spawn(i); this.age[i] = Math.floor(rng() * life); this.x[i] = this.wx(this.x[i] + (this.age[i]) * this.vx[i]); this.y[i] = this.wy(this.y[i] + this.age[i] * this.vy[i]); }
    this.bits = new Uint8Array((GW * GH) >> 3);
  }
  wx(v) { v %= GW; return v < 0 ? v + GW : v; }
  wy(v) { v %= GH; return v < 0 ? v + GH : v; }
  spawn(i) {
    const r = this.rng; const ux = r() * GW, uy = r() * GH;           // "mid-life" position
    const inside = this.mask[(uy | 0) * GW + (ux | 0)] === 1;
    let dx, dy;
    if (r() < this.coh) { const s = inside ? 1 : -1; dx = s * this.ux * this.speed; dy = s * this.uy * this.speed; }
    else { const a = r() * Math.PI * 2; dx = Math.cos(a) * this.speed; dy = Math.sin(a) * this.speed; } // incoherent dots carry no information
    this.vx[i] = dx; this.vy[i] = dy; this.age[i] = 0;
    this.x[i] = this.wx(ux - dx * this.life / 2); this.y[i] = this.wy(uy - dy * this.life / 2);
  }
  /** advance one frame; returns occupancy bitmap (identity-free: a set of cells, no dot order) */
  step() {
    const bits = this.bits; bits.fill(0);
    for (let i = 0; i < this.n; i++) {
      this.x[i] = this.wx(this.x[i] + this.vx[i]); this.y[i] = this.wy(this.y[i] + this.vy[i]);
      if (++this.age[i] >= this.life) this.spawn(i);
      const c = ((this.y[i] | 0) * GW + (this.x[i] | 0)); bits[c >> 3] |= 1 << (c & 7);
    }
    return bits;
  }
}
