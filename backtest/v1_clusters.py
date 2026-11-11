import sys,pandas as pd,numpy as np
sys.path.insert(0,'backtest')
from analyze import *
v1=load('/workspace/pulse-bt-data/v1.jsonl');F=pd.read_pickle('/workspace/pulse-bt-data/features.pkl')
# features are indexed by the candle whose close they describe -> they predict candle W=idx+900
F=F.copy();F.index=F.index+900
d=v1.set_index('W').join(F[['vol16','vol96','rng']],how='inner')
c=pd.read_pickle('/workspace/pulse-bt-data/features.pkl')
d['lr']=d.vol16/d.vol96
d['volq']=pd.qcut(d.vol96,4,labels=['calm','mid-low','mid-high','wild'])
print('v1 by absolute volatility regime (96-candle realized vol quartile)')
for b,g in d.groupby('volq',observed=True):print(f'{b:10}',fmt(rate(g)))
# chop: efficiency ratio of last 16 candles' closes using consensus close approx: use ret series
cons=pd.Series({int(r.W):r.c for r in v1.itertuples()}) 
er=(cons.diff(16).abs())/(cons.diff().abs().rolling(16).sum());d['er']=er.shift(1).reindex(d.index)
d=d.dropna(subset=['er']);d['erq']=pd.qcut(d.er,4,labels=['choppiest','chop-ish','trend-ish','trendiest'])
print('\nv1 by trendiness (efficiency ratio, last 16 candles; low = chop)')
for b,g in d.groupby('erq',observed=True):print(f'{b:10}',fmt(rate(g)))
d['conf_hi']=d.conf>=80
print('\nv1 high-confidence (>=80%) calls',fmt(rate(d[d.conf>=80])),'\nv1 low-confidence (<60%) calls',fmt(rate(d[d.conf<60])))
inv=d.copy();inv['dir']=inv.dir.map({'UP':'DOWN','DOWN':'UP'});print('\nv1 INVERTED (always do the opposite), all windows',fmt(rate(inv)))
# losing runs
r=(d.dir==d.actual).astype(int).values;runs=[];cur=0
for x in r:
    if x==0:cur+=1
    else:
        if cur:runs.append(cur);cur=0
print('v1 losing-streak lengths: max',max(runs),' share of losses in streaks>=4:',round(sum(x for x in runs if x>=4)/sum(runs),3),'; expected for coin flip ~',round(sum(x*0.5**x*0.5 for x in range(4,60)) if False else 0,3))
