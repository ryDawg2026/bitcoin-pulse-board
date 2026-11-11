import sys,json,time,os
from playwright.sync_api import sync_playwright
url=sys.argv[1];tag=sys.argv[2]
out='/workspace/pulse-e2e-'
def ready(pg):
  pg.wait_for_function("window.__pulseReady===true",timeout=60000)
ok=True
def chk(name,cond,info=''):
  global ok
  print(('PASS' if cond else 'FAIL'),name,info)
  if not cond: ok=False
with sync_playwright() as p:
  b=p.chromium.launch()
  ctx=b.new_context(viewport={'width':1280,'height':900},accept_downloads=True)
  pg=ctx.new_page();errs=[];cons=[];pg.on('pageerror',lambda e:errs.append(str(e)));pg.on('console',lambda m:cons.append(m.text[:160]) if m.type=='error' else None)
  if os.environ.get('PULSE_RSS_FROM_FILES'):  # preview-only: the free rss2json relay rate-limits our local-preview origin, so serve real responses saved earlier via curl
    def _rss(route):
      u=route.request.url;m={'tag%2Fbitcoin':'rss_cointelegraph_com_2_rss_2_tag_2_bitcoin.json','cointelegraph.com%2Frss':'rss_cointelegraph_com_2_rss.json','decrypt.co':'rss_decrypt_co_2_feed.json'}
      f=[v for k,v in m.items() if k in u]
      if 'tag%2Fbitcoin' in u:f=[m['tag%2Fbitcoin']]
      route.fulfill(status=200,headers={'access-control-allow-origin':'*','content-type':'application/json'},body=open('/workspace/pulse-bt-data/'+f[0]).read())
    ctx.route('**/api.rss2json.com/**',_rss)
  pg.goto(url);ready(pg)
  res=pg.evaluate("Object.values(window.__pulse.sources).map(s=>[s.def.name,s.ok,s.err,s.candles.length])")
  okn=sum(1 for r in res if r[1]);cand=sum(1 for r in res if r[1] and r[3]>0)
  print('sources ok',okn,'/',len(res),'candle sources',cand);[print('  ',r) for r in res]
  chk('multi-source data',okn>=10 and cand>=8)
  chk('table rows',pg.locator('#srcTable tbody tr').count()==len(res))
  d=pg.locator('#callDir').text_content();chk('prediction renders',('UP' in d or 'DOWN' in d),d+' '+pg.locator('#callConf').text_content())
  chk('5 signals',pg.locator('#signals .sig').count()==5)
  chk('log rows',pg.locator('#logTable tbody tr').count()>=40,str(pg.locator('#logTable tbody tr').count()))
  chk('backfilled tagged',pg.locator('#logTable .pill.bf').count()>0)
  chk('live call locked',pg.locator('#logTable .pill.lv').count()>=1)
  chk('countdown',bool(__import__('re').match(r'\d\d:\d\d',pg.locator('#countdown').text_content())),pg.locator('#countdown').text_content())
  chk('charts drawn',pg.evaluate("document.getElementById('priceChart').width>0 && document.getElementById('wlChart').width>0"))
  call0=pg.evaluate("(()=>{const s=window.__pulse.state();const w=Object.keys(s.calls).map(Number).sort((a,b)=>b-a)[0];return JSON.stringify({w:w,dir:s.calls[w].dir,conf:s.calls[w].conf,made:s.calls[w].madeAt})})()")
  pg.screenshot(path=out+f'{tag}-desktop.png',full_page=True)

  # ---- market context card ----
  pg.wait_for_function("window.__ctxReady===true",timeout=90000);pg.wait_for_timeout(1500)
  chk('context card present',pg.locator('#ctxCard').count()==1 and pg.locator('#ctxCard .mini').count()==8)
  ids=['settle','book','events','vol','liq','whale','deriv','news']
  stat={i:pg.locator(f'#ctx-{i} .cs').text_content() for i in ids}
  print('context box status',stat)
  chk('every context feed shows data or "unavailable"',all(v in ('live','stale','unavailable') for v in stat.values()),str(stat))
  chk('events box has upcoming events',pg.locator('#ctx-events .evrow').count()>=1)
  chk('no empty context boxes',all(len(pg.locator(f'#ctx-{i} .cb').inner_text().strip())>5 for i in ids))
  et=pg.evaluate("[ContextPanel._etToUnix('2027-04-13','08:30'),ContextPanel._etToUnix('2026-12-10','08:30'),ContextPanel._etToUnix('2026-12-09','14:00')]")
  chk('ET->UTC conversion (EDT 12:30Z, EST 13:30Z, EST 19:00Z)',et==[1807619400,1796909400,1796842800],str(et))
  sit=pg.evaluate("(()=>{const e=ContextPanel._events.find(x=>x.ds==='2026-12-10');return [ContextPanel._eventState(e.t-1700).sit&&1,ContextPanel._eventState(e.t-2000).sit&&1,ContextPanel._eventState(e.t+1700).sit&&1,ContextPanel._eventState(e.t+1900).sit&&1].map(x=>x||0)})()")
  chk('sit-out window 30m before..30m after',sit==[1,0,1,0],str(sit))
  chk('Kalshi settlement scoring ran',pg.evaluate("window.__kalshiScore!==undefined"),str(pg.evaluate("window.__kalshiScore")))
  chk('settlement vs expiration_value consistent',pg.evaluate("(window.__kalshiScore||{inconsistent:-1}).inconsistent")==0)
  print('engine record:',pg.locator('#engRec').inner_text().replace('\n',' | ')[:400])
  pg.screenshot(path=out+f'{tag}-full.png',full_page=True)
  pg.locator('#ctxCard').screenshot(path=out+f'{tag}-context-card.png')
  # bet
  pg.fill('#betAmt','250');pg.click('#betUp')
  chk('bet placed',pg.evaluate("(()=>{const s=window.__pulse.state();return Object.values(s.calls).some(c=>c.bet&&c.bet.amt===250&&c.bet.side==='UP')})()"))
  chk('bet buttons locked after bet',pg.locator('#betUp').is_disabled())
  pg.reload();ready(pg)
  chk('bet persists after reload',pg.evaluate("Object.values(window.__pulse.state().calls).some(c=>c.bet&&c.bet.amt===250)"),pg.locator('#betMsg').text_content())
  chk('call unchanged after reload (locked)',pg.evaluate("(()=>{const s=window.__pulse.state();const w=Object.keys(s.calls).map(Number).sort((a,b)=>b-a)[0];return JSON.stringify({w:w,dir:s.calls[w].dir,conf:s.calls[w].conf,made:s.calls[w].madeAt})})()")==call0)
  chk('log shows bet',pg.locator('#logTable tbody tr',has_text='UP $250').count()>=1)
  # settlement: make a past live call with unresolved bet and ensure it settles on load
  pg.evaluate("""(()=>{const s=JSON.parse(localStorage.getItem('pulseboard.v1'));const ks=Object.keys(s.calls).map(Number).sort((a,b)=>b-a);const w=ks[2];const c=s.calls[w];
    delete c.res;delete c.open;delete c.close;delete c.actual;c.kind='live';c.bet={side:'UP',amt:100,placedAt:w+60};localStorage.setItem('pulseboard.v1',JSON.stringify(s));localStorage.setItem('test_w',w)})()""")
  pg.reload();ready(pg)
  r=pg.evaluate("(()=>{const s=window.__pulse.state();const c=s.calls[localStorage.getItem('test_w')];return c.bet.res+'|'+c.bet.pnl+'|'+c.actual+'|'+c.res})()")
  chk('bet auto-settles',r.split('|')[0] in ('win','loss'),r)
  bal=pg.locator('#bal').text_content();print('balance',bal)
  chk('balance reflects settlement',bal!='$1,000')
  # csv
  with pg.expect_download() as dl: pg.click('#csvBtn')
  path=dl.value.path();txt=open(path).read();chk('csv export',txt.count('\n')>=40 and 'window_start_local' in txt,f'{txt.count(chr(10))} lines')
  pg.screenshot(path=out+f'{tag}-desktop-after-bet.png',full_page=True)
  # reset
  pg.on('dialog',lambda d:d.accept());pg.click('#resetBtn')
  chk('reset to $1,000',pg.locator('#bal').text_content()=='$1,000',pg.locator('#bal').text_content())
  chk('no page errors',not errs,str(errs))
  print('console errors (expected from feeds that are down/blocked):',cons)
  # manual refresh
  pg.click('#refreshBtn');pg.wait_for_function("document.getElementById('refreshBtn').textContent.includes('Refresh now')&&!document.getElementById('refreshBtn').disabled",timeout=60000)
  chk('manual refresh works',True)
  # mobile
  m=b.new_context(viewport={'width':390,'height':844},device_scale_factor=2,is_mobile=True,has_touch=True)
  mp=m.new_page();mp.goto(url);ready(mp)
  sw=mp.evaluate("document.documentElement.scrollWidth");chk('mobile no horizontal overflow',sw<=392,str(sw))
  mp.wait_for_function('window.__ctxReady===true',timeout=90000);mp.wait_for_timeout(1500)
  sw=mp.evaluate('document.documentElement.scrollWidth');chk('mobile no horizontal overflow (with context card)',sw<=392,str(sw))
  mp.screenshot(path=out+f'{tag}-mobile.png',full_page=True)
  b.close()
print('ALL OK' if ok else 'SOME FAILED')
