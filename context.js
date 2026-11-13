/* Market context panel — INFORMATION ONLY. Nothing here feeds the prediction engine, places orders, or uses keys.
   Prior research (see backtest/): news, whale transfers, funding/OI and order-book imbalance did NOT predict 15-minute moves beyond Kalshi's own price.
   Every feed is independent: on failure its box says "unavailable" + the reason. No figure is ever invented or carried over from a stale fetch.
   Sources (all free, no key): Kalshi public API via our relay (orderbook, live_data BRTI), OKX, Deribit, alternative.me, blockchain.info, rss2json (Cointelegraph/Decrypt RSS),
   official BLS/Federal Reserve release schedules (static table below). */
(function(){
'use strict';
function $(i){return document.getElementById(i)}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function num(x){var v=parseFloat(x);return isFinite(v)?v:NaN}
function J(u,ms){var c=new AbortController(),to=setTimeout(function(){c.abort()},ms||12000);
  return fetch(u,{signal:c.signal,cache:'no-store'}).then(function(r){clearTimeout(to);if(!r.ok)throw new Error('HTTP '+r.status);return r.json()},function(e){clearTimeout(to);throw e})}
function why(e){var m=(e&&e.name==='AbortError')?'timeout':((e&&e.message)||'error');return m==='Failed to fetch'?'blocked/network':m}
function usd(x,d){return isFinite(x)?'$'+x.toLocaleString('en-US',{minimumFractionDigits:d==null?2:d,maximumFractionDigits:d==null?2:d}):'—'}
function ago(s){s=Math.max(0,Math.round(s));return s<90?s+'s':s<5400?Math.round(s/60)+' min':s<172800?Math.round(s/3600)+' h':Math.round(s/86400)+' d'}
function mmss(s){s=Math.max(0,Math.round(s));return Math.floor(s/60)+':'+('0'+(s%60)).slice(-2)}
function nowS(){return Date.now()/1000}
function mean(a){return a.reduce(function(x,y){return x+y},0)/(a.length||1)}
function sd(a){if(a.length<2)return NaN;var m=mean(a);return Math.sqrt(a.reduce(function(s,x){return s+(x-m)*(x-m)},0)/(a.length-1))}
function Phi(z){var t=1/(1+0.2316419*Math.abs(z)),d=0.3989423*Math.exp(-z*z/2),p=d*t*(0.3193815+t*(-0.3565638+t*(1.781478+t*(-1.821256+t*1.330274))));return z>0?1-p:p}
function g(){return window.__pulseNow||{}}
/* latest successful reading of each feed, for the Grokky rationales (read-only snapshot; never fed to the engine) */
var SNAP={};
function kp(){return window.KalshiPanel}

/* ---------- box helpers ---------- */
var firstDone={};
function box(id,status,html,note){
  var el=$('ctx-'+id);if(!el)return;
  var pill=el.querySelector('.cs'),body=el.querySelector('.cb');
  pill.className='cs pill '+(status==='ok'?'ok':status==='stale'?'bf':'bad');
  pill.textContent=status==='ok'?'live':status==='stale'?'stale':'unavailable';
  body.innerHTML=html+(note?'<div class="mut ctxnote">'+note+'</div>':'');
}
function unavailable(id,e,extra){if(id==='liq'&&window.FlowTracker)FlowTracker.liqFail(e);delete SNAP[({settle:'gap',book:'book',liq:'liq'})[id]||'_none'];box(id,'bad','<span class="mut">Unavailable — '+esc(why(e))+'.</span>'+(extra?' <span class="mut">'+extra+'</span>':''))}

/* ---------- events calendar (official schedules) ---------- */
// Sources: https://www.bls.gov/schedule/news_release/cpi.htm , .../empsit.htm , https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm (checked 2026-11-11)
var EVENTS=[];
function addEv(name,imp,time,after,dates,url){dates.forEach(function(d){EVENTS.push({name:name,imp:imp,ds:d,time:time,after:after,url:url})})}
addEv('CPI inflation','high','08:30',30,['2026-11-10','2026-12-10','2027-01-13','2027-02-11','2027-03-10','2027-04-13','2027-05-12','2027-06-10','2027-07-14','2027-08-11','2027-09-14','2027-10-14','2027-11-10','2027-12-10'],'https://www.bls.gov/schedule/news_release/cpi.htm');
addEv('Jobs report (NFP)','high','08:30',30,['2026-11-06','2026-12-04','2027-01-08','2027-02-05','2027-03-05','2027-04-02','2027-05-07','2027-06-04','2027-07-02','2027-08-06','2027-09-03','2027-10-08','2027-11-05','2027-12-03'],'https://www.bls.gov/schedule/news_release/empsit.htm');
addEv('FOMC rate decision','high','14:00',75,['2026-12-09','2027-01-27','2027-03-17','2027-04-28','2027-06-09','2027-07-28','2027-09-15','2027-10-27','2027-12-08'],'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm');
var NYF=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hourCycle:'h23',year:'numeric',month:'numeric',day:'numeric',hour:'numeric',minute:'numeric'});
function etToUnix(ds,hm){
  var p=ds.split('-').map(Number),t=hm.split(':').map(Number),guess=Date.UTC(p[0],p[1]-1,p[2],t[0],t[1]);
  function off(ms){var o={};NYF.formatToParts(new Date(ms)).forEach(function(x){o[x.type]=+x.value});return Date.UTC(o.year,o.month-1,o.day,o.hour,o.minute)-ms}
  var t1=guess-off(guess);return (guess-off(t1))/1000;
}
EVENTS.forEach(function(e){e.t=etToUnix(e.ds,e.time)});
EVENTS.sort(function(a,b){return a.t-b.t});
var BEFORE=1800; // sit-out starts 30 min before
function eventState(now){
  var sit=null,next=[];
  EVENTS.forEach(function(e){
    if(now>=e.t-BEFORE&&now<=e.t+e.after*60)sit=e;
    else if(e.t>now&&next.length<3)next.push(e);
  });
  return {sit:sit,next:next};
}
function renderEvents(){
  var now=nowS(),st=eventState(now),h='';
  if(st.sit){var s=st.sit;h+='<div class="sit">⛔ SIT OUT: '+esc(s.name)+(now<s.t?' in '+ago(s.t-now):' released '+ago(now-s.t)+' ago')+'. Prices can jump on the print; 15-minute calls are noise right now.</div>'}
  if(!st.next.length)h+='<div class="mut">No upcoming CPI / NFP / FOMC in the table.</div>';
  st.next.forEach(function(e){var d=new Date(e.t*1000);
    h+='<div class="evrow"><b>'+esc(e.name)+'</b> <span class="mut">'+d.toLocaleString([], {weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})+' (your time) · '+esc(e.time)+' ET</span><br><span class="'+((e.t-now)<86400?'warn':'mut')+'">in '+ago(e.t-now)+'</span> · <a href="'+esc(e.url)+'" target="_blank" rel="noopener noreferrer">official schedule</a></div>'});
  box('events','ok',h,'Static table from official BLS and Federal Reserve calendars (checked 2026-11-11). Covers only CPI, jobs report and FOMC decisions; PCE, PPI, GDP, Fed speakers and surprise news are NOT covered. Sit-out window: 30 min before to 30 min after (75 after FOMC, for the press conference).');
  var al=$('ctxAlert');
  if(al){var near=!st.sit&&st.next.length&&st.next[0].t-now<86400?st.next[0]:null;
    if(st.sit){al.className='ctxalert red';al.textContent='⛔ Sit-out window: '+st.sit.name+(now<st.sit.t?' in '+ago(st.sit.t-now):' just released')+' — high-impact release; skip 15-minute calls around it.';al.style.display='block'}
    else if(near){al.className='ctxalert amber';al.textContent='Heads-up: '+near.name+' in '+ago(near.t-now)+' ('+near.time+' ET). Sit-out window starts 30 min before.';al.style.display='block'}
    else{al.style.display='none'}}
}

