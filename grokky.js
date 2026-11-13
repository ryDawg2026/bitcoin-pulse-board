/* Grokky 1 vs Grokky 2 — two PAPER-ONLY pickers that always take opposite sides of each 15-minute KXBTC15M window.
   Nothing here places an order or bet; it only records picks in this browser's localStorage and scores them against Kalshi's real settlement.
   Rule (stated on the page too):
     Grokky 1 = the v2 engine's direction for the window (closed candles only, so a late page open has no look-ahead).
     Grokky 2 = always the opposite side.
   The side is locked the first moment the engine has a call for the window and is never edited. At the very start of a window Kalshi's price is ~50¢ by construction,
   so "the Kalshi favorite" cannot pick sides then; Kalshi's price is only cited as an agree/disagree note.
   Each Grokky's short rationale is built ONLY from fields that actually loaded (engine signals, Kalshi price, BRTI gap, order book, funding, liquidations, Fear & Greed,
   large-trade flow). If nothing supports Grokky 2's side it says so ("forced opposite pick"); no reason is ever made up. Rationales are frozen once the context feeds are ready. */
(function(){
'use strict';
var Q=900,CAPN=1000,H=null,lastSig='',chart=null;
function $(i){return document.getElementById(i)}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function num(x){var v=parseFloat(x);return isFinite(v)?v:NaN}
function nowS(){return Math.floor(Date.now()/1000)}
function hhmm(t){return new Date(t*1000).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}
function hhmmss(t){return new Date(t*1000).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'})}
function mmss(s){s=Math.max(0,Math.round(s));return Math.floor(s/60)+':'+('0'+(s%60)).slice(-2)}
function usd(x,d){return isFinite(x)?'$'+x.toLocaleString('en-US',{minimumFractionDigits:d==null?0:d,maximumFractionDigits:d==null?0:d}):'—'}
function fu(x){return x>=1e6?'$'+(x/1e6).toFixed(2)+'M':x>=1e3?'$'+Math.round(x/1e3)+'k':'$'+Math.round(x)}
function st(){return H.state()}
function opp(d){return d==='UP'?'DOWN':'UP'}
function cls(d){return d==='UP'?'up-t':'dn-t'}
function arrow(d){return d==='UP'?'▲ UP':'▼ DOWN'}

/* ---------- what I've learned (separate key; never touches picks history) ----------
   pulseboard.learn.v1 = {v:1, sig:{key:{n,hit}}, done:{W:1}}. For every SETTLED round I credit each stored reading that pointed the winning way ("hit") or the losing way.
   Trust multiplier for a reading = 1 + 2·(smoothed accuracy − 50%), smoothed with a 50%-prior worth 10 rounds, bounded to 0.7×–1.3×, and only once that reading has been seen in 20 settled rounds.
   Only Grokky 1's pick can move, and only through the ENGINE's own signals (multipliers re-weight the engine's published coefficients). Grokky 2 is still always opposite Grokky 1. */
var LK='pulseboard.learn.v1',LEARN=null,L_MIN=20,L_LO=0.7,L_HI=1.3;
function loadLearn(){if(LEARN)return LEARN;try{var s=JSON.parse(localStorage.getItem(LK)||'null');if(s&&s.v===1&&s.sig){LEARN=s;if(!s.done)s.done={};return s}}catch(e){}LEARN={v:1,sig:{},done:{}};return LEARN}
function saveLearn(){try{localStorage.setItem(LK,JSON.stringify(LEARN))}catch(e){}}
var LEGACY=[[/^1-hour overshoot/,'z4'],[/^Last-candle overshoot/,'z1'],[/^RSI\(14\) mean/,'rsi'],[/^Close location/,'clv'],[/^Cross-exchange premium/,'prem'],[/^Kalshi prices UP/,'kalshi'],[/^BRTI settlement average/,'gap'],[/^Kalshi order book/,'book'],[/^Large exchange trades/,'flow'],[/^OKX perp funding/,'funding'],[/^OKX liquidations/,'liq'],[/^Fear & Greed/,'fng'],[/^Chart \(/,'chart']];
var LNAME={z4:'1-hour overshoot fade',z1:'last-candle overshoot',rsi:'RSI mean-reversion',clv:'close location',prem:'USD/USDT premium',kalshi:'Kalshi price',gap:'settlement gap',book:'order book',flow:'large-trade flow',funding:'funding rate',liq:'liquidations',fng:'Fear & Greed',chart:'chart overshoot','i:strike':'distance to strike','i:ema':'EMA cross','i:mom':'momentum','i:vwap':'VWAP','i:drift':'move since open','i:rsi':'1-min RSI','i:stretch':'30-min stretch','i:cvd':'CVD (buyers vs sellers)','i:prem':'Coinbase-vs-Binance premium','i:book':'Kalshi book'};
function keyOf(x){if(!x)return null;if(x.k)return (x.src==='ind'?'i:':'')+x.k;for(var i=0;i<LEGACY.length;i++)if(LEGACY[i][0].test(String(x.txt||'')))return LEGACY[i][1];return null}
function learnFrom(r){ // credit one settled round (once)
  if(!r||!r.winner||!r.why||!r.why.items)return false;var L=loadLearn();if(L.done[r.W])return false;
  var res=r.kres==='yes'?'UP':'DOWN',seen={};
  r.why.items.forEach(function(x){var k=keyOf(x);if(!k||seen[k])return;seen[k]=1;var e=L.sig[k]||(L.sig[k]={n:0,hit:0});e.n++;if(x.dir===res)e.hit++});
  L.done[r.W]=1;var ks=Object.keys(L.done).map(Number).sort(function(a,b){return a-b});while(ks.length>800)delete L.done[ks.shift()];
  saveLearn();return true;
}
function learnAll(){var G=st().groks||{},ch=0;Object.keys(G).forEach(function(w){if(learnFrom(G[w]))ch++});return ch}
function acc(e){return (e.hit+5)/(e.n+10)}
function mult(k){var e=loadLearn().sig[k];if(!e||e.n<L_MIN)return 1;return clamp(1+2*(acc(e)-0.5),L_LO,L_HI)}
function clamp(x,a,b){return Math.max(a,Math.min(b,x))}
function learnSummary(){
  var L=loadLearn(),rounds=Object.keys(L.done).length,rows=Object.keys(L.sig).map(function(k){var e=L.sig[k];return {k:k,n:e.n,hit:e.hit,a:e.n?e.hit/e.n:0,m:mult(k)}}).filter(function(x){return x.n>=3});
  rows.sort(function(a,b){return b.a-a.a||b.n-a.n});
  return {rounds:rounds,rows:rows,best:rows.slice(0,2),moved:rows.filter(function(x){return x.m!==1})};
}
function learnNote(n,rec){
  var ls=learnSummary(),h='<h4>🌱 What I’ve learned</h4>';
  if(!ls.rounds)return h+'<p>I’m just getting started: once rounds settle I’ll keep score of which readings pointed the right way and gently adjust how much I trust them. Nothing to report yet.</p>';
  h+='<p>I’ve checked <b>'+ls.rounds+'</b> settled round'+(ls.rounds===1?'':'s')+' so far, crediting each reading that pointed the winning way.</p>';
  function line(x){return (LNAME[x.k]||x.k)+': right '+x.hit+' of '+x.n+' ('+Math.round(x.a*100)+'%)'}
  if(ls.rows.length){var top=ls.rows.slice(0,2),bot=ls.rows.slice(-2).filter(function(x){return top.indexOf(x)<0});
    h+='<p class="tiny">Best so far: '+esc(top.map(line).join(' · '))+(bot.length?'<br>Weakest so far: '+esc(bot.map(line).join(' · ')):'')+'</p>'}
  h+=ls.moved.length?'<p>Because readings need at least '+L_MIN+' settled rounds before I adjust, here’s what I now trust differently (always between '+L_LO+'× and '+L_HI+'×): '+esc(ls.moved.map(function(x){return (LNAME[x.k]||x.k)+' '+x.m.toFixed(2)+'×'}).join(', '))+'.</p>':'<p>I only adjust my trust in a reading after it has been seen in '+L_MIN+' settled rounds (and never by more than '+Math.round((L_HI-1)*100)+'%), so for now every reading still counts at 1.0×.</p>';
  if(rec&&rec.learn)h+=n===1?'<p>'+(rec.learn.flipped?'This round my learning <b>changed my pick</b>: the engine said '+arrow(rec.learn.raw)+', but after re-weighting its signals I went with '+arrow(rec.g1)+'.':'This round my learning didn’t change my pick: I stayed with the engine’s '+arrow(rec.g1)+'.')+'</p>':'<p>I never change my rule: I take the opposite side of Grokky 1. What I learn changes which readings I trust, not my side.</p>';
  return h;
}

/* ---------- lock ---------- */
function lock(W,call){
  var s=st();if(!s.groks)s.groks={};var G=s.groks;
  if(G[W]||!call||(call.dir!=='UP'&&call.dir!=='DOWN'))return G[W]||null;
  var now=nowS();
  var dir=call.dir,conf=call.conf,pUp=1/(1+Math.exp(-(call.score||0))),lrn=null;
  try{loadLearn();var adj=0,ch=[];(call.signals||[]).forEach(function(sg){var m=mult(sg.k);adj+=sg.w*sg.vote*m;if(m!==1)ch.push({k:sg.k,m:+m.toFixed(3)})});
    if(ch.length){var ad=adj>0?'UP':adj<0?'DOWN':call.dir;lrn={raw:call.dir,flipped:ad!==call.dir,adj:+adj.toFixed(4),changed:ch};
      if(lrn.flipped){dir=ad;pUp=1/(1+Math.exp(-adj));conf=Math.round((dir==='UP'?pUp:1-pUp)*100)}}
    else lrn={raw:call.dir,flipped:false,adj:null,changed:[]}}catch(e){}
  G[W]={W:W,g1:dir,g2:opp(dir),conf:conf,pUp:pUp,noedge:!!call.noedge,strong:!!call.strong,lockedAt:now,late:now-W>90,why:null,kres:null,winner:null,learn:lrn};
  var ks=Object.keys(G).map(Number).sort(function(a,b){return a-b});while(ks.length>CAPN)delete G[ks.shift()];
  H.save();return G[W];
}

/* ---------- evidence (real fields only) ---------- */
function kalshiNow(W){
  var kp=window.KalshiPanel,l=kp&&kp.last&&kp.last(),m=l&&l.current;if(!m)return null;
  var w=Math.round(Date.parse(m.close_time)/1000)-Q;if(w!==W)return null;
  var b=num(m.yes_bid_dollars),a=num(m.yes_ask_dollars),p=num(m.last_price_dollars),mid=(b>0&&a>0&&a<=1)?(b+a)/2:p;if(!(mid>0))mid=NaN; // a 0¢ price means "no market yet", never a reading
  return {mid:mid,strike:num(m.floor_strike),via:l._via,age:nowS()-(l.fetched_at||nowS())};
}
function items(rec,call,snap,kal){
  var it=[],neutral=[],passed=[];
  (call&&call.signals||[]).forEach(function(s){var c=s.w*s.vote;if(!isFinite(c))return;if(Math.abs(c)<0.003){passed.push('Engine signal “'+s.name+'”: '+s.desc+' — too close to neutral to count');return}it.push({src:'engine',pr:0,k:s.k,dir:c>0?'UP':'DOWN',m:Math.abs(c),txt:s.name+' — '+s.desc})});
  if(kal&&isFinite(kal.mid)){var d=kal.mid-.5;
    if(Math.abs(d)>=.02)it.push({src:'kalshi',pr:7,dir:d>0?'UP':'DOWN',m:Math.abs(d),txt:'Kalshi prices UP at '+Math.round(kal.mid*100)+'¢, so the crowd leans '+(d>0?'UP':'DOWN')});
    else neutral.push('Kalshi prices this window at about even ('+Math.round(kal.mid*100)+'¢ UP), as expected near the open, so it doesn’t pick a side.')}
  else neutral.push('Kalshi price not loaded for this window.');
  if(snap){
    var g=snap.gap;if(g&&isFinite(g.gap)){if(Math.abs(g.gap)>=1)it.push({src:'ctx',pr:1,dir:g.gap>0?'UP':'DOWN',m:1,txt:'BRTI settlement average is '+usd(Math.abs(g.gap),0)+(g.gap>0?' above':' below')+' the strike with '+mmss(g.tl)+' left ('+(g.gap>0?'UP':'DOWN')+' if it ended now)'});else passed.push('Settlement gap: the BRTI average is within $1 of the strike, so it favours neither side')}else passed.push('Settlement gap: couldn’t read it (feed not loaded)');
    var b=snap.book;if(b&&isFinite(b.imb)){if(Math.abs(b.imb)>=.15)it.push({src:'ctx',pr:2,dir:b.imb>0?'UP':'DOWN',m:Math.abs(b.imb),txt:'Kalshi order book: '+Math.round(Math.abs(b.imb)*100)+'% more resting size on the '+(b.imb>0?'UP':'DOWN')+' side'});else passed.push('Kalshi order book: only '+Math.round(Math.abs(b.imb)*100)+'% more size on '+(b.imb>0?'UP':'DOWN')+' (I need 15% or more)')}else passed.push('Kalshi order book: couldn’t read it (feed not loaded)');
    var f=snap.flow;if(f&&f.cover>=300&&f.buy+f.sell>=1e6){var r=f.buy/Math.max(f.sell,1);
      if(r>=1.5)it.push({src:'ctx',pr:3,dir:'UP',m:r,txt:'Large exchange trades (≥$25k, Binance+OKX, last 15 min): taker buys '+fu(f.buy)+' vs taker sells '+fu(f.sell)+' (follows the flow)'});
      else if(r<=1/1.5)it.push({src:'ctx',pr:3,dir:'DOWN',m:1/r,txt:'Large exchange trades (≥$25k, Binance+OKX, last 15 min): taker sells '+fu(f.sell)+' vs taker buys '+fu(f.buy)+' (follows the flow)'});
      else passed.push('Large exchange trades: buys '+fu(f.buy)+' vs sells '+fu(f.sell)+' — balanced (I need a 1.5× lean)')}
    else passed.push('Large exchange trades: '+(f?'only '+Math.round((f.cover||0)/60)+' min watched or under $1M traded in 15 min — too little to read':'not watched yet'));
    var fr=snap.funding;if(fr&&isFinite(fr.rate)){
      if(fr.rate>=0.02)it.push({src:'ctx',pr:4,dir:'DOWN',m:fr.rate,txt:'OKX perp funding '+(fr.rate>=0?'+':'')+fr.rate.toFixed(4)+'% per 8 h: longs are paying, crowded long side (contrarian reading → DOWN)'});
      else if(fr.rate<=-0.005)it.push({src:'ctx',pr:4,dir:'UP',m:Math.abs(fr.rate),txt:'OKX perp funding '+fr.rate.toFixed(4)+'% per 8 h: shorts are paying, crowded short side (contrarian reading → UP)'});
      else passed.push('OKX funding '+(fr.rate>=0?'+':'')+fr.rate.toFixed(4)+'% per 8 h — inside my normal band, so no crowded side')}else passed.push('OKX funding: couldn’t read it (feed not loaded)');
    var l=snap.liq;if(l&&l.L+l.S>=5e5){
      if(l.L>=3*l.S)it.push({src:'ctx',pr:5,dir:'UP',m:l.L/Math.max(l.S,1),txt:'OKX liquidations last 60 min: longs '+fu(l.L)+' vs shorts '+fu(l.S)+' — forced selling already happened (contrarian reading → bounce UP)'});
      else if(l.S>=3*l.L)it.push({src:'ctx',pr:5,dir:'DOWN',m:l.S/Math.max(l.L,1),txt:'OKX liquidations last 60 min: shorts '+fu(l.S)+' vs longs '+fu(l.L)+' — squeeze already happened (contrarian reading → pullback DOWN)'});
      else passed.push('OKX liquidations last hour: longs '+fu(l.L)+' vs shorts '+fu(l.S)+' — not lopsided enough (I need 3×)')}
    else passed.push('OKX liquidations last hour: '+(l?'only '+fu(l.L+l.S)+' — too small to read':'couldn’t read them (feed not loaded)'));
    var fg=snap.fng;if(fg&&isFinite(fg.v)){
      if(fg.v<=25)it.push({src:'ctx',pr:6,dir:'UP',m:(25-fg.v)/25,txt:'Fear & Greed '+fg.v+' ('+fg.cls+'): extreme fear (contrarian reading → UP; daily index, slow-moving)'});
      else if(fg.v>=75)it.push({src:'ctx',pr:6,dir:'DOWN',m:(fg.v-75)/25,txt:'Fear & Greed '+fg.v+' ('+fg.cls+'): extreme greed (contrarian reading → DOWN; daily index, slow-moving)'});
      else passed.push('Fear & Greed '+fg.v+' ('+fg.cls+'): middle of the range, so no contrarian reading')}
    if(snap.sit)neutral.push('High-impact release window ('+snap.sit+'): prices can jump on the print, so this round is closer to a coin flip.');
  }else neutral.push('Market-context feeds were not ready, so only engine signals are cited.');
  var cr=window.ChartPanel&&ChartPanel.reading&&ChartPanel.reading();
  if(cr&&Math.abs(cr.z)>=1.5)it.push({src:'chart',pr:8,dir:cr.z>0?'DOWN':'UP',m:Math.abs(cr.z),txt:'Chart ('+(cr.src||'1-minute candles')+'): BTC moved '+(cr.move>=0?'+':'−')+usd(Math.abs(cr.move),0)+' in the last 10 minutes ('+(cr.z>=0?'+':'−')+Math.abs(cr.z).toFixed(1)+'× a typical 10-minute move), an overshoot that tends to give back (mean-reversion reading → '+(cr.z>0?'DOWN':'UP')+'; only a small backtested edge)'});
  else if(cr)passed.push('Chart: the last 10 minutes moved '+(cr.move>=0?'+':'−')+usd(Math.abs(cr.move),0)+' ('+Math.abs(cr.z).toFixed(1)+'× typical) — not an overshoot, so no side');
  var CK={1:'gap',2:'book',3:'flow',4:'funding',5:'liq',6:'fng'};it.forEach(function(x){if(!x.k)x.k=x.src==='kalshi'?'kalshi':x.src==='chart'?'chart':CK[x.pr]});
  // price-action indicators (1-minute candles + Binance taker volume), read-only; only readings with a clear lean count
  var iv=window.CallersPanel&&CallersPanel.latest&&CallersPanel.latest(rec.W);
  if(iv&&iv.ok)iv.signals.forEach(function(sg){if(sg.group==='grokky'||sg.group==='info'||sg.k==='crowd'||sg.k==='book')return;
    if(sg.na)passed.push('Price action “'+sg.name+'”: '+sg.desc);
    else if(Math.abs(sg.vote)>=0.25)it.push({src:'ind',pr:9,k:sg.k,dir:sg.vote>0?'UP':'DOWN',m:Math.abs(sg.vote),txt:'Price action: '+sg.desc});
    else passed.push('Price action “'+sg.name+'”: '+sg.desc+' — too mild to count')});
  else if(rec.W===Math.floor(nowS()/Q)*Q)passed.push('Price-action indicators (VWAP, EMA, RSI, ATR, CVD…) weren’t loaded yet when I froze my reasons.');
  it.forEach(function(x,i){x.i=i});
  if(rec.noedge)neutral.push('The engine reports NO EDGE: its signals nearly cancel (backtest: coin flip). Scored anyway, because one side always wins.');
  return {it:it,neutral:neutral,passed:passed};
}
function pick(it,side,ctxFirst){
  var mine=it.filter(function(x){return x.dir===side}),against=it.length-mine.length;
  mine.sort(function(a,b){var ae=a.src==='engine'?1:0,be=b.src==='engine'?1:0;if(ae!==be)return ctxFirst?ae-be:be-ae;return ae?b.m-a.m:a.pr-b.pr});
  var top=mine.slice(0,4);return {lines:top.map(function(x){return x.txt}),idx:top.map(function(x){return x.i}),n:mine.length,against:against};
}
function buildWhy(rec){
  var call=st().calls&&st().calls[rec.W],snap=window.ContextPanel&&ContextPanel.snapshot?ContextPanel.snapshot(rec.W):null,kal=kalshiNow(rec.W);
  var e=items(rec,call,snap,kal),p1=pick(e.it,rec.g1,false),p2=pick(e.it,rec.g2,true);
  var ty=window.ChartPanel&&ChartPanel.typical15&&ChartPanel.typical15();
  return {at:nowS(),g1:p1,g2:p2,neutral:e.neutral,passed:e.passed.slice(0,18).map(function(x){return String(x).slice(0,230)}),forced2:p2.lines.length===0,haveCtx:!!snap,items:e.it.slice(0,26).map(function(x){return {src:x.src,k:x.k,dir:x.dir,m:+(+x.m).toFixed(4),txt:String(x.txt).slice(0,230)}}),typ:ty&&isFinite(ty.usd)?{usd:Math.round(ty.usd*100)/100,pct:ty.pct}:null};
}
function maybeFreeze(rec,now){
  if(rec.why||now>=rec.W+Q)return;
  if(window.__ctxReady||now-rec.lockedAt>=45)rec.why=buildWhy(rec),H.save();
}

/* ---------- scoring against Kalshi's real settlement ---------- */
function onKalshi(d){
  var s=st(),G=s.groks||{},changed=0;
  ((d&&d.settled)||[]).forEach(function(m){
    var res=m.result;if(res!=='yes'&&res!=='no')return;
    var W=Math.round(Date.parse(m.close_time)/1000)-Q,r=G[W];if(!r||r.winner)return;
    r.kres=res;r.kexp=num(m.expiration_value);r.kstrike=num(m.floor_strike);
    r.winner=((r.g1==='UP')===(res==='yes'))?1:2;changed++;
  });
  if(changed){learnAll();H.save();update(true)}
  return changed;
}
function ensurePx(now){
  if(!window.ChartPanel||!ChartPanel.windowStats)return;var G=st().groks||{},ks=Object.keys(G).map(Number).sort(function(a,b){return b-a}).slice(0,6),ch=false;
  ks.forEach(function(w){var r=G[w];if(!r.winner||r.px!==undefined||!isFinite(r.kstrike))return;var px=ChartPanel.windowStats(w,r.kstrike);if(px){r.px=px;ch=true}else if(now-(w+Q)>4*3600){r.px=false;ch=true}});
  if(ch)H.save();
}
function tally(now){
  now=now||nowS();var G=st().groks||{},ks=Object.keys(G).map(Number).sort(function(a,b){return a-b}),sc=[],pend=0,t={w1:0,w2:0,n:0,pend:0,ne:{n:0,w1:0,w2:0},cur:null,best1:0,best2:0,cur1:0,cur2:0,rows:ks.map(function(w){return G[w]})};
  ks.forEach(function(w){var r=G[w];if(r.winner){sc.push(r);if(r.winner===1)t.w1++;else t.w2++;if(r.noedge){t.ne.n++;if(r.winner===1)t.ne.w1++;else t.ne.w2++}}else if(w+Q<=now)pend++});
  t.n=sc.length;t.pend=pend;
  // streaks (positive = wins in a row, negative = losses in a row), newest outcome backwards
  if(sc.length){var last=sc[sc.length-1].winner,k=0;for(var i=sc.length-1;i>=0&&sc[i].winner===last;i--)k++;t.cur1=last===1?k:-k;t.cur2=last===2?k:-k;
    var b1=0,b2=0,c1=0,c2=0;sc.forEach(function(r){if(r.winner===1){c1++;c2=0}else{c2++;c1=0}b1=Math.max(b1,c1);b2=Math.max(b2,c2)});t.best1=b1;t.best2=b2}
  t.scored=sc;return t;
}
function streakTxt(n){return n===0?'—':(n>0?'W':'L')+Math.abs(n)}

/* ---------- rendering ---------- */
function windowMove(rec){
  var g=window.__pulseNow||{},kal=kalshiNow(rec.W),price=g.med,ref=kal&&isFinite(kal.strike)?kal.strike:g.winOpen,lab=kal&&isFinite(kal.strike)?'strike':'consensus open';
  if(!isFinite(price)||!isFinite(ref))return null;return {d:price-ref,lab:lab};
}
/* ---------- the two characters: simple inline SVG avatars ---------- */
function avatar(n,k){
  var c1=n===1?'#2f9fb5':'#ff6f61',c2=n===1?'#8cebd9':'#ffc980',id='gg'+n+(k||'');
  return '<svg class="av av'+n+'" viewBox="0 0 64 64" role="img" aria-label="Grokky '+n+' avatar"><defs><linearGradient id="'+id+'" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="'+c2+'"/><stop offset="1" stop-color="'+c1+'"/></linearGradient></defs>'
   +(n===1?'<line x1="32" y1="5" x2="32" y2="14" stroke="'+c1+'" stroke-width="3" stroke-linecap="round"/><circle cx="32" cy="5.5" r="4" fill="#ffb454"/>':'<path d="M17 16 L21 5 L29 14 Z M35 14 L43 5 L47 16 Z" fill="'+c1+'"/>')
   +'<rect x="7" y="12" width="50" height="47" rx="23" fill="url(#'+id+')"/>'
   +'<g class="eyes"><ellipse cx="23" cy="31" rx="6.2" ry="7" fill="#fff"/><ellipse cx="41" cy="31" rx="6.2" ry="7" fill="#fff"/><circle cx="24.6" cy="32" r="3.1" fill="#2a1d16"/><circle cx="42.6" cy="32" r="3.1" fill="#2a1d16"/></g>'
   +(n===1?'<path d="M22 45 Q32 54 42 45" stroke="#2a1d16" stroke-width="3" fill="none" stroke-linecap="round"/>':'<path d="M22 47 Q33 49 43 41" stroke="#2a1d16" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M15 22 L28 26 M49 22 L36 26" stroke="#2a1d16" stroke-width="3" stroke-linecap="round"/>')
   +'<circle cx="14" cy="43" r="4" fill="#ff9aa2" opacity=".55"/><circle cx="50" cy="43" r="4" fill="#ff9aa2" opacity=".55"/></svg>';
}
/* ---------- decision trail for a pick (why chosen + what else I considered) ---------- */
function liUl(a){return a.length?'<ul>'+a.map(function(x){return '<li>'+esc(x)+'</li>'}).join('')+'</ul>':''}
function pickTrail(n,rec,side){
  var why=rec.why,o=opp(side);
  if(!why)return {teaser:'',why:'<p>I’m still collecting readings (settlement gap, funding, liquidations…) before I write down my reasons. Give me a few seconds.</p>',more:'<p>I’ll list everything I looked at here once my reasons are frozen.</p>'};
  var me=n===1?why.g1:why.g2,forced=n===2&&why.forced2,items=why.items,passed=why.passed||[];
  var w='<h4>Why I picked '+arrow(side)+'</h4>';
  w+=n===1?'<p>I follow the engine. Its blended score puts '+arrow(side)+' at <b>'+rec.conf+'%</b> against '+(100-rec.conf)+'% for the other side, and I never switch once I’ve locked in.</p>'
          :'<p>My rule is to take the opposite side of Grokky 1, who’s on '+arrow(rec.g1)+'. The engine gives my side <b>'+(100-rec.conf)+'%</b>.</p>';
  w+=forced?'<p>Honestly, nothing on the board points to '+arrow(side)+', so this is a forced opposite pick: I’m the designated contrarian.</p>'
           :(me.lines.length?'<p>The readings I lean on:</p>'+liUl(me.lines):'<p>No single reading clears its threshold toward '+arrow(side)+', so I’m sticking with my rule.</p>');
  w+='<p class="tiny">'+me.n+' reading'+(me.n===1?'':'s')+' point my way and '+me.against+' point the other way. These readings are context: earlier backtests found no reliable 15-minute edge in them.</p>';
  var m='<h4>What else I considered</h4>';
  if(items){var same=items.filter(function(x){return x.dir===side}),other=items.filter(function(x){return x.dir!==side}),total=items.length+passed.length;
    m+='<p>I looked at <b>'+total+'</b> readings in total: <b>'+items.length+'</b> were strong enough to count ('+same.length+' toward '+arrow(side)+', '+other.length+' toward '+arrow(o)+') and <b>'+passed.length+'</b> were too weak or unavailable. I show my top '+me.lines.length+' above.</p>';
    if(other.length)m+='<h4>Pointing the other way ('+arrow(o)+')</h4>'+liUl(other.slice(0,4).map(function(x){return x.txt}));
  }else m+='<p>I didn’t save the full list of readings for this round (it was locked before I started keeping it), so I can only show my main reasons.</p>';
  if(passed.length)m+='<h4>Looked at, but didn’t count</h4>'+liUl(passed.slice(0,10));
  if(why.neutral&&why.neutral.length)m+='<h4>Had no side to give</h4>'+liUl(why.neutral);
  m+=learnNote(n,rec);
  var tz=forced?'Honestly, nothing on the board points to '+arrow(side)+' — I’m the designated contrarian, so this is a forced opposite pick.':(me.lines.length?'Mostly because: '+me.lines[0]:'No single reading clears its threshold, so I’m sticking with my rule.');
  return {teaser:tz,why:w,more:m};
}
function cardHtml(n,rec,t){
  var side=rec?(n===1?rec.g1:rec.g2):null,w=n===1?t.w1:t.w2,l=n===1?t.w2:t.w1,tot=t.n,cur=n===1?t.cur1:t.cur2;
  var head='<div class="gkhead">'+avatar(n,'c')+'<div class="gkname"><b>Grokky '+n+'</b><small>'+(n===1?'I follow the v2 engine':'I always take the other side')+'</small></div>'+(rec&&rec.noedge?' <span class="pill warn" title="the engine’s signals cancel out">no-edge round</span>':'')+'</div>';
  if(!rec)return head+'<div class="bubble">Hi, I’m Grokky '+n+'! I’m waiting for the engine’s call for this window — it needs about 100 candles from at least 3 sources. I’ll share my pick the moment it’s ready.</div>'+foot(n,w,l,tot,cur);
  var now=nowS(),mv=windowMove(rec),on=mv&&Math.abs(mv.d)>0?((mv.d>0)===(side==='UP')):null,mine=n===1?rec.conf:100-rec.conf,pk='<span class="pickbig '+cls(side)+'">'+arrow(side)+'</span>';
  var say=n===1?'I’m going '+pk+' this round. The engine I follow puts that side at <b>'+mine+'%</b> — honestly only a little better than a coin flip.'
               :'I’m taking '+pk+' — the opposite of Grokky 1, like always. The engine gives my side just <b>'+mine+'%</b>, so I’m the underdog by design.';
  if(rec.noedge)say+=' The engine says there’s no real edge this time, so this one’s close to a toss-up.';
  var h=head+'<div class="bubble">'+say+'</div>';
  h+='<div class="gkmeta">🔒 I locked this in '+(rec.late?'<span class="warn">'+mmss(rec.lockedAt-rec.W)+' into the window</span> (this page opened mid-window; I only use closed candles, so it’s not hindsight)':(rec.lockedAt-rec.W>20?mmss(rec.lockedAt-rec.W)+' into the window, as soon as the engine had its call':'at window open'))+' at '+hhmmss(rec.lockedAt)+' · window '+hhmm(rec.W)+'–'+hhmm(rec.W+Q)+' · ⏳ <b class="gkleft">§</b> left'
    +(mv?' · BTC '+(mv.d>=0?'+':'−')+usd(Math.abs(mv.d),2)+' vs '+mv.lab+(on===null?'':on?' <span class="up-t">✓ I’m on track</span>':' <span class="dn-t">✗ I’m off track</span>'):'')+'</div>';
  var tr=pickTrail(n,rec,side);
  if(tr.teaser)h+='<div class="teaser">'+esc(tr.teaser)+'</div>';
  h+=UI.xp('why'+n,'Why? How I chose '+arrow(side),tr.why)+UI.xp('more'+n,'What else I considered',tr.more);
  return h+foot(n,w,l,tot,cur);
}
function foot(n,w,l,tot,cur){return '<div class="gkfoot"><span>My record <b>'+UI.cu('gkw'+n,w)+' W</b> / <b>'+UI.cu('gkl'+n,l)+' L</b></span><span>'+(tot?'<b>'+UI.cu('gkr'+n,w/tot*100,{d:1,suf:'%'})+'</b> win rate':'no rounds scored yet')+'</span><span>streak <b class="'+(cur>0?'up-t':cur<0?'dn-t':'')+'">'+streakTxt(cur)+'</b></span></div><div class="tiny mut" style="font-size:12px;margin-top:6px">I only make paper picks: I never place bets or send anything to Kalshi.'+(function(){var r=Object.keys(loadLearn().done).length;return r?' 🌱 I’ve learned from '+r+' settled round'+(r===1?'':'s')+' so far.':''})()+'</div>'}
function resultCell(r,now){return r.winner?'<span class="'+(r.kres==='yes'?'up-t':'dn-t')+'">'+(r.kres==='yes'?'▲ UP':'▼ DOWN')+'</span>':(r.W+Q>now?'<span class="mut">in progress</span>':'<span class="mut">awaiting Kalshi settlement</span>')}
/* ---------- decision trail for a scored round ---------- */
function roundTrail(r){
  var out=r.kres==='yes'?'UP':'DOWN',why=r.why,h='<h4>What happened</h4><p>Kalshi settled <b class="'+cls(out)+'">'+arrow(out)+'</b>'+(isFinite(r.kexp)&&isFinite(r.kstrike)?' ('+usd(r.kexp,2)+' vs a strike of '+usd(r.kstrike,2)+', '+(r.kexp-r.kstrike>=0?'+':'−')+usd(Math.abs(r.kexp-r.kstrike),2)+')':'')+', so <b>Grokky '+r.winner+'</b> was right.'+(r.noedge?' The engine had called this one “no edge”.':'')+'</p>';
  if(!why)return h+'<p>I never froze my reasons for this round (the page wasn’t open long enough), so there’s no trail to show.</p>';
  [1,2].forEach(function(n){var me=n===1?why.g1:why.g2,side=n===1?r.g1:r.g2,forced=n===2&&why.forced2;
    h+='<h4>Grokky '+n+': why I picked '+arrow(side)+(r.winner===n?' ✓':' ✗')+'</h4>'+(forced?'<p>Nothing on the board pointed that way: a forced opposite pick.</p>':(me.lines.length?liUl(me.lines):'<p>No single reading cleared its threshold.</p>'))});
  if(why.items){var rt=why.items.filter(function(x){return x.dir===out});
    h+='<h4>What else we considered</h4><p>Between us we looked at <b>'+(why.items.length+(why.passed||[]).length)+'</b> readings: '+why.items.length+' strong enough to count ('+why.items.filter(function(x){return x.dir==='UP'}).length+' UP, '+why.items.filter(function(x){return x.dir==='DOWN'}).length+' DOWN) and '+(why.passed||[]).length+' too weak or unavailable. '+rt.length+' of the strong ones pointed '+arrow(out)+', the way it went.</p>'+(rt.length?liUl(rt.slice(0,3).map(function(x){return x.txt})):'')
      +((why.passed||[]).length?'<p class="tiny">Passed over: '+esc((why.passed||[]).slice(0,4).join(' · '))+((why.passed||[]).length>4?' · +'+((why.passed||[]).length-4)+' more':'')+'</p>':'');
  }else h+='<p class="tiny">The full list of readings wasn’t saved for this round.</p>';
  return h;
}
var SEENROWS=null;
function renderScore(t,now){
  var el=$('gkScore');if(!el)return;
  var rows=t.rows.slice().reverse().slice(0,40),first=SEENROWS===null;
  var ne=t.ne.n?('Rounds the engine called “no edge”: <b>'+t.ne.n+'</b> so far (Grokky 1 won '+t.ne.w1+', Grokky 2 won '+t.ne.w2+'). They still count, because one of us is always right.'):'No “no edge” rounds yet — they’ll still count when they happen, because one of us is always right.';
  var cols=[1,2].map(function(n){var w=n===1?t.w1:t.w2,cur=n===1?t.cur1:t.cur2,best=n===1?t.best1:t.best2,p=t.n?w/t.n*100:0;
    return '<div class="scorecol"><div class="row" style="gap:10px;flex-wrap:nowrap">'+avatar(n,'s')+'<div><div class="mut" style="font-size:12.5px">Grokky '+n+'</div><div style="font-size:20px;font-weight:750">'+UI.cu('sc'+n,w)+' <span class="mut" style="font-size:14px;font-weight:500">of '+t.n+' correct</span></div></div></div>'
      +UI.bar('bar'+n,Math.round(p*10)/10)+'<div class="mut" style="font-size:12.5px;margin-top:4px">'+(t.n?p.toFixed(1)+'% right · ':'')+'streak '+streakTxt(cur)+' · best run '+best+'</div></div>'}).join('');
  var h='<div class="row" style="gap:22px;margin-bottom:10px;align-items:flex-start">'+cols
    +'<div class="scorecol" style="flex:0 1 150px"><div class="mut" style="font-size:12.5px">Rounds scored</div><div style="font-size:24px;font-weight:750">'+UI.cu('rounds',t.n)+'</div><div class="mut" style="font-size:12.5px">'+(t.pend?t.pend+' waiting for Kalshi to settle':'none waiting')+'</div></div></div>'
    +'<div class="say">'+avatar(1,'q')+'<span>“Every round one of us is right, so please don’t read our record as skill. The engine I follow only has a small tested edge — about 50–52%.”</span></div>'
    +'<div class="say">'+avatar(2,'q')+'<span>“I’m always on the other side, so my wins are Grokky 1’s losses. If I’m ahead, it just means the engine has been unlucky lately — I’m not smarter.”</span></div>'
    +'<div class="mut" style="font-size:12.5px;margin:6px 0 8px">'+ne+'</div>'
    +'<div class="gkgrid"><div><div class="logwrap tw" style="max-height:300px"><table><thead><tr><th class="l">Window</th><th>Grokky 1</th><th>Grokky 2</th><th>Kalshi result</th><th>Winner</th><th class="l">Notes</th></tr></thead><tbody>'
    +(rows.map(function(r){var open=r.winner,isNew=!first&&!SEENROWS[r.W];
      return '<tr'+(open?' data-w="'+r.W+'" class="clk'+(isNew?' rowin':'')+'" title="Click to open the decision trail for this round"':(isNew?' class="rowin"':''))+'><td class="l">'+hhmm(r.W)+'–'+hhmm(r.W+Q)+'</td><td class="'+cls(r.g1)+'">'+r.g1+'</td><td class="'+cls(r.g2)+'">'+r.g2+'</td><td>'+resultCell(r,now)+'</td><td>'+(r.winner?'<b>Grokky '+r.winner+'</b>':'—')+'</td><td class="l mut"'+(r.winner&&isFinite(r.kexp)&&isFinite(r.kstrike)?' title="Kalshi settled at '+usd(r.kexp,2)+' vs strike '+usd(r.kstrike,2)+'"':'')+'>'+[r.noedge?'no edge':'',r.late?'late lock':''].filter(Boolean).join(' · ')+(r.winner?' <span class="chip">Why? <span class="chev" style="display:inline-block">▸</span></span>':'')+'</td></tr>'
        +(open?'<tr class="dtl"><td colspan="6"><div class="xp" data-xid="row'+r.W+'"><div class="xpin"><div class="xpbody">'+roundTrail(r)+'</div></div></div></td></tr>':'')}).join('')||'<tr><td class="l mut" colspan="6">No rounds yet — my first pick locks at the next window open and gets scored once Kalshi settles it.</td></tr>')
    +'</tbody></table></div>'+(t.rows.length>rows.length?'<div class="mut tiny" style="font-size:12px;margin-top:4px">Showing the latest '+rows.length+' of '+t.rows.length+' rounds (the CSV has all of them).</div>':'')+'</div><div class="chartbox" style="height:210px"><canvas id="gkChart"></canvas></div></div>';
  var sig=t.rows.length+':'+t.n+':'+t.pend+':'+rows.map(function(r){return (r.winner||0)+(r.late?'l':'')}).join('');
  if(sig!==lastSig||!$('gkChart')){lastSig=sig;el.innerHTML=h;chart=null;drawChart(t);UI.restore(el);UI.countAll(el);UI.settleBars(el)}
  var seen={};t.rows.forEach(function(r){seen[r.W]=1});SEENROWS=seen;
}
function drawChart(t){
  if(typeof Chart==='undefined'||!$('gkChart'))return;
  var lab=[],a=[],b=[],x=0,y=0;t.scored.forEach(function(r){if(r.winner===1)x++;else y++;lab.push(hhmm(r.W));a.push(x);b.push(y)});
  chart=new Chart($('gkChart'),{type:'line',data:{labels:lab,datasets:[{label:'Grokky 1 correct (cumulative)',data:a,borderColor:'#5aa9ff',pointRadius:0,borderWidth:2,stepped:true},{label:'Grokky 2 correct (cumulative)',data:b,borderColor:'#ffb454',borderDash:[5,3],pointRadius:0,borderWidth:2,stepped:true}]},
    options:{responsive:true,maintainAspectRatio:false,animation:false,plugins:{legend:{labels:{color:'#c9b8a8',boxWidth:10,font:{size:11}}}},scales:{x:{ticks:{color:'#c9b8a8',maxTicksLimit:6},grid:{color:'#3d3027'}},y:{beginAtZero:true,ticks:{color:'#c9b8a8',precision:0},grid:{color:'#3d3027'}}}}});
}

/* ---------- why a pick lost: first-person, only from data stored for that round ---------- */
var PMSEL=null,PMDEMO=null;
function li(a){return a.length?'<ul>'+a.map(function(x){return '<li>'+esc(x)+'</li>'}).join('')+'</ul>':''}
function postMortem(rec,demo){
  if(!rec||!rec.winner)return '';
  var n=rec.winner===1?2:1,side=n===1?rec.g1:rec.g2,out=rec.kres==='yes'?'UP':'DOWN',why=rec.why,me=why&&(n===1?why.g1:why.g2),mine=rec.conf!=null?(n===1?rec.conf:100-rec.conf):null;
  var move=(isFinite(rec.kexp)&&isFinite(rec.kstrike))?rec.kexp-rec.kstrike:NaN,typ=why&&why.typ&&isFinite(why.typ.usd)&&why.typ.usd>0?why.typ.usd:NaN,ratio=isFinite(move)&&isFinite(typ)?Math.abs(move)/typ:NaN;
  var h='<div class="pmhead">'+avatar(n,'p')+' <span><b>Grokky '+n+' here.</b> Oof — I lost the '+hhmm(rec.W)+'–'+hhmm(rec.W+Q)+' round, so let me tell you honestly what happened.</span>'+(demo?' <span class="pill warn">EXAMPLE — seeded for illustration, not a real round</span>':'')+'</div>';
  h+='<p>I picked <b class="'+cls(side)+'">'+arrow(side)+'</b>'+(mine!=null?' (the engine’s own probability for that side was '+mine+'%)':'')+' and locked it at '+hhmmss(rec.lockedAt)+'. Kalshi settled <b class="'+cls(out)+'">'+arrow(out)+'</b>, so Grokky '+rec.winner+' called it.'+(rec.noedge?' The engine had flagged this as a <i>no edge</i> round, so I was close to a coin flip going in.':'')+'</p>';
  // what moved price
  if(isFinite(move)){
    var thin=isFinite(ratio)&&ratio<0.25,big=isFinite(ratio)&&ratio>=1;
    h+='<p><b>What actually moved price.</b> The settlement average finished at <b>'+usd(rec.kexp,2)+'</b> against a strike of <b>'+usd(rec.kstrike,2)+'</b>: '+(move>=0?'+':'−')+usd(Math.abs(move),2)+' ('+(move>=0?'+':'−')+(Math.abs(move)/rec.kstrike*100).toFixed(3)+'%)'
      +(isFinite(ratio)?', about '+ratio.toFixed(1)+'× a typical 15-minute move (~'+usd(typ,0)+') — '+(thin?'a razor-thin margin; this one was close to a coin flip and a few dollars either way would have flipped it.':big?'a real move, not noise, and it went against me.':'a modest move.'):'.');
    var px=rec.px;
    if(px){var onMine=side==='UP'?px.above:px.below,tot=px.n;
      h+=' Exchange 1-minute candles ('+esc(px.src||'chart')+', approximate vs the BRTI-based settlement) show BTC ranged '+usd(px.lo,0)+'–'+usd(px.hi,0)+' (high at '+hhmm(px.tHi)+', low at '+hhmm(px.tLo)+') and closed '+onMine+' of '+tot+' minutes on <i>my</i> side of the strike'+(onMine>=tot/2?' — I was ahead for a good part of it, but settlement is the average of only the last 60 seconds, so the finish is what counts.':'.');}
    h+='</p>';
  }else h+='<p><b>What actually moved price.</b> Kalshi’s final settlement value was not stored for this round, so I can’t state the size of the move.</p>';
  // which signals were wrong / right
  if(me&&me.lines&&me.lines.length){
    h+='<p><b>The readings I cited, and how they fared.</b> All '+me.lines.length+' pointed '+side+', and the window settled '+out+', so every one of them was wrong this time:</p>'+li(me.lines);
  }else h+='<p><b>The readings I cited.</b> '+(why&&n===2&&why.forced2?'I had none: this was a forced opposite pick (Grokky 2 always hedges Grokky 1), so there was no signal of mine to be wrong.':'No individual signal cleared its threshold toward '+side+', so I had no specific reading to be wrong.')+'</p>';
  if(why&&why.items){
    var right=why.items.filter(function(x){return x.dir===out}),cited=(me&&me.idx)||[],rr=right,wrongAll=why.items.filter(function(x){return x.dir===side});
    if(rr.length)h+='<p><b>What the other side had right.</b> '+rr.length+' reading'+(rr.length>1?'s':'')+' on the board pointed '+out+' (vs '+wrongAll.length+' pointing '+side+') and turned out correct:</p>'+li(rr.slice(0,4).map(function(x){return x.txt}));
    else h+='<p><b>What the other side had right.</b> Nothing on the board pointed '+out+' — every reading I had agreed with me or was neutral, and the market still went the other way. That is the kind of loss no reading could have warned about.</p>';
  }else if(why){h+='<p><b>What the other side had right.</b> I didn’t store the full list of opposing readings for this round (it was locked before that was recorded), so I can’t say which of them were right.</p>';}
  else h+='<p class="mut">My reasons were never frozen for this round (the page was not open long enough), so I can’t list the readings.</p>';
  h+='<p class="mut" style="font-size:12.5px">An honest read: the board’s backtests found these signals are right only about as often as a coin flip over 15 minutes, so one loss is not proof a signal is broken, and one win would not have been proof it works. Nothing here places or suggests a bet.</p>';
  return h;
}
function pmRecs(){var G=st().groks||{};return Object.keys(G).map(Number).sort(function(a,b){return b-a}).map(function(w){return G[w]}).filter(function(r){return r.winner})}
function renderPM(){
  var el=$('pmBody');if(!el)return;var rec=PMDEMO||null,demo=!!PMDEMO,rs=pmRecs();
  if(!rec){if(PMSEL)rec=(st().groks||{})[PMSEL];if(!rec||!rec.winner)rec=rs[0]||null}
  var h=rec?postMortem(rec,demo):'<div class="mut">No scored round yet. Each round has one loser; as soon as Kalshi settles one, that Grokky explains here, in its own words, what went wrong using only the data stored for that round.</div>';
  if(rec&&!demo&&rs.length>1)h+='<div class="mut" style="font-size:12px;margin-top:6px">Showing '+(rec===rs[0]?'the latest':hhmm(rec.W))+' round. Click another row in the scoreboard to read that round’s post-mortem.</div>';
  if(el._h!==h){el.innerHTML=h;el._h=h}
}
function update(force){
  if(!H)return;var now=nowS(),s=st(),G=s.groks||{},W0=Math.floor(now/Q)*Q,rec=G[W0]||null;
  if(rec)maybeFreeze(rec,now);
  var t=tally(now);
  [1,2].forEach(function(n){var el=$('gk'+n);if(!el)return;var h=cardHtml(n,rec,t);if(el._h!==h){el.innerHTML=h;el._h=h;UI.restore(el);UI.countAll(el);UI.settleBars(el)}
    if(rec&&el._W!==rec.W){var first=el._W===undefined;el._W=rec.W;el.classList.add('reveal');setTimeout(function(){el.classList.remove('reveal')},1700)}
    var l=el.querySelector('.gkleft');if(l)l.textContent=mmss(W0+Q-now)});
  renderScore(t,now);ensurePx(now);renderPM();
}
function csv(){
  var G=st().groks||{},rows=['window_start_local,window_start_unix,grokky1,grokky2,engine_conf_pct,no_edge,late_lock,kalshi_result,winner,expiration_value,floor_strike,locked_at_unix'];
  Object.keys(G).map(Number).sort(function(a,b){return a-b}).forEach(function(w){var r=G[w];rows.push([new Date(w*1000).toLocaleString(),w,r.g1,r.g2,r.conf,r.noedge?'yes':'no',r.late?'yes':'no',r.kres||'',r.winner?'Grokky '+r.winner:'',isFinite(r.kexp)?r.kexp:'',isFinite(r.kstrike)?r.kstrike:'',r.lockedAt].map(function(x){return '"'+String(x).replace(/"/g,'""')+'"'}).join(','))});
  var a=document.createElement('a');a.href=URL.createObjectURL(new Blob([rows.join('\n')],{type:'text/csv'}));a.download='grokky-rounds.csv';document.body.appendChild(a);a.click();setTimeout(function(){URL.revokeObjectURL(a.href);a.remove()},500);
}
function init(host){H=host;try{learnAll()}catch(e){}if($('gkCsv'))$('gkCsv').onclick=csv;var sc=$('gkScore');if(sc)sc.addEventListener('click',function(e){var tr=e.target.closest&&e.target.closest('tr[data-w]');if(!tr)return;PMDEMO=null;PMSEL=+tr.getAttribute('data-w');var d=tr.nextElementSibling,x=d&&d.querySelector('.xp[data-xid]');if(x){var open=!x.classList.contains('open');x.classList.toggle('open',open);var id=x.getAttribute('data-xid');if(open)UI._open[id]=1;else delete UI._open[id];var ch=tr.querySelector('.chip .chev');if(ch)ch.style.transform=open?'rotate(90deg)':''}renderPM()});update()}
function showDemo(on){PMDEMO=on?demoRec():null;renderPM()}
function demoRec(){var W=Math.floor(Date.now()/1000/Q)*Q-3*Q;return {W:W,g1:'UP',g2:'DOWN',conf:58,noedge:false,lockedAt:W+7,late:false,winner:1,kres:'yes',kexp:70412.55,kstrike:70371.2,px:{o:70368,c:70415,hi:70440,lo:70352,tHi:W+780,tLo:W+120,above:11,below:3,n:15,src:'Coinbase 1m (example)'},
  why:{at:W+8,g1:{lines:['1-hour overshoot — price fell 0.8% in an hour (−1.3σ), oversold','RSI(14) 28 — oversold'],idx:[0,1],n:2,against:2},g2:{lines:['BRTI settlement average is $34 below the strike with 14:50 left (DOWN if it ended now)','OKX perp funding +0.0300% per 8 h: longs are paying, crowded long side (contrarian reading → DOWN)'],idx:[2,3],n:2,against:2},forced2:false,haveCtx:true,neutral:[],typ:{usd:96,pct:0.0013},
   items:[{src:'engine',dir:'UP',m:.4,txt:'1-hour overshoot — price fell 0.8% in an hour (−1.3σ), oversold'},{src:'engine',dir:'UP',m:.2,txt:'RSI(14) 28 — oversold'},{src:'ctx',dir:'DOWN',m:1,txt:'BRTI settlement average is $34 below the strike with 14:50 left (DOWN if it ended now)'},{src:'ctx',dir:'DOWN',m:.03,txt:'OKX perp funding +0.0300% per 8 h: longs are paying, crowded long side (contrarian reading → DOWN)'}]}}}
window.GrokkyPanel={avatar:avatar,learnFrom:learnFrom,learnAll:learnAll,learnSummary:learnSummary,_mult:mult,_keyOf:keyOf,_loadLearn:loadLearn,_resetLearnCache:function(){LEARN=null},showDemo:showDemo,postMortem:postMortem,init:init,lock:lock,update:update,onKalshi:onKalshi,tally:tally,_items:items,_pick:pick,_buildWhy:buildWhy,_csv:csv};
})();
