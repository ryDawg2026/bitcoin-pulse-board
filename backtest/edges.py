"""Test candidate extra edges on real public data, train/test split as in fit_v2. Binance-spot taker-buy flow (CVD proxy) + OKX perp funding."""
import json,time,urllib.request,numpy as np,pandas as pd,sys
sys.path.insert(0,'backtest')
from analyze import wilson
from sklearn.linear_model import LogisticRegression
D='/workspace/pulse-bt-data'
def get(u):
    for i in range(4):
        try:return json.load(urllib.request.urlopen(urllib.request.Request(u,headers={'User-Agent':'Mozilla/5.0'}),timeout=25))
        except Exception as e:err=e;time.sleep(2)
    raise err
import os
if not os.path.exists(D+'/taker.json'):
    c=json.load(open(D+'/binancevision.json'))['candles'];t0=c[0][0];end=c[-1][0];rows={}
    t=t0*1000
    while t<end*1000:
        d=get(f'https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=15m&limit=1000&startTime={t}')
        if not d:break
        for k in d:rows[k[0]//1000]=[float(k[5]),float(k[9]),int(k[8])]  # vol,takerbuy,trades
        t=d[-1][0]+900000;time.sleep(.2)
    json.dump(rows,open(D+'/taker.json','w'))
    fr=[];after=''
    for _ in range(12):
        d=get('https://www.okx.com/api/v5/public/funding-rate-history?instId=BTC-USDT-SWAP&limit=100'+after)['data']
        if not d:break
        fr+=[(int(x['fundingTime'])//1000,float(x['fundingRate'])) for x in d];after='&after='+d[-1]['fundingTime'];time.sleep(.2)
    json.dump(fr,open(D+'/funding.json','w'))
rows=json.load(open(D+'/taker.json'));fr=sorted(json.load(open(D+'/funding.json')))
F=pd.read_pickle(D+'/features.pkl')
tk=pd.DataFrame({int(k):v for k,v in rows.items()},index=['v','tb','n']).T
tk['imb']=2*tk.tb/tk.v-1  # +1 = all taker buys
F['imb1']=tk.imb.reindex(F.index);F['imb4']=(2*tk.tb.rolling(4).sum()/tk.v.rolling(4).sum()-1).reindex(F.index)
F['imb1z']=(F.imb1-tk.imb.rolling(96).mean().reindex(F.index))/tk.imb.rolling(96).std().reindex(F.index)
F['ntr_z']=np.log(tk.n/tk.n.rolling(96).mean()).reindex(F.index)
fs=pd.Series({t:r for t,r in fr});F['fund']=fs.reindex(F.index.union(fs.index)).sort_index().ffill().reindex(F.index)
F=F.dropna(subset=['imb1','imb4','imb1z','fund']);split=int(len(F)*.68);tr,te=F.iloc[:split],F.iloc[split:]
def hit(s,sign):
    p=(sign>0).astype(int);w=int((p==s.y).sum());n=len(s);lo,hi=wilson(w,n);return f'n={n} hit={w/n*100:.1f}% [{lo*100:.1f},{hi*100:.1f}]'
print('train',len(tr),'test',len(te))
for f in ['imb1','imb4','imb1z']:
    print(f'{f} FOLLOW  tr {hit(tr,tr[f])} | te {hit(te,te[f])}')
    print(f'{f} FADE    tr {hit(tr,-tr[f])} | te {hit(te,-te[f])}')
print('funding > 0 -> UP  tr',hit(tr,tr.fund),'| te',hit(te,te.fund),'  (funding>0 share',(F.fund>0).mean().round(3),')')
print('funding > 0 -> DOWN(fade) tr',hit(tr,-tr.fund),'| te',hit(te,-te.fund))
base=['z4c','z1c','rsic','clvc','premc']
for d in (tr,te):
    d['z4c']=d.z4.clip(-3,3);d['z1c']=d.z1.clip(-3,3);d['rsic']=((d.rsi14-50)/25).clip(-1.5,1.5);d['clvc']=(d.clv-.5)*2;d['premc']=d.premz.clip(-3,3)
    d['imb1zc']=d.imb1z.clip(-3,3);d['imb4c']=d.imb4*5
for nm,cols in (('base v2-like',base),('+ taker flow imb1z/imb4',base+['imb1zc','imb4c'])):
    m=LogisticRegression(fit_intercept=False).fit(tr[cols],tr.y);out=[]
    for d in (tr,te):
        p=m.predict_proba(d[cols])[:,1];w=int(((p>.5)==d.y).sum());n=len(d);lo,hi=wilson(w,n);out.append(f'{w/n*100:.2f}% [{lo*100:.1f},{hi*100:.1f}]')
    print(f'{nm:26} train {out[0]} | test {out[1]}',dict(zip(cols,m.coef_[0].round(3))))