/* ---------- volatility regime (board's own consensus candles) + Deribit DVOL ---------- */
var vol={v16:NaN,v96:NaN,ratio:NaN};
function calcVol(){
  var cl=(g().closes||[]);if(cl.length<100)return;
  var r=[];for(var i=1;i<cl.length;i++)r.push(Math.log(cl[i]/cl[i-1]));
  vol.v16=sd(r.slice(-16));vol.v96=sd(r.slice(-96));vol.ratio=vol.v16/vol.v96;
}
function regime(r){return r<0.7?['calm','ok']:r<1.3?['normal','']:r<2?['elevated','warn']:['stormy','bad']}
function loadVol(){
  calcVol();
  var price=g().med;
  var dv=J('https://www.deribit.com/api/v2/public/get_volatility_index_data?currency=BTC&resolution=3600&start_timestamp='+(Date.now()-90000000)+'&end_timestamp='+Date.now()).then(function(d){var a=d.result.data;if(!a||!a.length)throw new Error('no data');var last=a[a.length-1],first=a[0];return {v:last[4],t:last[0]/1000,chg:last[4]-first[1]}},function(e){return {err:e}});
  return dv.then(function(D){
    var h='';
    if(isFinite(vol.ratio)){var rg=regime(vol.ratio);
      h+='<div><span class="pill '+(rg[1]||'')+'" style="font-size:14px">'+rg[0].toUpperCase()+'</span> <span class="mut">recent vs normal realized vol</span></div>'
        +'<div class="row" style="gap:16px;margin-top:6px"><div class="kv"><small>last 4 h (16 candles)</small><b>'+(vol.v16*1e4).toFixed(1)+' bp</b></div><div class="kv"><small>last 24 h (96 candles)</small><b>'+(vol.v96*1e4).toFixed(1)+' bp</b></div><div class="kv"><small>ratio</small><b>'+vol.ratio.toFixed(2)+'×</b></div>'+(isFinite(price)?'<div class="kv"><small>typical 15-min 1σ move</small><b>≈ '+usd(price*vol.v96,0)+'</b></div>':'')+'</div>';
    }else h+='<div class="mut">Realized vol: unavailable (needs 100 consensus candles).</div>';
    if(D.err)h+='<div class="mut" style="margin-top:6px">Deribit DVOL (30-day implied vol): unavailable — '+esc(why(D.err))+'.</div>';
    else{var imp=D.v/100/Math.sqrt(365*96);h+='<div style="margin-top:6px">Deribit DVOL <b>'+D.v.toFixed(1)+'</b> <span class="mut">('+(D.chg>=0?'+':'')+D.chg.toFixed(1)+' over ~24 h, '+ago(nowS()-D.t)+' old)'+(isFinite(price)?' · implies ≈ '+usd(price*imp,0)+' per 15 min (1σ)':'')+'</span></div>'}
    box('vol',(isFinite(vol.ratio)||!D.err)?'ok':'bad',h,'Context for how big a move is “normal” right now. Realized vol is from the board’s consensus candles; DVOL is options-implied (Deribit public API).');
  });
}

