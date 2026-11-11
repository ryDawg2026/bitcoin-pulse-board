import json,sys,math,pandas as pd,numpy as np
D='/workspace/pulse-bt-data'
def load(f):
    df=pd.DataFrame([json.loads(l) for l in open(f)])
    df['t']=pd.to_datetime(df.W,unit='s',utc=True).dt.tz_convert('America/Los_Angeles')
    return df
def kal():
    k=pd.DataFrame(json.load(open(D+'/kalshi_settled.json')))
    k['W']=(pd.to_datetime(k.close_time).astype('int64')//10**9)-900 if False else (pd.to_datetime(k.close_time).map(lambda x:int(x.timestamp()))-900)
    return k.set_index('W')
def wilson(w,n):
    if n==0:return (float('nan'),)*2
    p=w/n;z=1.96;d=1+z*z/n;c=p+z*z/(2*n);a=z*math.sqrt(p*(1-p)/n+z*z/(4*n*n))
    return (c-a)/d,(c+a)/d
def rate(df,label='actual'):
    d=df[df[label].isin(['UP','DOWN'])]
    n=len(d);w=int((d[label]==d.dir).sum());lo,hi=wilson(w,n)
    return n,w,(w/n if n else float('nan')),lo,hi
def fmt(r):return f"n={r[0]:>6} wins={r[1]:>6} hit={r[2]*100:5.1f}%  95%CI[{r[3]*100:.1f},{r[4]*100:.1f}]"
if __name__=='__main__':
    df=load(sys.argv[1])
    k=kal()
    df['kal']=df.W.map(lambda w:('UP' if k.result.get(w)=='yes' else 'DOWN' if k.result.get(w)=='no' else None))
    print('ALL candle-label  ',fmt(rate(df)))
    kd=df[df.kal.notna()]
    print('Kalshi-label      ',fmt(rate(kd,'kal')),' | candle-label same period',fmt(rate(kd)))
    print('agreement candle vs kalshi label',(kd.kal==kd.actual).mean())
    print('share UP calls',(df.dir=='UP').mean(),' share actual UP',(df.actual=='UP').mean())
    # buckets
    df['hr']=df.t.dt.hour
    print('--- by conf bucket');df['cb']=pd.cut(df.conf,[0,55,60,65,70,80,100])
    for b,g in df.groupby('cb',observed=True):print(b,fmt(rate(g)))
    print('--- by |score| quintile');df['sq']=pd.qcut(df.score.abs(),5)
    for b,g in df.groupby('sq',observed=True):print(b,fmt(rate(g)))
    print('--- by hour PT')
    for b,g in df.groupby('hr'):print(b,fmt(rate(g)))
    print('--- by dow');
    for b,g in df.groupby(df.t.dt.dayofweek):print(b,fmt(rate(g)))
    # volatility: abs ret of last 16 candles rolling
    print('--- by dir');
    for b,g in df.groupby('dir'):print(b,fmt(rate(g)))
