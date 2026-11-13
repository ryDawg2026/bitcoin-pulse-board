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

/* ---------- lock ---------- */
function lock(W,call){
  var s=st();if(!s.groks)s.groks={};var G=s.groks;
  if(G[W]||!call||(call.dir!=='UP'&&call.dir!=='DOWN'))return G[W]||null;
  var now=nowS();
  G[W]={W:W,g1:call.dir,g2:opp(call.dir),conf:call.conf,pUp:1/(1+Math.exp(-(call.score||0))),noedge:!!call.noedge,strong:!!call.strong,lockedAt:now,late:now-W>90,why:null,kres:null,winner:null};
  var ks=Object.keys(G).map(Number).sort(function(a,b){return a-b});while(ks.length>CAPN)delete G[ks.shift()];
  H.save();return G[W];
}

/* ---------- evidence (real fields only) ---------- */
function kalshiNow(W){
  var kp=window.KalshiPanel,l=kp&&kp.last&&kp.last(),m=l&&l.current;if(!m)return null;
  var w=Math.round(Date.parse(m.close_time)/1000)-Q;if(w!==W)return null;
  var b=num(m.yes_bid_dollars),a=num(m.yes_ask_dollars),p=num(m.last_price_dollars),mid=(b>0&&a>0&&a<=1)?(b+a)/2:p;
  return {mid:mid,strike:num(m.floor_strike),via:l._via,age:nowS()-(l.fetched_at||nowS())};
}
function items(rec,call,snap,kal){
  var it=[],neutral=[];
  (call&&call.signals||[]).forEach(function(s){var c=s.w*s.vote;if(!isFinite(c)||Math.abs(c)<0.003)return;it.push({src:'engine',pr:0,dir:c>0?'UP':'DOWN',m:Math.abs(c),txt:s.name+' — '+s.desc})});
  if(kal&&isFinite(kal.mid)){var d=kal.mid-.5;
    if(Math.abs(d)>=.02)it.push({src:'kalshi',pr:7,dir:d>0?'UP':'DOWN',m:Math.abs(d),txt:'Kalshi prices UP at '+Math.round(kal.mid*100)+'¢, so the crowd leans '+(d>0?'UP':'DOWN')});
    else neutral.push('Kalshi prices the window at about even ('+Math.round(kal.mid*100)+'¢ UP), as expected near the open, so it does not pick a side.')}
  else neutral.push('Kalshi price not loaded for this window.');
  if(snap){
    var g=snap.gap;if(g&&isFinite(g.gap)&&Math.abs(g.gap)>=1)it.push({src:'ctx',pr:1,dir:g.gap>0?'UP':'DOWN',m:1,txt:'BRTI settlement average is '+usd(Math.abs(g.gap),0)+(g.gap>0?' above':' below')+' the strike with '+mmss(g.tl)+' left ('+(g.gap>0?'UP':'DOWN')+' if it ended now)'});
    var b=snap.book;if(b&&isFinite(b.imb)&&Math.abs(b.imb)>=.15)it.push({src:'ctx',pr:2,dir:b.imb>0?'UP':'DOWN',m:Math.abs(b.imb),txt:'Kalshi order book: '+Math.round(Math.abs(b.imb)*100)+'% more resting size on the '+(b.imb>0?'UP':'DOWN')+' side'});
    var f=snap.flow;if(f&&f.cover>=300&&f.buy+f.sell>=1e6){var r=f.buy/Math.max(f.sell,1);
      if(r>=1.5)it.push({src:'ctx',pr:3,dir:'UP',m:r,txt:'Large exchange trades (≥$25k, Binance+OKX, last 15 min): taker buys '+fu(f.buy)+' vs taker sells '+fu(f.sell)+' (follows the flow)'});
      else if(r<=1/1.5)it.push({src:'ctx',pr:3,dir:'DOWN',m:1/r,txt:'Large exchange trades (≥$25k, Binance+OKX, last 15 min): taker sells '+fu(f.sell)+' vs taker buys '+fu(f.buy)+' (follows the flow)'})}
    var fr=snap.funding;if(fr&&isFinite(fr.rate)){
      if(fr.rate>=0.02)it.push({src:'ctx',pr:4,dir:'DOWN',m:fr.rate,txt:'OKX perp funding '+(fr.rate>=0?'+':'')+fr.rate.toFixed(4)+'% per 8 h: longs are paying, crowded long side (contrarian reading → DOWN)'});
      else if(fr.rate<=-0.005)it.push({src:'ctx',pr:4,dir:'UP',m:Math.abs(fr.rate),txt:'OKX perp funding '+fr.rate.toFixed(4)+'% per 8 h: shorts are paying, crowded short side (contrarian reading → UP)'})}
    var l=snap.liq;if(l&&l.L+l.S>=5e5){
      if(l.L>=3*l.S)it.push({src:'ctx',pr:5,dir:'UP',m:l.L/Math.max(l.S,1),txt:'OKX liquidations last 60 min: longs '+fu(l.L)+' vs shorts '+fu(l.S)+' — forced selling already happened (contrarian reading → bounce UP)'});
      else if(l.S>=3*l.L)it.push({src:'ctx',pr:5,dir:'DOWN',m:l.S/Math.max(l.L,1),txt:'OKX liquidations last 60 min: shorts '+fu(l.S)+' vs longs '+fu(l.L)+' — squeeze already happened (contrarian reading → pullback DOWN)'})}
    var fg=snap.fng;if(fg&&isFinite(fg.v)){
      if(fg.v<=25)it.push({src:'ctx',pr:6,dir:'UP',m:(25-fg.v)/25,txt:'Fear & Greed '+fg.v+' ('+fg.cls+'): extreme fear (contrarian reading → UP; daily index, slow-moving)'});
      else if(fg.v>=75)it.push({src:'ctx',pr:6,dir:'DOWN',m:(fg.v-75)/25,txt:'Fear & Greed '+fg.v+' ('+fg.cls+'): extreme greed (contrarian reading → DOWN; daily index, slow-moving)'})}
    if(snap.sit)neutral.push('High-impact release window ('+snap.sit+'): prices can jump on the print, so this round is closer to a coin flip.');
  }else neutral.push('Market-context feeds were not ready, so only engine signals are cited.');
  if(rec.noedge)neutral.push('The engine reports NO EDGE: its signals nearly cancel (backtest: coin flip). Scored anyway, because one side always wins.');
  return {it:it,neutral:neutral};
}
function pick(it,side,ctxFirst){
  var mine=it.filter(function(x){return x.dir===side}),against=it.length-mine.length;
  mine.sort(function(a,b){var ae=a.src==='engine'?1:0,be=b.src==='engine'?1:0;if(ae!==be)return ctxFirst?ae-be:be-ae;return ae?b.m-a.m:a.pr-b.pr});
  return {lines:mine.slice(0,4).map(function(x){return x.txt}),n:mine.length,against:against};
}
function buildWhy(rec){
  var call=st().calls&&st().calls[rec.W],snap=window.ContextPanel&&ContextPanel.snapshot?ContextPanel.snapshot(rec.W):null,kal=kalshiNow(rec.W);
  var e=items(rec,call,snap,kal),p1=pick(e.it,rec.g1,false),p2=pick(e.it,rec.g2,true);
  return {at:nowS(),g1:p1,g2:p2,neutral:e.neutral,forced2:p2.lines.length===0,haveCtx:!!snap};
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
  if(changed){H.save();update(true)}
  return changed;
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
function cardHtml(n,rec,t){
  var side=rec?(n===1?rec.g1:rec.g2):null,w=n===1?t.w1:t.w2,l=n===1?t.w2:t.w1,tot=t.n,cur=n===1?t.cur1:t.cur2;
  var name='Grokky '+n,role=n===1?'follows the v2 engine':'always the other side';
  if(!rec)return '<div class="gkhead"><b>'+name+'</b><span class="pill">'+role+'</span></div><div class="mut" style="padding:12px 0">Waiting for the engine’s call for this window (needs ≥100 candles from ≥3 sources)…</div>'+foot(w,l,tot,cur);
  var now=nowS(),left=rec.W+Q-now,mv=windowMove(rec),on=mv&&Math.abs(mv.d)>0?((mv.d>0)===(side==='UP')):null;
  var why=rec.why,h='<div class="gkhead"><b>'+name+'</b><span class="pill">'+role+'</span>'+(rec.noedge?' <span class="pill warn" title="the engine’s signals cancel out">no edge round</span>':'')+'</div>';
  h+='<div class="row" style="gap:16px;margin:6px 0"><div class="big '+cls(side)+'">'+arrow(side)+'</div>'
    +'<div class="kv"><b>'+(n===1?rec.conf:100-rec.conf)+'%</b><small>'+(n===1?'engine’s own probability':'engine’s own probability for this (opposite) side')+'</small></div>'
    +'<div class="kv"><b class="gkleft">§</b><small>until the window closes</small></div></div>';
  h+='<div class="mut" style="font-size:12.5px">🔒 locked '+hhmmss(rec.lockedAt)+(rec.late?' <span class="warn">('+mmss(rec.lockedAt-rec.W)+' into the window: page opened mid-window; the engine only uses closed candles, so this is not hindsight)</span>':(rec.lockedAt-rec.W>20?' ('+mmss(rec.lockedAt-rec.W)+' into the window, as soon as the engine had its call)':' at window open'))+' · window '+hhmm(rec.W)+'–'+hhmm(rec.W+Q)+(mv?' · BTC '+(mv.d>=0?'+':'−')+usd(Math.abs(mv.d),2)+' vs '+mv.lab+(on===null?'':on?' <span class="up-t">✓ on track</span>':' <span class="dn-t">✗ off track</span>'):'')+'</div>';
  if(why){var me=n===1?why.g1:why.g2,forced=n===2&&why.forced2;
    h+='<div class="gkwhy"><div class="mut" style="font-size:11.5px;text-transform:uppercase;letter-spacing:.06em">Why '+(n===1?'(engine signals + context)':'(contrarian case from board data)')+' · as of '+hhmmss(why.at)+'</div><ul>'
      +(forced?'<li class="mut">Nothing on the board currently points to '+side+'. This is a forced opposite pick: Grokky 2 always hedges Grokky 1.</li>':(me.lines.length?me.lines.map(function(x){return '<li>'+esc(x)+'</li>'}).join(''):'<li class="mut">No individual signal clears its threshold toward '+side+'.</li>'))
      +'</ul>'+(me.against?'<div class="mut" style="font-size:12px">'+me.against+(me.against>1?' other readings point':' other reading points')+' the other way.</div>':'')+'</div>';
  }else h+='<div class="mut" style="margin:8px 0;font-size:13px">Collecting context (BRTI gap, funding, liquidations…) before writing the rationale…</div>';
  return h+foot(w,l,tot,cur);
}
function foot(w,l,tot,cur){return '<div class="gkfoot"><span>Record <b>'+w+' W / '+l+' L</b></span><span>'+(tot?(w/tot*100).toFixed(1)+'% win rate':'no rounds scored yet')+'</span><span>streak <b class="'+(cur>0?'up-t':cur<0?'dn-t':'')+'">'+streakTxt(cur)+'</b></span></div>'}
function resultCell(r,now){return r.winner?'<span class="'+(r.kres==='yes'?'up-t':'dn-t')+'">'+(r.kres==='yes'?'▲ UP':'▼ DOWN')+'</span>':(r.W+Q>now?'<span class="mut">in progress</span>':'<span class="mut">awaiting Kalshi settlement</span>')}
function renderScore(t,now){
  var el=$('gkScore');if(!el)return;
  var rows=t.rows.slice().reverse().slice(0,40);
  var ne=t.ne.n?('No-edge rounds scored: <b>'+t.ne.n+'</b> (Grokky 1 won '+t.ne.w1+', Grokky 2 won '+t.ne.w2+'). They still count, because one of them always wins.'):'No “no edge” rounds scored yet (they still count when they happen: one side always wins).';
  var h='<div class="row" style="gap:22px;margin-bottom:8px">'
    +[1,2].map(function(n){var w=n===1?t.w1:t.w2,cur=n===1?t.cur1:t.cur2,best=n===1?t.best1:t.best2;return '<div class="kv"><small>Grokky '+n+'</small><b>'+w+' / '+t.n+' correct</b><small>'+(t.n?(w/t.n*100).toFixed(1)+'% · ':'')+'streak '+streakTxt(cur)+' · best run '+best+'</small></div>'}).join('')
    +'<div class="kv"><small>Rounds scored</small><b>'+t.n+'</b><small>'+(t.pend?t.pend+' awaiting Kalshi settlement':'none waiting')+'</small></div></div>'
    +'<div class="mut" style="font-size:12.5px;margin-bottom:8px">'+ne+'</div>'
    +'<div class="gkgrid"><div class="logwrap tw" style="max-height:230px"><table><thead><tr><th class="l">Window</th><th>Grokky 1</th><th>Grokky 2</th><th>Kalshi result</th><th>Winner</th><th class="l">Notes</th></tr></thead><tbody>'
    +(rows.map(function(r){return '<tr><td class="l">'+hhmm(r.W)+'–'+hhmm(r.W+Q)+'</td><td class="'+cls(r.g1)+'">'+r.g1+'</td><td class="'+cls(r.g2)+'">'+r.g2+'</td><td>'+resultCell(r,now)+'</td><td>'+(r.winner?'<b>Grokky '+r.winner+'</b>':'—')+'</td><td class="l mut"'+(r.winner&&isFinite(r.kexp)&&isFinite(r.kstrike)?' title="Kalshi settled at '+usd(r.kexp,2)+' vs strike '+usd(r.kstrike,2)+'"':'')+'>'+[r.noedge?'no edge':'',r.late?'late lock':''].filter(Boolean).join(' · ')+'</td></tr>'}).join('')||'<tr><td class="l mut" colspan="6">No rounds yet — the first pick locks at the next window open and scores once Kalshi settles it.</td></tr>')
    +'</tbody></table></div><div class="chartbox" style="height:190px"><canvas id="gkChart"></canvas></div></div>';
  var sig=t.rows.length+':'+t.n+':'+t.pend+':'+rows.map(function(r){return (r.winner||0)+(r.late?'l':'')}).join('');
  if(sig!==lastSig||!$('gkChart')){lastSig=sig;el.innerHTML=h;chart=null;drawChart(t)}
}
function drawChart(t){
  if(typeof Chart==='undefined'||!$('gkChart'))return;
  var lab=[],a=[],b=[],x=0,y=0;t.scored.forEach(function(r){if(r.winner===1)x++;else y++;lab.push(hhmm(r.W));a.push(x);b.push(y)});
  chart=new Chart($('gkChart'),{type:'line',data:{labels:lab,datasets:[{label:'Grokky 1 correct (cumulative)',data:a,borderColor:'#5aa9ff',pointRadius:0,borderWidth:2,stepped:true},{label:'Grokky 2 correct (cumulative)',data:b,borderColor:'#ffb454',borderDash:[5,3],pointRadius:0,borderWidth:2,stepped:true}]},
    options:{responsive:true,maintainAspectRatio:false,animation:false,plugins:{legend:{labels:{color:'#8b97b3',boxWidth:10,font:{size:11}}}},scales:{x:{ticks:{color:'#8b97b3',maxTicksLimit:6},grid:{color:'#1b2438'}},y:{beginAtZero:true,ticks:{color:'#8b97b3',precision:0},grid:{color:'#1b2438'}}}}});
}
function update(force){
  if(!H)return;var now=nowS(),s=st(),G=s.groks||{},W0=Math.floor(now/Q)*Q,rec=G[W0]||null;
  if(rec)maybeFreeze(rec,now);
  var t=tally(now);
  [1,2].forEach(function(n){var el=$('gk'+n);if(!el)return;var h=cardHtml(n,rec,t);if(el._h!==h){el.innerHTML=h;el._h=h}
    var l=el.querySelector('.gkleft');if(l)l.textContent=mmss(W0+Q-now)});
  renderScore(t,now);
}
function csv(){
  var G=st().groks||{},rows=['window_start_local,window_start_unix,grokky1,grokky2,engine_conf_pct,no_edge,late_lock,kalshi_result,winner,expiration_value,floor_strike,locked_at_unix'];
  Object.keys(G).map(Number).sort(function(a,b){return a-b}).forEach(function(w){var r=G[w];rows.push([new Date(w*1000).toLocaleString(),w,r.g1,r.g2,r.conf,r.noedge?'yes':'no',r.late?'yes':'no',r.kres||'',r.winner?'Grokky '+r.winner:'',isFinite(r.kexp)?r.kexp:'',isFinite(r.kstrike)?r.kstrike:'',r.lockedAt].map(function(x){return '"'+String(x).replace(/"/g,'""')+'"'}).join(','))});
  var a=document.createElement('a');a.href=URL.createObjectURL(new Blob([rows.join('\n')],{type:'text/csv'}));a.download='grokky-rounds.csv';document.body.appendChild(a);a.click();setTimeout(function(){URL.revokeObjectURL(a.href);a.remove()},500);
}
function init(host){H=host;if($('gkCsv'))$('gkCsv').onclick=csv;update()}
window.GrokkyPanel={init:init,lock:lock,update:update,onKalshi:onKalshi,tally:tally,_items:items,_pick:pick,_buildWhy:buildWhy,_csv:csv};
})();