/* ---------- Kalshi: BRTI settlement gap ---------- */
function cur(){var l=kp()&&kp().last&&kp().last();return l&&l.current?l.current:null}
function base(){return kp()&&kp().base?kp().base():null}
function loadSettle(){
  var m=cur();if(!m)return Promise.reject(new Error('Kalshi market not loaded yet'));
  if(kp().viaSnapshot&&kp().viaSnapshot())return Promise.reject(new Error('relay not reachable (snapshot mode)'));
  calcVol();
  return J(base()+'/live_data/events/'+encodeURIComponent(m.event_ticker),15000).then(function(d){
    var ts=d.live_data&&d.live_data.details&&d.live_data.details.timeseries;if(!ts||!ts.length)throw new Error('empty BRTI series');
    var last=ts[ts.length-1],v=last.v,age=nowS()-last.t/1000,strike=num(m.floor_strike),close=Date.parse(m.close_time)/1000,tl=close-nowS(),gap=v-strike;
    var sig15=isFinite(vol.v96)?vol.v96:NaN,price=g().med,sigRem=isFinite(sig15)&&isFinite(price)?price*sig15*Math.sqrt(Math.max(tl,1)/900):NaN,z=gap/sigRem,sig16=isFinite(vol.v16)?price*vol.v16*Math.sqrt(Math.max(tl,1)/900):NaN,z16=gap/sig16;
    SNAP.gap={W:Math.round(close)-900,gap:gap,v:v,strike:strike,tl:tl,at:nowS(),age:age};
    var h='<div class="row" style="gap:16px"><div class="kv"><small>BRTI 60-s average now</small><b>'+usd(v)+'</b><small class="mut">'+ago(age)+' old</small></div><div class="kv"><small>strike (floor_strike)</small><b>'+usd(strike)+'</b></div>'
      +'<div class="kv"><small>gap</small><b class="'+(gap>=0?'up-t':'dn-t')+'">'+(gap>=0?'+':'−')+usd(Math.abs(gap))+'</b><small class="mut">'+(gap>=0?'UP if it ended now':'DOWN if it ended now')+'</small></div>'
      +'<div class="kv"><small>time left</small><b>'+mmss(tl)+'</b></div></div>';
    if(isFinite(z))h+='<div style="margin-top:8px" class="mut">Rough distance in normal-vol units: <b>'+(z>=0?'+':'')+z.toFixed(2)+'σ</b> (24 h vol) / <b>'+(isFinite(z16)?(z16>=0?'+':'')+z16.toFixed(2)+'σ':'—')+'</b> (4 h vol)'+(isFinite(z)?' → a plain normal-distribution guess of '+Math.round(Phi(z)*100)+'% / '+(isFinite(z16)?Math.round(Phi(z16)*100)+'%':'—')+' for UP. Compare with Kalshi’s price; ignores jumps and BRTI-vs-board differences.':'')+'</div>';
    box('settle',age>30?'stale':'ok',h,'Kalshi settles on the simple average of the 60 seconds of CF Benchmarks BRTI before the close vs the same average at the window start (the strike). The series’ last point equals the final settlement value (checked against a settled market). The σ lines are my own arithmetic from the board’s candles, not a Kalshi figure.');
  });
}

