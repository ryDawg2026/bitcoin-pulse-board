import sys,json,time,os,re
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
  chk('fresh start: no backfilled history (only calls locked while open)',pg.locator('#logTable .pill.bf').count()==0 and pg.locator('#logTable tbody tr').count()<=2,str(pg.locator('#logTable tbody tr').count()))
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
  print('engine record:',pg.locator('#engRec').inner_text().replace('\n',' | ')[:400]);chk('legacy v1 line removed',('v1' not in pg.locator('#engRec').inner_text().lower()) and ('legacy' not in pg.locator('#engRec').inner_text().lower()))
  pg.screenshot(path=out+f'{tag}-full.png',full_page=True)
  pg.locator('#ctxCard').screenshot(path=out+f'{tag}-context-card.png')
  pg.evaluate('window.scrollTo(0,0)');pg.screenshot(path=out+f'{tag}-top.png',full_page=True,clip={'x':0,'y':0,'width':1280,'height':1150})

  # ---- Grokky cards ----
  gk=pg.evaluate("(()=>{const s=window.__pulse.state();const W0=Math.floor(Date.now()/900000)*900;const g=s.groks[W0];const c=s.calls[W0];return g?{g1:g.g1,g2:g.g2,eng:c&&c.dir,lockedAt:g.lockedAt,late:g.late,why:!!g.why,W:W0}:null})()")
  print('grokky record',gk)
  chk('Grokky record locked for current window',gk is not None)
  chk('Grokky 1 follows engine; Grokky 2 is the opposite side',gk and gk['g1']==gk['eng'] and gk['g2']!=gk['g1'] and {gk['g1'],gk['g2']}=={'UP','DOWN'},str(gk))
  t1=pg.locator('#gk1').inner_text();t2=pg.locator('#gk2').inner_text()
  chk('both Grokky cards render opposite sides on page',('UP' in t1 and 'DOWN' in t2 and gk['g1']=='UP') or ('DOWN' in t1 and 'UP' in t2 and gk['g1']=='DOWN'),t1[:60].replace('\n',' ')+' | '+t2[:60].replace('\n',' '))
  chk('Grokky cards at the very top of the board',pg.evaluate("(()=>{const y=e=>document.getElementById(e).getBoundingClientRect().top;return y('gk1')<y('callCard')&&y('gk1')<y('kalshiCard')&&y('gk2')<y('ctxCard')})()"))
  pg.wait_for_function("(()=>{const s=window.__pulse.state();const g=s.groks[Math.floor(Date.now()/900000)*900];return g&&g.why})()",timeout=70000)
  why0=pg.evaluate("(()=>{const s=window.__pulse.state();return JSON.stringify(s.groks[Math.floor(Date.now()/900000)*900].why)})()")
  chk('rationale built from real fields (no empty text; forced-pick wording when nothing supports Grokky 2)',pg.evaluate("(()=>{const w=JSON.parse(%s);return (w.g1.lines.length>0||w.g1.against>0)&&(w.g2.lines.length>0||w.forced2)&&w.g1.lines.concat(w.g2.lines).every(x=>x.length>10&&x.indexOf('undefined')<0&&x.indexOf('NaN')<0)})()" % json.dumps(why0)))
  print('G1 why:',json.loads(why0)['g1']['lines']);print('G2 why:',json.loads(why0)['g2']['lines'],'forced' if json.loads(why0)['forced2'] else '')
  # ---- large transfers tracker ----
  pg.evaluate("Object.values(FlowTracker._status()).forEach(f=>f.next=1e18)")
  chk('flows tracker card present with 3 summaries',pg.locator('#flowCard').count()==1 and pg.locator('#flowSum .mini').count()==3)
  st_=pg.evaluate("Object.fromEntries(Object.entries(FlowTracker._status()).map(([k,v])=>[k,[v.ok,v.err]]))");print('flow feed status',st_)
  chk('each flow feed shows live or an explicit unavailable',pg.locator('#flowStatus .pill').count()==4 and all(('live' in x or 'unavailable' in x) for x in pg.locator('#flowStatus .pill').all_inner_texts()),str(pg.locator('#flowStatus .pill').all_inner_texts()))
  r=pg.evaluate("""(()=>{FlowTracker._clear();const now=Date.now()/1000;const T=FlowTracker._tier;const out={};
    out.tiers=[T(24999.99),T(25000),T(99999.99),T(100000),T(999999.99),T(1000000),T(5e7)];
    const add=(i,k,u,age,side)=>FlowTracker._add({i:i,t:now-age,k:k,s:'test',b:u/70000,u:u,side:side,mx:1,n:2,h:'ab'+i});
    add('a','tx',24999,5);add('b','tx',25000,5);add('c','tx',99999,5);add('d','tx',100000,5);add('e','tx',999999,5);add('f','tx',1000000,5);add('g','tx',2500000,5);
    add('h','tx',50000,1800);add('i','tx',50000,9000);   // 30 min old (in 1 h only), 2.5 h old (in neither)
    add('j','tr',200000,60,'buy');add('k','tr',60000,60,'sell');add('l','lq',300000,60,'long');
    const s15=FlowTracker.summary(900),s60=FlowTracker.summary(3600);
    out.tx15=[1,2,3].map(t=>s15.tx[t][0]);out.tx15u=Math.round(s15.tx.all[1]);out.tx60=[1,2,3].map(t=>s60.tx[t][0]);
    out.tr15=[s15.tr.all[0],s15.tr.all[2],s15.tr.all[3]];out.lq15=[s15.lq.all[0],s15.lq.all[2],s15.lq.all[3]];
    out.dup=FlowTracker._add({i:'b',t:now,k:'tx',s:'t',b:1,u:30000,mx:1,n:1,h:'x'});out.n=FlowTracker.records().length;return out})()""")
  print('flows injected',r)
  chk('tier boundaries ($25k/$100k/$1M, sub-$25k ignored)',r['tiers']==[0,1,1,2,2,3,3],str(r['tiers']))
  chk('15-min tiers exact (tx: 2 / 2 / 2)',r['tx15']==[2,2,2],str(r['tx15']))
  chk('1-hour summary includes 30-min-old, excludes 2.5-h-old',r['tx60']==[3,2,2],str(r['tx60']))
  chk('trade taker buy/sell and liquidation totals',r['tr15']==[2,200000,60000] and r['lq15']==[1,300000,0],str(r['tr15'])+str(r['lq15']))
  chk('duplicate ids rejected',r['dup'] is False)
  big=pg.evaluate("""(()=>{FlowTracker._clear();const now=Date.now()/1000;for(let i=0;i<1100;i++)FlowTracker._add({i:'x'+i,t:now-10,k:'tx',s:'t',b:1,u:30000,mx:1,n:1,h:'h'+i});const s=FlowTracker.summary(3600);return [FlowTracker.records().length,s.tx.all[0]]})()""")
  chk('record list capped at 1000 while 1-h summary still counts all 1100 (per-minute buckets)',big==[1000,1100],str(big))
  pg.evaluate("FlowTracker._clear();(()=>{const now=Date.now()/1000;FlowTracker._add({i:'t1',t:now-3,k:'tx',s:'blockchain.info',b:12.5,u:900000,mx:12,n:3,h:'deadbeefcafe'});FlowTracker._add({i:'t2',t:now-2,k:'tr',s:'Binance',b:2,u:140000,side:'sell',px:70000});FlowTracker._add({i:'t3',t:now-1,k:'lq',s:'OKX',b:1,u:70000,side:'long',px:70000});FlowTracker.render()})()")
  rows=pg.locator('#flowList tbody tr').all_inner_texts()
  tx_row=[x for x in rows if 'On-chain transfer' in x]
  chk('on-chain rows say "transfer (unconfirmed)" and never show a buy/sell direction',len(tx_row)==1 and 'BUY' not in tx_row[0] and 'SELL' not in tx_row[0] and 'unconfirmed' in tx_row[0],str(tx_row))
  chk('exchange trade row shows taker side; liquidation shows position',any('taker' in x and 'SELL' in x for x in rows) and any('Liquidation' in x and 'long' in x for x in rows))
  with pg.expect_download() as dl2: pg.click('#flowCsv')
  txt2=open(dl2.value.path()).read();chk('flows CSV export',txt2.count(chr(10))>=3 and 'usd_when_seen' in txt2,str(txt2.count(chr(10))))
  pg.evaluate("Object.values(FlowTracker._status()).forEach(f=>f.next=0)")
  pg.locator('#flowCard').screenshot(path=out+f'{tag}-flows-card.png')
  # bet
  pg.fill('#betAmt','250');pg.click('#betUp')
  chk('bet placed',pg.evaluate("(()=>{const s=window.__pulse.state();return Object.values(s.calls).some(c=>c.bet&&c.bet.amt===250&&c.bet.side==='UP')})()"))
  chk('bet buttons locked after bet',pg.locator('#betUp').is_disabled())
  pg.reload();ready(pg)
  chk('bet persists after reload',pg.evaluate("Object.values(window.__pulse.state().calls).some(c=>c.bet&&c.bet.amt===250)"),pg.locator('#betMsg').text_content())
  chk('call unchanged after reload (locked)',pg.evaluate("(()=>{const s=window.__pulse.state();const w=Object.keys(s.calls).map(Number).sort((a,b)=>b-a)[0];return JSON.stringify({w:w,dir:s.calls[w].dir,conf:s.calls[w].conf,made:s.calls[w].madeAt})})()")==call0)
  gk2=pg.evaluate("(()=>{const s=window.__pulse.state();const W0=Math.floor(Date.now()/900000)*900;const g=s.groks[W0];return g?{g1:g.g1,g2:g.g2,lockedAt:g.lockedAt,W:W0,why:JSON.stringify(g.why)}:null})()")
  chk('Grokky lock survives reload (same sides, lock time, frozen rationale)',gk2 is not None and gk2['g1']==gk['g1'] and gk2['g2']==gk['g2'] and gk2['lockedAt']==gk['lockedAt'] and gk2['why']==why0,str(gk2)[:200])
  chk('log shows bet',pg.locator('#logTable tbody tr',has_text='UP $250').count()>=1)
  # settlement: make a past live call with unresolved bet and ensure it settles on load
  pg.evaluate("""(()=>{const s=JSON.parse(localStorage.getItem('pulseboard.v2'));const W0=Math.floor(Date.now()/900000)*900;const w=W0-2*900;
    s.calls[w]={W:w,eng:'v2',dir:'UP',conf:55,score:.1,signals:[],kind:'live',madeAt:w+5,bet:{side:'UP',amt:100,placedAt:w+60}};localStorage.setItem('pulseboard.v2',JSON.stringify(s));localStorage.setItem('test_w',w)})()""")
  pg.reload();ready(pg)
  r=pg.evaluate("(()=>{const s=window.__pulse.state();const c=s.calls[localStorage.getItem('test_w')];return c.bet.res+'|'+c.bet.pnl+'|'+c.actual+'|'+c.res})()")
  chk('bet auto-settles',r.split('|')[0] in ('win','loss'),r)
  bal=pg.locator('#bal').text_content();print('balance',bal)
  chk('balance reflects settlement',bal!='$1,000')
  # ---- one-time migration: old v1 history cleared, only once ----
  c2=b.new_context(viewport={'width':1280,'height':900});p2=c2.new_page();p2.goto(url);ready(p2)
  p2.evaluate("""(()=>{localStorage.setItem('pulseboard.v1',JSON.stringify({v:1,calls:{'1':{W:1,dir:'UP',res:'win',eng:'v1'}},resetAt:0}));localStorage.setItem('pulseboard.obook.v1',JSON.stringify({v:1,rows:[1],paper:{}}));localStorage.removeItem('pulseboard.cleared.2026-11-12')})()""")
  p2.reload();ready(p2)
  mg=p2.evaluate("({v1:localStorage.getItem('pulseboard.v1'),ob:localStorage.getItem('pulseboard.obook.v1'),flag:!!localStorage.getItem('pulseboard.cleared.2026-11-12'),has1:!!window.__pulse.state().calls['1'],eng:document.getElementById('engRec').innerText})")
  chk('migration removes old v1 history + v1 paper log from a returning visitor',mg['v1'] is None and mg['ob'] is None and mg['flag'] and not mg['has1'],str({k:(v if k!='eng' else '') for k,v in mg.items()}))
  p2.evaluate("localStorage.setItem('pulseboard.v1','sentinel')");p2.reload();ready(p2)
  chk('migration is one-time (does not wipe again)',p2.evaluate("localStorage.getItem('pulseboard.v1')")=='sentinel')
  c2.close()
  # ---- Grokky tally / streak / no-edge / pending against injected settled data ----
  c3=b.new_context(viewport={'width':1280,'height':900});p3=c3.new_page();p3.goto(url);ready(p3)
  tl=p3.evaluate("""(()=>{const s=window.__pulse.state();const W0=Math.floor(Date.now()/900000)*900;s.groks={};
    const plan=[['UP','yes',0],['UP','no',0],['DOWN','yes',0],['UP','no',1],['DOWN','no',0],['DOWN','no',0],['UP','yes',0]];const settled=[];
    plan.forEach((p,i)=>{const W=W0-(plan.length+1-i)*900;s.groks[W]={W:W,g1:p[0],g2:p[0]==='UP'?'DOWN':'UP',conf:52,noedge:!!p[2],lockedAt:W+3,late:false,why:null,kres:null,winner:null};
      settled.push({result:p[1],close_time:new Date((W+900)*1000).toISOString(),expiration_value:'70010.5',floor_strike:70000})});
    const Wp=W0-30*900;s.groks[Wp]={W:Wp,g1:'UP',g2:'DOWN',conf:50,noedge:false,lockedAt:Wp+3,late:false,why:null,kres:null,winner:null}; // never settled in the list
    const changed=GrokkyPanel.onKalshi({settled:settled.slice().reverse()});const again=GrokkyPanel.onKalshi({settled:settled});const t=GrokkyPanel.tally();
    return {changed:changed,again:again,w1:t.w1,w2:t.w2,n:t.n,pend:t.pend,cur1:t.cur1,cur2:t.cur2,best1:t.best1,best2:t.best2,ne:t.ne,txt:document.getElementById('gkScore').innerText,rows:document.querySelectorAll('#gkScore tbody tr').length,chart:document.getElementById('gkChart')&&document.getElementById('gkChart').width>0}})()""")
  print('tally',{k:v for k,v in tl.items() if k!='txt'})
  chk('tally: Grokky 1 won 4, Grokky 2 won 3 of 7 scored (winner = whoever matched Kalshi result)',tl['w1']==4 and tl['w2']==3 and tl['n']==7,str(tl['w1'])+'/'+str(tl['w2']))
  chk('re-scoring is idempotent',tl['changed']==7 and tl['again']==0)
  chk('current streaks: Grokky 1 W3, Grokky 2 L3; best runs 3/3',tl['cur1']==3 and tl['cur2']==-3 and tl['best1']==3 and tl['best2']==3,str((tl['cur1'],tl['cur2'],tl['best1'],tl['best2'])))
  chk('no-edge round scored and noted (1 round, Grokky 2 won it)',tl['ne']['n']==1 and tl['ne']['w2']==1 and 'no edge' in tl['txt'].lower())
  chk('unsettled old round shown as awaiting Kalshi settlement (pending=1)',tl['pend']==1 and 'awaiting Kalshi settlement' in tl['txt'])
  chk('scoreboard text: 4 / 7 correct, 57.1%, history rows, chart drawn',('4 / 7 correct' in tl['txt']) and ('57.1%' in tl['txt']) and tl['rows']>=8 and tl['chart'],tl['txt'][:160].replace('\n',' '))
  p3.evaluate("(()=>{const s=window.__pulse.state();const W0=Math.floor(Date.now()/900000)*900;GrokkyPanel.lock(W0,s.calls[W0]);GrokkyPanel.update()})()");p3.wait_for_timeout(500);p3.screenshot(path=out+f'{tag}-seeded-top.png',full_page=True,clip={'x':0,'y':0,'width':1280,'height':1250})
  c3.close()
  # ---- degraded: flow feeds blocked -> explicit "unavailable", nothing invented, no page errors ----
  c4=b.new_context(viewport={'width':1280,'height':900});p4=c4.new_page();e4=[];p4.on('pageerror',lambda e:e4.append(str(e)))
  for pat in ('**/data-api.binance.vision/api/v3/aggTrades*','**/blockchain.info/unconfirmed-transactions*','**/www.okx.com/api/v5/market/trades*','**/www.okx.com/api/v5/public/liquidation-orders*'):
    c4.route(pat,lambda r:r.abort())
  p4.goto(url);ready(p4);p4.wait_for_function("window.__flowsReady===true",timeout=30000);p4.wait_for_timeout(9000)
  pl=p4.locator('#flowStatus .pill').all_inner_texts()
  chk('blocked flow feeds say "unavailable" with a reason',sum('unavailable' in x for x in pl)>=3,str(pl))
  chk('blocked flow feeds record nothing (no invented figures)',p4.evaluate("FlowTracker.records().length")==0 and 'Nothing ≥ $25k recorded yet' in p4.locator('#flowList').inner_text())
  chk('Grokky cards still lock and render with feeds down',p4.evaluate("(()=>{const s=window.__pulse.state();return Object.keys(s.groks).length>=1})()") and 'UP' in p4.locator('#gk1').inner_text()+p4.locator('#gk2').inner_text())
  chk('no page errors with feeds down',not e4,str(e4))
  c4.close()
  # csv
  with pg.expect_download() as dl: pg.click('#csvBtn')
  path=dl.value.path();txt=open(path).read();chk('csv export',txt.count('\n')>=2 and 'window_start_local' in txt and ',"v1"' not in txt,f'{txt.count(chr(10))} lines')
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
  chk('mobile: Grokky cards stack and fit',mp.evaluate("(()=>{const a=document.getElementById('gk1').getBoundingClientRect(),c=document.getElementById('gk2').getBoundingClientRect();return a.right<=392&&c.right<=392&&c.top>=a.bottom-1})()"))
  mp.screenshot(path=out+f'{tag}-mobile.png',full_page=True)
  mp.evaluate('window.scrollTo(0,0)');mp.screenshot(path=out+f'{tag}-mobile-top.png',full_page=True,clip={'x':0,'y':0,'width':390,'height':1500})
  b.close()
print('ALL OK' if ok else 'SOME FAILED')
