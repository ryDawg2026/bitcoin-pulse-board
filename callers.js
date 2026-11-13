/* The three callers — Zippy, Mellow and Ripple. PAPER-ONLY: no money, no Kalshi orders, ever.
   Cadence: every 15-minute Kalshi window is cut into 4-minute blocks; at minute 4, 8 and 12 each caller makes a call (UP or DOWN for that window) and "backs" Grokky 1 or Grokky 2.
   All three get EXACTLY the same inputs (one shared reading vector from indicators.js + what Grokky 1 and 2 picked and why) and use the same decision function with the same reasoning depth.
   They differ ONLY in how they weigh five groups of readings (a fixed budget of 1.00 each, strike 0.30 and Grokky-evidence 0.10 identical for all):
     Zippy  (momentum)        trend .38 · bounce-back .08 · order flow .14
     Mellow (mean-reversion)  trend .08 · bounce-back .38 · order flow .14
     Ripple (order flow)      trend .08 · bounce-back .08 · order flow .44
   "Backing" is fully determined by the call: Grokky 2 always takes the opposite side of Grokky 1, so calling Grokky 1's side = backing Grokky 1, otherwise Grokky 2.
   A mark only fires if the page is open within 90 s of it (nothing is back-filled with hindsight); otherwise the mark is recorded as missed.
   Scored on Kalshi's real settlement. Storage: pulseboard.callers.v1 (new, isolated). Never writes pulseboard.v2 / obook / flows / sig / learn. */
