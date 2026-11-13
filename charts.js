/* Price & signal charts — INFORMATION ONLY. Light canvas drawing, no libraries, no keys, places no orders.
   Candles: Coinbase BTC-USD (fallbacks: Binance market-data host, Kraken), 1m / 5m / 15m. Green = closed above its open, red = below.
   Overlays: the current window's strike (Kalshi floor_strike; consensus open if Kalshi is unavailable), 15-minute window boundaries, settled windows' strikes and which Grokky won.
   Signal strips use only data this page really has: large-trade flow tiers + liquidations (FlowTracker, only while this page is open), Kalshi order-book imbalance and UP price (sampled by the Market-context box),
   BRTI settlement gap (sampled here every ~20 s), OKX funding history (public endpoint), OKX open interest (sampled here every ~60 s; the OKX history endpoint has no browser access).
   Nothing is back-filled or invented: a strip with no samples says so. Earlier backtests found these signals did not predict 15-minute moves beyond Kalshi's price. */
(function(){
'use strict';
var Q=900,SIGKEY='pulseboard.sig.v1',GREEN='#2fd18b',RED='#ff5d73',BLUE='#5aa9ff',AMB='#ffb454',MUT='#8b97b3',GRID='#1b2438';
function $(i){return document.getElementById(i)}
function nowS(){return Math.floor(Date.now()/1000)}
function num(x){var v=parseFloat(x);return isFinite(v)?v:NaN}
function usd(x,d){return isFinite(x)?'$'+x.toLocaleString('en-US',{minimumFractionDigits:d==null?0:d,maximumFractionDigits:d==null?0:d}):'—'}
function fu(x){x=Math.abs(x);return x>=1e9?'$'+(x/1e9).toFixed(2)+'B':x>=1e6?'$'+(x/1e6).toFixed(2)+'M':x>=1e3?'$'+Math.round(x/1e3)+'k':'$'+Math.round(x)}
function hhmm(t){return new Date(t*1000).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function J(u,ms){var c=new AbortController(),to=setTimeout(function(){c.abort()},ms||12000);
  return fetch(u,{signal:c.signal,cache:'no-store'}).then(function(r){clearTimeout(to);if(!r.ok)throw new Error('HTTP '+r.status);return r.json()},function(e){clearTimeout(to);throw e})}
function why(e){var m=(e&&e.name==='AbortError')?'timeout':((e&&e.message)||'error');return m==='Failed to fetch'?'blocked/network':m}

/* ================= candle sources ================= */
var TF={'1m':{s:60,show:90,every:15000},'5m':{s:300,show:96,every:30000},'15m':{s:900,show:96,every:45000}};
var SRC=[
  {id:'Coinbase BTC-USD',fn:function(g){return J('https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity='+g).then(function(d){return d.map(function(k){return {t:k[0],o:k[3],h:k[2],l:k[1],c:k[4],v:k[5]}})})}},
  {id:'Binance (market-data host) BTCUSDT',fn:function(g){var iv={60:'1m',300:'5m',900:'15m'}[g];return J('https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval='+iv+'&limit=300').then(function(d){return d.map(function(k){return {t:Math.floor(k[0]/1000),o:+k[1],h:+k[2],l:+k[3],c:+k[4],v:+k[5]}})})}},
  {id:'Kraken XBT/USD',fn:function(g){return J('https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval='+(g/60)).then(function(d){var k=Object.keys(d.result).filter(function(x){return Array.isArray(d.result[x])})[0];return d.result[k].map(function(r){return {t:r[0],o:+r[1],h:+r[2],l:+r[3],c:+r[4],v:+r[6]}})})}}];
var C={tf:'1m',data:{},info:{},hover:-1,timer:null};   // data[tf]=ascending candles; info[tf]={src,at,err}
var SIG=loadSig(),SNAPSTATE={fund:null,fundErr:'',oiErr:''};

function loadSig(){try{var s=JSON.parse(localStorage.getItem(SIGKEY)||'null');if(s&&s.v===1)return s}catch(e){}return {v:1,gap:[],oi:[]}}
function saveSig(){try{localStorage.setItem(SIGKEY,JSON.stringify(SIG))}catch(e){}}

function loadTf(tf,force){
  var def=TF[tf],inf=C.info[tf]||(C.info[tf]={}),now=Date.now();
  if(inf.busy||(!force&&inf.at&&now-inf.at<def.every-500))return Promise.resolve();
  inf.busy=true;var errs=[],i=0;
  function next(){
    if(i>=SRC.length){inf.busy=false;inf.err=errs.join(' · ');draw();return}
    var s=SRC[i++];
    return s.fn(def.s).then(function(a){
      a=a.filter(function(k){return isFinite(k.o+k.h+k.l+k.c)&&k.t>0}).sort(function(x,y){return x.t-y.t});
      if(a.length<20)throw new Error('too few candles');
      if(a[a.length-1].t<nowS()-def.s*3)throw new Error('stale candles');
      return a;
    }).then(function(a){
      C.data[tf]=a;inf.src=s.id;inf.at=Date.now();inf.err='';inf.busy=false;try{draw();updateSignalsOnce()}catch(e){}
    },function(e){errs.push(s.id+': '+why(e));return next()});
  }
  return next();
}

/* ================= overlays: strike + windows ================= */
function curWindow(){var W=Math.floor(nowS()/Q)*Q,kp=window.KalshiPanel,l=kp&&kp.last&&kp.last(),m=l&&l.current,k=null;
  if(m){var w=Math.round(Date.parse(m.close_time)/1000)-Q;if(w===W&&isFinite(num(m.floor_strike)))k=num(m.floor_strike)}
  var g=window.__pulseNow||{};
  if(k!=null)return {W:W,strike:k,src:'Kalshi strike'};
  if(isFinite(g.winOpen))return {W:W,strike:g.winOpen,src:'consensus window open (Kalshi strike not loaded)'};
  return {W:W,strike:NaN,src:''};
}
function pastStrikes(){var G=(window.__pulse&&window.__pulse.state&&window.__pulse.state().groks)||{},o={};Object.keys(G).forEach(function(w){var r=G[w];if(r&&isFinite(r.kstrike))o[w]={strike:r.kstrike,winner:r.winner,g1:r.g1,res:r.kres}});return o}

/* ================= canvas helpers ================= */
function fit(cv){
  var r=cv.getBoundingClientRect(),dpr=window.devicePixelRatio||1,w=Math.max(120,Math.round(r.width)),h=Math.max(60,Math.round(r.height));
  if(cv._w!==w||cv._h!==h||cv._d!==dpr){cv.width=w*dpr;cv.height=h*dpr;cv._w=w;cv._h=h;cv._d=dpr}
  var x=cv.getContext('2d');x.setTransform(dpr,0,0,dpr,0,0);x.clearRect(0,0,w,h);return {x:x,w:w,h:h};
}
function niceTicks(lo,hi,n){var span=hi-lo||1,step=Math.pow(10,Math.floor(Math.log10(span/n))),e=span/n/step;step*=e>=5?5:e>=2?2:1;var a=[],v=Math.ceil(lo/step)*step;while(v<=hi){a.push(v);v+=step}return a}

/* ================= main candle chart ================= */
var LAY={};
function draw(){
  var cv=$('pcChart');if(!cv)return;
  var tf=C.tf,def=TF[tf],all=C.data[tf],f=fit(cv),x=f.x,W=f.w,H=f.h;
  if(!all||!all.length){x.fillStyle=MUT;x.font='13px system-ui';x.fillText((C.info[tf]&&C.info[tf].err)?'Candles unavailable: '+C.info[tf].err:'Loading candles…',14,28);return}
  var cs=all.slice(-def.show),padL=8,padR=64,padT=10,padB=22,volH=Math.round(H*.16),ph=H-padT-padB-volH-6,pw=W-padL-padR,n=cs.length,step=pw/(n+1),bw=Math.max(1,Math.min(14,step*.68));
  var cw=curWindow(),ps=pastStrikes(),lo=Infinity,hi=-Infinity,vmax=0;
  cs.forEach(function(k){lo=Math.min(lo,k.l);hi=Math.max(hi,k.h);vmax=Math.max(vmax,k.v)});
  if(isFinite(cw.strike)&&cw.strike>lo-(hi-lo)*.6&&cw.strike<hi+(hi-lo)*.6){lo=Math.min(lo,cw.strike);hi=Math.max(hi,cw.strike)}
  var pad=(hi-lo)*.06||1;lo-=pad;hi+=pad;
  function X(i){return padL+step*(i+.5)}
  function Y(p){return padT+ph*(1-(p-lo)/(hi-lo))}
  var t0=cs[0].t,t1=cs[n-1].t+def.s;
  function XT(t){return padL+step*((t-t0)/def.s+.5)}
  LAY={cs:cs,X:X,Y:Y,padL:padL,padR:padR,padT:padT,ph:ph,W:W,H:H,step:step};
  // grid + price axis
  x.font='11px system-ui';x.textBaseline='middle';
  niceTicks(lo,hi,5).forEach(function(v){var y=Math.round(Y(v))+.5;x.strokeStyle=GRID;x.lineWidth=1;x.beginPath();x.moveTo(padL,y);x.lineTo(W-padR,y);x.stroke();x.fillStyle=MUT;x.textAlign='left';x.fillText(usd(v),W-padR+6,y)});
  // 15-minute window boundaries (+ faint tint on alternate windows) and time labels
  var wa=Math.floor(t0/Q)*Q,lblEvery=Math.max(1,Math.ceil(58/Math.max(1,step*Q/def.s)));
  x.textAlign='center';x.textBaseline='alphabetic';
  for(var w=wa;w<=t1;w+=Q){
    var xa=XT(w)-step*.5,xb=XT(w+Q)-step*.5;
    if(((w/Q)|0)%2===0){x.fillStyle='rgba(90,169,255,.035)';var l=Math.max(padL,xa),r=Math.min(W-padR,xb);if(r>l)x.fillRect(l,padT,r-l,ph+volH+6)}
    if(xa>=padL&&xa<=W-padR){x.strokeStyle='rgba(139,151,179,.35)';x.setLineDash([3,4]);x.beginPath();x.moveTo(Math.round(xa)+.5,padT);x.lineTo(Math.round(xa)+.5,H-padB);x.stroke();x.setLineDash([]);if(((w/Q)|0)%lblEvery===0){x.fillStyle=MUT;x.fillText(hhmm(w),xa,H-6)}}
    var p=ps[w];
    if(p&&isFinite(p.strike)&&w+Q<=t1+Q){var ya=Y(p.strike);if(ya>padT&&ya<padT+ph){x.strokeStyle='rgba(255,180,84,.55)';x.lineWidth=1;x.setLineDash([2,3]);x.beginPath();x.moveTo(Math.max(padL,xa),ya);x.lineTo(Math.min(W-padR,xb),ya);x.stroke();x.setLineDash([])}}
  }
  // volume
  cs.forEach(function(k,i){var vh=vmax?k.v/vmax*volH:0;x.fillStyle=k.c>=k.o?'rgba(47,209,139,.35)':'rgba(255,93,115,.35)';x.fillRect(X(i)-bw/2,H-padB-vh,bw,vh)});
  // candles
  cs.forEach(function(k,i){var up=k.c>=k.o,col=up?GREEN:RED,cx=Math.round(X(i))+.5;x.strokeStyle=col;x.fillStyle=col;x.lineWidth=1;x.beginPath();x.moveTo(cx,Y(k.h));x.lineTo(cx,Y(k.l));x.stroke();
    var yo=Y(k.o),yc=Y(k.c);x.fillRect(Math.round(X(i)-bw/2),Math.min(yo,yc),Math.max(1,Math.round(bw)),Math.max(1,Math.abs(yo-yc)))});
  // current strike line across the chart, labelled
  if(isFinite(cw.strike)){var ys=Y(cw.strike);if(ys>=padT&&ys<=padT+ph){x.strokeStyle=AMB;x.lineWidth=1.5;x.setLineDash([6,4]);x.beginPath();x.moveTo(padL,ys);x.lineTo(W-padR,ys);x.stroke();x.setLineDash([]);
    x.fillStyle=AMB;x.textAlign='right';x.textBaseline='alphabetic';x.font='bold 11px system-ui';x.fillText('strike '+usd(cw.strike,2),W-padR-6,Math.max(padT+12,Math.min(padT+ph-4,ys-5)))}}
  // last price tag
  var last=cs[n-1],yl=Y(last.c),lc=last.c>=last.o?GREEN:RED;x.strokeStyle=lc;x.lineWidth=1;x.setLineDash([1,3]);x.beginPath();x.moveTo(padL,yl);x.lineTo(W-padR,yl);x.stroke();x.setLineDash([]);
  x.fillStyle=lc;x.fillRect(W-padR+1,yl-8,padR-2,16);x.fillStyle='#08101c';x.textAlign='left';x.textBaseline='middle';x.font='bold 11px system-ui';x.fillText(usd(last.c,0),W-padR+5,yl);
  // hover crosshair
  if(C.hover>=0&&C.hover<n){var k=cs[C.hover],hx=Math.round(X(C.hover))+.5;x.strokeStyle='rgba(230,236,247,.35)';x.setLineDash([2,3]);x.beginPath();x.moveTo(hx,padT);x.lineTo(hx,H-padB);x.stroke();x.setLineDash([])}
  var ro=$('pcReadout');
  if(ro){var k2=(C.hover>=0&&C.hover<n)?cs[C.hover]:last,inf=C.info[tf]||{};
    ro.innerHTML='<b>'+new Date(k2.t*1000).toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})+'</b> · O '+usd(k2.o,2)+' H '+usd(k2.h,2)+' L '+usd(k2.l,2)+' C <b class="'+(k2.c>=k2.o?'up-t':'dn-t')+'">'+usd(k2.c,2)+'</b> ('+(k2.c>=k2.o?'+':'−')+usd(Math.abs(k2.c-k2.o),2)+') · vol '+k2.v.toFixed(1)+' BTC'+(C.hover<0?' <span class="mut">(latest, still forming)</span>':'');}
  var nt=$('pcNote');
  if(nt){var inf2=C.info[tf]||{};nt.innerHTML='Candles: <b>'+esc(inf2.src||'—')+'</b>'+(inf2.at?' · updated '+Math.round((Date.now()-inf2.at)/1000)+' s ago':'')+' · showing '+n+' × '+tf+' candles · dashed amber = '+esc(cw.src||'strike not available')+(isFinite(cw.strike)?' ('+usd(cw.strike,2)+')':'')+' · dotted grey = 15-minute window boundaries · small amber ticks = earlier windows’ Kalshi strikes. The strike is a BRTI 60-second average, so it can sit a few dollars away from this exchange’s candles.'}
}
function hoverAt(clientX){var cv=$('pcChart');if(!cv||!LAY.cs)return;var r=cv.getBoundingClientRect(),px=clientX-r.left,i=Math.round((px-LAY.padL)/LAY.step-.5);C.hover=(i>=0&&i<LAY.cs.length)?i:-1;draw()}

/* ================= signal strips ================= */
function axisTimes(x,w,h,t0,t1,padL,padR){x.fillStyle=MUT;x.font='10px system-ui';x.textBaseline='alphabetic';var long=(t1-t0)>36*3600;for(var i=0;i<=3;i++){var t=t0+(t1-t0)*i/3;x.textAlign=i===0?'left':i===3?'right':'center';x.fillText(long?new Date(t*1000).toLocaleDateString([], {month:'short',day:'numeric'}):hhmm(t),padL+(w-padL-padR)*i/3,h-3)}}
function stripBars(id,series,t0,t1,binS,opt){ // series: [{col,map:{binStartSec:value}}] stacked on the + side; opt.neg: same on the - side
  var cv=$(id);if(!cv)return false;var f=fit(cv),x=f.x,w=f.w,h=f.h,pl=6,pr=6,pt=6,pb=14,ph=h-pt-pb,mid=pt+ph/2,bins=Math.max(1,Math.round((t1-t0)/binS)),bw=(w-pl-pr)/bins,maxv=0,any=false;
  var tot={};
  for(var b=0;b<bins;b++){var t=t0+b*binS,up=0,dn=0;(opt.pos||[]).forEach(function(s){up+=s.map[t]||0});(opt.neg||[]).forEach(function(s){dn+=s.map[t]||0});tot[t]={up:up,dn:dn};maxv=Math.max(maxv,up,dn);if(up||dn)any=true}
  x.strokeStyle=GRID;x.beginPath();x.moveTo(pl,Math.round(mid)+.5);x.lineTo(w-pr,Math.round(mid)+.5);x.stroke();
  if(!any){x.fillStyle=MUT;x.font='12px system-ui';x.textAlign='left';x.fillText(opt.empty||'no samples yet',pl+2,mid-6);axisTimes(x,w,h,t0,t1,pl,pr);return false}
  var half=ph/2-2;
  for(var b2=0;b2<bins;b2++){var t2=t0+b2*binS,xx=pl+b2*bw,yy=mid;
    (opt.pos||[]).forEach(function(s){var v=(s.map[t2]||0)/maxv*half;if(v>0){x.fillStyle=s.col;x.fillRect(xx+.5,yy-v,Math.max(1,bw-1),v);yy-=v}});
    yy=mid;(opt.neg||[]).forEach(function(s){var v=(s.map[t2]||0)/maxv*half;if(v>0){x.fillStyle=s.col;x.fillRect(xx+.5,yy,Math.max(1,bw-1),v);yy+=v}})}
  x.fillStyle=MUT;x.font='10px system-ui';x.textAlign='right';x.fillText('±'+fu(maxv),w-pr,pt+8);axisTimes(x,w,h,t0,t1,pl,pr);return true;
}
function stripLine(id,pts,t0,t1,opt){ // pts [[t,v]]; opt {zero,min,max,col,step,fmt,lines:[{pts,col}]}
  var cv=$(id);if(!cv)return false;var f=fit(cv),x=f.x,w=f.w,h=f.h,pl=6,pr=44,pt=8,pb=14,ph=h-pt-pb;
  var groups=opt.lines||[{pts:pts,col:opt.col}],lo=Infinity,hi=-Infinity,cnt=0;
  groups.forEach(function(g){g.pts.forEach(function(p){if(p[0]>=t0&&p[0]<=t1){lo=Math.min(lo,p[1]);hi=Math.max(hi,p[1]);cnt++}})});
  if(opt.zero){lo=Math.min(lo,0);hi=Math.max(hi,0)}
  if(opt.min!=null)lo=opt.min;if(opt.max!=null)hi=opt.max;
  if(!cnt||!isFinite(lo)){x.fillStyle=MUT;x.font='12px system-ui';x.textAlign='left';x.fillText(opt.empty||'no samples yet',pl+2,pt+ph/2);axisTimes(x,w,h,t0,t1,pl,pr);return false}
  if(hi===lo){hi+=1;lo-=1}var pd=(hi-lo)*.08;if(opt.min==null)lo-=pd;if(opt.max==null)hi+=pd;
  function X(t){return pl+(w-pl-pr)*(t-t0)/(t1-t0)}function Y(v){return pt+ph*(1-(v-lo)/(hi-lo))}
  if(opt.bounds)opt.bounds.forEach(function(b){if(b>=t0&&b<=t1){x.strokeStyle='rgba(139,151,179,.3)';x.setLineDash([2,3]);x.beginPath();x.moveTo(Math.round(X(b))+.5,pt);x.lineTo(Math.round(X(b))+.5,pt+ph);x.stroke();x.setLineDash([])}});
  if(opt.zero&&0>lo&&0<hi){x.strokeStyle='rgba(139,151,179,.5)';x.beginPath();x.moveTo(pl,Math.round(Y(0))+.5);x.lineTo(w-pr,Math.round(Y(0))+.5);x.stroke()}
  groups.forEach(function(g){var ps=g.pts.filter(function(p){return p[0]>=t0&&p[0]<=t1});if(!ps.length)return;x.strokeStyle=g.col;x.lineWidth=1.6;x.beginPath();var prev=null;
    ps.forEach(function(p,i){var px=X(p[0]),py=Y(p[1]);if(i===0)x.moveTo(px,py);else if(opt.step||(prev&&p[0]-prev>(g.gapS||1e9))){if(opt.step){x.lineTo(px,Y(ps[i-1][1]))}else{x.moveTo(px,py)}x.lineTo(px,py)}else x.lineTo(px,py);prev=p[0]});x.stroke();
    var lp=ps[ps.length-1];x.fillStyle=g.col;x.beginPath();x.arc(X(lp[0]),Y(lp[1]),2.5,0,7);x.fill()});
  x.fillStyle=MUT;x.font='10px system-ui';x.textAlign='left';x.textBaseline='middle';var fm=opt.fmt||function(v){return v.toFixed(2)};x.fillText(fm(hi),w-pr+4,pt+4);x.fillText(fm(lo),w-pr+4,pt+ph-2);x.textBaseline='alphabetic';
  axisTimes(x,w,h,t0,t1,pl,pr);return true;
}
function bucketsFor(kind,binS,t0,t1){ // from FlowTracker per-minute totals -> per-bin per-tier values
  var ft=window.FlowTracker,bk=ft&&ft.buckets&&ft.buckets()||{},out={};
  Object.keys(bk).forEach(function(m){var t=m*60;if(t<t0||t>=t1)return;var bin=t0+Math.floor((t-t0)/binS)*binS;[1,2,3].forEach(function(tr){var a=bk[m][kind+tr];if(!a)return;(out[tr]||(out[tr]={buy:{},sell:{}}));out[tr].buy[bin]=(out[tr].buy[bin]||0)+a[2];out[tr].sell[bin]=(out[tr].sell[bin]||0)+a[3]})});
  return out;
}
var TIERCOL={buy:{1:'#1f8a5f',2:'#2fd18b',3:'#9bf5cf'},sell:{1:'#a03a4a',2:'#ff5d73',3:'#ffb3bf'}};
function covNote(feeds,winS){var ft=window.FlowTracker;if(!ft||!ft.coverage)return '';var c=ft.coverage(feeds,winS);return c>=winS-90?'Watched the whole 3 h':c<60?'Just started watching (this page only counts while it is open)':'Watched '+Math.round(c/60)+' of the last '+Math.round(winS/60)+' min (this page only counts while it is open)'}
function drawSignals(){
  var n=nowS(),t1=Math.ceil(n/300)*300,t0=t1-3*3600,bounds=[];for(var b=Math.floor(t0/Q)*Q;b<=t1;b+=Q)bounds.push(b);
  var set=function(id,h){var e=$(id);if(e)e.innerHTML=h};
  // A flow tiers
  var tr=bucketsFor('tr',300,t0,t1),pos=[],neg=[];
  [1,2,3].forEach(function(t){pos.push({col:TIERCOL.buy[t],map:(tr[t]&&tr[t].buy)||{}});neg.push({col:TIERCOL.sell[t],map:(tr[t]&&tr[t].sell)||{}})});
  var okA=stripBars('sgFlow',null,t0,t1,300,{pos:pos,neg:neg,empty:'no ≥$25k exchange trades recorded yet'});
  set('sgFlowN',okA?'Taker <b class="up-t">buys</b> above / <b class="dn-t">sells</b> below the line, 5-minute bars stacked by tier (dark $25–100k · mid $100k–1M · light $1M+). '+covNote(['bin','okx'],3*3600)+'.':'Waiting for large trades. Only counts while this page is open.');
  // B liquidations
  var lq=bucketsFor('lq',300,t0,t1),lp=[],ln=[]; // FlowTracker stores liquidations as a[2]=longs$, a[3]=shorts$ (exposed here as buy/sell)
  [1,2,3].forEach(function(t){lp.push({col:TIERCOL.buy[t],map:(lq[t]&&lq[t].sell)||{}});ln.push({col:TIERCOL.sell[t],map:(lq[t]&&lq[t].buy)||{}})});
  var okB=stripBars('sgLiq',null,t0,t1,300,{pos:lp,neg:ln,empty:'no ≥$25k liquidations recorded yet'});
  set('sgLiqN',okB?'OKX forced closes, 5-minute bars: <b class="up-t">shorts liquidated</b> above / <b class="dn-t">longs liquidated</b> below. '+covNote(['lq'],3*3600)+'.':'No large liquidations recorded yet (only counts while this page is open).');
  // C order-book imbalance + Kalshi UP price
  var rows=(window.ContextPanel&&ContextPanel.obRows&&ContextPanel.obRows()||[]).filter(function(r){return r.t>=t0}),imb=[],mid=[];
  rows.forEach(function(r){imb.push([r.t,r.imb]);if(r.yb>0&&r.ya>0)mid.push([r.t,(r.yb+r.ya)/2*100])});
  var okC=stripLine('sgBook',null,t0,t1,{zero:true,min:-1,max:1,empty:'no order-book samples yet',lines:[{pts:imb,col:BLUE,gapS:300}],fmt:function(v){return (v>=0?'+':'')+Math.round(v*100)+'%'},bounds:bounds});
  set('sgBookN',okC?'Kalshi order-book imbalance (blue; + = more resting size on UP). Sampled about every 15 s by the Market-context box while this page is open; gaps are shown as breaks. Kalshi’s UP price now: '+(mid.length?Math.round(mid[mid.length-1][1])+'¢':'—')+'.':'Waiting for order-book samples (needs the Kalshi relay).');
  // D settlement gap
  var gp=SIG.gap.filter(function(p){return p[0]>=t0}).map(function(p){return [p[0],p[1]]});
  var okD=stripLine('sgGap',null,t0,t1,{zero:true,empty:'no BRTI gap samples yet',lines:[{pts:gp,col:AMB,gapS:120}],fmt:function(v){return (v>=0?'+':'−')+usd(Math.abs(v))},bounds:bounds});
  set('sgGapN',okD?'BRTI 60-second average minus the strike (amber). Above 0 = “UP if it ended now”. Resets to ≈0 at each window start (dotted lines). Sampled here every ~20 s while open.':'Waiting for the Kalshi BRTI gap (needs the relay’s live_data route).');
  // E funding history (public endpoint, real history)
  var fd=SNAPSTATE.fund,fp=fd?fd.map(function(p){return [p[0],p[1]]}):[];
  var fT0=fd&&fd.length?fd[0][0]-1800:t0,fT1=n+3600;
  var okE=stripLine('sgFund',null,fT0,fT1,{zero:true,step:true,empty:SNAPSTATE.fundErr?'funding history unavailable: '+SNAPSTATE.fundErr:'loading funding history…',lines:[{pts:fp,col:BLUE}],fmt:function(v){return v.toFixed(3)+'%'}});
  set('sgFundN',okE?'OKX BTC perpetual funding per 8 h, last '+fd.length+' settlements (~'+Math.round(fd.length/3)+' days; real history). Positive = longs pay shorts.':'Funding history not available right now.');
  // F open interest (sampled)
  var oi=SIG.oi.filter(function(p){return p[0]>=n-24*3600}),oiT0=oi.length?Math.min(oi[0][0],n-1800):n-1800;
  var okF=stripLine('sgOi',null,oiT0,n+60,{empty:SNAPSTATE.oiErr?'open interest unavailable: '+SNAPSTATE.oiErr:'sampling open interest… (first point in a few seconds)',lines:[{pts:oi.map(function(p){return [p[0],p[1]/1e9]}),col:'#c9a3ff',gapS:600}],fmt:function(v){return '$'+v.toFixed(2)+'B'}});
  set('sgOiN',okF?'OKX BTC perpetual open interest in USD, sampled every ~60 s while this page is open ('+oi.length+' samples'+(oi.length?', since '+hhmm(oi[0][0]):'')+'). OKX’s history endpoint has no browser access, so nothing before this page opened is shown.':'No open-interest samples yet.');
}

/* ================= signal sampling ================= */
function sampleGap(){
  var cp=window.ContextPanel,W=Math.floor(nowS()/Q)*Q,s=cp&&cp.snapshot&&cp.snapshot(W),g=s&&s.gap;
  if(g&&isFinite(g.gap)){var last=SIG.gap[SIG.gap.length-1],t=nowS();if(!last||t-last[0]>=18){SIG.gap.push([t,Math.round(g.gap*100)/100,W]);while(SIG.gap.length>700)SIG.gap.shift();saveSig()}}
}
function sampleOi(){
  J('https://www.okx.com/api/v5/public/open-interest?instType=SWAP&instId=BTC-USDT-SWAP').then(function(d){var v=num(d.data&&d.data[0]&&d.data[0].oiUsd);if(!isFinite(v))throw new Error('no value');SIG.oi.push([nowS(),Math.round(v)]);while(SIG.oi.length>1500)SIG.oi.shift();SNAPSTATE.oiErr='';saveSig()},function(e){SNAPSTATE.oiErr=why(e)})["catch"](function(e){SNAPSTATE.oiErr=why(e)});
}
function loadFunding(){
  J('https://www.okx.com/api/v5/public/funding-rate-history?instId=BTC-USDT-SWAP&limit=60').then(function(d){var a=(d.data||[]).map(function(x){return [Math.floor(+x.fundingTime/1000),num(x.fundingRate)*100]}).filter(function(p){return isFinite(p[1])}).sort(function(x,y){return x[0]-y[0]});if(a.length<3)throw new Error('too few points');SNAPSTATE.fund=a;SNAPSTATE.fundErr=''},function(e){SNAPSTATE.fundErr=why(e)})["catch"](function(e){SNAPSTATE.fundErr=why(e)});
}
var sigDone=false;function updateSignalsOnce(){if(sigDone)return;sigDone=true;drawSignals()}

/* ================= chart-derived reading for the Grokkys + per-window price path ================= */
function oneMin(){var a=C.data['1m'];return a&&a.length>40?a:null}
function reading(){ // last-10-minute overshoot vs the typical 10-minute move, from real 1-minute closes (Coinbase/Binance/Kraken, whichever answered)
  var a=oneMin();if(!a)return null;var last=a[a.length-1],now=nowS();if(now-last.t>180)return null;
  var cl=a.slice(-241).map(function(k){return k.c}),r=[];for(var i=1;i<cl.length;i++)r.push(Math.log(cl[i]/cl[i-1]));if(r.length<100)return null;
  var m=r.reduce(function(s,x){return s+x},0)/r.length,sd=Math.sqrt(r.reduce(function(s,x){return s+(x-m)*(x-m)},0)/r.length),sd10=sd*Math.sqrt(10);
  var mv=Math.log(cl[cl.length-1]/cl[cl.length-11]),z=mv/sd10;if(!isFinite(z))return null;
  return {z:z,move:cl[cl.length-1]-cl[cl.length-11],pct:mv,src:(C.info['1m']||{}).src,sd10:sd10};
}
function typical15(){ // standard deviation of real 15-minute close-to-close moves over the loaded history (~3.5 days)
  var a=C.data['15m'];if(!a||a.length<40)return null;var cl=a.map(function(k){return k.c}),r=[];for(var i=1;i<cl.length;i++)r.push(Math.log(cl[i]/cl[i-1]));
  var m=r.reduce(function(s,x){return s+x},0)/r.length,sd=Math.sqrt(r.reduce(function(s,x){return s+(x-m)*(x-m)},0)/r.length);return {pct:sd,usd:sd*cl[cl.length-1]};
}
function windowStats(W,strike){ // price path of one 15-minute window from loaded 1-minute candles (approx: exchange candles, not BRTI)
  var a=C.data['1m'];if(!a||!a.length)return null;var cs=a.filter(function(k){return k.t>=W&&k.t<W+Q});if(cs.length<12||a[0].t>W)return null;
  var hi=-Infinity,lo=Infinity,tHi=0,tLo=0,above=0,below=0;
  cs.forEach(function(k){if(k.h>hi){hi=k.h;tHi=k.t}if(k.l<lo){lo=k.l;tLo=k.t}if(isFinite(strike)){if(k.c>strike)above++;else if(k.c<strike)below++}});
  return {o:cs[0].o,c:cs[cs.length-1].c,hi:hi,lo:lo,tHi:tHi,tLo:tLo,above:above,below:below,n:cs.length,src:(C.info['1m']||{}).src};
}

/* ================= wiring ================= */
function setTf(tf){C.tf=tf;C.hover=-1;[].forEach.call(document.querySelectorAll('#pcTabs .tfb'),function(b){b.classList.toggle('on',b.getAttribute('data-tf')===tf)});draw();loadTf(tf,true)}
function start(){
  var tabs=$('pcTabs');if(tabs)[].forEach.call(tabs.querySelectorAll('.tfb'),function(b){b.onclick=function(){setTf(b.getAttribute('data-tf'))}});
  var cv=$('pcChart');
  if(cv){cv.addEventListener('mousemove',function(e){hoverAt(e.clientX)});cv.addEventListener('mouseleave',function(){C.hover=-1;draw()});cv.addEventListener('touchstart',function(e){hoverAt(e.touches[0].clientX)},{passive:true});cv.addEventListener('touchmove',function(e){hoverAt(e.touches[0].clientX)},{passive:true})}
  var rz=null;window.addEventListener('resize',function(){clearTimeout(rz);rz=setTimeout(function(){draw();drawSignals()},120)});
  loadTf('1m',true);loadTf('5m',true);loadTf('15m',true);loadFunding();sampleOi();
  setInterval(function(){loadTf(C.tf,false);if(C.tf!=='1m')loadTf('1m',false)},5000);   // each timeframe throttles itself (15 s / 30 s / 45 s)
  setInterval(function(){sampleGap()},5000);
  setInterval(sampleOi,60000);setInterval(loadFunding,30*60000);
  setInterval(function(){draw();drawSignals()},10000);
  setTimeout(function(){sampleGap();drawSignals()},4000);
}
window.ChartPanel={start:start,setTf:setTf,draw:draw,drawSignals:drawSignals,reading:reading,typical15:typical15,windowStats:windowStats,curWindow:curWindow,
  _state:function(){return {tf:C.tf,info:C.info,n:{'1m':(C.data['1m']||[]).length,'5m':(C.data['5m']||[]).length,'15m':(C.data['15m']||[]).length},sigGap:SIG.gap.length,oi:SIG.oi.length,fund:SNAPSTATE.fund&&SNAPSTATE.fund.length,fundErr:SNAPSTATE.fundErr,oiErr:SNAPSTATE.oiErr}},
  _inject:function(tf,arr,src){C.data[tf]=arr;C.info[tf]={src:src||'test data',at:Date.now()+600000,err:''};draw()},_sig:function(){return SIG}};
})();
