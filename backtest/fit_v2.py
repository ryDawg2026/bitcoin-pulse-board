"""Fit v2 coefficients on TRAIN windows only (W < cutoff) from features emitted by the JS engine, then write them into engine.js.
usage: python3 backtest/fit_v2.py [--write]"""
import json,re,sys,numpy as np,pandas as pd
from sklearn.linear_model import LogisticRegression
CUT=1790294400
rows=[json.loads(l) for l in open('/workspace/pulse-bt-data/v2_raw.jsonl')]
df=pd.DataFrame(rows);df=df[df.actual.isin(['UP','DOWN'])]
K=['z4','z1','rsi','clv','prem']
X=pd.DataFrame([r['f'] for r in df.feat],index=df.index)[K]
y=(df.actual=='UP').astype(int)
tr=df.W<CUT
m=LogisticRegression(C=1.0,fit_intercept=False).fit(X[tr],y[tr])
coef=dict(zip(K,[round(float(c),3) for c in m.coef_[0]]));print('train n',int(tr.sum()),'test n',int((~tr).sum()));print('coef',coef)
logit=X.values@np.array([coef[k] for k in K]);edge=np.abs(1/(1+np.exp(-logit))-.5)
th=round(float(np.median(edge[tr.values])),4);print('strong threshold (train median |p-.5|)',th)
if '--write' in sys.argv:
    s=open('engine.js').read()
    s=re.sub(r"var V2_COEF=\{[^}]*\};","var V2_COEF="+json.dumps(coef,separators=(',',':')).replace('"','')+";",s)
    s=re.sub(r"var V2_STRONG=[0-9.]+;","var V2_STRONG=%s;"%th,s)
    open('engine.js','w').write(s);print('written')