(function(){
'use strict';
var KEY='pulseboard.callers.v1',Q=900,MARKS=[4,8,12],GRACE=90,CAPR=90,K_SIG=4;
var GL={trend:'price trend',revert:'bounce-back',flow:'order flow',strike:'distance to strike & crowd',grokky:'the Grokkys’ evidence'};
var GI={trend:'📈',revert:'🔁',flow:'🌊',strike:'🎯',grokky:'🤝'};
var PROFILES={
  zippy:{id:'zippy',name:'Zippy',style:'momentum',tag:'I ride the wave',lens:'trend',blurb:'I love a trend. I give the most weight to which way price has been moving.',col:'#ffb454',w:{trend:.38,revert:.08,flow:.14,strike:.30,grokky:.10}},
  mellow:{id:'mellow',name:'Mellow',style:'mean-reversion',tag:'I bet on the bounce-back',lens:'revert',blurb:'I’m the calm one. I give the most weight to stretched moves snapping back.',col:'#7bd88f',w:{trend:.08,revert:.38,flow:.14,strike:.30,grokky:.10}},
  ripple:{id:'ripple',name:'Ripple',style:'order-flow',tag:'I follow the money',lens:'flow',blurb:'I watch who’s really buying and selling. I give the most weight to order flow.',col:'#6cc3ff',w:{trend:.08,revert:.08,flow:.44,strike:.30,grokky:.10}}};
var IDS=['zippy','mellow','ripple'],H=null,ST=null,LIVE=null,liveAt=0,_now=null,lastSave=0;
function $(i){return document.getElementById(i)}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function num(x){var v=parseFloat(x);return isFinite(v)?v:NaN}
function nowS(){return _now!=null?_now:Math.floor(Date.now()/1000)}
function mmss(s){s=Math.max(0,Math.round(s));return Math.floor(s/60)+':'+('0'+(s%60)).slice(-2)}
function usd(x,d){return isFinite(x)?'$'+Math.abs(x).toLocaleString('en-US',{minimumFractionDigits:d==null?0:d,maximumFractionDigits:d==null?0:d}):'—'}
function arrow(d){return d==='UP'?'▲ UP':'▼ DOWN'}
function cls(d){return d==='UP'?'up-t':'dn-t'}
function opp(d){return d==='UP'?'DOWN':'UP'}
function sigm(x){return 1/(1+Math.exp(-x))}
function liUl(a){return a.length?'<ul>'+a.map(function(x){return '<li>'+esc(x)+'</li>'}).join('')+'</ul>':''}

/* ---------- storage (own key only) ---------- */
function fresh(){var t={};IDS.forEach(function(i){t[i]={a:{n:0,w:0},m4:{n:0,w:0},m8:{n:0,w:0},m12:{n:0,w:0},b1:{n:0,w:0},b2:{n:0,w:0}}});return {v:1,rounds:{},tot:t,sig:{}}}
function load(){if(ST)return ST;try{var s=JSON.parse(localStorage.getItem(KEY)||'null');if(s&&s.v===1&&s.rounds&&s.tot){IDS.forEach(function(i){if(!s.tot[i])s.tot[i]=fresh().tot[i]});if(!s.sig)s.sig={};ST=s;return s}}catch(e){}ST=fresh();return ST}
function save(){try{localStorage.setItem(KEY,JSON.stringify(ST))}catch(e){}}
function round(W,mk){var s=load();if(!s.rounds[W]&&mk){s.rounds[W]={W:W,marks:{},miss:{},res:null,scored:false};var ks=Object.keys(s.rounds).map(Number).sort(function(a,b){return a-b});while(ks.length>CAPR)delete s.rounds[ks.shift()]}return s.rounds[W]||null}

/* ---------- inputs: the same for every caller ---------- */
function gks(){return (H&&H.state&&H.state().groks)||{}}
function kal(W){var kp=window.KalshiPanel,l=kp&&kp.last&&kp.last(),m=l&&l.current;if(!m)return {strike:NaN,mid:NaN};
  var w=Math.round(Date.parse(m.close_time)/1000)-Q;if(w!==W)return {strike:NaN,mid:NaN};
  var b=num(m.yes_bid_dollars),a=num(m.yes_ask_dollars),p=num(m.last_price_dollars),mid=(b>0&&a>0&&a<=1)?(b+a)/2:p;if(!(mid>0))mid=NaN;return {strike:num(m.floor_strike),mid:mid}}
function inputs(W,now){
  var D=window.PulseIndicators?PulseIndicators.feed():{cb:[],bn:[]},rec=gks()[W],g=null,k=kal(W),book=NaN;
  if(rec)g={g1:rec.g1,g2:rec.g2,pUp:rec.pUp,items:(rec.why&&rec.why.items||[]).filter(function(x){return x.src!=='ind'})};
  try{var sn=window.ContextPanel&&ContextPanel.snapshot&&ContextPanel.snapshot(W);if(sn&&sn.book&&isFinite(sn.book.imb))book=sn.book.imb}catch(e){}
  return {now:now,W:W,strike:k.strike,kmid:k.mid,cb:D.cb,bn:D.bn,g:g,ctx:{book:book}};
}
function liveVec(W,now,force){if(!window.PulseIndicators)return null;if(!force&&LIVE&&LIVE.W===W&&now-liveAt<5)return LIVE;LIVE=PulseIndicators.compute(inputs(W,now));LIVE.W=W;liveAt=now;return LIVE}
function latest(W){return LIVE&&LIVE.ok&&LIVE.W===W?LIVE:null}

/* ---------- one shared decision function, three weight profiles ---------- */
function leansOf(sigs){return PulseIndicators.groupLean(sigs)}
function decide(leans,prof,d0){
  var G=PulseIndicators.GROUPS,av=G.filter(function(g){return leans[g]&&leans[g].n>0});if(!av.length)return null;
  var ws=0;av.forEach(function(g){ws+=prof.w[g]});var sc=0,gc={};
  G.forEach(function(g){var c=av.indexOf(g)>=0?prof.w[g]/ws*leans[g].lean:0;gc[g]=+c.toFixed(4);sc+=c});
  var dir=sc>0?'UP':sc<0?'DOWN':(d0>=0?'UP':'DOWN');
  return {dir:dir,sc:+sc.toFixed(4),p:+sigm(K_SIG*sc).toFixed(4),gc:gc};
}
function leansStored(m){var o={};PulseIndicators.GROUPS.forEach(function(g){o[g]=m.leans[g]||{lean:0,n:0}});return o}
function packVec(v){return v.signals.map(function(s){return {k:s.k,n:s.name,g:s.group,v:+s.vote.toFixed(3),d:String(s.desc).slice(0,230),na:s.na?1:0}})}

function fire(W,mk,now,inp){
  var r=round(W,true);if(r.marks[mk]||r.miss[mk])return null;
  var v=inp?PulseIndicators.compute(inp):liveVec(W,now,true);if(!v||!v.ok)return null;
  var avail=v.signals.filter(function(s){return !s.na&&s.group!=='info'}).length;if(!avail)return null;
  var leans=leansOf(v.signals),rec=gks()[W],g=inp?inp.g:(rec?{g1:rec.g1,g2:rec.g2}:null),calls={},d0=isFinite(v.d)?v.d:0;
  IDS.forEach(function(id){var c=decide(leans,PROFILES[id],d0);if(!c)return;c.backs=g?(c.dir===g.g1?1:2):0;calls[id]=c});
  if(!Object.keys(calls).length)return null;
  r.marks[mk]={at:now,px:+v.px.toFixed(2),strike:isFinite(v.strike)?v.strike:null,kmid:isFinite(v.kmid)?+v.kmid.toFixed(3):null,secs:W+Q-now,d:isFinite(v.d)?+v.d.toFixed(2):null,
    src:v.pxSrc,leans:leans,vec:packVec(v),gk:g?{g1:g.g1,g2:g.g2}:null,calls:calls};
  save();return r.marks[mk];
}
function tickMarks(now){
  var W=Math.floor(now/Q)*Q,r=round(W,false),changed=false;
  MARKS.forEach(function(m){var due=W+m*60;if(now<due)return;var rr=round(W,true);if(rr.marks[m]||rr.miss[m])return;
    if(now<=due+GRACE){if(fire(W,m,now))changed=true}
    else{rr.miss[m]='the page wasn’t open (or the feeds weren’t ready) in time';changed=true}});
  if(changed)save();return changed;
}

/* ---------- scoring on Kalshi's real settlement ---------- */
function scoreRound(r){
  if(!r||r.scored||(r.res!=='yes'&&r.res!=='no'))return false;var s=load(),up=r.res==='yes';
  MARKS.forEach(function(m){var mk=r.marks[m];if(!mk)return;
    IDS.forEach(function(id){var c=mk.calls[id];if(!c)return;var ok=(c.dir==='UP')===up,t=s.tot[id];
      t.a.n++;t['m'+m].n++;if(ok){t.a.w++;t['m'+m].w++}
      if(c.backs){var b=t['b'+c.backs];b.n++;if(ok)b.w++}});
    mk.vec.forEach(function(x){if(x.na||x.g==='info'||!x.v||Math.abs(x.v)<0.1)return;var e=s.sig[x.k]||(s.sig[x.k]={});var o=e[m]||(e[m]={n:0,h:0});o.n++;if((x.v>0)===up)o.h++});
  });
  r.scored=true;return true;
}
function onKalshi(d){var s=load(),ch=0;((d&&d.settled)||[]).forEach(function(m){var res=m.result;if(res!=='yes'&&res!=='no')return;var W=Math.round(Date.parse(m.close_time)/1000)-Q,r=s.rounds[W];if(!r||r.scored)return;r.res=res;if(scoreRound(r))ch++});
  if(ch){save();update(true)}return ch}
function scoreFromGrokky(){var G=gks(),s=load(),ch=0;Object.keys(s.rounds).forEach(function(w){var r=s.rounds[w];if(r.scored)return;var g=G[w];if(g&&(g.kres==='yes'||g.kres==='no')){r.res=g.kres;if(scoreRound(r))ch++}});if(ch)save();return ch}

/* ---------- plain-language explanation, grounded in the stored numbers ---------- */
function leanWord(l){return l>=.5?'strongly UP':l>=.15?'leans UP':l<=-.5?'strongly DOWN':l<=-.15?'leans DOWN':'is quiet'}
function sgnl(x){return (x>=0?'+':'−')+Math.abs(x).toFixed(2)}
function pcs(dir,p){return Math.round((dir==='UP'?p:1-p)*100)}
function memberContrib(mk,prof){ // each reading's share of the final score: group weight / readings in group × vote
  var G=mk.leans,ws=0;PulseIndicators.GROUPS.forEach(function(g){if(G[g]&&G[g].n>0)ws+=prof.w[g]});
  return mk.vec.filter(function(x){return !x.na&&x.g!=='info'&&G[x.g]&&G[x.g].n}).map(function(x){return {x:x,c:prof.w[x.g]/ws*x.v/G[x.g].n}});
}
function bubble(id,m,mk,c){
  var P=PROFILES[id],h='I’m calling <b class="'+cls(c.dir)+'">'+arrow(c.dir)+'</b> at the '+m+'-minute mark';
  h+=c.backs?' and backing <b>Grokky '+c.backs+'</b>.':'. There’s no Grokky pick for this window, so I’m not backing anyone.';
  if(isFinite(mk.d)&&mk.strike!=null)h+=' Price is '+usd(Math.abs(mk.d),0)+' '+(mk.d>=0?'above':'below')+' the strike with '+mmss(mk.secs)+' left.';
  var l=mk.leans[P.lens];if(l&&l.n){h+=' My '+P.style+' lens '+leanWord(l.lean);if(Math.abs(l.lean)>=.15&&(l.lean>0)!==(c.dir==='UP'))h+=', but the rest of the evidence outweighed it';h+='.'}
  if(c.backs&&mk.gk&&isFinite(mk.d)&&mk.strike!=null){var side=c.backs===1?mk.gk.g1:mk.gk.g2,on=(mk.d>=0)===(side==='UP');h+=' Grokky '+c.backs+' is '+(on?'on':'off')+' track so far.'}
  return h;
}
function whyHtml(id,m,mk,c){
  var P=PROFILES[id],h='<h4>Why I called '+arrow(c.dir)+'</h4>',mc=memberContrib(mk,P).filter(function(o){return (o.c>0)===(c.dir==='UP')&&Math.abs(o.c)>0.002}).sort(function(a,b){return Math.abs(b.c)-Math.abs(a.c)}).slice(0,4);
  h+='<p>I’m '+P.style+'-minded, so I give '+Math.round(P.w[P.lens]*100)+'% of my say to '+GL[P.lens]+'. Here’s how all five kinds of evidence added up for me:</p><ul>';
  PulseIndicators.GROUPS.forEach(function(g){var l=mk.leans[g];if(!l||!l.n)h+='<li>'+GI[g]+' '+esc(GL[g])+': couldn’t be read right now, so I ignored it.</li>';
    else h+='<li>'+GI[g]+' '+esc(GL[g])+' '+leanWord(l.lean)+' ('+sgnl(l.lean)+') × my '+Math.round(P.w[g]*100)+'% weight = '+sgnl(c.gc[g])+'</li>'});
  h+='</ul><p>Total <b>'+sgnl(c.sc)+'</b> (below 0 is DOWN, above 0 is UP), which I turn into a rough <b>'+pcs(c.dir,c.p)+'%</b> chance for '+arrow(c.dir)+'. It’s a rough estimate, not a tested probability.</p>';
  if(mc.length)h+='<p>The readings that mattered most:</p>'+liUl(mc.map(function(o){return o.x.d}));
  if(c.backs&&mk.gk)h+='<h4>Who I back</h4><p>Grokky 1 is on '+arrow(mk.gk.g1)+' and Grokky 2 on '+arrow(mk.gk.g2)+'. They’re always opposite, so backing just follows my call: my side matches Grokky '+c.backs+'.</p>';
  return h;
}
function altHtml(id,m,mk,c,others){
  var P=PROFILES[id],all=mk.vec,cnt=all.filter(function(x){return !x.na&&x.g!=='info'}),nas=all.filter(function(x){return x.na}),inf=all.filter(function(x){return !x.na&&x.g==='info'});
  var h='<h4>What else I considered</h4><p>I looked at <b>'+all.length+'</b> readings: <b>'+cnt.length+'</b> voted, <b>'+inf.length+'</b> are background context, and <b>'+nas.length+'</b> couldn’t be read.</p>';
  var opp1=memberContrib(mk,P).filter(function(o){return (o.c>0)!==(c.dir==='UP')&&Math.abs(o.c)>0.002}).sort(function(a,b){return Math.abs(b.c)-Math.abs(a.c)}).slice(0,3);
  h+='<h4>Pointing the other way ('+arrow(opp(c.dir))+')</h4>'+(opp1.length?liUl(opp1.map(function(o){return o.x.d})):'<p>Nothing notable: every reading that voted agreed with me or was neutral.</p>');
  var lens=mk.leans[P.lens],fav=lens&&lens.n&&Math.abs(lens.lean)>=0.02?(lens.lean>0?'UP':'DOWN'):null,ws=0,sc=0;
  PulseIndicators.GROUPS.forEach(function(g){if(g!=='grokky'&&mk.leans[g]&&mk.leans[g].n)ws+=P.w[g]});PulseIndicators.GROUPS.forEach(function(g){if(g!=='grokky'&&mk.leans[g]&&mk.leans[g].n&&ws)sc+=P.w[g]/ws*mk.leans[g].lean});
  var st=mk.leans.strike&&mk.leans.strike.n?(mk.leans.strike.lean>=0?'UP':'DOWN'):null;
  h+='<h4>If I’d done it differently</h4><ul>'+(fav?'<li>Using only my '+P.style+' lens I’d have said '+arrow(fav)+'.</li>':'')+(ws?'<li>Ignoring what the Grokkys think, I’d have said '+arrow(sc>=0?'UP':'DOWN')+'.</li>':'')+(st?'<li>Following only the distance to the strike (and Kalshi’s crowd), I’d have said '+arrow(st)+'.</li>':'')+'</ul>';
  if(others&&others.length)h+='<h4>What the others called at this mark</h4>'+liUl(others);
  if(nas.length)h+='<h4>Couldn’t read right now</h4>'+liUl(nas.slice(0,6).map(function(x){return x.n+': '+x.d}));
  return h;
}
function othersAt(id,mk){var o=[];if(mk.gk)o.push('Grokky 1: '+arrow(mk.gk.g1)+' · Grokky 2: '+arrow(mk.gk.g2)+' (locked at the window start)');IDS.forEach(function(j){if(j!==id&&mk.calls[j])o.push(PROFILES[j].name+': '+arrow(mk.calls[j].dir)+' ('+PROFILES[j].style+', backing '+(mk.calls[j].backs?'Grokky '+mk.calls[j].backs:'nobody')+')')});return o}

/* ---------- avatars (same family as the Grokkys) ---------- */
function avatar(id,k){
  var c={zippy:['#ffd36b','#ff9a3d'],mellow:['#b9f0a8','#4fbf8f'],ripple:['#a9e4ff','#4a9be8']}[id],gid='cg'+id+(k||'');
  var top=id==='zippy'?'<path d="M34 2 L26 15 L32 15 L28 26 L40 11 L33 11 Z" fill="#ffe27a" stroke="#d9822b" stroke-width="1.4" stroke-linejoin="round"/>'
        :id==='mellow'?'<path d="M32 15 Q32 7 32 4" stroke="#3f9a6d" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M32 8 Q43 1 46 9 Q38 13 32 8Z" fill="#6fd49a"/><path d="M32 9 Q22 3 19 10 Q26 14 32 9Z" fill="#8fe3b2"/>'
        :'<path d="M16 14 Q24 4 32 12 Q40 4 48 14" stroke="#e6f6ff" stroke-width="3.2" fill="none" stroke-linecap="round"/><circle cx="32" cy="5" r="3" fill="#e6f6ff"/>';
  var mouth=id==='zippy'?'<path d="M22 44 Q32 53 42 44" stroke="#2a1d16" stroke-width="3" fill="none" stroke-linecap="round"/>':id==='mellow'?'<path d="M24 46 Q32 50 40 46" stroke="#2a1d16" stroke-width="3" fill="none" stroke-linecap="round"/>':'<path d="M24 45 Q32 51 40 45" stroke="#2a1d16" stroke-width="3" fill="none" stroke-linecap="round"/><circle cx="32" cy="49" r="0.01"/>';
  var brow=id==='zippy'?'<path d="M15 21 L27 24 M49 21 L37 24" stroke="#2a1d16" stroke-width="2.6" stroke-linecap="round"/>':id==='mellow'?'<path d="M16 25 Q22 22 28 25 M36 25 Q42 22 48 25" stroke="#2a1d16" stroke-width="2.4" fill="none" stroke-linecap="round"/>':'';
  var eyes=id==='mellow'?'<g class="eyes"><path d="M17 33 Q23 28 29 33" stroke="#2a1d16" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M35 33 Q41 28 47 33" stroke="#2a1d16" stroke-width="3" fill="none" stroke-linecap="round"/></g>'
    :'<g class="eyes"><ellipse cx="23" cy="31" rx="6.2" ry="7" fill="#fff"/><ellipse cx="41" cy="31" rx="6.2" ry="7" fill="#fff"/><circle cx="'+(id==='zippy'?'25':'23')+'" cy="32" r="3.1" fill="#2a1d16"/><circle cx="'+(id==='zippy'?'43':'41')+'" cy="32" r="3.1" fill="#2a1d16"/></g>';
  return '<svg class="av avc av-'+id+'" viewBox="0 0 64 64" role="img" aria-label="'+PROFILES[id].name+' avatar"><defs><linearGradient id="'+gid+'" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="'+c[0]+'"/><stop offset="1" stop-color="'+c[1]+'"/></linearGradient></defs>'+top+'<rect x="7" y="12" width="50" height="47" rx="23" fill="url(#'+gid+')"/>'+brow+eyes+mouth+'<circle cx="14" cy="43" r="4" fill="#ff9aa2" opacity=".5"/><circle cx="50" cy="43" r="4" fill="#ff9aa2" opacity=".5"/></svg>';
}
window.__callersAvatar=avatar;

/* ---------- views ---------- */
function acc(t){return t.n?t.w/t.n*100:0}
function pctTxt(t){return t.n?Math.round(t.w/t.n*100)+'%':'—'}
function curRound(now){var W=Math.floor(now/Q)*Q;return {W:W,r:load().rounds[W]||null}}
function lastMark(r){if(!r)return null;var m=null;MARKS.forEach(function(k){if(r.marks[k])m=k});return m}
function markChips(id,r,now,W){
  return '<div class="mchips">'+MARKS.map(function(m){var mk=r&&r.marks[m],c=mk&&mk.calls[id],due=W+m*60,st;
    if(c){var res=r.res,ok=(res==='yes'||res==='no')?((c.dir==='UP')===(res==='yes')):null;
      return '<span class="mchip '+(c.dir==='UP'?'up':'dn')+(ok===true?' win':ok===false?' loss':'')+'" title="Minute '+m+': '+arrow(c.dir)+', backing Grokky '+c.backs+(ok===null?' (waiting for Kalshi to settle)':ok?' — right ✓':' — wrong ✗')+'"><small>'+m+' min</small><b>'+(c.dir==='UP'?'▲':'▼')+'</b>'+(ok===true?'<i>✓</i>':ok===false?'<i>✗</i>':'')+'</span>'}
    if(r&&r.miss[m])return '<span class="mchip miss" title="Missed: '+esc(r.miss[m])+'"><small>'+m+' min</small><b>–</b></span>';
    return '<span class="mchip wait" title="Next call at minute '+m+'"><small>'+m+' min</small><b>'+(now<due?'⏳':'…')+'</b></span>'}).join('')+'</div>';
}
function callerCard(id,now){
  var P=PROFILES[id],cr=curRound(now),r=cr.r,m=lastMark(r),T=load().tot[id],mk=m&&r.marks[m],c=mk&&mk.calls[id];
  var h='<div class="gkhead">'+avatar(id,'c')+'<div class="gkname"><b>'+P.name+'</b><small>'+esc(P.tag)+'</small><span class="pill sty" style="border-color:'+P.col+'66;color:'+P.col+'">'+P.style+' lens</span></div></div>';
  h+=markChips(id,r,now,cr.W);
  if(c){h+='<div class="bubble cb-'+id+'">'+bubble(id,m,mk,c)+'</div>'
      +'<div class="cmeter" title="My rough estimate for this window"><span class="mlab">UP '+Math.round(c.p*100)+'%</span>'+UI.barc('cm'+id,Math.round(c.p*100),'upbar')+'<span class="mlab">DOWN '+Math.round((1-c.p)*100)+'%</span></div>'
      +'<div class="gkmeta">Called at '+new Date(mk.at*1000).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'})+' · '+mmss(mk.secs)+' left · BTC '+usd(mk.px,0)+' ('+esc(mk.src)+')</div>'
      +UI.xp('cw'+id,'Why? How I called '+arrow(c.dir),whyHtml(id,m,mk,c))+UI.xp('ca'+id,'What else I considered',altHtml(id,m,mk,c,othersAt(id,mk)));
  }else{var nx=MARKS.filter(function(k){return cr.W+k*60>now&&!(r&&(r.marks[k]||r.miss[k]))})[0];
    h+='<div class="bubble cb-'+id+'">Hi, I’m '+P.name+'! '+esc(P.blurb)+' '+(nx?'I make my first call for this window at minute '+nx+' (in <b class="cnext" data-t="'+(cr.W+nx*60)+'">'+mmss(cr.W+nx*60-now)+'</b>).':'I missed this window’s marks, so I’ll be back with the next one.')+'</div>'}
  h+='<div class="gkfoot cfoot"><span>My record <b>'+UI.cu('cw-'+id,T.a.w)+' W</b> / <b>'+UI.cu('cl-'+id,T.a.n-T.a.w)+' L</b></span><span>'+(T.a.n?'<b>'+UI.cu('cr-'+id,acc(T.a),{d:1,suf:'%'})+'</b> right':'no calls scored yet')+'</span></div>';
  h+='<div class="mbars">'+MARKS.map(function(k){var t=T['m'+k];return '<div class="mb"><small>'+k+' min</small>'+UI.barc('mb'+k+id,Math.round(acc(t)),'mbar')+'<small>'+(t.n?pctTxt(t)+' ('+t.w+'/'+t.n+')':'—')+'</small></div>'}).join('')+'</div>';
  return h+'<div class="tiny mut" style="font-size:12px;margin-top:6px">Paper calls only: no money, and I never place anything on Kalshi.</div>';
}
function stanceMap(now){ // each of the five entities' current stance in this window
  var cr=curRound(now),g=gks()[cr.W],o=[{id:'g1',name:'Grokky 1',dir:g?g.g1:null,ic:'g1'},{id:'g2',name:'Grokky 2',dir:g?g.g2:null,ic:'g2'}],r=cr.r,m=lastMark(r);
  IDS.forEach(function(id){var c=m&&r.marks[m].calls[id];o.push({id:id,name:PROFILES[id].name,dir:c?c.dir:null,ic:id})});return o;
}
function timeline(now){
  var cr=curRound(now),el=Math.max(0,Math.min(Q,now-cr.W)),r=cr.r;
  return '<div class="mtl" aria-label="Window timeline"><div class="mtl-bar"><i style="width:'+(el/Q*100).toFixed(1)+'%"></i>'+MARKS.map(function(m){var done=r&&r.marks[m],miss=r&&r.miss[m];return '<span class="mtl-dot '+(done?'done':miss?'miss':cr.W+m*60<=now?'due':'')+'" style="left:'+(m*60/Q*100).toFixed(2)+'%"><em>'+m+'</em></span>'}).join('')+'</div>'
   +'<div class="mtl-txt tiny mut">Window '+new Date(cr.W*1000).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})+' · '+Math.floor(el/60)+' of 15 min gone · calls at minute 4, 8 and 12</div></div>';
}
function scoreTable(){
  var s=load(),G=(H&&H.state&&H.state().groks)||{},gw={w1:0,w2:0,n:0};Object.keys(G).forEach(function(w){var r=G[w];if(r.winner){gw.n++;if(r.winner===1)gw.w1++;else gw.w2++}});
  function cell(t,key){return '<td><b>'+(t.n?Math.round(t.w/t.n*100)+'%':'—')+'</b><small>'+(t.n?t.w+'/'+t.n:'')+'</small>'+(t.n?UI.barc(key,Math.round(acc(t)),'mbar'):'')+'</td>'}
  var rows=IDS.map(function(id){var T=s.tot[id];return '<tr><td class="l"><span class="cn">'+avatar(id,'t')+'<b>'+PROFILES[id].name+'</b></span></td>'+cell(T.a,'sa'+id)+cell(T.m4,'s4'+id)+cell(T.m8,'s8'+id)+cell(T.m12,'s12'+id)+'<td class="l mut">'+(T.b1.n?'G1 '+T.b1.w+'/'+T.b1.n:'')+(T.b1.n&&T.b2.n?' · ':'')+(T.b2.n?'G2 '+T.b2.w+'/'+T.b2.n:'')+(T.b1.n+T.b2.n?'':'—')+'</td></tr>'}).join('');
  var gr=[1,2].map(function(n){var w=n===1?gw.w1:gw.w2;return '<tr class="ref"><td class="l"><span class="cn">'+window.GrokkyPanel.avatar(n,'t')+'<b>Grokky '+n+'</b></span></td>'+cell({n:gw.n,w:w},'sg'+n)+'<td class="mut" colspan="3"><small>one call per window, at the start</small></td><td class="l mut">for comparison</td></tr>'}).join('');
  return '<div class="logwrap tw"><table class="ctab"><thead><tr><th class="l">Who</th><th>Overall</th><th>Minute 4</th><th>Minute 8</th><th>Minute 12</th><th class="l">When they backed…</th></tr></thead><tbody>'+rows+gr+'</tbody></table></div>';
}
function fmtSig(x){return x}
function checkBalance(now){
  var v=liveVec(Math.floor(now/Q)*Q,now),ents=stanceMap(now),vis=v&&v.ok?v.signals.filter(function(s){return s.group!=='info'&&!s.na}):[],nas=v&&v.signals?v.signals.filter(function(s){return s.na&&s.group!=='info'}):[],inf=v&&v.signals?v.signals.filter(function(s){return s.group==='info'&&!s.na}):[];
  if(!v||!v.ok||!vis.length)return '<div class="mut">I’m still gathering price candles for the readings ('+esc(v&&v.why||'loading')+'). They appear here as soon as there are about 25 closed minutes.</div>';
  var upN=vis.filter(function(s){return s.vote>=.15}).length,dnN=vis.filter(function(s){return s.vote<=-.15}).length,neu=vis.length-upN-dnN;
  var called=ents.filter(function(e){return e.dir}),eu=called.filter(function(e){return e.dir==='UP'}),ed=called.filter(function(e){return e.dir==='DOWN'});
  var agree={};vis.forEach(function(s){if(Math.abs(s.vote)<.15){agree[s.k]={a:0,d:0};return}var a=0,d=0;called.forEach(function(e){if((s.vote>0)===(e.dir==='UP'))a++;else d++});agree[s.k]={a:a,d:d}});
  var split=vis.filter(function(s){var x=agree[s.k];return x&&x.a&&x.d}).sort(function(a,b){return Math.min(agree[b.k].a,agree[b.k].d)-Math.min(agree[a.k].a,agree[a.k].d)}).slice(0,2);
  var agreed=vis.filter(function(s){var x=agree[s.k];return x&&called.length>1&&(x.a===called.length)}).slice(0,2);
  var h='<div class="cbsum"><div class="cbline"><b>'+(called.length?eu.length+' of '+called.length+' of us say <span class="up-t">▲ UP</span>':'Nobody has called yet')+'</b>'+(ed.length?' · '+ed.length+' say <span class="dn-t">▼ DOWN</span> ('+ed.map(function(e){return e.name}).join(', ')+')':'')+'</div>'
   +(called.length?'<div class="cmeter"><span class="mlab">UP</span>'+UI.barc('cbent',Math.round(eu.length/called.length*100),'upbar')+'<span class="mlab">DOWN</span></div>':'')
   +'<div class="cbline">Of <b>'+vis.length+'</b> price-action readings, <b class="up-t">'+upN+'</b> lean UP, <b class="dn-t">'+dnN+'</b> lean DOWN and '+neu+' are quiet.</div>'
   +'<div class="cmeter"><span class="mlab">UP</span>'+UI.barc('cbrd',Math.round(upN/Math.max(1,upN+dnN)*100),'upbar')+'<span class="mlab">DOWN</span></div>'
   +(agreed.length?'<div class="cbnote">✅ <b>We all agree on:</b> '+esc(agreed.map(function(s){return s.name}).join(' · '))+'</div>':'')
   +(split.length?'<div class="cbnote">⚖️ <b>Where we split:</b> '+esc(split.map(function(s){return s.name+' ('+agree[s.k].a+' with it, '+agree[s.k].d+' against)'}).join(' · '))+'</div>':'')+'</div>';
  var sg=load().sig;
  function rec(k){var e=sg[k];if(!e)return '<span class="mut">—</span>';var n=0,hh=0;MARKS.forEach(function(m){if(e[m]){n+=e[m].n;hh+=e[m].h}});return n?'<span title="across '+n+' scored mark'+(n===1?'':'s')+'">'+Math.round(hh/n*100)+'%</span>':'<span class="mut">—</span>'}
  var grid='<div class="logwrap tw"><table class="ctab cbtab"><thead><tr><th class="l">Reading</th><th>Lean</th>'+ents.map(function(e){return '<th title="'+e.name+'">'+(e.ic==='g1'?window.GrokkyPanel.avatar(1,'h'):e.ic==='g2'?window.GrokkyPanel.avatar(2,'h'):avatar(e.id,'h'))+'<small>'+e.name+'</small></th>'}).join('')+'<th>Right so far</th></tr></thead><tbody>'
   +vis.map(function(s){var lean=Math.abs(s.vote)<.15?'quiet':s.vote>0?'UP':'DOWN';return '<tr><td class="l" title="'+esc(s.desc)+'">'+GI[s.group]+' '+esc(s.name)+'</td><td><span class="lean '+(lean==='UP'?'up':lean==='DOWN'?'dn':'q')+'">'+(lean==='UP'?'▲':lean==='DOWN'?'▼':'·')+' <i style="width:'+Math.round(Math.abs(s.vote)*100)+'%"></i></span></td>'
     +ents.map(function(e){if(!e.dir)return '<td class="mut">…</td>';if(lean==='quiet')return '<td class="mut">·</td>';var ok=(s.vote>0)===(e.dir==='UP');return '<td class="'+(ok?'ag':'dis')+'" title="'+e.name+' is on '+e.dir+(ok?' — agrees':' — disagrees')+'">'+(ok?'✓':'✗')+'</td>'}).join('')+'<td>'+rec(s.k)+'</td></tr>'}).join('')
   +'<tr class="tot"><td class="l"><b>Agrees with…</b></td><td></td>'+ents.map(function(e){if(!e.dir)return '<td class="mut">…</td>';var a=0,n=0;vis.forEach(function(s){if(Math.abs(s.vote)<.15)return;n++;if((s.vote>0)===(e.dir==='UP'))a++});return '<td><b>'+a+'/'+n+'</b></td>'}).join('')+'<td></td></tr></tbody></table></div>'
   +'<div class="tiny mut" style="margin-top:6px">✓ means that entity’s call matches the reading’s lean, ✗ means it goes against it, · means the reading is quiet. “Right so far” is how often a reading’s lean matched Kalshi’s result at the callers’ marks (it fills in as rounds settle).</div>';
  var info=inf.length?'<h4>Background readings</h4>'+liUl(inf.map(function(s){return s.name+': '+s.desc})):'';
  var narr=nas.length?'<h4>Couldn’t read right now</h4>'+liUl(nas.map(function(s){return s.name+': '+s.desc})):'';
  var srcs='<p class="tiny mut">Computed from Coinbase BTC-USD 1-minute candles and Binance BTCUSDT 1-minute klines (free public data, no keys) plus Kalshi’s strike and price. Only the board’s own picks and these readings are used; nothing is invented.</p>';
  return h+UI.xp('cbgrid','Show me the reading-by-reading view',grid+info+narr+srcs);
}
function summary(){var s=load(),now=nowS(),cr=curRound(now),r=cr.r,m=lastMark(r),o={marks_called_this_window:m||null,callers:[]};
  IDS.forEach(function(id){var T=s.tot[id],c=m&&r.marks[m].calls[id];o.callers.push({name:PROFILES[id].name,style:PROFILES[id].style,latest:c?{minute:m,call:c.dir,backs:c.backs?'Grokky '+c.backs:'nobody'}:null,right:T.a.n?T.a.w+'/'+T.a.n:'none scored',by_minute:{m4:T['m4'].n?T['m4'].w+'/'+T['m4'].n:'-',m8:T['m8'].n?T['m8'].w+'/'+T['m8'].n:'-',m12:T['m12'].n?T['m12'].w+'/'+T['m12'].n:'-'}})});return o}

