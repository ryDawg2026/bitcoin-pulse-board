/* Bitcoin Pulse Board — prediction engine (shared by index.html and the Node backtest).
   v1 = the original engine, logic copied verbatim from index.html on main.
   Pure functions: no DOM, no network. */
(function(root){
'use strict';
var Q=900;
function median(a){var s=a.filter(isFinite).slice().sort(function(x,y){return x-y});if(!s.length)return NaN;var m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2}
function mean(a){return a.reduce(function(x,y){return x+y},0)/(a.length||1)}
function std(a){var m=mean(a);return Math.sqrt(mean(a.map(function(x){return (x-m)*(x-m)})))}
function clamp(x,a,b){return Math.max(a,Math.min(b,x))}
function pct(x,d){return isFinite(x)?(x>=0?'+':'')+(x*100).toFixed(d==null?2:d)+'%':'—'}
function ema(a,n){if(a.length<n)return NaN;var k=2/(n+1),e=mean(a.slice(0,n));for(var i=n;i<a.length;i++)e=a[i]*k+e*(1-k);return e}
function rsi(c,n){if(c.length<n+1)return NaN;var g=0,l=0,i;for(i=1;i<=n;i++){var d=c[i]-c[i-1];if(d>0)g+=d;else l-=d}g/=n;l/=n;
  for(i=n+1;i<c.length;i++){var d2=c[i]-c[i-1];g=(g*(n-1)+Math.max(d2,0))/n;l=(l*(n-1)+Math.max(-d2,0))/n}
  if(l===0)return 100;return 100-100/(1+g/l)}

/* ---- consensus: sources = [{id,q:'USD'|'USDT'}], S[id].map = {t:{o,h,l,c,v}} (only OK, non-price-only sources) ---- */
function buildConsensus(sources,S,now,MIN_SRC){
  MIN_SRC=MIN_SRC||3;
  var times={};
  sources.forEach(function(s){Object.keys(S[s.id].map).forEach(function(t){t=+t;if(t+Q<=now+1)times[t]=1})});
  var need=Math.max(MIN_SRC,Math.floor(sources.length/2));
  var cons={},ts=Object.keys(times).map(Number).sort(function(a,b){return a-b});
  ts.forEach(function(t){
    var os=[],cl=[],v=0,n=0,usd=[],usdt=[],up=0,dn=0,hs=[],ls=[];
    sources.forEach(function(s){var k=S[s.id].map[t];if(!k)return;os.push(k.o);cl.push(k.c);hs.push(k.h);ls.push(k.l);v+=isFinite(k.v)?k.v:0;n++;
      (s.q==='USD'?usd:usdt).push(k.c);if(k.c>k.o)up++;else if(k.c<k.o)dn++});
    if(n>=need)cons[t]={t:t,o:median(os),c:median(cl),h:median(hs),l:median(ls),v:v,n:n,usd:usd.length?median(usd):NaN,usdt:usdt.length?median(usdt):NaN,up:up,dn:dn};
  });
  return {cons:cons,ts:ts.filter(function(t){return cons[t]}),ok:sources};
}

/* ================= v1: ORIGINAL engine (verbatim logic) ================= */
var W1={ema15:.20,ema1h:.15,rsi:.15,mom:.15,prem:.15,vol:.10,agree:.10};
function predictV1(W,C,okSrc,S,MIN_HIST){
  MIN_HIST=MIN_HIST||60;
  var hist=C.ts.filter(function(t){return t<W}).slice(-300);
  if(hist.length<MIN_HIST)return null;
  var cl=hist.map(function(t){return C.cons[t].c});
  var last=hist[hist.length-1],sg=[];
  function add(key,name,w,vote,desc){sg.push({k:key,name:name,w:w,vote:clamp(isFinite(vote)?vote:0,-1,1),desc:desc})}
  var e9=ema(cl,9),e21=ema(cl,21),x=e9/e21-1;
  add('ema15','15m EMA trend (9 vs 21)',W1.ema15,Math.tanh(x/0.0015),'EMA9 '+pct(x,3)+' vs EMA21');
  var hrs={};hist.forEach(function(t){var h=Math.floor(t/3600);(hrs[h]=hrs[h]||[]).push(t)});
  var hc=Object.keys(hrs).map(Number).sort(function(a,b){return a-b}).filter(function(h){return hrs[h].length===4}).map(function(h){return C.cons[hrs[h][3]].c});
  var h5=ema(hc,5),h12=ema(hc,12),hx=h5/h12-1;
  add('ema1h','1h EMA trend (5 vs 12)',W1.ema1h,isFinite(hx)?Math.tanh(hx/0.004):0,isFinite(hx)?('1h EMA5 '+pct(hx,3)+' vs EMA12'):'not enough 1h history');
  var r=rsi(cl.slice(-120),14),rv=0;
  if(r>70)rv=-clamp((r-70)/20,0,1);else if(r<30)rv=clamp((30-r)/20,0,1);
  add('rsi','RSI(14) extremes (mean-reversion)',W1.rsi,rv,'RSI '+(isFinite(r)?r.toFixed(1):'—')+(r>70?' overbought → DOWN':r<30?' oversold → UP':' neutral zone → 0'));
  var n=cl.length,r1=cl[n-1]/cl[n-2]-1,r2=cl[n-1]/cl[n-3]-1,r3=cl[n-1]/cl[n-4]-1,m=.5*r1+.3*r2+.2*r3;
  add('mom','Momentum (last 1–3 candles)',W1.mom,Math.tanh(m/0.002),'1c '+pct(r1)+' · 2c '+pct(r2)+' · 3c '+pct(r3));
  var pr=[];hist.slice(-25).forEach(function(t){var k=C.cons[t];if(isFinite(k.usd)&&isFinite(k.usdt))pr.push(k.usd/k.usdt-1)});
  var pv=0,pd='no USD/USDT pair data';
  if(pr.length>=10){var cur=pr[pr.length-1],base=pr.slice(0,-1),sd=std(base);pv=Math.tanh(((cur-mean(base))/(sd||1e-5))/2);pd='USD-vs-USDT premium '+pct(cur,3)+' (z '+((cur-mean(base))/(sd||1e-5)).toFixed(2)+')'}
  add('prem','Cross-exchange premium (USD vs USDT venues)',W1.prem,pv,pd);
  var sv=0,tv=0;
  okSrc.forEach(function(s){hist.slice(-4).forEach(function(t){var k=S[s.id].map[t];if(!k||!isFinite(k.v))return;tv+=k.v;sv+=k.v*Math.sign(k.c-k.o)})});
  var vv=tv?sv/tv:0;
  add('vol','Volume-weighted direction (last 4)',W1.vol,vv,'net signed volume '+(vv*100).toFixed(0)+'%');
  var lk=C.cons[last],tot=lk.up+lk.dn,ag=tot?(lk.up-lk.dn)/tot:0;
  add('agree','Source agreement (last candle)',W1.agree,ag,lk.up+' sources up · '+lk.dn+' down');
  var score=sg.reduce(function(a,s){s.contrib=s.w*s.vote;return a+s.contrib},0);
  var dir=score>0?'UP':score<0?'DOWN':(r1>=0?'UP':'DOWN');
  var agreeShare=tot?((dir==='UP'?lk.up:lk.dn)/tot):.5;
  var conf=Math.min(99,Math.round(50+40*Math.min(1,Math.abs(score)/0.5)+9*agreeShare));
  return {dir:dir,score:score,conf:conf,signals:sg,basis:last,nSrc:lk.n,
    feat:{r1:r1,r2:r2,r3:r3,rsi:r,x15:x,x1h:hx}};
}


/* ================= v2: mean-reversion engine (this branch) =================
   Why: backtest of v1 on 150 days of real candles showed trend-following signals hit <50% at the 15-minute horizon
   (BTC mean-reverts slightly after a move), and v1's "confidence" was anti-calibrated (higher conf -> lower hit rate).
   v2 = logistic-style score on 4-5 features, coefficients FITTED ON TRAIN DATA ONLY (see backtest/README.md), frozen here.
   Confidence = model probability of the called side (honestly ~50-56%), not a 50-99 "strength gauge". */
var V2_CUTOFF_UNIX=1790294400; // 2026-09-25 00:00 UTC: coefficients were fitted only on windows before this
var V2_COEF={z4:0.184,z1:0.016,rsi:0.139,clv:0.033,prem:0.017};   // filled by backtest/fit_v2.py
var V2_STRONG=0.0159;                            // |p-0.5| at/above this = "conviction" call (train median)
var V2_NOEDGE=0.01;                            // |p-0.5| below this = "no edge": 32% of backtest windows, hit 50.2% (coin flip)
var V2_MIN_HIST=100;
function sigmoid(x){return 1/(1+Math.exp(-x))}
function predictV2(W,C,okSrc,S){
  var hist=C.ts.filter(function(t){return t<W}).slice(-300);
  if(hist.length<V2_MIN_HIST)return null;
  var cons=C.cons,n=hist.length,cl=hist.map(function(t){return cons[t].c});
  var rets=hist.slice(-96).map(function(t){return cons[t].c/cons[t].o-1});
  var m=mean(rets),vol=Math.sqrt(rets.reduce(function(a,x){return a+(x-m)*(x-m)},0)/(rets.length-1))||1e-9;
  var lastK=cons[hist[n-1]],r1=cl[n-1]/lastK.o-1,r4=cl[n-1]/cl[n-5]-1;
  var z1=r1/vol,z4=r4/(vol*2);
  var rs=rsi(cl.slice(-120),14);
  var clv=lastK.h>lastK.l?(lastK.c-lastK.l)/(lastK.h-lastK.l):0.5;
  var pr=[];hist.slice(-25).forEach(function(t){var k=cons[t];if(isFinite(k.usd)&&isFinite(k.usdt))pr.push(k.usd/k.usdt-1)});
  var pz=0,pd='no USD/USDT pair data';
  if(pr.length>=10){var cur=pr[pr.length-1],base=pr.slice(0,-1),bm=mean(base),bs=Math.sqrt(base.reduce(function(a,x){return a+(x-bm)*(x-bm)},0)/(base.length-1))||1e-5;pz=(cur-bm)/bs;pd='USD-vs-USDT premium '+pct(cur,3)+' (z '+pz.toFixed(2)+')'}
  var f={z4:-clamp(z4,-3,3)/3,z1:-clamp(z1,-3,3)/3,rsi:isFinite(rs)?-clamp((rs-50)/25,-1.5,1.5)/1.5:0,clv:-(clv-0.5)*2,prem:clamp(pz,-3,3)/3};
  var sg=[],logit=0;
  function add(k,name,vote,desc){var w=V2_COEF[k];sg.push({k:k,name:name,w:w,vote:vote,desc:desc,contrib:w*vote});logit+=w*vote}
  add('z4','1-hour overshoot fade (4 candles, vol-scaled)',f.z4,'last 4 candles '+pct(r4)+' = '+z4.toFixed(2)+'σ → '+(f.z4>0?'expect bounce UP':f.z4<0?'expect pullback DOWN':'neutral'));
  add('z1','Last-candle overshoot fade',f.z1,'last candle '+pct(r1)+' = '+z1.toFixed(2)+'σ');
  add('rsi','RSI(14) mean-reversion',f.rsi,'RSI '+(isFinite(rs)?rs.toFixed(1):'—'));
  add('clv','Close location in candle range (fade the close)',f.clv,'last candle closed '+(clv*100).toFixed(0)+'% up its range');
  add('prem','Cross-exchange premium (USD vs USDT venues)',f.prem,pd);
  var p=sigmoid(logit),dir=logit>0?'UP':logit<0?'DOWN':(r1<=0?'UP':'DOWN');
  var pc=dir==='UP'?p:1-p,edge=Math.abs(p-0.5);
  var lk=cons[hist[n-1]];
  return {dir:dir,score:logit,conf:Math.round(pc*100),pUp:p,edge:edge,strong:edge>=V2_STRONG,noedge:edge<V2_NOEDGE,signals:sg,basis:hist[n-1],nSrc:lk.n,
    feat:{f:f,z1:z1,z4:z4,rsi:rs,clv:clv,pz:pz,vol:vol},eng:'v2'};
}

root.PulseEngine={V2_COEF:V2_COEF,V2_CUTOFF_UNIX:V2_CUTOFF_UNIX,predictV2:predictV2,setV2:function(c,t){Object.keys(c).forEach(function(k){V2_COEF[k]=c[k]});if(t!=null)V2_STRONG=t},Q:Q,median:median,mean:mean,std:std,clamp:clamp,pct:pct,ema:ema,rsi:rsi,buildConsensus:buildConsensus,predictV1:predictV1,W1:W1};
if(typeof module!=='undefined'&&module.exports)module.exports=root.PulseEngine;
})(typeof window!=='undefined'?window:globalThis);
