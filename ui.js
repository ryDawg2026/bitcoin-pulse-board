/* Small shared UI helpers: smooth expand/collapse "Why?" sections, count-ups, animated bars, new-item slide-in.
   Everything honours prefers-reduced-motion (values jump straight to their final state, nothing animates). Pure presentation: no data, no network. */
(function(){
'use strict';
var OPEN={},LAST={};
function reduced(){try{return window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches}catch(e){return false}}
/* expander: UI.xp(id,label,innerHtml) -> html. Open state is remembered by id, so re-renders keep it. */
function xp(id,label,body,opts){
  opts=opts||{};
  return '<div class="xpw" data-xp="'+id+'"><button type="button" class="xpb" aria-expanded="false" aria-controls="xp-'+id+'"><span class="chev" aria-hidden="true">▸</span><span>'+label+'</span></button>'
    +'<div class="xp" id="xp-'+id+'"><div class="xpin"><div class="xpbody">'+body+'</div></div></div></div>';
}
function restore(root){ // re-apply remembered open state after innerHTML (no transition on restore)
  [].forEach.call((root||document).querySelectorAll('.xpw'),function(w){
    var id=w.getAttribute('data-xp');if(OPEN[id]){var p=w.querySelector('.xp');p.classList.add('noanim','open');w.querySelector('.xpb').setAttribute('aria-expanded','true');requestAnimationFrame(function(){requestAnimationFrame(function(){p.classList.remove('noanim')})})}
  });
  [].forEach.call((root||document).querySelectorAll('.xp[data-xid]'),function(p){var id=p.getAttribute('data-xid');if(OPEN[id]){p.classList.add('noanim','open');var tr=p.closest('tr'),prev=tr&&tr.previousElementSibling,ch=prev&&prev.querySelector('.chip .chev');if(ch)ch.style.transform='rotate(90deg)';requestAnimationFrame(function(){requestAnimationFrame(function(){p.classList.remove('noanim')})})}});
}
document.addEventListener('click',function(e){
  var b=e.target.closest&&e.target.closest('.xpb');if(!b)return;
  var w=b.closest('.xpw'),id=w.getAttribute('data-xp'),p=w.querySelector('.xp'),open=!p.classList.contains('open');
  p.classList.toggle('open',open);b.setAttribute('aria-expanded',open?'true':'false');OPEN[id]=open;if(!open)delete OPEN[id];
});
/* count-up: <b class="cu" data-k="key" data-v="12" data-d="0" data-pre="$"> — animates from the last shown value for that key */
function fmt(v,d,pre,suf){return (pre||'')+(d?v.toFixed(d):String(Math.round(v)))+(suf||'')}
function countAll(root){
  [].forEach.call((root||document).querySelectorAll('.cu'),function(el){
    var k=el.getAttribute('data-k'),to=parseFloat(el.getAttribute('data-v')),d=+(el.getAttribute('data-d')||0),pre=el.getAttribute('data-pre')||'',suf=el.getAttribute('data-suf')||'';
    if(!isFinite(to)){return}
    var from=(k&&LAST[k]!=null)?LAST[k]:0;if(k)LAST[k]=to;
    if(reduced()||from===to){el.textContent=fmt(to,d,pre,suf);return}
    el.textContent=fmt(from,d,pre,suf);var t0=performance.now(),dur=700;
    (function step(t){var p=Math.min(1,(t-t0)/dur),e=1-Math.pow(1-p,3);el.textContent=fmt(from+(to-from)*e,d,pre,suf);if(p<1&&el.isConnected)requestAnimationFrame(step);else el.textContent=fmt(to,d,pre,suf)})(t0);
  });
}
function cu(key,val,opts){opts=opts||{};return '<b class="cu" data-k="'+key+'" data-v="'+val+'"'+(opts.d?' data-d="'+opts.d+'"':'')+(opts.pre?' data-pre="'+opts.pre+'"':'')+(opts.suf?' data-suf="'+opts.suf+'"':'')+'>'+((opts.pre||'')+(opts.d?(+val).toFixed(opts.d):val)+(opts.suf||''))+'</b>'}
/* bars: <i data-w="63"> — grows from the previously shown width */
function bar(key,pct){var from=LAST['bar:'+key]!=null?LAST['bar:'+key]:0;LAST['bar:'+key]=pct;return '<div class="sbar s'+key.slice(-1)+'"><i data-k="'+key+'" data-w="'+pct+'" style="width:'+(reduced()?pct:from)+'%"></i></div>'}
function barc(key,pct,cls){var from=LAST['bar:'+key]!=null?LAST['bar:'+key]:0;LAST['bar:'+key]=pct;return '<div class="sbar '+cls+'"><i data-k="'+key+'" data-w="'+pct+'" style="width:'+(reduced()?pct:from)+'%"></i></div>'}
function settleBars(root){
  var els=[].slice.call((root||document).querySelectorAll('.sbar i[data-w]'));if(!els.length)return;
  if(reduced()){els.forEach(function(i){i.style.width=i.getAttribute('data-w')+'%'});return}
  requestAnimationFrame(function(){requestAnimationFrame(function(){els.forEach(function(i){i.style.width=i.getAttribute('data-w')+'%'})})});
}
/* staggered rise-in for the page's cards */
function stagger(){[].forEach.call(document.querySelectorAll('.wrap .card'),function(c,i){c.style.setProperty('--i',Math.min(i,8))})}
window.UI={xp:xp,restore:restore,cu:cu,countAll:countAll,bar:bar,barc:barc,settleBars:settleBars,reduced:reduced,stagger:stagger,_open:OPEN};
if(document.readyState!=='loading')stagger();else document.addEventListener('DOMContentLoaded',stagger);
})();
