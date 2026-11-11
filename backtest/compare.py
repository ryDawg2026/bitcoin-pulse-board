import sys,json,pandas as pd,numpy as np
sys.path.insert(0,'backtest')
from analyze import *
CUT=1790294400
v1=load('/workspace/pulse-bt-data/v1.jsonl');v2=load('/workspace/pulse-bt-data/v2.jsonl')
k=kal()
for d in (v1,v2): d['kal']=d.W.map(lambda w:('UP' if k.result.get(w)=='yes' else 'DOWN' if k.result.get(w)=='no' else None))
common=set(v1.W)&set(v2.W);v1=v1[v1.W.isin(common)];v2=v2[v2.W.isin(common)]
def block(nm,a,b,label='actual'):
    print(f'{nm:34} v1 {fmt(rate(a,label))}\n{"":34} v2 {fmt(rate(b,label))}')
print('same windows only; common windows =',len(common),pd.to_datetime(min(common),unit='s'),'->',pd.to_datetime(max(common),unit='s'))
block('ALL 150d (v2 TRAIN part in-sample!)',v1,v2)
block('TRAIN (before 2026-09-25) in-sample',v1[v1.W<CUT],v2[v2.W<CUT])
block('TEST (2026-09-25+) OUT-OF-SAMPLE',v1[v1.W>=CUT],v2[v2.W>=CUT])
t1,t2=v1[v1.W>=CUT],v2[v2.W>=CUT]
print('--- TEST, Kalshi KXBTC15M settlement as the label')
block('TEST vs Kalshi result',t1[t1.kal.notna()],t2[t2.kal.notna()],'kal')
print('--- TEST, v2 conviction calls only (|p-.5|>=train median)')
s=t2[t2.strong];print('v2 strong, candle label',fmt(rate(s)));print('v2 strong, Kalshi label ',fmt(rate(s[s.kal.notna()],'kal')))
print('v2 weak calls            ',fmt(rate(t2[~t2.strong])))
print('v1 same windows as strong',fmt(rate(t1[t1.W.isin(s.W)])))
print('--- TEST v2 by confidence bucket (calibration)')
t2=t2.copy();t2['cb']=pd.cut(t2.conf,[0,50.5,51.5,52.5,60])
for b,g in t2.groupby('cb',observed=True):print(b,fmt(rate(g)))
print('--- v2 monthly hit rate (all windows)')
v2['m']=v2.t.dt.strftime('%Y-%m');v1['m']=v1.t.dt.strftime('%Y-%m')
for m,g in v2.groupby('m'):print(m,'v1',f'{rate(v1[v1.m==m])[2]*100:.1f}%','v2',f'{rate(g)[2]*100:.1f}%',' n=',len(g),'(v2 in-sample before Sep 25)' if m<'2026-09' else '')
# longest losing streak and avg
def streaks(df):
    r=(df.dir==df.actual).astype(int).values;best=cur=0;
    mx=0
    for x in r:
        cur=0 if x else cur+1;mx=max(mx,cur)
    return mx
print('max consecutive losses  v1',streaks(v1[v1.W>=CUT]),'v2',streaks(t2),'(test)')
# permutation / binomial p-value for v2 test
from math import erf,sqrt
n,w=rate(t2)[0],rate(t2)[1];z=(w-n/2)/sqrt(n/4);print('v2 test z vs 50%%: %.2f one-sided p=%.4f'%(z,0.5*(1-erf(z/sqrt(2)))))
