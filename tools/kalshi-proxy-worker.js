// Cloudflare Worker (free tier): tiny read-only CORS proxy for Kalshi's PUBLIC market data. NOT deployed — proposal only.
// Only forwards GET to /markets and /series/KXBTC15M/... ; no auth, no keys, no orders possible.
// Then set  window.KALSHI_PROXY='https://<your-worker>.workers.dev'  in index.html (or open the page with ?kalshi=<worker url>).
export default {
  async fetch(req){
    const u=new URL(req.url),h={'Access-Control-Allow-Origin':'https://rydawg2026.github.io','Vary':'Origin'};
    if(req.method==='OPTIONS')return new Response(null,{headers:{...h,'Access-Control-Allow-Methods':'GET'}});
    if(req.method!=='GET'||!(u.pathname==='/markets'||/^\/series\/KXBTC15M\/markets\/[A-Z0-9-]+\/candlesticks$/.test(u.pathname)))return new Response('not allowed',{status:403,headers:h});
    if(u.pathname==='/markets'&&u.searchParams.get('series_ticker')!=='KXBTC15M')return new Response('not allowed',{status:403,headers:h});
    const r=await fetch('https://api.elections.kalshi.com/trade-api/v2'+u.pathname+u.search,{headers:{'User-Agent':'pulse-board-proxy'},cf:{cacheTtl:10}});
    return new Response(r.body,{status:r.status,headers:{...h,'Content-Type':'application/json','Cache-Control':'public,max-age=10'}});
  }
};
