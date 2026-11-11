import numpy as np,pandas as pd,math,sys
sys.path.insert(0,'backtest')
from analyze import wilson
from sklearn.linear_model import LogisticRegression
F=pd.read_pickle('/workspace/pulse-bt-data/features.pkl')
split=int(len(F)*0.68);tr,te=F.iloc[:split].copy(),F.iloc[split:].copy()
for d in (tr,te):
    d['z4c']=d.z4.clip(-3,3);d['z1c']=d.z1.clip(-3,3)
    d['rsic']=((d.rsi14-50)/25).clip(-1.5,1.5);d['clvc']=(d.clv-0.5)*2;d['premc']=d.premz.clip(-3,3)
    d['lr']=np.log(d.vol16/d.vol96)
sets={'all':['z1c','z4c','rsic','clvc','premc'],'mr_only':['z1c','z4c','rsic','clvc'],'z4+prem':['z4c','premc'],'z1,z4,prem':['z1c','z4c','premc']}
for nm,cols in sets.items():
    m=LogisticRegression(C=1.0).fit(tr[cols],tr.y)
    for lab,d in (('tr',tr),('te',te)):
        p=m.predict_proba(d[cols])[:,1];pred=(p>.5).astype(int);w=int((pred==d.y).sum());n=len(d);lo,hi=wilson(w,n)
        print(f'{nm:12} {lab} hit={w/n*100:.2f}% n={n} [{lo*100:.1f},{hi*100:.1f}]',end='  ')
    print(dict(zip(cols,np.round(m.coef_[0],3))),'icpt',round(m.intercept_[0],3))
cols=sets['all'];m=LogisticRegression(C=1.0).fit(tr[cols],tr.y)
for d in (tr,te):d['p']=m.predict_proba(d[cols])[:,1];d['edge']=(d.p-.5).abs();d['pred']=(d.p>.5).astype(int);d['ok']=(d.pred==d.y)
print('\nselective calling on test, threshold from TRAIN edge quantiles')
for q in (0,.25,.5,.75,.9):
    th=tr.edge.quantile(q);s=te[te.edge>=th];n=len(s);w=int(s.ok.sum());lo,hi=wilson(w,n)
    print(f'edge>=train q{q:.2f} ({th:.4f}) test n={n} ({n/len(te)*100:.0f}% of windows) hit={w/n*100:.2f}% [{lo*100:.1f},{hi*100:.1f}]  | train same thr hit={tr[tr.edge>=th].ok.mean()*100:.2f}%')
print('\nby vol regime (vol16/vol96) on test, all calls')
te['vq']=pd.qcut(te.lr,4)
for b,g in te.groupby('vq',observed=True):print(b,f'n={len(g)} hit={g.ok.mean()*100:.1f}%')
print('abs 1-candle size (rng) quartiles')
te['rq']=pd.qcut(te.rng,4)
for b,g in te.groupby('rq',observed=True):print(b,f'n={len(g)} hit={g.ok.mean()*100:.1f}%')