/* ---------- Kalshi: order book + paper-only log ---------- */
var OBK='pulseboard.obook.v2',OB=null; // v2 key: the old v1 paper log is cleared by the one-time migration in index.html
function obLoad(){try{var s=JSON.parse(localStorage.getItem(OBK)||'null');if(s&&s.rows)return s}catch(e){}return {v:1,rows:[],paper:{}}}
function obSave(){try{localStorage.setItem(OBK,JSON.stringify(OB))}catch(e){}}
OB=obLoad();
function levels(a){return (a||[]).map(function(x){return [num(x[0]),num(x[1])]}).filter(function(x){return isFinite(x[0])&&isFinite(x[1])}).sort(function(a,b){return b[0]-a[0]})}
function depthWithin(L,best,c){return L.filter(function(x){return x[0]>=best-c-1e-9}).reduce(function(s,x){return s+x[1]},0)}
function loadBook(){
  var m=cur();if(!m)return Promise.reject(new Error('Kalshi market not loaded yet'));
  if(kp().viaSnapshot&&kp().viaSnapshot())return Promise.reject(new Error('relay not reachable (snapshot mode)'));
  return J(base()+'/markets/'+encodeURIComponent(m.ticker)+'/orderbook?depth=10',12000).then(function(d){
    var ob=d.orderbook_fp||d.orderbook;if(!ob)throw new Error('no orderbook');
    var Y=levels(ob.yes_dollars||ob.yes),N=levels(ob.no_dollars||ob.no);if(!Y.length||!N.length)throw new Error('empty book side');
    var yb=Y[0][0],nb=N[0][0],ya=1-nb,spread=ya-yb,yd=depthWithin(Y,yb,.05),nd=depthWithin(N,nb,.05),imb=(yd-nd)/(yd+nd);
    var tl=Date.parse(m.close_time)/1000-nowS();
    var h='<div class="row" style="gap:16px"><div class="kv"><small>best UP bid / ask</small><b>'+Math.round(yb*100)+'¢ / '+Math.round(ya*100)+'¢</b></div><div class="kv"><small>spread</small><b>'+Math.round(spread*100)+'¢</b></div>'
     +'<div class="kv"><small>size within 5¢ of best</small><b>UP '+Math.round(yd).toLocaleString()+' · DOWN '+Math.round(nd).toLocaleString()+'</b></div></div>'
     +'<div class="bar" style="margin:8px 0 2px"><i style="left:'+(imb>=0?50:50+imb*50)+'%;width:'+Math.abs(imb)*50+'%;background:'+(imb>=0?'var(--up)':'var(--dn)')+'"></i></div>'
     +'<div>Imbalance <b class="'+(imb>=0?'up-t':'dn-t')+'">'+(imb>=0?'+':'')+Math.round(imb*100)+'%</b> <span class="mut">('+(Math.abs(imb)<.15?'balanced':imb>0?'more resting size on the UP side':'more resting size on the DOWN side')+')</span></div>';
    SNAP.book={W:Math.round(Date.parse(m.close_time)/1000)-900,imb:imb,at:nowS()};
    var P=paperUpdate(m,yb,ya,nb,imb,yd,nd,tl);
    h+=paperHtml();
    box('book','ok',h,'Resting limit orders on this Kalshi market. Mostly market-maker quotes; I have NOT found it predictive at 15 minutes, so it is context. The paper log below only records what a resting limit order would have done — nothing is ever sent to Kalshi.');
    wirePaper();
  });
}
function paperUpdate(m,yb,ya,nb,imb,yd,nd,tl){
  var now=Math.floor(nowS()),W=Math.floor(Date.parse(m.close_time)/1000)-900,calls=g().calls||{},c=calls[W];
  var last=OB.rows[OB.rows.length-1];
  if(!last||now-last.t>=15){
    OB.rows.push({t:now,tk:m.ticker,W:W,yb:yb,ya:ya,nb:nb,imb:+imb.toFixed(4),yd:Math.round(yd),nd:Math.round(nd),strike:num(m.floor_strike),tl:Math.round(tl)});
    while(OB.rows.length>500)OB.rows.shift();
  }
  var P=OB.paper;
  if(c&&!P[W]){
    if(c.noedge)P[W]={W:W,tk:m.ticker,side:null,skipped:'no edge',t:now};
    else{var side=c.dir,px=side==='UP'?yb:nb;P[W]={W:W,tk:m.ticker,side:side,px:px,t:now,filled:false,res:null,pnl:null}}
  }
  var o=P[W];
  if(o&&o.side&&!o.filled){ // plausible fill: the opposing quote came down to our resting bid
    if(o.side==='UP'&&ya<=o.px+1e-9)o.filled=true;
    if(o.side==='DOWN'&&yb>=1-o.px-1e-9)o.filled=true;
  }
  var ks=Object.keys(P).map(Number).sort(function(a,b){return a-b});while(ks.length>200)delete P[ks.shift()];
  obSave();
}
function paperStats(){
  var n=0,f=0,w=0,l=0,pnl=0,skip=0,open=0;
  Object.keys(OB.paper).forEach(function(k){var o=OB.paper[k];if(!o.side){skip++;return}n++;
    if(o.filled)f++;
    if(o.filled&&o.res){var win=(o.side==='UP')===(o.res==='yes');if(win){w++;pnl+=1-o.px}else{l++;pnl-=o.px}}
    else if(!o.res)open++});
  return {n:n,f:f,w:w,l:l,pnl:pnl,skip:skip,open:open};
}
function paperHtml(){
  var s=paperStats();
  return '<details style="margin-top:8px"><summary>Paper-only limit-order test (browser storage)</summary><div class="mut" style="font-size:13px;margin-top:4px">Idea tested: for each window the board calls with an edge, a pretend buy rests at the best bid on the called side. “Filled” is only a guess (the opposite quote later reached our price; 20-s sampling can miss fills). Per contract, ignores fees. '+s.n+' paper orders ('+s.skip+' skipped: no edge) · '+s.f+' plausibly filled · settled: '+s.w+' W / '+s.l+' L · paper P&amp;L '+(s.pnl>=0?'+':'−')+'$'+Math.abs(s.pnl).toFixed(2)+' per contract · '+OB.rows.length+' book snapshots stored (max 500). Only grows while this page is open.</div><div class="row" style="margin-top:6px"><button class="small" id="obCsv">⬇ Export paper log CSV</button><button class="small" id="obClear">Clear paper log</button></div></details>';
}
function wirePaper(){
  var b=$('obCsv');if(b)b.onclick=function(){
    var rows=['kind,t_unix,window_start,ticker,yes_bid,yes_ask,no_bid,imbalance_5c,yes_size_5c,no_size_5c,strike,secs_left,side,paper_px,plausibly_filled,kalshi_result,paper_pnl'];
    OB.rows.forEach(function(r){rows.push(['snapshot',r.t,r.W,r.tk,r.yb,r.ya,r.nb,r.imb,r.yd,r.nd,r.strike,r.tl,'','','','',''].join(','))});
    Object.keys(OB.paper).forEach(function(k){var o=OB.paper[k];rows.push(['paper',o.t,o.W,o.tk,'','','','','','','','',o.side||('skipped:'+o.skipped),o.px==null?'':o.px,o.filled?'1':'0',o.res||'',o.pnl==null?'':o.pnl].join(','))});
    var a=document.createElement('a');a.href=URL.createObjectURL(new Blob([rows.join('\n')],{type:'text/csv'}));a.download='pulse-orderbook-paper-log.csv';document.body.appendChild(a);a.click();setTimeout(function(){URL.revokeObjectURL(a.href);a.remove()},500)};
  var c=$('obClear');if(c)c.onclick=function(){if(confirm('Clear the paper order-book log? (Your prediction log and bets are untouched.)')){OB={v:1,rows:[],paper:{}};obSave();loadBook().catch(function(){})}};
}

