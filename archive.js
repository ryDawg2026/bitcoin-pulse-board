/* The Grokky Archive — a never-forget BENCHMARK that runs fully isolated, in parallel. PAPER-ONLY.
   What it does: (1) permanently logs every call every caller makes (compact rows) plus both Grokkys' picks and Kalshi's result,
   (2) runs its own fixed benchmark call at minute 4, 8 and 12 with EQUAL weights on every group — no memory, no damping, no phases, no learning — so it is what "never changing, never forgetting" scores.
   Isolation rules (tested): it reads only the shared indicator vector it is handed and its OWN key (pulseboard.archive.v1, loaded once into memory at start-up);
   it writes only its own key; nothing in the callers' or Grokkys' decision code ever reads it or its key, so its output can never feed a live call. It is shown only as a comparison scoreboard.
   Size: bounded. Above MAXB characters the oldest settled rounds are dropped from the ledger; all-time totals are kept and a note says what was pruned. */
(function(){
'use strict';
var KEY='pulseboard.archive.v1',Q=900,MARKS=[240,480,720],GRACE=45,MAXB=900000,S=null,_now=null,lastSave=0,nSave=0;
function nowS(){return _now!=null?_now:Math.floor(Date.now()/1000)}
function fresh(){return {v:1,since:nowS(),agg:{callers:{},bench:{n:0,w:0,m:[{n:0,w:0},{n:0,w:0},{n:0,w:0}]},g1:{n:0,w:0},g2:{n:0,w:0},rounds:0,pruned:0},rounds:{},note:''}}
function load(){if(S)return S;try{var raw=localStorage.getItem(KEY);if(raw){var s=JSON.parse(raw);if(s&&s.v===1&&s.agg&&s.rounds){S=s;return S}}}catch(e){}S=fresh();return S}
function size(){try{return JSON.stringify(S).length}catch(e){return 0}}
function prune(){var n=0;if(size()<=MAXB)return 0;var ks=Object.keys(S.rounds).map(Number).sort(function(a,b){return a-b});
  while(ks.length>20&&size()>MAXB*0.7){var k=ks.shift();delete S.rounds[k];n++}
  if(n){S.agg.pruned+=n;S.note='To stay inside the browser’s storage limit I dropped the '+S.agg.pruned+' oldest round-by-round rows. All-time totals below are untouched and still count every round.'}return n}
function save(force){if(!S)return;var t=Date.now();if(!force&&t-lastSave<8000)return;lastSave=t;nSave++;if(nSave%10===1||force)prune();try{localStorage.setItem(KEY,JSON.stringify(S))}catch(e){prune();try{localStorage.setItem(KEY,JSON.stringify(S))}catch(e2){}}}
function rd(W){var s=load();return s.rounds[W]||(s.rounds[W]={c:{},b:[null,null,null],g:null,r:null,s:0})}
function dcode(d){return d==='UP'?1:d==='DOWN'?0:-1}
/* ---- one-way inputs from the live board ---- */
function logCall(W,id,sec,dir,conf,gate){var r=rd(W),a=r.c[id]||(r.c[id]=[]);if(a.some(function(x){return x[0]===sec}))return;a.push([sec,dcode(dir),conf==null?null:conf,gate==='sit'?3:gate==='skip'?2:gate==='caution'?1:0]);save()}
function observeG(W,g1,g2){var r=rd(W);if(!r.g&&(g1||g2)){r.g=[dcode(g1),dcode(g2)];save()}}
function settle(W,res){var s=load(),r=s.rounds[W];if(!r||r.s)return false;if(res!=='yes'&&res!=='no')return false;var up=res==='yes'?1:0;r.r=up;r.s=1;s.agg.rounds++;
  Object.keys(r.c).forEach(function(id){var t=s.agg.callers[id]||(s.agg.callers[id]={n:0,w:0,sk:0});r.c[id].forEach(function(x){if(x[1]<0){t.sk++;return}t.n++;if(x[1]===up)t.w++})});
  r.b.forEach(function(d,i){if(d==null||d<0)return;s.agg.bench.n++;s.agg.bench.m[i].n++;if(d===up){s.agg.bench.w++;s.agg.bench.m[i].w++}});
  if(r.g){[0,1].forEach(function(i){var t=i?s.agg.g2:s.agg.g1;if(r.g[i]<0)return;t.n++;if(r.g[i]===up)t.w++})}
  save(true);return true}
/* ---- the benchmark's own fixed call: EQUAL weight on every group that can be read. Never adapts. ---- */
function benchDecide(sigs,d0){var L=PulseIndicators.groupLean(sigs),G=PulseIndicators.GROUPS,av=G.filter(function(g){return L[g]&&L[g].n>0});if(!av.length)return null;var sc=0;av.forEach(function(g){sc+=L[g].lean/av.length});return sc>0?1:sc<0?0:(d0>=0?1:0)}
/* tick(now, vecFn): vecFn(W,now) returns the live board's shared read-only indicator vector */
function tick(now,vecFn){var W=Math.floor(now/Q)*Q,r=rd(W),ch=false;
  MARKS.forEach(function(m,i){var due=W+m;if(now<due||r.b[i]!=null)return;if(now>due+GRACE){r.b[i]=-1;ch=true;return}
    var v=null;try{v=vecFn(W,now)}catch(e){}if(!v||!v.ok)return;var d=benchDecide(v.signals,isFinite(v.d)?v.d:0);if(d==null)return;r.b[i]=d;ch=true});
  if(ch)save();return ch}
function summary(){var s=load();return {since:s.since,rounds:s.agg.rounds,bench:s.agg.bench,callers:s.agg.callers,g1:s.agg.g1,g2:s.agg.g2,pruned:s.agg.pruned,note:s.note,bytes:size()}}
window.GrokkyArchive={KEY:KEY,MARKS:MARKS,logCall:logCall,observeG:observeG,settle:settle,tick:tick,summary:summary,
  _reload:function(){S=null;return load()},_state:function(){return load()},_setMax:function(n){MAXB=n},_prune:prune,_save:function(){save(true)},_setNow:function(t){_now=t},_benchDecide:benchDecide};
load();
})();
