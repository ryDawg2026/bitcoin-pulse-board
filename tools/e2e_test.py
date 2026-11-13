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

  # ---- price chart + signal strips ----
  pg.wait_for_function("window.ChartPanel&&ChartPanel._state().n['1m']>=40",timeout=60000);pg.wait_for_timeout(500)
  cs=pg.evaluate("ChartPanel._state()")
  print('chart state',json.dumps(cs)[:400])
  chk('chart card present with live 1m candles from a real source',pg.locator('#chartCard').count()==1 and cs['n']['1m']>=40 and bool(cs['info']['1m'].get('src')),cs['info']['1m'].get('src',''))
  PIX="""(c)=>{const cv=document.getElementById('pcChart'),x=cv.getContext('2d'),d=x.getImageData(0,0,cv.width,cv.height).data;let g=0,r=0,a=0;for(let i=0;i<d.length;i+=4){const R=d[i],G=d[i+1],B=d[i+2],A=d[i+3];if(A<200)continue;if(Math.abs(R-47)<6&&Math.abs(G-209)<6&&Math.abs(B-139)<6)g++;else if(Math.abs(R-255)<6&&Math.abs(G-93)<6&&Math.abs(B-115)<6)r++;else if(Math.abs(R-255)<6&&Math.abs(G-180)<6&&Math.abs(B-84)<6)a++}return [g,r,a]}"""
  gra=pg.evaluate(PIX,0)
  chk('candles drawn: green (up) and red (down) pixels present',gra[0]>50 and gra[1]>50,str(gra))
  chk('strike line (amber) drawn',gra[2]>80,str(gra[2]))
  for tf in ['5m','15m','1m']:
    pg.click(f'#pcTabs [data-tf="{tf}"]');pg.wait_for_function(f"ChartPanel._state().tf==='{tf}'&&ChartPanel._state().n['{tf}']>=40",timeout=30000);pg.wait_for_timeout(300)
    chk(f'{tf} tab shows {tf} candles',f'× {tf} candles' in pg.locator('#pcNote').inner_text())
  # deterministic: all-up candles are green only, all-down red only
  mk="""(dir)=>{const now=Math.floor(Date.now()/1000),t0=Math.floor(now/60)*60-120*60,a=[];let p=70000;for(let i=0;i<=120;i++){const o=p,c=dir>0?p+8:p-8;a.push({t:t0+i*60,o:o,h:Math.max(o,c)+3,l:Math.min(o,c)-3,c:c,v:5});p=c}ChartPanel._inject('1m',a,'synthetic');return 1}"""
  pg.evaluate(mk,1);pg.wait_for_timeout(200);up=pg.evaluate(PIX,0)
  pg.evaluate(mk,-1);pg.wait_for_timeout(200);dn=pg.evaluate(PIX,0)
  chk('all-up candles draw green (no red candles)',up[0]>200 and up[1]<40,str(up))
  chk('all-down candles draw red (no green candles)',dn[1]>200 and dn[0]<40,str(dn))
  # chart reading feeds the Grokky reasoning only when it is a real overshoot
  rd=pg.evaluate("""(()=>{const now=Math.floor(Date.now()/1000),t0=Math.floor(now/60)*60-300*60,a=[];let p=70000;for(let i=0;i<=300;i++){const o=p;let c=p*(1+(((i*37)%11)-5)*0.00004);if(i>=291)c=p*1.0012;a.push({t:t0+i*60,o:o,h:Math.max(o,c),l:Math.min(o,c),c:c,v:3});p=c}ChartPanel._inject('1m',a,'synthetic');const r=ChartPanel.reading();const it=GrokkyPanel._items({noedge:false},null,null,null).it.filter(x=>x.src==='chart');return {z:r&&r.z,items:it.map(x=>[x.dir,x.txt.slice(0,60)])}})()""")
  chk('big 10-min up-overshoot adds a chart reading pointing DOWN (mean-reversion, labelled a reading)',rd['z'] and rd['z']>=1.5 and rd['items'] and rd['items'][0][0]=='DOWN',str(rd))
  rd2=pg.evaluate("""(()=>{const now=Math.floor(Date.now()/1000),t0=Math.floor(now/60)*60-300*60,a=[];let p=70000;for(let i=0;i<=300;i++){const o=p,c=p*(1+(((i*37)%11)-5)*0.00004);a.push({t:t0+i*60,o:o,h:Math.max(o,c),l:Math.min(o,c),c:c,v:3});p=c}ChartPanel._inject('1m',a,'synthetic');return GrokkyPanel._items({noedge:false},null,null,null).it.filter(x=>x.src==='chart').length})()""")
  chk('ordinary 10-min move adds no chart reading',rd2==0,str(rd2))
  chk('six signal strips present, each with a data note',pg.locator('#sigCard canvas').count()==6 and all(len(pg.locator(f'#{i}N').inner_text().strip())>10 for i in ['sgFlow','sgLiq','sgBook','sgGap','sgFund','sgOi']))
  pg.evaluate("""(()=>{FlowTracker._clear();const now=Date.now()/1000;FlowTracker._add({i:'sg1',t:now-120,k:'tr',s:'test',b:2,u:400000,side:'buy',mx:1,n:1,h:'sg1'});FlowTracker._add({i:'sg2',t:now-90,k:'tr',s:'test',b:2,u:1500000,side:'sell',mx:1,n:1,h:'sg2'});FlowTracker._add({i:'sg3',t:now-60,k:'lq',s:'test',b:2,u:250000,side:'long',mx:1,n:1,h:'sg3'});ChartPanel.drawSignals()})()""")
  fl=pg.evaluate("""(()=>{const f=(id)=>{const c=document.getElementById(id),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=0;i<d.length;i+=4)if(d[i+3]>200&&(d[i]>150||d[i+1]>150)&&d[i]+d[i+1]+d[i+2]>250)n++;return n};return [f('sgFlow'),f('sgLiq')]})()""")
  chk('flow-tier and liquidation strips draw seeded ≥$25k records',fl[0]>100 and fl[1]>50 and 'Taker' in pg.locator('#sgFlowN').inner_text(),str(fl))
  pg.evaluate("FlowTracker._clear()")
  fe=pg.locator('#sgFundN').inner_text();chk('funding strip shows real history or says unavailable',('real history' in fe) or ('not available' in fe),fe[:80])
  oi=pg.locator('#sgOiN').inner_text();chk('open-interest strip says it is sampled (no invented history)',('sampled' in oi) or ('No open-interest' in oi),oi[:90])
  pg.evaluate("ChartPanel.setTf('1m')");
  pg.evaluate("ChartPanel.draw()")
  pg.locator('#chartCard').scroll_into_view_if_needed();pg.locator('#chartCard').screenshot(path=out+f'{tag}-chart-synthetic-check.png')

  # ---- loss post-mortem (first person, only stored data) ----
  seed="""([off,w])=>{const s=window.__pulse.state();s.groks=s.groks||{};const W=Math.floor(Date.now()/1000/900)*900-off*3600;s.groks[W]=Object.assign({W:W,g1:'DOWN',g2:'UP',conf:61,noedge:false,strong:false,lockedAt:W+5,late:false,winner:2,kres:'yes',kexp:70131.4,kstrike:70128.1,seeded:1},w);window.__pulse.save();GrokkyPanel.update(true);return W}"""
  W=pg.evaluate("("+seed+")([5,{why:{at:1,g1:{lines:['RSI(14) 71 — overbought'],idx:[0],n:1,against:1},g2:{lines:['Large exchange trades: taker buys $2.1M'],idx:[1],n:1,against:1},forced2:false,haveCtx:true,neutral:[],typ:{usd:96,pct:0.0013},items:[{src:'engine',dir:'DOWN',m:.3,txt:'RSI(14) 71 — overbought'},{src:'ctx',dir:'UP',m:2,txt:'Large exchange trades: taker buys $2.1M'}]},px:{o:70100,c:70131,hi:70160,lo:70080,tHi:1,tLo:2,above:9,below:5,n:15,src:'test candles'}}])")
  pm=pg.locator('#pmBody').inner_text()
  chk('post-mortem names the loser and is first person',pm.startswith('Grokky 1 lost') and 'I picked' in pm and 'my side' in pm,pm[:90])
  chk('post-mortem states final vs strike, move size and typical-move ratio',('$70,131.40' in pm and '$70,128.10' in pm and '$3.30' in pm and 'razor-thin' in pm),pm[200:420])
  chk('post-mortem lists my cited reading as wrong and the opposing reading that was right',('every one of them was wrong' in pm) and 'RSI(14) 71' in pm and 'Large exchange trades: taker buys $2.1M' in pm and 'turned out correct' in pm)
  chk('post-mortem uses candle path only because it was stored',('test candles' in pm) and ('5 of 15 minutes' in pm))
  W2=pg.evaluate("("+seed+")([6,{why:{at:1,g1:{lines:['RSI(14) 71 — overbought'],n:1,against:0},g2:{lines:[],n:0,against:1},forced2:true,haveCtx:false,neutral:[]},px:false,kexp:70500,kstrike:70128.1}])")
  pg.click(f'#gkScore tr[data-w="{W2}"]');pg.wait_for_timeout(300)
  pm2=pg.locator('#pmBody').inner_text()
  chk('clicking a scoreboard row shows that round; record without stored opposing readings says so instead of guessing',("didn’t store the full list of opposing readings" in pm2 or 'never frozen' in pm2 or 'stored' in pm2) and ('I picked' in pm2),pm2[:60])
  chk('no typical-move ratio or candle path is claimed when none was stored',('typical 15-minute move' not in pm2) and ('Exchange 1-minute candles' not in pm2) and ('$70,500.00' in pm2),pm2[100:420])
  pg.evaluate("GrokkyPanel.showDemo(true)");dm=pg.locator('#pmBody').inner_text()
  chk('seeded example is labelled as an example, not a real round',('EXAMPLE — seeded for illustration' in dm) and 'I picked' in dm)
  pg.locator('#pmCard').scroll_into_view_if_needed();pg.locator('#pmCard').screenshot(path=out+f'{tag}-postmortem-example.png')
  pg.evaluate("GrokkyPanel.showDemo(false)")
  pg.evaluate("(()=>{const s=window.__pulse.state();Object.keys(s.groks).map(Number).forEach(k=>{if(s.groks[k].seeded)delete s.groks[k]});window.__pulse.save();GrokkyPanel.update(true)})()")

  # ---- Ask AI: built-in mode ----
  askreq=[];pg.on('request',lambda r:askreq.append(r.url) if '/ask' in r.url and 'workers.dev' in r.url else None)
  chk('Ask panel starts in built-in mode and says so',pg.locator('#askCard').count()==1 and 'Built-in answers' in pg.locator('#askMode').inner_text() and 'not financial advice' in pg.locator('#askCard h2').inner_text())
  def ask(page,q,wait=1800):
    page.fill('#askInput',q);page.click('#askSend');page.wait_for_timeout(wait);return page.locator('#askLog .askmsg.bot').last.inner_text()
  a1=ask(pg,'What is a halving?');chk('built-in FAQ answer, labelled built-in',('210,000' in a1) and ('Built-in answer' in a1),a1[:80])
  a2=ask(pg,'What is the market doing right now?');chk('built-in live answer uses real board numbers',('BTC is about $' in a2 or 'sources are still loading' in a2) and 'Built-in answer' in a2,a2[:140])
  a3=ask(pg,'Should I buy bitcoin now?');chk('advice question: declined, not financial advice, no bet placed',('can’t tell you what to buy' in a3) and ('financial advice' in a3) and ('can’t place' in a3),a3[:120])
  a4=ask(pg,'Why did the last pick lose?');chk('"why did it lose" answers with the post-mortem or says nothing is scored',('lost' in a4 and 'I picked' in a4) or ('No round has been scored' in a4) ,a4[:100])
  a5=ask(pg,'tell me a joke');chk('unknown question admitted, not invented',"don’t have a built-in answer" in a5)
  chk('built-in mode made no call to any AI service',len(askreq)==0,str(askreq))
  sn=pg.evaluate("AskPanel.snapshot()");sj=json.dumps(sn)
  okk={'asof','window','btc_consensus_usd','change_since_window_open_usd','kalshi_orderbook_imbalance','okx_funding_pct_per_8h','fear_greed','okx_liquidations_60m_usd','large_exchange_trades_15m_usd','high_impact_event_window','engine_v2','grokky_this_window','scoreboard','last_settled_round','chart_last_10min','typical_15min_move_usd','board_notes'}
  chk('snapshot is compact and has only board-data keys (no play-money balance, bets or storage)',len(sj)<4500 and set(sn.keys())<=okk,str(len(sj))+' '+str(set(sn.keys())-okk))
  pg.locator('#askCard').scroll_into_view_if_needed();pg.locator('#askCard').screenshot(path=out+f'{tag}-ask-builtin.png')
  chk('worker unit tests (offline) pass',__import__('subprocess').run(['node','tools/ask-ai-worker/test.mjs'],capture_output=True,text=True).returncode==0)
  # ---- Ask AI: AI mode against a mock Worker (loopback only; nothing leaves the machine) ----
  base=url.split('?')[0].rstrip('/')
  c5=b.new_context(viewport={'width':1280,'height':900});p5=c5.new_page();e5=[];p5.on('pageerror',lambda e:e5.append(str(e)))
  seen=[];mode={'m':'ok'}
  def mock(route):
    req=route.request
    if req.method!='POST':route.fulfill(status=405,body='no');return
    seen.append(req.post_data_json)
    m=mode['m']
    if m=='ok':route.fulfill(status=200,headers={'content-type':'text/event-stream','X-Questions-Left-Today':'41','access-control-expose-headers':'X-Questions-Left-Today'},body='data: {"t":"A halving cuts the "}\n\ndata: {"t":"**block reward** in half.\\n- about every 4 years"}\n\ndata: {"done":true,"model":"@cf/openai/gpt-oss-120b"}\n\n')
    elif m=='cap':route.fulfill(status=429,content_type='application/json',body='{"error":"daily_cap"}')
    elif m=='down':route.fulfill(status=503,content_type='application/json',body='{"error":"ai_unavailable"}')
    elif m=='empty':route.fulfill(status=200,headers={'content-type':'text/event-stream'},body='data: {"done":true,"empty":true}\n\n')
    elif m=='net':route.abort()
  p5.route(lambda u:__import__('urllib.parse').parse.urlparse(u).path=='/mock-ask',mock)
  p5.goto(base+'/?kalshi=/kalshi-proxy&askurl=http://127.0.0.1:8765/mock-ask');ready(p5)
  chk('AI mode shows when a Worker URL is configured',('AI mode' in p5.locator('#askMode').inner_text()),p5.locator('#askMode').inner_text())
  r1=ask(p5,'What is a halving?',2500)
  chk('AI answer streams in, is labelled as an AI answer with model name, markdown is rendered safely',('AI answer' in r1 and 'gpt-oss-120b' in r1) and 'block reward' in r1 and p5.locator('#askLog .askmsg.bot').last.locator('b').count()==1 and p5.locator('#askLog .askmsg.bot').last.locator('li').count()==1,r1[:120])
  chk('questions-left counter shown from the Worker header',('41 AI answers left' in p5.locator('#askMode').inner_text()),p5.locator('#askMode').inner_text())
  body=seen[0];chk('request carries question + compact snapshot only',set(body.keys())=={'question','snapshot','history'} and body['question']=='What is a halving?' and len(body['snapshot'])<4500 and 'asof' in body['snapshot'],str(len(body['snapshot'])))
  mode['m']='cap';r2=ask(p5,'And mining?',2500);chk('daily cap (429) → falls back to built-in answer, clearly labelled',('Built-in answer (the AI backend was unavailable: daily/rate limit reached)' in r2) and ('Mining' in r2 or 'mining' in r2),r2[:140])
  chk('mode line explains the fallback',('using built-in answers' in p5.locator('#askMode').inner_text()),p5.locator('#askMode').inner_text())
  mode['m']='down';r3=ask(p5,'What is the market doing right now?',2500);chk('503 → built-in fallback labelled',('AI temporarily unavailable' in r3),r3[:100])
  mode['m']='net';r4=ask(p5,'What is a halving?',2500);chk('network failure → built-in fallback labelled',('Built-in answer (the AI backend was unavailable' in r4) and '210,000' in r4,r4[:100])
  mode['m']='empty';r5=ask(p5,'What is a halving?',2500);chk('empty AI answer → built-in fallback',('empty answer' in r5),r5[:100])
  mode['m']='ok';x=ask(p5,'<img src=x onerror=alert(1)> halving',2500)
  chk('AI text is escaped (no HTML injection)',p5.locator('#askLog img').count()==0)
  p5.locator('#askCard').scroll_into_view_if_needed();p5.locator('#askCard').screenshot(path=out+f'{tag}-ask-ai-mode-mock.png')
  chk('public ASK_AI_URL cannot be redirected by a link (askurl only accepts loopback)',pg.evaluate("(()=>{const u=new URL(location.href);return true})()") and p5.evaluate("window.ASK_AI_URL===''"))
  c6=b.new_context();p6=c6.new_page();p6.goto(base+'/?kalshi=/kalshi-proxy&askurl=https://evil.example.com/ask');ready(p6)
  chk('?askurl=https://evil… is ignored',('Built-in answers' in p6.locator('#askMode').inner_text()),p6.locator('#askMode').inner_text());c6.close()
  chk('no page errors in AI-mode page',not e5,str(e5));c5.close()

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
  for el,nm in [('#chartCard','chart'),('#sigCard','signals'),('#pmCard','postmortem'),('#askCard','ask')]:
    mp.locator(el).scroll_into_view_if_needed();mp.locator(el).screenshot(path=out+f'{tag}-mobile-{nm}.png')
  mp.screenshot(path=out+f'{tag}-mobile.png',full_page=True)
  mp.evaluate('window.scrollTo(0,0)');mp.screenshot(path=out+f'{tag}-mobile-top.png',full_page=True,clip={'x':0,'y':0,'width':390,'height':1500})
  b.close()
print('ALL OK' if ok else 'SOME FAILED')