/* ---------- Kalshi: score calls vs REAL settlement (expiration_value vs floor_strike) ---------- */
function onKalshi(d){
  var settled=d&&d.settled||[],P=window.__pulse,st=P&&P.state&&P.state(),changed=false,paperChanged=false,bad=0,seen=0;
  if(!st)return;
  settled.forEach(function(s){
    var res=s.result;if(res!=='yes'&&res!=='no')return;
    var W=Math.round(Date.parse(s.close_time)/1000)-900,exp=num(s.expiration_value),fs=num(s.floor_strike);
    var o=OB.paper[W];if(o&&!o.res){o.res=res;paperChanged=true;if(o.side&&o.filled){var win=(o.side==='UP')===(res==='yes');o.pnl=win?+(1-o.px).toFixed(4):+(-o.px).toFixed(4)}}
    var c=st.calls[W];if(!c||!c.dir)return;
    seen++;
    var consistent=isFinite(exp)&&isFinite(fs)?((exp>=fs)===(res==='yes')):true;if(!consistent)bad++;
    var k=((c.dir==='UP')===(res==='yes'))?'win':'loss';
    if(c.kres!==k||c.kexp!==exp){c.kres=k;c.kexp=exp;c.kstrike=fs;changed=true}
  });
  if(paperChanged)obSave();
  if(changed&&P.save){P.save();if(P.rerender)P.rerender()}
  window.__kalshiScore={seen:seen,inconsistent:bad};
}

