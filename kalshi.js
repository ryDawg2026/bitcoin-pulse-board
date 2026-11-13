/* Kalshi panel — read-only, public market data (no auth, no keys, no orders).
   Series KXBTC15M = "BTC price up in next 15 mins?".  Yes price = market-implied chance BTC finishes the window above its start price.
   Data path, first that works:
     1. KALSHI_BASE = ?kalshi=<url> query param or window.KALSHI_PROXY (a CORS-enabled proxy, see tools/kalshi-proxy-worker.js)
     2. Kalshi's API directly (works only from origins Kalshi allows: github.io is currently answered with HTTP 403, no CORS header)
     3. same-origin kalshi-snapshot.json (written by tools/kalshi_snapshot.py), shown with its age
*/
(function(){
'use strict';
var API='https://api.elections.kalshi.com/trade-api/v2',SERIES='KXBTC15M',Q=900;
var qp=(location.search.match(/[?&]kalshi=([^&]+)/)||[])[1];
var BASE=qp?decodeURIComponent(qp):(window.KALSHI_PROXY||'');
var chart=null,last=null,timer=null,srcLabel='';
function $(i){return document.getElementById(i)}
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function J(u,ms){var c=new AbortController(),to=setTimeout(function(){c.abort()},ms||10000);
  return fetch(u,{signal:c.signal,cache:'no-store'}).then(function(r){clearTimeout(to);if(!r.ok)throw new Error('HTTP '+r.status);return r.json()},function(e){clearTimeout(to);throw e})}
function num(x){var v=parseFloat(x);return isFinite(v)?v:NaN}
function cents(x){return isFinite(x)?Math.round(x*100)+'¢':'—'}
function mid(m){var b=num(m.yes_bid_dollars),a=num(m.yes_ask_dollars),l=num(m.last_price_dollars);
  if(b>0&&a>0&&a<=1)return (b+a)/2; return isFinite(l)?l:NaN}
function candMid(c){var b=c.yes_bid&&num(c.yes_bid.close_dollars),a=c.yes_ask&&num(c.yes_ask.close_dollars),p=c.price&&num(c.price.close_dollars);
  if(b>0&&a>0&&a<=1)return (b+a)/2;return isFinite(p)?p:NaN}
function pick(ms){var now=Date.now()/1000;return ms.filter(function(m){var o=Date.parse(m.open_time)/1000,c=Date.parse(m.close_time)/1000;return o<=now&&now<c})[0]||ms[0]}
function viaApi(base){
  var origin=base||API;
  return J(origin+'/markets?series_ticker='+SERIES+'&status=open&limit=5',10000).then(function(d){
    var cur=pick(d.markets||[]);if(!cur)throw new Error('no open market');
    var now=Math.floor(Date.now()/1000),o=Date.parse(cur.open_time)/1000;
    var cc=J(origin+'/series/'+SERIES+'/markets/'+cur.ticker+'/candlesticks?start_ts='+(o-60)+'&end_ts='+(now+60)+'&period_interval=1').catch(function(){return {candlesticks:[]}});
    var st=J(origin+'/markets?series_ticker='+SERIES+'&status=settled&limit=50').catch(function(){return {markets:[]}});
    return Promise.all([cc,st]).then(function(r){
      var settled=r[1].markets||[];
      var prev=settled[0];
      var pc=prev?J(origin+'/series/'+SERIES+'/markets/'+prev.ticker+'/candlesticks?start_ts='+(Date.parse(prev.open_time)/1000-60)+'&end_ts='+(Date.parse(prev.close_time)/1000+60)+'&period_interval=1').catch(function(){return {candlesticks:[]}}):Promise.resolve({candlesticks:[]});
      return pc.then(function(p){return {fetched_at:now,current:cur,cand_cur:r[0].candlesticks||[],prev:prev||null,cand_prev:p.candlesticks||[],settled:settled}});
    });
  });
}
function viaSnapshot(){return J('kalshi-snapshot.json').then(function(d){if(!d||!d.current)throw new Error('bad snapshot');d._snapshot=true;return d})}
function load(){
  var tries=[];
  if(BASE)tries.push(['proxy',function(){return viaApi(BASE)}]);
  tries.push(['direct',function(){return viaApi('')}]);
  tries.push(['snapshot',viaSnapshot]);
  var errs=[];
  return tries.reduce(function(p,t){return p.then(function(r){if(r)return r;return t[1]().then(function(d){d._via=t[0];return d},function(e){errs.push(t[0]+': '+(e.message==='Failed to fetch'?'blocked (CORS/403)':e.message));return null})})},Promise.resolve(null)).then(function(d){if(!d){var e=new Error(errs.join(' · '));throw e}d._errs=errs;return d});
}
function mmss(s){s=Math.max(0,Math.round(s));return Math.floor(s/60)+':'+('0'+(s%60)).slice(-2)}
function render(d,ctx){
  var m=d.current,yes=mid(m),strike=num(m.floor_strike),close=Date.parse(m.close_time)/1000,open=Date.parse(m.open_time)/1000,now=Date.now()/1000;
  var age=Math.max(0,now-d.fetched_at);
  var via=d._via==='snapshot'?'<span class="pill bad">snapshot '+(age<90?Math.round(age)+'s':Math.round(age/60)+' min')+' old</span>':'<span class="pill ok">live · '+d._via+'</span>';
  var h='<div class="row" style="gap:20px"><div class="kv"><small>Kalshi odds BTC goes UP</small><b class="big '+(yes>=.5?'up-t':'dn-t')+'" style="font-size:34px">'+(isFinite(yes)?Math.round(yes*100)+'%':'—')+'</b></div>'
   +'<div class="kv"><small>UP (yes) bid / ask</small><b>'+cents(num(m.yes_bid_dollars))+' / '+cents(num(m.yes_ask_dollars))+'</b></div>'
   +'<div class="kv"><small>strike (price at window start)</small><b>$'+(isFinite(strike)?strike.toLocaleString('en-US',{minimumFractionDigits:2}):'—')+'</b></div>'
   +'<div class="kv"><small>BTC now (board consensus)</small><b>'+(ctx&&isFinite(ctx.price)?'$'+ctx.price.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):'—')+'</b><small class="'+(ctx&&ctx.price>strike?'up-t':'dn-t')+'">'+(ctx&&isFinite(ctx.price)&&isFinite(strike)?((ctx.price-strike>=0?'+':'−')+'$'+Math.abs(ctx.price-strike).toFixed(2)+' vs strike'):'')+'</small></div>'
   +'<div class="kv"><small>closes in</small><b id="kClock" data-close="'+close+'">'+mmss(close-now)+'</b></div>'
   +'<div class="kv"><small>volume</small><b>'+(num(m.volume_fp)?Math.round(num(m.volume_fp)).toLocaleString():'—')+'</b></div>'
   +'<div style="margin-left:auto">'+via+'</div></div>';
  // board vs kalshi
  var agree='';
  if(ctx&&ctx.call){var bu=ctx.call.dir==='UP',ku=yes>=.5;agree='<div style="margin-top:8px;font-size:14px">Board call: <b class="'+(bu?'up-t':'dn-t')+'">'+ctx.call.dir+'</b> ('+ctx.call.conf+'%) · Kalshi crowd leans <b class="'+(ku?'up-t':'dn-t')+'">'+(ku?'UP':'DOWN')+'</b> → '+(bu===ku?'<span class="pill ok">agree</span>':'<span class="pill bad">disagree</span>')+' <span class="mut" style="font-size:12px">The board call is locked at the window start; Kalshi odds keep moving as BTC drifts vs the strike, so late in a window they mostly just reflect where BTC is now.</span></div>'}
  // history strip of settled windows
  var strip=(d.settled||[]).slice(0,24).map(function(s){var up=s.result==='yes',W=Date.parse(s.close_time)/1000-Q;
    var bc=ctx&&ctx.calls&&ctx.calls[W],tag=bc?(bc.dir===(up?'UP':'DOWN')?'✔':'✘'):'';
    var t=new Date(W*1000).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
    return '<span title="'+esc(t+' · strike $'+s.floor_strike+' · settled '+(up?'UP':'DOWN')+(bc?' · board called '+bc.dir:''))+'" style="display:inline-block;min-width:34px;text-align:center;margin:2px;padding:2px 4px;border-radius:6px;border:1px solid var(--line);color:'+(up?'var(--up)':'var(--dn)')+'">'+(up?'▲':'▼')+'<small class="mut" style="display:block;font-size:10px">'+t.replace(/ ?[AP]M/,'')+(tag?' '+tag:'')+'</small></span>'}).join('');
  var s24=(d.settled||[]).slice(0,24),settledUp=s24.filter(function(s){return s.result==='yes'}).length,sn=s24.length;
  var hist='<div style="margin-top:10px"><div class="mut" style="font-size:12px;margin-bottom:2px">Last '+sn+' settled Kalshi windows (newest left) — '+settledUp+' up / '+(sn-settledUp)+' down; ✔/✘ = board call matched/missed where the board has a logged call</div><div>'+strip+'</div></div>';
  $('kalshiBody').innerHTML=h+agree+hist;
  // chart
  function series(cands,o){var arr=[];for(var i=0;i<16;i++)arr.push(null);cands.forEach(function(c){var k=Math.round((c.end_period_ts-o)/60)-1;if(k>=0&&k<16){var v=candMid(c);if(isFinite(v))arr[k]=Math.round(v*1000)/10}});return arr}
  var labels=[];for(var i=0;i<16;i++)labels.push(i+'m');
  var ds=[{label:'this window (Kalshi UP %)',data:series(d.cand_cur||[],open),borderColor:'#f7931a',borderWidth:2,pointRadius:1,spanGaps:true,tension:.15}];
  if(d.prev&&(d.cand_prev||[]).length)ds.push({label:'previous window ('+(d.prev.result==='yes'?'settled UP':'settled DOWN')+')',data:series(d.cand_prev,Date.parse(d.prev.open_time)/1000),borderColor:'#5aa9ff',borderWidth:1.5,borderDash:[5,3],pointRadius:0,spanGaps:true,tension:.15});
  ds.push({label:'50%',data:labels.map(function(){return 50}),borderColor:'#8b97b3',borderWidth:1,pointRadius:0,borderDash:[2,3]});
  if(typeof Chart!=='undefined'){
    if(chart){chart.data.labels=labels;chart.data.datasets=ds;chart.update('none')}
    else chart=new Chart($('kalshiChart'),{type:'line',data:{labels:labels,datasets:ds},options:{responsive:true,maintainAspectRatio:false,animation:false,interaction:{mode:'index',intersect:false},plugins:{legend:{labels:{color:'#8b97b3',boxWidth:10,font:{size:10}}}},scales:{x:{title:{display:true,text:'minutes into the 15-minute window',color:'#8b97b3'},ticks:{color:'#8b97b3',maxTicksLimit:16},grid:{color:'#1b2438'}},y:{min:0,max:100,ticks:{color:'#8b97b3',callback:function(v){return v+'%'}},grid:{color:'#1b2438'}}}}});
  }
}
function fail(e){
  $('kalshiBody').innerHTML='<div class="mut" style="font-size:13px">Kalshi market data could not be loaded ('+esc(e.message)+'). Kalshi’s public API does not send CORS headers for github.io, so a static page cannot call it directly; see tools/kalshi-proxy-worker.js (free Cloudflare Worker) or tools/kalshi_snapshot.py. Nothing else on the board is affected.</div>';
}
function ctxNow(){var g=window.__pulseNow||{};return {price:g.med,call:g.call,calls:g.calls}}
function refresh(){return load().then(function(d){last=d;render(d,ctxNow());if(window.ContextPanel&&ContextPanel.onKalshi)ContextPanel.onKalshi(d);if(window.GrokkyPanel&&GrokkyPanel.onKalshi)GrokkyPanel.onKalshi(d)},fail)}
function tickClock(){var el=$('kClock');if(el){var s=+el.getAttribute('data-close')-Date.now()/1000;el.textContent=mmss(s);if(s<-3&&document.visibilityState==='visible'&&(!last||Date.now()-(last._at||0)>8000)){last&&(last._at=Date.now());refresh()}}}
window.KalshiPanel={start:function(){if(!$('kalshiBody'))return;refresh().then(function(){window.__kalshiReady=true},function(){window.__kalshiReady=true});clearInterval(timer);timer=setInterval(function(){if(document.visibilityState==='visible')refresh()},20000);setInterval(tickClock,1000)},base:function(){return BASE||API},viaSnapshot:function(){return last&&last._via==='snapshot'},last:function(){return last},rerender:function(){if(last)render(last,ctxNow())}};
})();
