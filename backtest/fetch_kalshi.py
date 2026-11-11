"""Fetch settled Kalshi KXBTC15M markets (public, no auth) -> kalshi_settled.json"""
import json,sys,time,urllib.request,os
DATA=os.environ.get('PULSE_DATA','/workspace/pulse-bt-data')
MAX=int(sys.argv[1]) if len(sys.argv)>1 else 15000
def get(u):
    for i in range(4):
        try: return json.load(urllib.request.urlopen(urllib.request.Request(u,headers={'User-Agent':'Mozilla/5.0'}),timeout=25))
        except Exception as e: err=e; time.sleep(2*(i+1))
    raise err
out=[];cur=''
while len(out)<MAX:
    d=get(f'https://api.elections.kalshi.com/trade-api/v2/markets?series_ticker=KXBTC15M&status=settled&limit=1000&cursor={cur}')
    out+=[{k:m.get(k) for k in('ticker','open_time','close_time','floor_strike','expiration_value','result','volume_fp','last_price_dollars')} for m in d['markets']]
    cur=d.get('cursor') or ''
    print(len(out),flush=True)
    if not cur: break
    time.sleep(0.4)
json.dump(out,open(f'{DATA}/kalshi_settled.json','w'))
print('done',len(out),out[0]['close_time'],out[-1]['close_time'])