/* ---------- derivatives context: funding, open interest, Fear & Greed, USD/USDT premium ---------- */
function loadDeriv(){
  var items=[];
  var a=J('https://www.okx.com/api/v5/public/funding-rate?instId=BTC-USDT-SWAP').then(function(d){var x=d.data[0];SNAP.funding={rate:num(x.fundingRate)*100,at:nowS()};return '<div class="kv"><small>OKX perp funding (per 8 h)</small><b>'+(num(x.fundingRate)*100).toFixed(4)+'%</b><small class="mut">next '+new Date(+x.nextFundingTime||+x.fundingTime).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})+'</small></div>'},function(e){return '<div class="kv"><small>OKX funding</small><b class="mut">unavailable</b><small class="mut">'+esc(why(e))+'</small></div>'});
  var b=J('https://www.okx.com/api/v5/public/open-interest?instId=BTC-USDT-SWAP').then(function(d){var x=d.data[0];return '<div class="kv"><small>OKX perp open interest</small><b>'+Math.round(num(x.oiCcy)).toLocaleString()+' BTC</b><small class="mut">≈ $'+(num(x.oiUsd)/1e9).toFixed(2)+'B · '+ago(nowS()-x.ts/1000)+' old</small></div>'},function(e){return '<div class="kv"><small>OKX open interest</small><b class="mut">unavailable</b><small class="mut">'+esc(why(e))+'</small></div>'});
  var c=J('https://api.alternative.me/fng/?limit=1').then(function(d){var x=d.data[0];SNAP.fng={v:num(x.value),cls:String(x.value_classification||''),at:nowS()};return '<div class="kv"><small>Fear &amp; Greed (daily)</small><b>'+esc(x.value)+' · '+esc(x.value_classification)+'</b><small class="mut">updated '+ago(nowS()-x.timestamp)+' ago</small></div>'},function(e){return '<div class="kv"><small>Fear &amp; Greed</small><b class="mut">unavailable</b><small class="mut">'+esc(why(e))+'</small></div>'});
  var pm=g().prem,pr=isFinite(pm)?'<div class="kv"><small>USD vs USDT venues (premium)</small><b>'+(pm>=0?'+':'')+(pm*100).toFixed(3)+'%</b><small class="mut">board consensus, last closed candle</small></div>':'<div class="kv"><small>USD vs USDT premium</small><b class="mut">unavailable</b></div>';
  return Promise.all([a,b,c]).then(function(r){
    var ok=r.filter(function(x){return x.indexOf('unavailable')<0}).length;
    box('deriv',ok?'ok':'bad','<div class="row" style="gap:18px">'+r.join('')+pr+'</div>','Context only. Funding, open interest and sentiment did not improve 15-minute accuracy in my backtest (OKX funding tested: no edge). ETF daily flows have no free CORS-friendly feed, so they are not shown.');
  });
}

/* ---------- liquidations (OKX BTC-USDT perp) ---------- */
function loadLiq(){
  var ct=J('https://www.okx.com/api/v5/public/instruments?instType=SWAP&instId=BTC-USDT-SWAP').then(function(d){var v=num(d.data[0].ctVal);if(!isFinite(v)||v<=0)throw new Error('no contract size');return v});
  var lq=J('https://www.okx.com/api/v5/public/liquidation-orders?instType=SWAP&uly=BTC-USDT&state=filled&limit=100');
  return Promise.all([ct,lq]).then(function(r){
    var ctVal=r[0],rows=[];
    (r[1].data||[]).forEach(function(o){(o.details||[]).forEach(function(x){var sz=num(x.sz),px=num(x.bkPx),t=+x.ts;if(isFinite(sz)&&isFinite(px)&&isFinite(t))rows.push({t:t/1000,long:x.posSide==='long',usd:sz*ctVal*px,px:px,btc:sz*ctVal})})});
    rows.sort(function(a,b){return b.t-a.t});
    var now=nowS(),h1=rows.filter(function(x){return now-x.t<=3600}),L=h1.filter(function(x){return x.long}).reduce(function(s,x){return s+x.usd},0),S=h1.filter(function(x){return !x.long}).reduce(function(s,x){return s+x.usd},0);
    var oldest=rows.length?now-rows[rows.length-1].t:0;
    SNAP.liq={L:L,S:S,n:h1.length,at:nowS()};
    if(window.FlowTracker)FlowTracker.addLiq(rows);
    var h='<div class="row" style="gap:16px"><div class="kv"><small>longs liquidated, last 60 min</small><b class="dn-t">'+usd(L,0)+'</b></div><div class="kv"><small>shorts liquidated, last 60 min</small><b class="up-t">'+usd(S,0)+'</b></div><div class="kv"><small>events</small><b>'+h1.length+'</b></div></div>';
    h+=rows.slice(0,5).map(function(x){return '<div class="mut" style="font-size:13px">'+ago(now-x.t)+' ago · '+(x.long?'long':'short')+' liquidated · '+x.btc.toFixed(4)+' BTC ≈ '+usd(x.usd,0)+' @ '+usd(x.px,0)+'</div>'}).join('')||'<div class="mut">No liquidations in the sample OKX returned.</div>';
    box('liq','ok',h,'OKX BTC-USDT perpetual only (size = contracts × 0.01 BTC × bankruptcy price). OKX’s REST feed returns just the latest handful of events'+(rows.length&&oldest<3600?', so the 60-minute totals are a floor, not a full count':'')+'. Binance and Bybit liquidation feeds are geo-blocked / have no browser-friendly endpoint, so they are not included. Forced selling that already happened is context, not a forecast.');
  });
}

