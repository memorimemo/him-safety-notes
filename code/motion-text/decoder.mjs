// streamq/decoder.mjs - the "obvious counter": a bot that integrates the frames itself.
// Input: array of occupancy bitmaps (packed bits). It does NOT know the motion axis or speed (random per question per player).
// 1) estimate the two dominant inter-frame displacements by cross-correlating consecutive frames;
// 2) per pair, mark cells whose dot reappears at d1 (figure) or d2 (ground); 3) sum + blur -> text image.
import { createCanvas } from '@napi-rs/canvas';
import { GW, GH, W, H } from './lib.mjs';
const N = GW * GH;
const expand = (bits) => { const a = new Uint8Array(N); for (let c = 0; c < N; c++) a[c] = (bits[c >> 3] >> (c & 7)) & 1; return a; };
const R = 4;
function corr(A, B, dx, dy) { // torus match count
  let s = 0; for (let y = 0; y < GH; y++) { const yy = (y + dy + GH) % GH; for (let x = 0; x < GW; x++) if (A[y * GW + x] && B[yy * GW + ((x + dx + GW) % GW)]) s++; } return s;
}
function shiftDilate(B, dx, dy) { // B shifted by (-dx,-dy) so that out[x,y]=B[x+dx,y+dy] dilated 3x3 (tolerates rounding)
  const t = new Uint8Array(N);
  for (let y = 0; y < GH; y++) { const yy = (y + dy + GH) % GH; for (let x = 0; x < GW; x++) t[y * GW + x] = B[yy * GW + ((x + dx + GW) % GW)]; }
  const h = new Uint8Array(N), o = new Uint8Array(N);
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) h[y * GW + x] = t[y * GW + x] | t[y * GW + (x + 1) % GW] | t[y * GW + (x + GW - 1) % GW];
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) o[y * GW + x] = h[y * GW + x] | h[((y + 1) % GH) * GW + x] | h[((y + GH - 1) % GH) * GW + x];
  return o;
}
function boxBlur(a, r) { // separable, wrap
  const t = new Float32Array(N), o = new Float32Array(N), k = 2 * r + 1;
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) { let s = 0; for (let d = -r; d <= r; d++) s += a[y * GW + (x + d + GW) % GW]; t[y * GW + x] = s / k; }
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) { let s = 0; for (let d = -r; d <= r; d++) s += t[((y + d + GH) % GH) * GW + x]; o[y * GW + x] = s / k; }
  return o;
}
/** returns {D (Float32 GWxGH, + = figure candidate), d1, d2, ms} */
export function decode(bitmaps, { searchPairs = 4, blur = 3 } = {}) {
  const t0 = performance.now(); const fr = bitmaps.map(expand);
  // 1. displacement search on the first few pairs
  const score = new Map();
  for (let p = 0; p < Math.min(searchPairs, fr.length - 1); p++) for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { if (!dx && !dy) continue; const k = dx + ',' + dy; score.set(k, (score.get(k) || 0) + corr(fr[p], fr[p + 1], dx, dy)); }
  const ranked = [...score.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => [...k.split(',').map(Number), v]);
  const d1 = ranked[0]; const d2 = ranked.find((r) => Math.hypot(r[0] - d1[0], r[1] - d1[1]) >= 1.9);
  // 2. accumulate figure/ground match maps
  const S1 = new Float32Array(N), S2 = new Float32Array(N);
  for (let p = 0; p < fr.length - 1; p++) {
    const m1 = shiftDilate(fr[p + 1], d1[0], d1[1]), m2 = shiftDilate(fr[p + 1], d2[0], d2[1]);
    for (let c = 0; c < N; c++) if (fr[p][c]) { S1[c] += m1[c]; S2[c] += m2[c]; }
  }
  const b1 = boxBlur(S1, blur), b2 = boxBlur(S2, blur); const D = new Float32Array(N);
  for (let c = 0; c < N; c++) D[c] = b1[c] - b2[c];
  return { D, d1, d2, ms: performance.now() - t0, pairs: fr.length - 1 };
}
/** D -> PNG buffer 960x540, text dark on white (minority class = text) */
export function toPng(D) {
  let pos = 0; for (let c = 0; c < N; c++) if (D[c] > 0) pos++;
  const sign = pos < N / 2 ? 1 : -1; // the smaller side is the text
  const srt = Float32Array.from(D, (v) => sign * v).sort(); const lo = srt[Math.floor(N * 0.03)], hi = srt[Math.floor(N * 0.97)]; // robust contrast stretch (a bot would do the same)
  const cv = createCanvas(W, H), ctx = cv.getContext('2d'), img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = sign * D[((y >> 1) * GW) + (x >> 1)]; const g = 255 - Math.max(0, Math.min(255, ((v - lo) / (hi - lo)) * 255 * 1.0)) ; const o = (y * W + x) * 4; img.data[o] = img.data[o + 1] = img.data[o + 2] = g; img.data[o + 3] = 255; }
  ctx.putImageData(img, 0, 0); return cv.toBuffer('image/png');
}
/** how well does D recover the true mask? area under ROC (probability a text cell scores higher than a ground cell) */
export function auc(D, mask) {
  const pos = [], neg = []; for (let c = 0; c < N; c += 3) (mask[c] ? pos : neg).push(D[c]);
  const all = [...pos.map((v) => [v, 1]), ...neg.map((v) => [v, 0])].sort((a, b) => a[0] - b[0]);
  let rank = 0, sum = 0; for (let i = 0; i < all.length; i++) if (all[i][1]) { sum += i + 1; rank++; }
  return (sum - rank * (rank + 1) / 2) / (rank * (all.length - rank));
}
