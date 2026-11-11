import json,numpy as np,pandas as pd,math,sys
sys.path.insert(0,'backtest')
from analyze import wilson
D='/workspace/pulse-bt-data'
src={}
for n in ['coinbase','binanceus','binancevision','okx']:
    d=json.load(open(f'{D}/{n}.json'));a=np.array(d['candles']);src[n]=(d['q'],pd.DataFrame(a,columns=['t','o','h','l','c','v']).set_index('t'))
idx=sorted(set.union(*[set(v[1].index) for v in src.values()]))
def med(col,names=None):
    return pd.concat([v[1][col].reindex(idx) for k,v in src.items() if names is None or k in names],axis=1).median(axis=1)
df=pd.DataFrame({'o':med('o'),'h':med('h'),'l':med('l'),'c':med('c'),'usd':med('c',['coinbase','binanceus']),'usdt':med('c',['binancevision','okx'])},index=idx)
df['v']=sum(v[1]['v'].reindex(idx).fillna(0) for v in src.values())
df['ret']=df.c/df.o-1; df['up']=(df.c>df.o).astype(int); df['flat']=(df.c==df.o)
df['prem']=df.usd/df.usdt-1
df['t']=pd.to_datetime(df.index,unit='s',utc=True)
c=df.c
# features known at close of candle i (to predict i+1)
F=pd.DataFrame(index=df.index)
F['r1']=df.ret
F['r2']=c/c.shift(2)-1
F['r4']=c/c.shift(4)-1
F['r16']=c/c.shift(16)-1
F['vol16']=df.ret.rolling(16).std()
F['vol96']=df.ret.rolling(96).std()
F['z1']=F.r1/F.vol96
F['z4']=F.r4/(F.vol96*2)
F['clv']=(df.c-df.l)/(df.h-df.l).replace(0,np.nan)  # 0 = closed at low, 1 = at high
F['rng']=(df.h-df.l)/df.o/F.vol96
def rsi(c,n):
    d=c.diff();g=d.clip(lower=0).ewm(alpha=1/n,adjust=False).mean();l=(-d.clip(upper=0)).ewm(alpha=1/n,adjust=False).mean();return 100-100/(1+g/l)
F['rsi14']=rsi(c,14);F['rsi7']=rsi(c,7)
F['prem']=df.prem; F['premz']=(df.prem-df.prem.rolling(24).mean())/df.prem.rolling(24).std()
F['vz']=np.log(df.v/df.v.rolling(96).mean())
F['e9_21']=c.ewm(span=9,adjust=False).mean()/c.ewm(span=21,adjust=False).mean()-1
F['hr']=df.t.dt.tz_convert('America/Los_Angeles').dt.hour
# label: next candle direction
F['y']=df.up.shift(-1); F['flat']=df.flat.shift(-1)
F=F.dropna(); F=F[F.flat==0]
F.to_pickle(D+'/features.pkl')
split=int(len(F)*0.68)  # ~ first 100 days train, last ~48 days test
tr,te=F.iloc[:split],F.iloc[split:]
print('train',len(tr),pd.to_datetime(tr.index[0],unit='s'),'->',pd.to_datetime(tr.index[-1],unit='s'),'| test',len(te),pd.to_datetime(te.index[0],unit='s'),'->',pd.to_datetime(te.index[-1],unit='s'))
print('base rate up train/test',tr.y.mean(),te.y.mean())
def hit(sub,sign):  # predict up if sign>0
    p=(sign>0).astype(int);w=int((p==sub.y).sum());n=len(sub);lo,hi=wilson(w,n);return f'n={n:5} hit={w/n*100:5.1f}% [{lo*100:.1f},{hi*100:.1f}]'
print('\nsingle-feature direction rules (contrarian = -sign). train | test')
for f,thr in [('r1',0),('r2',0),('r4',0),('r16',0),('z1',0),('clv',0.5),('rsi14',50),('rsi7',50),('premz',0),('prem',0),('vz',0),('e9_21',0)]:
    s=lambda d:(d[f]-thr)
    print(f'{f:6} follow  tr:{hit(tr,s(tr))} | te:{hit(te,s(te))}')
print('\nthresholded (extremes only)')
for nm,fn in [('z1<-1 -> UP',lambda d:d.z1<-1),('z1>1 -> DOWN',lambda d:d.z1>1),('z1<-1.5 -> UP',lambda d:d.z1<-1.5),('z1>1.5 -> DOWN',lambda d:d.z1>1.5),('rsi14<30 -> UP',lambda d:d.rsi14<30),('rsi14>70 -> DOWN',lambda d:d.rsi14>70),('rsi7<20 UP',lambda d:d.rsi7<20),('rsi7>80 DOWN',lambda d:d.rsi7>80),('clv<.1 UP',lambda d:d.clv<.1),('clv>.9 DOWN',lambda d:d.clv>.9),('z4<-1 UP',lambda d:d.z4<-1),('z4>1 DOWN',lambda d:d.z4>1)]:
    r=[]
    for d in (tr,te):
        s=d[fn(d)];up='UP' in nm
        r.append(hit(s,pd.Series(1 if up else -1,index=s.index)) if len(s) else 'n=0')
    print(f'{nm:18} tr:{r[0]} | te:{r[1]}')