var sigAll='';
function update(force){
  if(!H||!window.PulseIndicators)return;var now=nowS(),W=Math.floor(now/Q)*Q;
  try{tickMarks(now);scoreFromGrokky();liveVec(W,now)}catch(e){}
  var body=$('callersBody');if(!body)return;
  var nowEls=document.querySelectorAll('#callersCard .cnext');[].forEach.call(nowEls,function(e){e.textContent=mmss(+e.getAttribute('data-t')-now)});
  var tl=$('callersTl');if(tl){var h=timeline(now);if(tl._h!==h){tl.innerHTML=h;tl._h=h}}
  IDS.forEach(function(id){var el=$('caller-'+id);if(!el)return;var h=callerCard(id,now);if(el._h!==h){el.innerHTML=h;el._h=h;UI.restore(el);UI.countAll(el);UI.settleBars(el)}
    var cr=curRound(now),r=cr.r,m=lastMark(r),key=r&&m?cr.W+':'+m:'';if(key&&el._k!==key){var first=el._k===undefined;el._k=key;if(!first){el.classList.add('reveal');setTimeout(function(){el.classList.remove('reveal')},1700)}}});
  var sc=$('callersScore');if(sc){var h2=scoreTable();if(sc._h!==h2){sc.innerHTML=h2;sc._h=h2;UI.restore(sc);UI.countAll(sc);UI.settleBars(sc)}}
  var cb=$('cbBody');if(cb){var h3=checkBalance(now);if(cb._h!==h3){cb.innerHTML=h3;cb._h=h3;UI.restore(cb);UI.settleBars(cb)}}
}
function init(host){H=host;load();try{scoreFromGrokky()}catch(e){}update(true)}
window.CallersPanel={init:init,update:update,onKalshi:onKalshi,latest:latest,summary:summary,fire:fire,decide:decide,tickMarks:tickMarks,scoreRound:scoreRound,PROFILES:PROFILES,IDS:IDS,MARKS:MARKS,avatar:avatar,
  _setNow:function(t){_now=t},_store:function(){return load()},_inputs:inputs,_leans:leansOf,_resetCache:function(){ST=null;LIVE=null},_bubble:bubble};
})();