/* ---------- whales: large unconfirmed BTC transfers (blockchain.info) ---------- */
var WHALE_BTC=100;
function loadWhale(){
  return (window.FlowTracker?FlowTracker.bcSample(30):J('https://blockchain.info/unconfirmed-transactions?format=json&cors=true',20000)).then(function(d){
    var tx=(d.txs||[]).map(function(x){return {h:x.hash,t:x.time,btc:(x.out||[]).reduce(function(s,o){return s+(o.value||0)},0)/1e8}}).sort(function(a,b){return b.btc-a.btc});
    var price=g().med,big=tx.filter(function(x){return x.btc>=WHALE_BTC}),now=nowS();
    function line(x){return '<div style="font-size:13px"><a href="https://mempool.space/tx/'+esc(x.h)+'" target="_blank" rel="noopener noreferrer">'+x.btc.toFixed(1)+' BTC'+(isFinite(price)?' ≈ '+usd(x.btc*price,0):'')+'</a> <span class="mut">· '+ago(now-x.t)+' ago · unconfirmed</span></div>'}
    var h='<div>'+(big.length?'<b>'+big.length+'</b> transfer'+(big.length>1?'s':'')+' ≥ '+WHALE_BTC+' BTC in the mempool sample':'<b>None right now</b> ≥ '+WHALE_BTC+' BTC in the sample')+'</div>';
    h+=(big.length?big.slice(0,5):tx.slice(0,3)).map(line).join('');
    if(!big.length)h+='<div class="mut" style="font-size:12px">(above: the largest 3 in the sample, all below the whale line)</div>';
    box('whale','ok',h,'Latest ~100 unconfirmed transactions (blockchain.info); output total includes change, so it overstates the amount moved. Exchange inflow/outflow labels need paid data (Glassnode / CryptoQuant), so I cannot say whether a transfer is heading to an exchange. Not a signal.');
  });
}

