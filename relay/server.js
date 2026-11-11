// Kalshi read-only relay for the Bitcoin Pulse Board. Zero dependencies.
// Locks: GET only; only /markets?series_ticker=KXBTC15M... and /series/KXBTC15M/markets/<ticker>/candlesticks; CORS only for the Pages origin.
// Public Kalshi market data only: no keys, no auth, no orders possible. ~8s in-memory cache.
const http = require('http'), https = require('https');
const ORIGIN = process.env.ALLOWED_ORIGIN || 'https://rydawg2026.github.io';
const UPSTREAM = 'api.elections.kalshi.com', BASE = '/trade-api/v2';
const TTL = 8000, MAX_CACHE = 200, cache = new Map();
const CAND = /^\/series\/KXBTC15M\/markets\/KXBTC15M-[A-Z0-9-]{3,40}\/candlesticks$/;
const base = () => ({ 'Access-Control-Allow-Origin': ORIGIN, 'Vary': 'Origin' });
function allowed(u) {
  if (u.pathname === '/markets') {
    if (u.searchParams.get('series_ticker') !== 'KXBTC15M') return false;
    const st = u.searchParams.get('status'); if (st && !/^(open|settled|closed)$/.test(st)) return false;
    const lim = +(u.searchParams.get('limit') || 1); if (!(lim >= 1 && lim <= 50)) return false;
    return [...u.searchParams.keys()].every(k => ['series_ticker', 'status', 'limit', 'cursor'].includes(k));
  }
  if (CAND.test(u.pathname)) {
    const ks = [...u.searchParams.keys()]; if (!ks.every(k => ['start_ts', 'end_ts', 'period_interval'].includes(k))) return false;
    return ks.every(k => /^\d{1,12}$/.test(u.searchParams.get(k)));
  }
  return false;
}
function send(res, code, body, extra) { res.writeHead(code, { ...base(), 'Content-Type': 'application/json', ...extra }); res.end(body); }
function fetchUp(path) {
  return new Promise((ok, bad) => {
    const r = https.get({ host: UPSTREAM, path: BASE + path, headers: { 'User-Agent': 'Mozilla/5.0 pulse-board-relay', Accept: 'application/json' }, timeout: 10000 }, up => {
      const ch = []; up.on('data', c => ch.push(c)); up.on('end', () => ok({ code: up.statusCode, body: Buffer.concat(ch) }));
    });
    r.on('timeout', () => r.destroy(new Error('timeout'))); r.on('error', bad);
  });
}
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/' || u.pathname === '/healthz') return send(res, 200, '{"ok":true,"service":"kalshi-relay"}', { 'Cache-Control': 'no-store' });
  if (req.method === 'OPTIONS') { res.writeHead(204, { ...base(), 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Max-Age': '600' }); return res.end(); }
  if (req.method !== 'GET' || !allowed(u)) return send(res, 403, '{"error":"not allowed"}');
  const key = u.pathname + u.search, hit = cache.get(key);
  if (hit && Date.now() - hit.t < TTL) return send(res, hit.code, hit.body, { 'Cache-Control': 'public,max-age=5', 'X-Relay-Cache': 'hit' });
  try {
    const r = await fetchUp(key);
    if (r.code === 200) { if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value); cache.set(key, { t: Date.now(), code: 200, body: r.body }); }
    send(res, r.code, r.body, { 'Cache-Control': 'public,max-age=5', 'X-Relay-Cache': 'miss' });
  } catch (e) { send(res, 502, '{"error":"upstream"}'); }
}).listen(process.env.PORT || 10000, '0.0.0.0');
