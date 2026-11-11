import sys,json,pandas as pd,numpy as np
sys.path.insert(0,'backtest')
from analyze import *
df=load(sys.argv[1])
s=pd.DataFrame(list(df.sig));d=df[df.actual.isin(['UP','DOWN'])]
y=(d.actual=='UP').astype(int)*2-1
print('per-signal standalone (sign of vote vs actual), nonzero votes only')
for c in s.columns:
    v=s.loc[d.index,c];m=v!=0
    w=((np.sign(v[m])==y[m])).sum();n=m.sum();lo,hi=wilson(w,n)
    print(f'{c:6} n={n:6} hit={w/n*100:5.1f}%  CI[{lo*100:.1f},{hi*100:.1f}]  corr(vote,ret)={np.corrcoef(v,d.ret)[0,1]:+.3f}')
# first and second half
h=len(df)//2
for nm,part in (('first half',df.iloc[:h]),('second half',df.iloc[h:])): print(nm,fmt(rate(part)))
