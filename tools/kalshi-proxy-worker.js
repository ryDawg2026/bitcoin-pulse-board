// Cloudflare Worker (free plan): read-only CORS relay for Kalshi's PUBLIC KXBTC15M market data.
// Locks: GET only; /markets?series_ticker=KXBTC15M (limit<=50) and /series/KXBTC15M/markets/KXBTC15M-…/candlesticks only;
// CORS only for the Pages origin; ~8s edge cache. No keys, no auth, no orders possible. Same rules as relay/server.js.
const ORIGIN = 'https://rydawg2026.github.io';
const API = 'https://api.elections.kalshi.com/trade-api/v2';
const CAND = /^\/series\/KXBTC15M\/markets\/KXBTC15M-[A-Z0-9-]{3,40}\/candlesticks$/;
const H = { 'Access-Control-Allow-Origin': ORIGIN, 'Vary': 'Origin' };
const reply = (body, status, extra) => new Response(body, { status, headers: { ...H, 'Content-Type': 'application/json', ...extra } });
function allowed(u) {
  if (u.pathname === '/markets') {
    if (u.searchParams.get('series_ticker') !== 'KXBTC15M') return false;
    const st = u.searchParams.get('status'); if (st && !/^(open|settled|closed)$/.test(st)) return false;
    const lim = +(u.searchParams.get('limit') || 1); if (!(lim >= 1 && lim <= 50)) return false;
    return [...u.searchParams.keys()].every(k => ['series_ticker', 'status', 'limit', 'cursor'].includes(k));
  }
  if (CAND.test(u.pathname)) {
    const ks = [...u.searchParams.keys()];
    return ks.every(k => ['start_ts', 'end_ts', 'period_interval'].includes(k) && /^\d{1,12}$/.test(u.searchParams.get(k)));
  }
  return false;
}
export default {
  async fetch(req) {
    const u = new URL(req.url);
    if (u.pathname === '/' || u.pathname === '/healthz') return reply('{"ok":true,"service":"kalshi-relay"}', 200, { 'Cache-Control': 'no-store' });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...H, 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Max-Age': '600' } });
    if (req.method !== 'GET' || !allowed(u)) return reply('{"error":"not allowed"}', 403);
    try {
      const r = await fetch(API + u.pathname + u.search, { headers: { 'User-Agent': 'Mozilla/5.0 pulse-board-relay', Accept: 'application/json' }, cf: { cacheTtl: 8, cacheEverything: true } });
      return new Response(r.body, { status: r.status, headers: { ...H, 'Content-Type': 'application/json', 'Cache-Control': 'public,max-age=5' } });
    } catch (e) { return reply('{"error":"upstream"}', 502); }
  }
};
