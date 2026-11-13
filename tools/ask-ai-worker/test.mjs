// Offline tests for worker.js — NO network, NO Cloudflare account, NO neurons used. Run: node tools/ask-ai-worker/test.mjs
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { DatabaseSync } from 'node:sqlite';
const dir = path.dirname(new URL(import.meta.url).pathname);
let src = fs.readFileSync(path.join(dir, 'worker.js'), 'utf8').replace("import { DurableObject } from 'cloudflare:workers';", 'class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }');
const tmp = path.join(os.tmpdir(), 'pulse-ask-worker-under-test.mjs'); fs.writeFileSync(tmp, src);
const W = await import(tmp);
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m); } };
const ORIGIN = 'https://rydawg2026.github.io';
function mkLimiter() { const db = new DatabaseSync(':memory:'); const sql = { exec(q, ...a) { const st = db.prepare(q); const isSel = /^\s*select/i.test(q); const rows = isSel ? st.all(...a) : (st.run(...a), []); return { toArray: () => rows }; } }; return new W.AskLimiter({ storage: { sql } }, {}); }
function mkEnv(over) {
  const lim = mkLimiter(); const calls = []; let ipHits = 0;
  const env = { LIMITER: { idFromName: () => 'x', get: () => lim }, IP_LIMITER: { limit: async () => ({ success: ++ipHits <= 5 }) }, DAILY_CAP: '3', IP_DAILY_CAP: '2',
    AI: { run: async (m, inp) => { calls.push({ m, inp }); if (env._fail && env._fail.includes(m)) throw new Error('3040 capacity'); return env._stream ? env._stream() : sse(['{"response":"Hello "}', '{"response":"there"}', '[DONE]']); } }, ...over };
  env._calls = calls; return env;
}
const sse = lines => new ReadableStream({ start(c) { const e = new TextEncoder(); lines.forEach(l => c.enqueue(e.encode('data: ' + l + '\n\n'))); c.close(); } });
const post = (body, hdr) => new Request('https://x.workers.dev/ask', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.2.3.4', ...hdr }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const txt = async r => await r.text();
const good = { question: 'What is a halving?', snapshot: { price: 100000 } };
let env = mkEnv(), r;

r = await W.default.fetch(new Request('https://x.workers.dev/ask', { method: 'OPTIONS', headers: { Origin: ORIGIN } }), env);
ok(r.status === 204 && r.headers.get('Access-Control-Allow-Origin') === ORIGIN && r.headers.get('Access-Control-Allow-Methods') === 'POST', 'preflight allows only POST from the github.io origin');
r = await W.default.fetch(new Request('https://x.workers.dev/ask', { method: 'GET' }), env); ok(r.status === 405, 'GET /ask rejected (405)');
r = await W.default.fetch(new Request('https://x.workers.dev/other', { method: 'POST' }), env); ok(r.status === 404, 'other paths 404');
r = await W.default.fetch(post(good, { Origin: 'https://evil.example' }), env); ok(r.status === 403 && r.headers.get('Access-Control-Allow-Origin') === ORIGIN, 'foreign Origin rejected (403)');
r = await W.default.fetch(new Request('https://x.workers.dev/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(good) }), env); ok(r.status === 403, 'missing Origin rejected');
r = await W.default.fetch(post(good, { 'Content-Type': 'text/plain' }), env); ok(r.status === 415, 'non-JSON content type rejected');
r = await W.default.fetch(post({ question: 'x'.repeat(20000) }), env); ok(r.status === 413, 'oversize body rejected (413)');
r = await W.default.fetch(post('{not json'), env); ok(r.status === 400, 'bad JSON rejected');
r = await W.default.fetch(post({ question: '   ' }), env); ok(r.status === 400, 'empty question rejected');
ok(env._calls.length === 0, 'no AI call was made for any rejected request');

r = await W.default.fetch(post(good), env); let t = await txt(r);
ok(r.status === 200 && /text\/event-stream/.test(r.headers.get('Content-Type')) && r.headers.get('Access-Control-Allow-Origin') === ORIGIN, 'good request streams SSE with locked CORS');
ok(/"t":"Hello "/.test(t) && /"t":"there"/.test(t) && /"done":true/.test(t), 'stream normalised to {t} chunks + done');
ok(env._calls.length === 1 && env._calls[0].m === '@cf/openai/gpt-oss-120b' && env._calls[0].inp.stream === true && env._calls[0].inp.max_tokens === 1000, 'primary model gpt-oss-120b, stream on, output capped');
const msgs = env._calls[0].inp.messages; ok(msgs[0].role === 'system' && /not financial advice/i.test(msgs[0].content) && /"price":100000/.test(msgs[0].content) && msgs[msgs.length - 1].content === 'What is a halving?', 'system prompt carries snapshot + disclaimer, user question last');

env._stream = () => sse(['{"choices":[{"delta":{"reasoning_content":"thinking..."}}]}', '{"choices":[{"delta":{"content":"Answer "}}]}', '{"type":"response.output_text.delta","delta":"two"}', '{"type":"response.reasoning_text.delta","delta":"SECRET"}']);
r = await W.default.fetch(post(good), env); t = await txt(r);
ok(/Answer /.test(t) && /two/.test(t) && !/thinking|SECRET/.test(t), 'OpenAI-style and Responses-style chunks parsed; reasoning text never forwarded');
env._stream = () => sse(['{"response":"x"}']); 
// per-IP daily cap (IP_DAILY_CAP=2; two used above)
r = await W.default.fetch(post(good), env); ok(r.status === 429 && /ip_daily_cap/.test(await txt(r)), 'per-IP daily cap enforced (429)');
r = await W.default.fetch(post(good, { 'CF-Connecting-IP': '9.9.9.9' }), env); ok(r.status === 200, 'a different IP still served');
await txt(r);
r = await W.default.fetch(post(good, { 'CF-Connecting-IP': '8.8.8.8' }), env); ok(r.status === 429 && /daily_cap/.test(await txt(r)), 'global daily cap (3) enforced for everyone');

env = mkEnv({ DAILY_CAP: '50', IP_DAILY_CAP: '50' }); env._fail = ['@cf/openai/gpt-oss-120b'];
r = await W.default.fetch(post(good), env); await txt(r);
ok(r.status === 200 && env._calls.map(c => c.m).join() === '@cf/openai/gpt-oss-120b,@cf/google/gemma-4-26b-a4b-it', 'primary error -> falls back to gemma-4-26b');
env._fail = ['@cf/openai/gpt-oss-120b', '@cf/google/gemma-4-26b-a4b-it'];
r = await W.default.fetch(post(good), env); ok(r.status === 503, 'both models down -> 503 (page falls back to built-in answers)');
const lim = env.LIMITER.get(); const dayRow = lim.sql.exec('SELECT n FROM day').toArray()[0];
ok(dayRow.n === 1, 'failed request was refunded against the daily cap');
env = mkEnv({ DAILY_CAP: '50', IP_DAILY_CAP: '50' }); let last; for (let i = 0; i < 7; i++) { last = await W.default.fetch(post(good), env); if (i < 6) await txt(last); }
const lastBody = await txt(last); ok(last.status === 429 && /rate_limited/.test(lastBody), 'burst limiter (5/min) returns 429 rate_limited');
env = mkEnv({ ENABLED: 'false' }); r = await W.default.fetch(post(good), env); ok(r.status === 503, 'kill switch ENABLED=false -> 503');
env = mkEnv(); r = await W.default.fetch(new Request('https://x.workers.dev/healthz'), env); ok(r.status === 200 && env._calls.length === 0, '/healthz works and uses no AI');
// no question logging
const logs = []; const oc = console.log; console.log = (...a) => logs.push(a.join(' ')); env = mkEnv(); await txt(await W.default.fetch(post({ question: 'SECRET-QUESTION-123' }), env)); console.log = oc;
ok(!logs.some(l => /SECRET-QUESTION-123/.test(l)), 'question text is not logged');
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
