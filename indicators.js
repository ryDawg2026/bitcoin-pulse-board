/* Price-action indicators for the five of us (Grokky 1, Grokky 2 and the three callers). INFORMATION ONLY: no orders, no keys.
   Everything is computed from two free, CORS-friendly public candle feeds the board already uses elsewhere:
     • Coinbase BTC-USD 1-minute candles   (api.exchange.coinbase.com)   → price, VWAP, EMA, RSI, ATR, momentum, stretch
     • Binance BTCUSDT 1-minute klines     (data-api.binance.vision)     → CVD (taker-buy minus taker-sell volume), Coinbase-vs-Binance premium
   plus the Kalshi strike / UP price and the board's own picks, which are passed in. Nothing is invented: a reading that can't be computed says so ("na" + why).
   Each reading is {k,name,group,vote,desc}: vote runs −1 (DOWN) … +1 (UP) and "desc" quotes the live numbers it used.
   Groups: trend (ema, mom, vwap, drift) · revert (rsi, stretch) · flow (cvd, prem, book) · strike (strike, crowd) · grokky (gkread, gkconf) · info (vol, implied; vote 0). */
(function(){
'use strict';
function num(x){var v=parseFloat(x);return isFinite(v)?v:NaN}
function clamp(x,a,b){return Math.max(a,Math.min(b,x))}
function mean(a){return a.length?a.reduce(function(x,y){return x+y},0)/a.length:NaN}
function sd(a){if(a.length<3)return NaN;var m=mean(a);return Math.sqrt(a.reduce(function(s,x){return s+(x-m)*(x-m)},0)/(a.length-1))}
function usd(x,d){return isFinite(x)?'$'+Math.abs(x).toLocaleString('en-US',{minimumFractionDigits:d==null?0:d,maximumFractionDigits:d==null?0:d}):'—'}
function sgn(x,d){return (x>=0?'+':'−')+usd(x,d)}
function mmss(s){s=Math.max(0,Math.round(s));return Math.floor(s/60)+':'+('0'+(s%60)).slice(-2)}
function ema(a,n){if(a.length<n)return NaN;var k=2/(n+1),e=mean(a.slice(0,n));for(var i=n;i<a.length;i++)e=a[i]*k+e*(1-k);return e}
function rsi(c,n){if(c.length<n+1)return NaN;var g=0,l=0,i;for(i=1;i<=n;i++){var d=c[i]-c[i-1];if(d>0)g+=d;else l-=d}g/=n;l/=n;
  for(i=n+1;i<c.length;i++){var d2=c[i]-c[i-1];g=(g*(n-1)+Math.max(d2,0))/n;l=(l*(n-1)+Math.max(-d2,0))/n}
  return l===0?100:100-100/(1+g/l)}
function phi(z){ // standard normal CDF (Abramowitz-Stegun 7.1.26)
  var t=1/(1+0.2316419*Math.abs(z)),d=0.3989423*Math.exp(-z*z/2),p=d*t*(0.3193815+t*(-0.3565638+t*(1.781478+t*(-1.821256+t*1.330274))));return z>0?1-p:p}
function phiInv(p){var lo=-6,hi=6;for(var i=0;i<40;i++){var m=(lo+hi)/2;if(phi(m)<p)lo=m;else hi=m}return (lo+hi)/2}
var GROUPS=['trend','revert','flow','strike','grokky'];

/* inp: {now,W,strike,kmid,cb:[{t,o,h,l,c,v}],bn:[{t,o,h,l,c,v,tb}],g:{g1,g2,pUp,items:[{dir,src,txt}]}|null,ctx:{book:imb}|null} */
function compute(inp){
  var now=inp.now,W=inp.W,closed=function(a){return (a||[]).filter(function(k){return k.t+60<=now}).sort(function(x,y){return x.t-y.t})};
  var cb=closed(inp.cb),bn=closed(inp.bn),base=cb.length>=30?cb:bn.length>=30?bn:cb.length?cb:bn,baseSrc=base===cb?'Coinbase':'Binance';
  var out={signals:[],ok:false,why:'',px:NaN,pxSrc:baseSrc,at:now,W:W,secsLeft:W+900-now,strike:inp.strike,kmid:inp.kmid};
  var S=out.signals;
  function add(k,name,group,vote,desc,extra){S.push({k:k,name:name,group:group,vote:isFinite(vote)?clamp(vote,-1,1):0,desc:desc,na:false,val:extra&&extra.val,unit:extra&&extra.unit})}
  function na(k,name,group,why){S.push({k:k,name:name,group:group,vote:0,desc:why,na:true})}
  if(base.length<25){out.why='Not enough 1-minute candles yet ('+base.length+' closed; I need about 25).';
    ['strike','ema','mom','vwap','drift','rsi','stretch','cvd','prem'].forEach(function(k){na(k,k,'info',out.why)});return out}
  var last=base[base.length-1],cl=base.map(function(k){return k.c}),px=cl[cl.length-1];
  var live=(inp.cb||[]).concat([]).sort(function(x,y){return x.t-y.t}).filter(function(k){return k.t<=now}).slice(-1)[0];
  if(live&&live.t+60>now&&baseSrc==='Coinbase')px=live.c;  // the forming minute's latest trade price, so "now" really is now
  out.px=px;
  var rets=[];for(var i=1;i<cl.length;i++)rets.push(Math.log(cl[i]/cl[i-1]));
  var r60=rets.slice(-60),sr=sd(r60),s1=isFinite(sr)?sr*px:NaN;           // typical 1-minute swing in USD
  var tr=[];for(i=Math.max(1,base.length-14);i<base.length;i++){var k=base[i],p=base[i-1];tr.push(Math.max(k.h-k.l,Math.abs(k.h-p.c),Math.abs(k.l-p.c)))}
  var atr=mean(tr);out.atr=atr;out.s1=s1;
  var minsLeft=Math.max(0.5,out.secsLeft/60),sRem=s1*Math.sqrt(minsLeft);out.sRem=sRem;
  // ---- strike: distance to strike measured in typical swings left (and in ATRs) ----
  var strike=inp.strike;
  if(isFinite(strike)&&isFinite(sRem)&&sRem>0){var d=px-strike,z=d/sRem,pm=phi(z);out.d=d;out.pModel=pm;out.atrDist=isFinite(atr)&&atr>0?d/atr:NaN;
    add('strike','Distance to strike','strike',2*pm-1,'Price is '+usd(Math.abs(d),0)+' '+(d>=0?'above':'below')+' the strike with '+mmss(out.secsLeft)+' left: that is '+Math.abs(z).toFixed(1)+'× the typical swing left (~'+usd(sRem,0)+')'+(isFinite(out.atrDist)?' and '+Math.abs(out.atrDist).toFixed(1)+' ATRs':'')+', so roughly a '+Math.min(99,Math.max(50,Math.round((d>=0?pm:1-pm)*100)))+'% chance of finishing '+(d>=0?'above':'below')+' it (my rough estimate)',{val:d,unit:'usd'})}
  else na('strike','Distance to strike','strike',isFinite(strike)?'Not enough candle history to size the typical swing.':'Kalshi strike not loaded for this window.');
  // ---- crowd: Kalshi's own UP price (read-only) ----
  var km=inp.kmid;
  if(isFinite(km)&&km>0&&km<1)add('crowd','Kalshi crowd','strike',clamp((km-0.5)*2,-1,1),'Kalshi traders price UP at '+Math.round(km*100)+'¢, so the crowd leans '+(km>=0.5?'UP':'DOWN')+(km===0.5?' (even)':''),{val:km,unit:'p'});
  else na('crowd','Kalshi crowd','strike','Kalshi price not loaded for this window.');
  // ---- trend ----
  var e5=ema(cl.slice(-60),5),e20=ema(cl.slice(-80),20);
  if(isFinite(e5)&&isFinite(e20)&&isFinite(sr)){var x=e5/e20-1;add('ema','Short EMA cross (5 vs 20 min)','trend',Math.tanh(x/(1.5*sr)),'5-minute average is '+usd(Math.abs(e5-e20),0)+' '+(e5>=e20?'above':'below')+' the 20-minute one ('+(x>=0?'+':'−')+Math.abs(x*100).toFixed(3)+'%), so the short trend points '+(e5>=e20?'UP':'DOWN'),{val:x,unit:'frac'})}
  else na('ema','Short EMA cross (5 vs 20 min)','trend','Not enough candles for the 20-minute average.');
  var N=5;if(cl.length>N&&isFinite(sr)){var mv=Math.log(px/cl[cl.length-1-N]);add('mom','Momentum (last '+N+' candles)','trend',Math.tanh(mv/(sr*Math.sqrt(N)*1.5)),'Last '+N+' minutes: '+sgn(px-cl[cl.length-1-N],0)+' ('+(mv>=0?'+':'−')+Math.abs(mv*100).toFixed(2)+'%)',{val:mv,unit:'frac'})}
  else na('mom','Momentum','trend','Not enough candles.');
  var vw=base.slice(-60),pv=0,vv=0;vw.forEach(function(k){var tp=(k.h+k.l+k.c)/3;pv+=tp*k.v;vv+=k.v});
  if(vv>0&&isFinite(s1)){var vwap=pv/vv,dv=px-vwap;out.vwap=vwap;add('vwap','Price vs VWAP (1 h)','trend',Math.tanh(dv/(2.5*s1)),'Price is '+usd(Math.abs(dv),0)+' '+(dv>=0?'above':'below')+' the 1-hour VWAP ('+usd(vwap,0)+'), the average price weighted by volume — '+(dv>=0?'recent buyers are in profit':'recent buyers are under water'),{val:dv,unit:'usd'})}
  else na('vwap','Price vs VWAP (1 h)','trend','No volume data to build a VWAP.');
  // drift since the window opened (price action since the Grokkys locked in)
  var op=base.filter(function(k){return k.t===W})[0]||(inp.cb||[]).filter(function(k){return k.t===W})[0];
  var el=Math.max(1,(now-W)/60);
  if(op&&isFinite(s1)&&now-W>=60){var dr=px-op.o;add('drift','Move since window open','trend',Math.tanh(dr/(s1*Math.sqrt(el)*1.5)),'Since this window opened ('+Math.round(el)+' min ago) price moved '+sgn(dr,0)+' from '+usd(op.o,0),{val:dr,unit:'usd'})}
  else na('drift','Move since window open','trend',now-W<60?'The window just opened.':'Window-open candle not in the feed.');
  // ---- revert ----
  var rs=rsi(cl.slice(-120),14);
  if(isFinite(rs))add('rsi','RSI(14, 1 min)','revert',-clamp((rs-50)/20,-1,1),'RSI is '+rs.toFixed(0)+(rs>=70?' (overbought: stretched up, a pullback is likelier)':rs<=30?' (oversold: stretched down, a bounce is likelier)':' (neither stretched)'),{val:rs,unit:'rsi'});
  else na('rsi','RSI(14, 1 min)','revert','Not enough candles for RSI.');
  var w30=cl.slice(-30),m30=mean(w30),s30=sd(w30);
  if(isFinite(s30)&&s30>0){var zz=(px-m30)/s30;add('stretch','Stretch from 30-min average','revert',-Math.tanh(zz/2),'Price is '+Math.abs(zz).toFixed(1)+' standard deviations '+(zz>=0?'above':'below')+' its 30-minute average ('+usd(m30,0)+')'+(Math.abs(zz)>=1.5?', which tends to snap back':', so not really stretched'),{val:zz,unit:'z'})}
  else na('stretch','Stretch from 30-min average','revert','Not enough candles.');
  // ---- flow ----
  var bw=bn.slice(-15);
  if(bw.length>=10&&bw.every(function(k){return isFinite(k.tb)})){var buy=0,tot=0;bw.forEach(function(k){buy+=k.tb;tot+=k.v});var cvd=2*buy-tot,ratio=tot?cvd/tot:0;out.cvd=cvd;
    add('cvd','CVD: buyers vs sellers (15 min)','flow',Math.tanh(ratio/0.08),'On Binance, market buyers '+(cvd>=0?'out-bought':'were out-sold by')+' sellers by '+Math.abs(cvd).toFixed(1)+' BTC over the last '+bw.length+' minutes ('+(ratio>=0?'+':'−')+Math.abs(ratio*100).toFixed(1)+'% of volume)',{val:cvd,unit:'btc'})}
  else na('cvd','CVD: buyers vs sellers (15 min)','flow','Binance taker-volume candles not loaded.');
  // Coinbase-vs-Binance premium, as a z-score against its own last hour (so the permanent USD/USDT basis cancels out)
  var bm={};bn.forEach(function(k){bm[k.t]=k});var pr=[];cb.slice(-60).forEach(function(k){var b=bm[k.t];if(b&&b.c>0)pr.push({t:k.t,p:k.c/b.c-1})});
  if(pr.length>=25){var cur=pr[pr.length-1].p,hist=pr.slice(0,-1).map(function(o){return o.p}),pz=(cur-mean(hist))/(sd(hist)||1e-6);out.prem=cur;
    add('prem','Coinbase vs Binance premium','flow',Math.tanh(pz/2),'Coinbase trades '+(cur>=0?'+':'−')+Math.abs(cur*1e4).toFixed(1)+' bps '+(cur>=0?'above':'below')+' Binance; that is '+Math.abs(pz).toFixed(1)+' σ '+(pz>=0?'richer':'cheaper')+' than its own last hour (US buyers '+(pz>=0?'are keener':'are less keen')+')',{val:cur,unit:'frac'})}
  else na('prem','Coinbase vs Binance premium','flow','Need both exchanges\' candles for the same minutes.');
  if(inp.ctx&&isFinite(inp.ctx.book)&&Math.abs(inp.ctx.book)>=0.02)add('book','Kalshi order book','flow',clamp(inp.ctx.book*2,-1,1),'Kalshi order book has '+Math.round(Math.abs(inp.ctx.book)*100)+'% more resting size on the '+(inp.ctx.book>0?'UP':'DOWN')+' side',{val:inp.ctx.book,unit:'frac'});
  else na('book','Kalshi order book','flow',inp.ctx&&isFinite(inp.ctx.book)?'Order book is balanced (under 2% lean).':'Kalshi order book not loaded.');
  // ---- grokky read: what the two of them are saying ----
  var g=inp.g;
  if(g&&g.items&&g.items.length){var up=0,dn=0;g.items.forEach(function(o){if(o.dir==='UP')up++;else if(o.dir==='DOWN')dn++});var tt=up+dn;
    if(tt)add('gkread','Board readings Grokky 1 & 2 weighed','grokky',(up-dn)/tt,'Of the '+tt+' readings the Grokkys counted, '+up+' lean UP and '+dn+' lean DOWN (Grokky 1 sided with '+g.g1+', Grokky 2 with '+g.g2+')',{val:(up-dn)/tt,unit:'frac'});
    else na('gkread','Board readings Grokky 1 & 2 weighed','grokky','The Grokkys counted no readings this round.')}
  else na('gkread','Board readings Grokky 1 & 2 weighed','grokky',g?'Grokky readings not frozen yet.':'No Grokky pick for this window.');
  if(g&&isFinite(g.pUp)){add('gkconf','Engine lean (what Grokky 1 follows)','grokky',clamp((g.pUp-0.5)*8,-1,1),'The engine Grokky 1 follows gives UP '+Math.round(g.pUp*100)+'% (a small edge at best)',{val:g.pUp,unit:'p'})}
  else na('gkconf','Engine lean (what Grokky 1 follows)','grokky','No engine call for this window.');
  // ---- info only ----
  if(isFinite(atr)&&isFinite(s1)){var med=null;var atrs=[];for(i=15;i<base.length;i++){var t2=[];for(var j=i-13;j<=i;j++){var a=base[j],b2=base[j-1];if(!b2)continue;t2.push(Math.max(a.h-a.l,Math.abs(a.h-b2.c),Math.abs(a.l-b2.c)))}atrs.push(mean(t2))}
    med=atrs.length?atrs.slice().sort(function(a,b){return a-b})[atrs.length>>1]:NaN;var rr=med>0?atr/med:NaN;out.volRatio=rr;
    S.push({k:'vol',name:'Volatility (ATR 14 min)',group:'info',vote:0,na:false,desc:'A typical 1-minute range is about '+usd(atr,0)+' ('+(atr/px*100).toFixed(3)+'% of price)'+(isFinite(rr)?', '+(rr>1.25?'busier':rr<0.8?'quieter':'about normal')+' versus the last few hours':''),val:atr,unit:'usd'})}
  else na('vol','Volatility (ATR 14 min)','info','Not enough candles.');
  if(isFinite(km)&&km>0.03&&km<0.97&&isFinite(out.d)&&Math.abs(out.d)>1&&isFinite(sRem)){var zi=phiInv(km>=0.5?km:1-km),impl=Math.abs(out.d)/zi,ok2=(km>=0.5)===(out.d>=0);
    if(ok2&&zi>0.05){out.implied=impl;var ratio2=sRem/impl;S.push({k:'implied',name:'Realized vs implied move',group:'info',vote:0,na:false,desc:'Kalshi\'s price implies a swing of about ±'+usd(impl,0)+' over the rest of the window; the last hour\'s real 1-minute swings scale to about ±'+usd(sRem,0)+' ('+(ratio2<0.1?'<0.1':ratio2.toFixed(1))+'×) — '+(ratio2>1.3?'the market is calmer than recent action suggests':ratio2<0.77?'the market expects more movement than recently seen':'roughly in line')+' (derived estimate)',val:ratio2,unit:'x'})}
    else na('implied','Realized vs implied move','info','Kalshi\'s price and the strike gap point opposite ways, so no implied swing can be read from them.')}
  else na('implied','Realized vs implied move','info','Needs a Kalshi price away from 50¢ and a strike gap.');
  out.ok=true;return out;
}

/* group leans: mean vote of the available readings in each group */
function groupLean(signals){var o={};GROUPS.forEach(function(g){var v=signals.filter(function(s){return s.group===g&&!s.na}).map(function(s){return s.vote});o[g]=v.length?{lean:mean(v),n:v.length}:{lean:0,n:0}});return o}

/* ---------- live feed (Coinbase 1m + Binance 1m klines) ---------- */
var D={cb:[],bn:[],cbAt:0,bnAt:0,cbErr:'',bnErr:'',timer:null,busy:false};
function J(u,ms){var c=new AbortController(),to=setTimeout(function(){c.abort()},ms||10000);return fetch(u,{signal:c.signal,cache:'no-store'}).then(function(r){clearTimeout(to);if(!r.ok)throw new Error('HTTP '+r.status);return r.json()},function(e){clearTimeout(to);throw e})}
function why(e){var m=(e&&e.name==='AbortError')?'timeout':((e&&e.message)||'error');return m==='Failed to fetch'?'blocked/network':m}
function pollOnce(){
  if(D.busy)return Promise.resolve();D.busy=true;
  var a=J('https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=60').then(function(d){D.cb=d.map(function(k){return {t:k[0],o:k[3],h:k[2],l:k[1],c:k[4],v:k[5]}}).filter(function(k){return isFinite(k.o+k.h+k.l+k.c)}).sort(function(x,y){return x.t-y.t});D.cbAt=Math.floor(Date.now()/1000);D.cbErr=''},function(e){D.cbErr=why(e)});
  var b=J('https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=120').then(function(d){D.bn=d.map(function(k){return {t:Math.floor(k[0]/1000),o:+k[1],h:+k[2],l:+k[3],c:+k[4],v:+k[5],tb:+k[9]}}).filter(function(k){return isFinite(k.o+k.c)});D.bnAt=Math.floor(Date.now()/1000);D.bnErr=''},function(e){D.bnErr=why(e)});
  return Promise.all([a,b]).then(function(){D.busy=false;window.dispatchEvent(new Event('pulse-indicators'))},function(){D.busy=false});
}
function start(){if(D.timer)return;pollOnce();D.timer=setInterval(pollOnce,20000)}
function feed(){return D}
window.PulseIndicators={compute:compute,groupLean:groupLean,GROUPS:GROUPS,start:start,pollOnce:pollOnce,feed:feed,_phi:phi,_phiInv:phiInv,_rsi:rsi,_ema:ema};
})();
