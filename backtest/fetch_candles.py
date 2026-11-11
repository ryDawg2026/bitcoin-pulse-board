"""Fetch public 15m BTC candles from several exchanges (no auth) -> JSON files in DATA dir.
usage: python3 fetch_candles.py DAYS"""
import json,sys,time,urllib.request,os
DATA=os.environ.get('PULSE_DATA','/workspace/pulse-bt-data')
DAYS=int(sys.argv[1]) if len(sys.argv)>1 else 120
Q=900
def get(u):
    for i in range(4):
        try:
            return json.load(urllib.request.urlopen(urllib.request.Request(u,headers={'User-Agent':'Mozilla/5.0'}),timeout=25))
        except Exception as e:
            err=e; time.sleep(1.5*(i+1))
    raise err
now=int(time.time()); end=(now//Q)*Q; start=end-DAYS*86400
def coinbase():
    out={}; t=start
    while t<end:
        e=min(end,t+300*Q)
        u=f'https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=900&start={t}&end={e}'
        for k in get(u): out[k[0]]=[k[0],k[3],k[2],k[1],k[4],k[5]]  # t,o,h,l,c,v
        t=e; time.sleep(0.25)
    return out
def binlike(base):
    def f(sym):
        out={}; t=start*1000
        while t<end*1000:
            d=get(f'{base}?symbol={sym}&interval=15m&limit=1000&startTime={t}')
            if not d: break
            for k in d: out[k[0]//1000]=[k[0]//1000,float(k[1]),float(k[2]),float(k[3]),float(k[4]),float(k[5])]
            t=d[-1][0]+Q*1000; time.sleep(0.2)
        return out
    return f
def okx():
    out={}; after=end*1000
    while True:
        d=get(f'https://www.okx.com/api/v5/market/history-candles?instId=BTC-USDT&bar=15m&limit=100&after={after}')['data']
        if not d: break
        for k in d: out[int(k[0])//1000]=[int(k[0])//1000,float(k[1]),float(k[2]),float(k[3]),float(k[4]),float(k[5])]
        after=int(d[-1][0])
        if after//1000<=start: break
        time.sleep(0.12)
    return out
def gate():
    out={}; t=start
    while t<end:
        e=min(end,t+900*Q)
        d=get(f'https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=BTC_USDT&interval=15m&from={t}&to={e}')
        for k in d: out[int(k[0])]=[int(k[0]),float(k[5]),float(k[3]),float(k[4]),float(k[2]),float(k[6])]
        t=e+Q; time.sleep(0.2)
    return out
SRC={'coinbase':('USD',coinbase),'binanceus':('USD',lambda:binlike('https://api.binance.us/api/v3/klines')('BTCUSD')),
 'binancevision':('USDT',lambda:binlike('https://data-api.binance.vision/api/v3/klines')('BTCUSDT')),'okx':('USDT',okx),'gate':('USDT',gate)}
os.makedirs(DATA,exist_ok=True)
for n,(q,f) in SRC.items():
    try:
        d=f(); rows=sorted(d.values())
        json.dump({'q':q,'candles':rows},open(f'{DATA}/{n}.json','w'))
        print(n,len(rows),time.strftime('%F %R',time.localtime(rows[0][0])),'->',time.strftime('%F %R',time.localtime(rows[-1][0])),flush=True)
    except Exception as e: print(n,'FAILED',e,flush=True)
