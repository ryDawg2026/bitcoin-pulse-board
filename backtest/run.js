// Replays an engine over real historical 15m candles from several public exchanges.
// usage: node backtest/run.js v1|v2 out.jsonl [PULSE_DATA dir]
var fs=require('fs'),path=require('path');
var E=require('../engine.js');
var which=process.argv[2]||'v1',out=process.argv[3]||('/tmp/'+which+'.jsonl'),DATA=process.argv[4]||process.env.PULSE_DATA||'/workspace/pulse-bt-data';
var Q=900,names=['coinbase','binanceus','binancevision','okx','gate'];
var sources=[],S={};
names.forEach(function(n){var f=path.join(DATA,n+'.json');if(!fs.existsSync(f))return;var d=JSON.parse(fs.readFileSync(f));
  var map={};d.candles.forEach(function(r){map[r[0]]={t:r[0],o:r[1],h:r[2],l:r[3],c:r[4],v:r[5]}});
  sources.push({id:n,q:d.q});S[n]={map:map}});
console.error('sources',sources.map(function(s){return s.id+':'+Object.keys(S[s.id].map).length}).join(' '));
var all=Math.max.apply(null,sources.map(function(s){return Math.max.apply(null,Object.keys(S[s.id].map).map(Number))}))+Q;
var C=E.buildConsensus(sources,S,all,3);
console.error('consensus candles',C.ts.length);
var predict=which==='v1'?E.predictV1:E['predict'+which.toUpperCase()];
// precompute index for speed: predictors slice last 300 of ts<W
var ts=C.ts,lines=[],n=0;
// speed: give predictor a view with ts limited to <W (binary search)
function view(W){var lo=0,hi=ts.length;while(lo<hi){var m=(lo+hi)>>1;if(ts[m]<W)lo=m+1;else hi=m}return {cons:C.cons,ts:ts.slice(Math.max(0,lo-400),lo),ok:C.ok}}
for(var i=0;i<ts.length;i++){
  var W=ts[i];var c=C.cons[W];if(!c)continue;
  var V=view(W);
  var p=predict(W,V,sources,S);if(!p)continue;
  var actual=c.c>c.o?'UP':c.c<c.o?'DOWN':'FLAT';
  var rec={W:W,dir:p.dir,conf:p.conf,score:p.score,skip:!!p.skip,strong:!!p.strong,actual:actual,ret:c.c/c.o-1,o:c.o,c:c.c,n:c.n,feat:p.feat,why:p.why,sig:p.signals?p.signals.reduce(function(a,s){a[s.k]=+s.vote.toFixed(4);return a},{}):null};
  lines.push(JSON.stringify(rec));
}
fs.writeFileSync(out,lines.join('\n'));
console.error('wrote',lines.length,out);