/* ---------- news strip ---------- */
var FEEDS=[['Cointelegraph (Bitcoin)','https://cointelegraph.com/rss/tag/bitcoin'],['Cointelegraph','https://cointelegraph.com/rss'],['Decrypt','https://decrypt.co/feed']];
var lastNews=null;
function loadNews(){
  // sequential, spaced requests: the free rss2json relay rate-limits bursts (HTTP 429)
  var R=[],chain=Promise.resolve();
  FEEDS.forEach(function(f,i){chain=chain.then(function(){return new Promise(function(ok){setTimeout(ok,i?700:0)})}).then(function(){
    return J('https://api.rss2json.com/v1/api.json?rss_url='+encodeURIComponent(f[1]),15000).then(function(d){if(d.status!=='ok')throw new Error(d.message||'feed error');R.push((d.items||[]).map(function(i){return {src:f[0],title:i.title,link:i.link,t:Date.parse(String(i.pubDate).replace(' ','T')+'Z')/1000}}))},function(e){R.push({err:e,src:f[0]})})})});
  return chain.then(function(){
    var items=[],errs=[];R.forEach(function(r){if(r.err)errs.push(r.src+': '+why(r.err));else items=items.concat(r)});
    var seen={};items=items.filter(function(i){var k=String(i.title||'').toLowerCase().replace(/\s+/g,' ').trim();if(!k||!i.link||!isFinite(i.t)||seen[k])return false;seen[k]=1;return /^https?:\/\//.test(i.link)}).sort(function(a,b){return b.t-a.t});
    function draw(list,fetchedAt,staleNote){
      var now=nowS(),newest=now-list[0].t;
      var h=list.slice(0,8).map(function(i){return '<div class="newsrow"><a href="'+esc(i.link)+'" target="_blank" rel="noopener noreferrer">'+esc(i.title)+'</a><div class="mut" style="font-size:12px">'+esc(i.src)+' · '+ago(now-i.t)+' ago</div></div>'}).join('');
      box('news',(staleNote||newest>21600)?'stale':'ok',h,(staleNote?'<b>Showing the last successful fetch ('+ago(now-fetchedAt)+' ago): '+esc(staleNote)+'.</b> ':'')+'Headlines via the free rss2json relay of Cointelegraph and Decrypt RSS'+(!staleNote&&errs.length?' (partial: '+esc(errs.join('; '))+')':'')+'. For reading only: headlines did not predict 15-minute moves beyond Kalshi’s price in earlier research, and are often late.');
    }
    if(items.length){lastNews={items:items,at:nowS()};draw(items,nowS(),'');return}
    if(lastNews){draw(lastNews.items,lastNews.at,errs.join(' · ')||'no items');return}
    // fallback: Hacker News search (CORS-friendly, no key). Discussion links, not newsroom reporting.
    return J('https://hn.algolia.com/api/v1/search_by_date?query=bitcoin&tags=story&hitsPerPage=8',12000).then(function(d){
      var hn=(d.hits||[]).filter(function(x){return x.title}).map(function(x){return {src:'Hacker News (discussion)',title:x.title,link:x.url||('https://news.ycombinator.com/item?id='+x.objectID),t:Date.parse(x.created_at)/1000}}).filter(function(x){return isFinite(x.t)&&/^https?:\/\//.test(x.link)});
      if(!hn.length)throw new Error('no items');
      draw(hn,nowS(),'headline relay unavailable ('+errs.join('; ')+'); showing Hacker News posts mentioning bitcoin instead');
    },function(e2){throw new Error((errs.join(' · ')||'no items')+' · Hacker News: '+why(e2))});
  });
}

/* ---------- orchestration: independent feeds, never block the board ---------- */
var FEEDLIST=[['settle',20000,loadSettle,'Needs the relay’s live_data route'],['book',20000,loadBook,'Needs the relay’s orderbook route'],['vol',60000,loadVol],['deriv',60000,loadDeriv],['liq',60000,loadLiq],['whale',120000,loadWhale],['news',300000,loadNews]];
var running={};
function runFeed(f){
  var id=f[0];if(running[id])return Promise.resolve();running[id]=true;
  var p;try{p=Promise.resolve(f[2]())}catch(e){p=Promise.reject(e)}
  return p.catch(function(e){unavailable(id,e,f[3]&&/403|relay|snapshot|not loaded|HTTP/.test(why(e))?esc(f[3])+' (not deployed yet or Kalshi unreachable).':'')}).then(function(){running[id]=false;firstDone[id]=true});
}
function start(){
  renderEvents();setInterval(renderEvents,15000);
  FEEDLIST.forEach(function(f,i){
    var go=function(){runFeed(f);setInterval(function(){if(document.visibilityState==='visible')runFeed(f)},f[1])};
    if(i<2){var tries=0,w=setInterval(function(){tries++;if(window.__kalshiReady||tries>80){clearInterval(w);go()}},500)} // Kalshi-dependent: wait for the Kalshi panel's first load
    else setTimeout(go,i*400);
  });
  var chk=setInterval(function(){if(FEEDLIST.every(function(f){return firstDone[f[0]]})){window.__ctxReady=true;clearInterval(chk)}},500);
  setTimeout(function(){window.__ctxReady=true},45000);
}
function snapshot(W){
  var n=nowS(),o={},ok=function(x,max){return x&&n-x.at<=max};
  if(ok(SNAP.gap,120)&&SNAP.gap.W===W)o.gap={gap:SNAP.gap.gap,tl:Math.max(0,W+900-n)};
  if(ok(SNAP.book,120)&&SNAP.book.W===W)o.book={imb:SNAP.book.imb};
  if(ok(SNAP.funding,900))o.funding={rate:SNAP.funding.rate};
  if(ok(SNAP.fng,172800))o.fng={v:SNAP.fng.v,cls:SNAP.fng.cls};
  if(ok(SNAP.liq,900))o.liq={L:SNAP.liq.L,S:SNAP.liq.S};
  if(window.FlowTracker){var s=FlowTracker.summary(900).tr.all;o.flow={buy:s[2],sell:s[3],cover:FlowTracker.coverage(['bin','okx'],900)}}
  var es=eventState(n);if(es.sit)o.sit=es.sit.name;
  return Object.keys(o).length?o:null;
}
window.ContextPanel={start:start,snapshot:snapshot,obRows:function(){return OB&&OB.rows||[]},onKalshi:onKalshi,_etToUnix:etToUnix,_events:EVENTS,_eventState:eventState,_regime:regime};
})();
