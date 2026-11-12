// redteam.mjs - offline vision red-team of the captured canvas modes. Never touches live games.
import { readFileSync, writeFileSync } from 'node:fs';
const REGION = process.env.AWS_REGION || 'eu-central-1';
const MODELS = { haiku: { id: 'eu.anthropic.claude-haiku-5-5', pin: 0.11, pout: 0.55 }, sonnet: { id: 'eu.anthropic.claude-sonnet-5-5', pin: 2.2, pout: 11 } };
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const model = MODELS[arg('model', 'haiku')], modes = arg('modes', 'control,single,avg5,max5,avg30,max30,dec8,dec16,dec40,dec40b').split(','), N = Number(arg('n', 40)), OCR = Number(arg('ocr', 0));
// Bedrock API key from the environment (never hard-code it): export AWS_BEARER_TOKEN_BEDROCK=...
const KEY = process.env.AWS_BEARER_TOKEN_BEDROCK; if (!KEY) { console.error('Set AWS_BEARER_TOKEN_BEDROCK'); process.exit(1); }
const man = JSON.parse(readFileSync('out/manifest.json', 'utf8')).items.slice(0, N);
const LET = ['A', 'B', 'C', 'D'];
const SYS = 'You are playing a timed quiz. Answer with exactly one letter: A, B, C or D. No explanation. If the image is unreadable, noise, or you cannot read the question, you must still output one letter (a guess).';
const pick = (t) => { const u = String(t).trim().toUpperCase(); const m = u.match(/^\(?([ABCD])\)?[.):]?$/) || u.match(/^([ABCD])\b/); return m ? LET.indexOf(m[1]) : -1; };
let inTok = 0, outTok = 0;
async function call(file, prompt, maxTokens, sys) {
  const body = { system: [{ text: sys }], messages: [{ role: 'user', content: [{ image: { format: 'png', source: { bytes: readFileSync(file).toString('base64') } } }, { text: prompt }] }], inferenceConfig: { maxTokens }, ...(model.id.includes('haiku') ? { additionalModelRequestFields: { thinking: { type: 'disabled' } } } : {}) };
  for (let a = 0; a < 3; a++) {
    const t0 = performance.now();
    const r = await fetch(`https://bedrock-runtime.${REGION}.amazonaws.com/model/${encodeURIComponent(model.id)}/converse`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` }, body: JSON.stringify(body) });
    const j = await r.json(); const wall = performance.now() - t0;
    if (!r.ok) { if (a === 2) throw new Error(`HTTP ${r.status} ${String(j.message).slice(0, 160)}`); await new Promise((s) => setTimeout(s, 1000 * (a + 1))); continue; }
    inTok += j.usage?.inputTokens || 0; outTok += j.usage?.outputTokens || 0;
    return { text: (j.output?.message?.content || []).map((c) => c.text || '').join(''), modelMs: j.metrics?.latencyMs ?? null, wall };
  }
}
async function pool(jobs, conc = 4) { const out = new Array(jobs.length); let i = 0; await Promise.all(Array.from({ length: conc }, async () => { while (i < jobs.length) { const k = i++; try { out[k] = await jobs[k](); } catch (e) { out[k] = { err: String(e.message) }; } } })); return out; }
const wilson = (k, n) => { const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), s = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [((c - s) / d), ((c + s) / d)].map((x) => +(x * 100).toFixed(0)); };
const res = {};
for (const mode of modes) {
  const rows = await pool(man.map((m) => async () => { const r = await call(`out/img/${m.i}_${mode}.png`, 'The image is a quiz card (question and options A-D). Answer:', 8, SYS); const L = pick(r.text); return { i: m.i, got: L, right: m.right, ok: L === m.right, text: r.text.slice(0, 12), modelMs: r.modelMs }; }));
  const ok = rows.filter((r) => r.ok).length, errs = rows.filter((r) => r.err).length, unp = rows.filter((r) => !r.err && r.got < 0).length;
  const dist = [0, 1, 2, 3].map((l) => rows.filter((r) => r.got === l).length);
  const med = rows.map((r) => r.modelMs).filter(Boolean).sort((a, b) => a - b); 
  res[mode] = { expectedAccIfUnparsedGuessed: +(((ok + 0.25 * unp) / rows.length) * 100).toFixed(1), n: rows.length, correct: ok, acc: +(ok / rows.length * 100).toFixed(1), ci95: wilson(ok, rows.length), errors: errs, unparsed: unp, letterDist: dist, medModelMs: med[med.length >> 1] };
  console.log(model.id.split('.').pop(), mode, JSON.stringify(res[mode]));
}
const ocr = {};
if (OCR) for (const mode of ['single', 'avg30', 'dec16', 'control']) {
  if (!modes.includes(mode)) continue;
  const rows = await pool(man.slice(0, OCR).map((m) => async () => { const r = await call(`out/img/${m.i}_${mode}.png`, 'Transcribe all the text you can read in this image, exactly. If you can read no words, reply NONE.', 80, 'You are an OCR system.'); const words = new Set(m.q.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter((w) => w.length > 3)); const got = new Set(String(r.text).toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/)); const hit = [...words].filter((w) => got.has(w)).length; return { frac: words.size ? hit / words.size : 0, none: /^NONE/i.test(r.text.trim()) }; }));
  ocr[mode] = { n: rows.length, meanQuestionWordsRecovered: +(rows.reduce((s, r) => s + (r.frac || 0), 0) / rows.length).toFixed(2), saidNone: rows.filter((r) => r.none).length };
  console.log('OCR', model.id.split('.').pop(), mode, JSON.stringify(ocr[mode]));
}
const cost = (inTok * model.pin + outTok * model.pout) / 1e6;
console.log('tokens', inTok, outTok, 'cost USD', cost.toFixed(4));
writeFileSync(`out/redteam-${arg('model', 'haiku')}.json`, JSON.stringify({ model: model.id, n: N, res, ocr, inTok, outTok, costUSD: +cost.toFixed(4) }, null, 1));
