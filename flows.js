/* Large transfers & trades tracker — INFORMATION ONLY. Reads free public feeds, never feeds the prediction engine, places no orders, uses no keys.
   What is recorded (only items worth >= $25,000):
     tx  = on-chain BTC transfers seen UNCONFIRMED in the mempool (blockchain.info). Amount = sum of all outputs, which INCLUDES CHANGE sent back to the sender,
           so it overstates what actually moved, and nothing says whether it is a buy, a sale or just a wallet shuffle. Priced in USD at the board's price when first seen.
     tr  = exchange trades (Binance aggTrades + OKX trades). The exchange itself reports the taker side, so "taker buy / taker sell" is real data, but one trade
           is one fill, not one person's whole position. USDT-quoted, treated as ≈ USD.
     lq  = OKX perpetual liquidations (forced closes; long or short is reported by the exchange).
   Storage: one capped list of the latest 1000 items plus per-minute totals for ~3 h (so the 15 min / 1 h summaries do not depend on the list cap).
   Coverage is honest: this only sees what happens while this page is open; the page shows "watching since" and flags partial windows. */
(function(){
'use strict';
var KEY='pulseboard.flows.v1',MIN_USD=25000,CAP=1000,KEEP_S=3*3600+300;
var TIERS=[{n:1,label:'$25k – $100k'},{n:2,label:'$100k – $1M'},{n:3,label:'$1M +'}];
var KINDS={tx:'On-chain transfers (unconfirmed)',tr:'Exchange trades (Binance + OKX)',lq:'Liquidations (OKX perpetual)'};
function $(i){return document.getElementById(i)}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function num(x){var v=parseFloat(x);return isFinite(v)?v:NaN}
function nowS(){return Date.now()/1000}
function J(u,ms){var c=new AbortController(),to=setTimeout(function(){c.abort()},ms||12000);
  return fetch(u,{signal:c.signal,cache:'no-store'}).then(function(r){clearTimeout(to);if(!r.ok)throw new Error('HTTP '+r.status);return r.json()},function(e){clearTimeout(to);throw e})}
function why(e){var m=(e&&e.name==='AbortError')?'timeout':((e&&e.message)||'error');return m==='Failed to fetch'?'blocked/network':m}
function tier(u){return u>=1e6?3:u>=1e5?2:u>=MIN_USD?1:0}
function hhmm(t){return new Date(t*1000).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}
function hhmmss(t){return new Date(t*1000).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'})}
function ago(s){s=Math.max(0,Math.round(s));return s<90?s+'s':s<5400?Math.round(s/60)+' min':Math.round(s/3600)+' h'}
function fu(x){if(!isFinite(x))return '—';if(x>=1e6)return '$'+(x/1e6).toFixed(2)+'M';if(x>=1e5)return '$'+Math.round(x/1e3)+'k';return '$'+Math.round(x).toLocaleString('en-US')}
function price(){var g=window.__pulseNow;return g&&isFinite(g.med)&&g.med>1000?g.med:NaN}

/* ---------- state ---------- */
var S=load(),ids={},dirty=false;
/* decision-trail counters: what this visit looked at, passed over (< $25k), or rejected as a duplicate. In memory only (not stored). */
var CNT={since:Date.now()/1000,tx:{seen:0,below:0,dup:0},tr:{seen:0,below:0,dup:0},lq:{seen:0,below:0,dup:0}},seenIds={},seenN=0;
function consider(k,id,u){
  if(seenIds[id]||ids[id]){CNT[k].dup++;return false}
  if(++seenN>60000){seenIds={};seenN=0}seenIds[id]=1;CNT[k].seen++;
  if(!(u>=MIN_USD)){CNT[k].below++;return false}return true}
function fresh(){return {v:1,recs:[],bk:{},cov:{tx:{from:0,last:0},bin:{from:0,last:0},okx:{from:0,last:0},lq:{from:0,last:0}},binLast:0}}
function load(){try{var s=JSON.parse(localStorage.getItem(KEY)||'null');if(s&&s.v===1&&Array.isArray(s.recs)&&s.bk&&s.cov){var f=fresh();Object.keys(f.cov).forEach(function(k){if(!s.cov[k])s.cov[k]=f.cov[k]});return s}}catch(e){}return fresh()}
function save(){if(!dirty)return;try{prune();localStorage.setItem(KEY,JSON.stringify(S));dirty=false}catch(e){/* storage full/unavailable: keep running in memory */}}
function prune(){var cut=Math.floor((nowS()-KEEP_S)/60);Object.keys(S.bk).forEach(function(m){if(+m<cut)delete S.bk[m]})}
S.recs.forEach(function(r){ids[r.i]=1});

/* ---------- ingest ---------- */
function addRec(r){ // r: {i,t,k,s,b,u,side?,mx?,n?,link?}
  if(!r)return false;if(ids[r.i]){if(CNT[r.k])CNT[r.k].dup++;return false}
  if(!isFinite(r.u)||r.u<MIN_USD||!isFinite(r.t))return false;
  var now=nowS();if(r.t>now)r.t=now;
  ids[r.i]=1;S.recs.push(r);
  while(S.recs.length>CAP){var o=S.recs.shift();delete ids[o.i]}
  var m=Math.floor(r.t/60),b=S.bk[m]||(S.bk[m]={}),key=r.k+tier(r.u),a=b[key]||(b[key]=[0,0,0,0]);
  a[0]++;a[1]+=r.u;
  if(r.k==='tr'){if(r.side==='buy')a[2]+=r.u;else a[3]+=r.u}
  if(r.k==='lq'){if(r.side==='long')a[2]+=r.u;else a[3]+=r.u}
  dirty=true;return true;
}
function cover(feed,gapS){var c=S.cov[feed],n=nowS();if(!c.from||n-c.last>gapS)c.from=n;c.last=n;dirty=true}

/* ---------- summaries (from per-minute totals, not from the capped list) ---------- */
function summary(winS){
  var nowM=Math.floor(nowS()/60),from=nowM-Math.floor(winS/60),out={tx:{},tr:{},lq:{}};
  ['tx','tr','lq'].forEach(function(k){[1,2,3].forEach(function(t){out[k][t]=[0,0,0,0]});out[k].all=[0,0,0,0]});
  Object.keys(S.bk).forEach(function(m){if(+m<=from||+m>nowM)return;var b=S.bk[m];Object.keys(b).forEach(function(key){var k=key.slice(0,2),t=+key.slice(2),a=b[key];for(var i=0;i<4;i++){out[k][t][i]+=a[i];out[k].all[i]+=a[i]}})});
  return out;
}
function coverageFor(feeds,winS){ // seconds of continuous watching (shortest feed) within the window
  var n=nowS(),c=Infinity;feeds.forEach(function(f){var x=S.cov[f];var s=x.from&&n-x.last<150?Math.min(winS,n-x.from):0;c=Math.min(c,s)});return c===Infinity?0:c}

/* ---------- feeds ---------- */
var FEED={
  tx:{label:'blockchain.info mempool',every:25,next:0,run:false,ok:null,err:'',at:0},
  bin:{label:'Binance trades',every:20,next:0,run:false,ok:null,err:'',at:0},
  okx:{label:'OKX trades',every:20,next:0,run:false,ok:null,err:'',at:0},
  lq:{label:'OKX liquidations (from the Market context box)',every:0,next:0,run:false,ok:null,err:'',at:0}};
var bcP=null,bcAt=0,bcData=null;
function bcSample(maxAge){ // shared with the whale box: one request serves both
  var n=Date.now();if(bcData&&n-bcAt<maxAge*1000)return Promise.resolve(bcData);if(bcP)return bcP;
  bcP=J('https://blockchain.info/unconfirmed-transactions?format=json&cors=true',20000).then(function(d){bcData=d;bcAt=Date.now();bcP=null;return d},function(e){bcP=null;throw e});return bcP}
function pollTx(){
  var p=price();if(!isFinite(p))return Promise.resolve();
  return bcSample(15).then(function(d){
    var txs=d.txs||[];if(!txs.length)throw new Error('empty sample');
    cover('tx',60);var added=0;
    txs.forEach(function(x){var outs=(x.out||[]).map(function(o){return (o.value||0)/1e8}),btc=outs.reduce(function(s,v){return s+v},0),u=btc*p;
      if(x.hash&&consider('tx','tx:'+x.hash,u)&&addRec({i:'tx:'+x.hash,t:x.time,k:'tx',s:'blockchain.info',b:btc,u:u,mx:Math.max.apply(null,outs),n:outs.length,h:x.hash}))added++});
    return added});
}
function pollBin(){
  var base='https://data-api.binance.vision/api/v3/aggTrades?symbol=BTCUSDT&limit=1000',pages=0;
  function page(){
    var u=base+(S.binLast?'&fromId='+(S.binLast+1):'');
    return J(u,15000).then(function(d){
      if(!Array.isArray(d))throw new Error('bad response');
      var full=d.length>=1000;
      d.forEach(function(x){var q=num(x.q),px=num(x.p),usd=q*px;S.binLast=Math.max(S.binLast,x.a);
        if(consider('tr','bn:'+x.a,usd))addRec({i:'bn:'+x.a,t:x.T/1000,k:'tr',s:'Binance',b:q,u:usd,side:x.m?'sell':'buy',px:px}) }); // m=true: buyer was the maker, so the TAKER sold
      dirty=true;
      if(full&&++pages<3)return page();
      // a full last page means we did not catch up: do not claim continuous coverage
      return cover('bin',full?0:75);
    });
  }
  return page();
}
function pollOkx(){
  return J('https://www.okx.com/api/v5/market/trades?instId=BTC-USDT&limit=500',15000).then(function(d){
    var a=d.data;if(!Array.isArray(a))throw new Error('bad response');
    cover('okx',100);
    a.forEach(function(x){var q=num(x.sz),px=num(x.px),usd=q*px;if((x.side==='buy'||x.side==='sell')&&consider('tr','ok:'+x.tradeId,usd))addRec({i:'ok:'+x.tradeId,t:(+x.ts)/1000,k:'tr',s:'OKX',b:q,u:usd,side:x.side,px:px})});
  });
}
var RUN={tx:pollTx,bin:pollBin,okx:pollOkx};
function runFeed(id){
  var f=FEED[id];if(f.run)return;f.run=true;
  Promise.resolve().then(RUN[id]).then(function(){f.ok=true;f.err='';f.at=nowS();f.next=Date.now()+f.every*1000},function(e){f.ok=false;f.err=why(e);f.next=Date.now()+(/429|418|403/.test(f.err)?120:f.every*2)*1000})
    .then(function(){f.run=false;save();render()});
}
function tickFeeds(){ // keeps polling in background tabs too (browsers throttle timers there, which shows up as a coverage gap)
  ['tx','bin','okx'].forEach(function(id){if(Date.now()>=FEED[id].next)runFeed(id)})}
/* liquidations come from the Market-context OKX box, which already fetches them: rows = {t,long,usd,px,btc} */
function addLiq(rows){
  try{cover('lq',400);rows.forEach(function(x){var lid='lq:'+Math.round(x.t)+':'+x.btc.toFixed(4)+':'+(x.long?'l':'s');if(consider('lq',lid,x.usd))addRec({i:lid,t:x.t,k:'lq',s:'OKX',b:x.btc,u:x.usd,side:x.long?'long':'short',px:x.px})});FEED.lq.ok=true;FEED.lq.err='';FEED.lq.at=nowS();save();render()}catch(e){FEED.lq.ok=false;FEED.lq.err=why(e)}}
function liqFail(e){FEED.lq.ok=false;FEED.lq.err=why(e);render()}

/* ---------- rendering ---------- */
function cell(a){return a[0]?'<b>'+a[0]+'</b> · '+fu(a[1]):'<span class="mut">0</span>'}
function sumTable(kind,extra){
  var s15=summary(900)[kind],s60=summary(3600)[kind],h='<table class="ftab"><thead><tr><th class="l">Size tier</th><th>last 15 min</th><th>last 1 h</th></tr></thead><tbody>';
  TIERS.forEach(function(t){h+='<tr><td class="l">'+t.label+'</td><td>'+cell(s15[t.n])+'</td><td>'+cell(s60[t.n])+'</td></tr>'});
  h+='<tr class="tot"><td class="l">All ≥ $25k</td><td>'+cell(s15.all)+'</td><td>'+cell(s60.all)+'</td></tr>';
  if(extra==='tr')h+='<tr><td class="l mut">taker buy $ / taker sell $</td><td><span class="up-t">'+fu(s15.all[2])+'</span> / <span class="dn-t">'+fu(s15.all[3])+'</span></td><td><span class="up-t">'+fu(s60.all[2])+'</span> / <span class="dn-t">'+fu(s60.all[3])+'</span></td></tr>';
  if(extra==='lq')h+='<tr><td class="l mut">longs $ / shorts $ liquidated</td><td><span class="dn-t">'+fu(s15.all[2])+'</span> / <span class="up-t">'+fu(s15.all[3])+'</span></td><td><span class="dn-t">'+fu(s60.all[2])+'</span> / <span class="up-t">'+fu(s60.all[3])+'</span></td></tr>';
  return h+'</tbody></table>';
}
function covNote(feeds){
  var c15=coverageFor(feeds,900),c60=coverageFor(feeds,3600),p=[];
  if(c15<880)p.push('15 min: only '+ago(c15)+' watched');if(c60<3580)p.push('1 h: only '+ago(c60)+' watched');
  return p.length?'<div class="warn" style="font-size:12px;margin-top:4px">Partial window — '+p.join(' · ')+'. Totals only count what this page saw while open.</div>':'';
}
function recLine(r,isNew){
  var kind=r.k==='tx'?'On-chain transfer <span class="mut">(unconfirmed)</span>':r.k==='tr'?'Trade · taker <b class="'+(r.side==='buy'?'up-t':'dn-t')+'">'+(r.side==='buy'?'BUY':'SELL')+'</b>':'Liquidation · <b>'+r.side+'</b> position';
  var link=r.k==='tx'&&r.h?'<a href="https://mempool.space/tx/'+esc(r.h)+'" target="_blank" rel="noopener noreferrer">'+esc(r.h.slice(0,8))+'…</a>':'';
  var extra=r.k==='tx'?'largest output '+r.mx.toFixed(2)+' BTC · '+r.n+' output'+(r.n>1?'s':''):(r.px?'@ $'+Math.round(r.px).toLocaleString('en-US'):'');
  var t=tier(r.u);
  return '<tr'+(isNew?' class="rowin"':'')+'><td class="l">'+hhmmss(r.t)+'</td><td class="l">'+kind+'</td><td>'+r.b.toFixed(r.b<1?4:2)+' BTC</td><td><b>'+fu(r.u)+'</b></td><td><span class="pill '+(t===3?'warn':t===2?'lv':'')+'">T'+t+'</span></td><td class="l mut">'+esc(r.s)+(extra?' · '+esc(extra):'')+(link?' · '+link:'')+'</td></tr>';
}
var KLAB={tx:'on-chain transfer',tr:'exchange trade',lq:'liquidation'};
function why1(r,rank,pool,total){
  var side=r.k==='tx'?'It’s an on-chain <b>transfer</b>: the amount includes change, and nothing says buy or sell, so I show no direction.':r.k==='tr'?'The exchange reports the taker side as <b>'+(r.side==='buy'?'BUY':'SELL')+'</b> (a single fill, not a trader’s whole position).':'The exchange reports it as a forced close of a <b>'+r.side+'</b> position.';
  return '<h4>Why I surfaced this</h4><p>It’s <b>#'+rank+'</b> of the <b>'+pool+'</b> item'+(pool===1?'':'s')+' ≥ $25k I kept in the last hour, ranked only by dollar size ('+fu(r.u)+', tier T'+tier(r.u)+').</p><h4>What I passed over</h4><p>The other '+(pool-1)+' kept item'+(pool===2?'':'s')+' were smaller'+(pool>3?' (I only highlight the top 3)':'')+'. '+side+' This is context, not a prediction: earlier backtests found large flows didn’t beat Kalshi’s price.</p>'}
function highlights(){
  var cut=nowS()-3600,pool=S.recs.filter(function(r){return r.t>=cut}).sort(function(a,b){return b.u-a.u}),top=pool.slice(0,3),m=Math.round((nowS()-CNT.since)/60);
  var h='<div class="mini" style="margin-bottom:12px"><h3>✨ Biggest moves I’m highlighting <span class="mut" style="font-weight:400">(last hour)</span></h3>';
  if(!top.length)h+='<div class="mut">Nothing ≥ $25k in the last hour yet. I’ll surface the biggest ones as they show up.</div>';
  top.forEach(function(r,i){h+='<div style="margin:6px 0"><b>'+fu(r.u)+'</b> '+KLAB[r.k]+(r.k==='tr'?' · taker <b class="'+(r.side==='buy'?'up-t':'dn-t')+'">'+(r.side==='buy'?'BUY':'SELL')+'</b>':r.k==='lq'?' · '+r.side+' position':'')+' <span class="mut">· '+hhmmss(r.t)+' · '+esc(r.s)+'</span>'+UI.xp('hi'+i,'Why this one?',why1(r,i+1,pool.length))+'</div>'});
  var t=CNT,shown=Math.min(40,S.recs.length);
  var tb='<table class="ftab"><thead><tr><th class="l">Feed</th><th>looked at</th><th>under $25k, passed over</th><th>duplicates rejected</th><th>kept (≥ $25k)</th></tr></thead><tbody>'+['tx','tr','lq'].map(function(k){return '<tr><td class="l">'+KINDS[k]+'</td><td>'+t[k].seen+'</td><td>'+t[k].below+'</td><td>'+t[k].dup+'</td><td>'+(t[k].seen-t[k].below)+'</td></tr>'}).join('')+'</tbody></table>';
  h+=UI.xp('passed','What else I considered (counts since this page opened '+(m<1?'a moment':m+' min')+' ago)','<p>Here’s everything I weighed, not just what I’m showing:</p>'+tb+'<p class="tiny">“Looked at” counts each new item once. Items under $25k are dropped on purpose; duplicates come from overlapping feed requests. Right now I’m listing the newest '+shown+' of the '+S.recs.length+' items I’ve kept (the list keeps at most '+CAP+').</p>');
  return h+'</div>';
}
var ROWSEEN=null;
function render(){
  var el=$('flowSum');if(!el)return;
  var p=price(),st=[];
  function pill(id,lab){var f=FEED[id];return '<span class="pill '+(f.ok===true?'ok':f.ok===false?'bad':'')+'" title="'+esc(f.err)+'">'+lab+': '+(f.ok===true?'live':f.ok===false?'unavailable — '+esc(f.err):'starting…')+'</span>'}
  var cv=function(f){var c=S.cov[f];return c.from?hhmm(c.from):'—'};
  $('flowStatus').innerHTML=pill('tx','Mempool (blockchain.info)')+' '+pill('bin','Binance')+' '+pill('okx','OKX trades')+' '+pill('lq','OKX liquidations')+'<div class="mut" style="font-size:12px;margin-top:4px">Watching since (continuous): mempool '+cv('tx')+' · Binance '+cv('bin')+' · OKX '+cv('okx')+' · '+(isFinite(p)?'BTC→USD at $'+Math.round(p).toLocaleString('en-US'):'waiting for a BTC price')+'</div>';
  el.innerHTML=highlights()+'<div class="ctxgrid">'
    +'<div class="mini"><h3>'+KINDS.tx+'</h3>'+sumTable('tx')+covNote(['tx'])+'<div class="mut ctxnote">Large <b>transfers</b>, not sales: the amount is the sum of all outputs including change, and nothing here says buy or sell. Sampled from the public mempool feed: each request returns only the latest 100 transactions (about 30 s worth when I checked), polled every ~25 s, so very busy moments can be undercounted.</div></div>'
    +'<div class="mini"><h3>'+KINDS.tr+'</h3>'+sumTable('tr','tr')+covNote(['bin','okx'])+'<div class="mut ctxnote">Single <b>trades</b> ≥ $25k (Binance aggregated fills, OKX fills). Taker side is reported by the exchange. USDT ≈ USD. One trade is one fill, not one trader’s full position. OKX returns only its latest 500 trades per request, so bursts can be undercounted.</div></div>'
    +'<div class="mini"><h3>'+KINDS.lq+'</h3>'+sumTable('lq','lq')+covNote(['lq'])+'<div class="mut ctxnote">Forced closes ≥ $25k. OKX’s REST feed only shows its latest handful, so this is a floor.</div></div></div>';
  var kind=($('flowKind')||{}).value||'all',list=S.recs.slice().filter(function(r){return kind==='all'||r.k===kind}).sort(function(a,b){return b.t-a.t}).slice(0,40);
  $('flowList').innerHTML='<table><thead><tr><th class="l">Seen</th><th class="l">What</th><th>Size</th><th>USD (when seen)</th><th>Tier</th><th class="l">Source</th></tr></thead><tbody>'+(list.map(function(r){return recLine(r,ROWSEEN&&!ROWSEEN[r.i])}).join('')||'<tr><td class="l mut" colspan="6">Nothing ≥ $25k recorded yet.</td></tr>')+'</tbody></table>';
  var ns={};list.forEach(function(r){ns[r.i]=1});ROWSEEN=ns;if(window.UI)UI.restore($('flowSum'));
  $('flowMeta').textContent=S.recs.length+' of the latest '+CAP+' items stored in this browser · per-minute totals kept ~3 h';
}
function csv(){
  var rows=['seen_local,seen_unix,kind,source,side_or_position,btc,usd_when_seen,tier,largest_output_btc,outputs,ref'];
  S.recs.slice().sort(function(a,b){return a.t-b.t}).forEach(function(r){rows.push([new Date(r.t*1000).toLocaleString(),Math.round(r.t),r.k==='tx'?'onchain_transfer':r.k==='tr'?'exchange_trade':'liquidation',r.s,r.side||'',r.b,Math.round(r.u),tier(r.u),r.mx||'',r.n||'',r.h||r.i].map(function(x){return '"'+String(x).replace(/"/g,'""')+'"'}).join(','))});
  var a=document.createElement('a');a.href=URL.createObjectURL(new Blob([rows.join('\n')],{type:'text/csv'}));a.download='pulse-large-flows.csv';document.body.appendChild(a);a.click();setTimeout(function(){URL.revokeObjectURL(a.href);a.remove()},500);
}
function clear(){S.recs=[];S.bk={};ids={};S.binLast=0;Object.keys(S.cov).forEach(function(k){S.cov[k]={from:0,last:0}});dirty=true;save();render()}
var started=false;
function start(){
  if(started)return;started=true;
  if($('flowCsv'))$('flowCsv').onclick=csv;
  if($('flowClear'))$('flowClear').onclick=function(){if(confirm('Clear the large-transfers record in this browser?'))clear()};
  if($('flowKind'))$('flowKind').onchange=render;
  render();tickFeeds();setInterval(tickFeeds,3000);setInterval(save,5000);setInterval(render,10000);
  window.addEventListener('pagehide',save);
  var w=setInterval(function(){if(isFinite(price())){clearInterval(w);FEED.tx.next=FEED.bin.next=FEED.okx.next=0;tickFeeds()}},1000);
  window.__flowsReady=true;
}
window.FlowTracker={_cnt:CNT,start:start,addLiq:addLiq,liqFail:liqFail,bcSample:bcSample,summary:summary,coverage:coverageFor,records:function(){return S.recs},buckets:function(){return S.bk},render:render,
  _add:addRec,_tier:tier,_clear:clear,_state:function(){return S},_status:function(){return FEED},_cover:cover};
})();
