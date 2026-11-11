#!/usr/bin/env python3
"""Write kalshi-snapshot.json (same shape the Kalshi panel builds in the browser) from Kalshi's PUBLIC read-only API.
No key, no auth, GET only. Run from the repo root:  python3 tools/kalshi_snapshot.py [out.json]
Use it for a static fallback (cron / GitHub Action) when no CORS proxy is available."""
import json,sys,time,urllib.request
API='https://api.elections.kalshi.com/trade-api/v2';S='KXBTC15M'
def get(p): return json.load(urllib.request.urlopen(urllib.request.Request(API+p,headers={'User-Agent':'Mozilla/5.0'}),timeout=20))
def ts(x):
    import datetime;return int(datetime.datetime.fromisoformat(x.replace('Z','+00:00')).timestamp())
now=int(time.time());ms=get(f'/markets?series_ticker={S}&status=open&limit=5')['markets']
cur=[m for m in ms if ts(m['open_time'])<=now<ts(m['close_time'])] or ms
cur=cur[0];o=ts(cur['open_time'])
cc=get(f"/series/{S}/markets/{cur['ticker']}/candlesticks?start_ts={o-60}&end_ts={now+60}&period_interval=1")['candlesticks']
st=get(f'/markets?series_ticker={S}&status=settled&limit=24')['markets']
prev=st[0] if st else None;pc=[]
if prev: pc=get(f"/series/{S}/markets/{prev['ticker']}/candlesticks?start_ts={ts(prev['open_time'])-60}&end_ts={ts(prev['close_time'])+60}&period_interval=1")['candlesticks']
keep=('ticker','open_time','close_time','floor_strike','result','yes_bid_dollars','yes_ask_dollars','last_price_dollars','volume_fp','status','event_ticker','title')
slim=lambda m:{k:m.get(k) for k in keep}
json.dump({'fetched_at':now,'current':slim(cur),'cand_cur':cc,'prev':slim(prev) if prev else None,'cand_prev':pc,'settled':[slim(m) for m in st]},open(sys.argv[1] if len(sys.argv)>1 else 'kalshi-snapshot.json','w'))
print('ok',cur['ticker'])
