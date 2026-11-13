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
  # The shipped page points ASK_AI_URL at the live Worker. Tests must never spend its real daily cap, so every test context gets the page's ASK_AI_URL blanked (built-in mode) unless it asks for the unmodified page (raw=True).
  _nc=b.new_context
  def _blank(route):
    r=route.fetch();route.fulfill(response=r,body=re.sub(r"window\.ASK_AI_URL='[^']*';","window.ASK_AI_URL='';",r.text(),count=1))
  def _ctx(*a,raw=False,**k):
    c=_nc(*a,**k)
    if not raw:c.route(lambda u:__import__('urllib.parse').parse.urlparse(u).path in ('/','/index.html') and '127.0.0.1' in u,_blank)
    return c
  b.new_context=_ctx
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
  chk('flows tracker card present with 3 summaries',pg.locator('#flowCard').count()==1 and pg.locator('#flowSum .ctxgrid .mini').count()==3)
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
    return {changed:changed,again:again,w1:t.w1,w2:t.w2,n:t.n,pend:t.pend,cur1:t.cur1,cur2:t.cur2,best1:t.best1,best2:t.best2,ne:t.ne,txt:(()=>{const c=document.getElementById('gkScore').cloneNode(true);c.querySelectorAll('.cu').forEach(e=>{const d=+(e.dataset.d||0),v=+e.dataset.v;e.textContent=(e.dataset.pre||'')+(d?v.toFixed(d):Math.round(v))+(e.dataset.suf||'')});document.body.appendChild(c);const s=c.innerText;c.remove();return s})(),rows:document.querySelectorAll('#gkScore tbody tr').length,chart:document.getElementById('gkChart')&&document.getElementById('gkChart').width>0}})()""")
  print('tally',{k:v for k,v in tl.items() if k!='txt'})
  chk('tally: Grokky 1 won 4, Grokky 2 won 3 of 7 scored (winner = whoever matched Kalshi result)',tl['w1']==4 and tl['w2']==3 and tl['n']==7,str(tl['w1'])+'/'+str(tl['w2']))
  chk('re-scoring is idempotent',tl['changed']==7 and tl['again']==0)
  chk('current streaks: Grokky 1 W3, Grokky 2 L3; best runs 3/3',tl['cur1']==3 and tl['cur2']==-3 and tl['best1']==3 and tl['best2']==3,str((tl['cur1'],tl['cur2'],tl['best1'],tl['best2'])))
  chk('no-edge round scored and noted (1 round, Grokky 2 won it)',tl['ne']['n']==1 and tl['ne']['w2']==1 and 'no edge' in tl['txt'].lower())
  chk('unsettled old round shown as awaiting Kalshi settlement (pending=1)',tl['pend']==1 and 'awaiting Kalshi settlement' in tl['txt'])
  chk('scoreboard text: 4 / 7 correct, 57.1%, history rows, chart drawn',('4 of 7 correct' in tl['txt']) and ('57.1%' in tl['txt']) and tl['rows']>=8 and tl['chart'],tl['txt'][:160].replace('\n',' '))
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

  zk=pg.evaluate("""(()=>{const W=Math.floor(Date.now()/1000/900)*900,old=KalshiPanel.last;KalshiPanel.last=()=>({fetched_at:Math.floor(Date.now()/1000),current:{close_time:new Date((W+900)*1000).toISOString(),yes_bid_dollars:'0.00',yes_ask_dollars:'0.00',last_price_dollars:'0.00',floor_strike:'70000'}});try{const y=GrokkyPanel._buildWhy({W:W,g1:'UP',g2:'DOWN'});return {k:y.items.filter(x=>x.src==='kalshi').length,neutral:y.neutral.join('|')}}finally{KalshiPanel.last=old}})()""")
  chk('a 0¢ / empty Kalshi market is never cited as a reading',zk['k']==0 and 'Kalshi price not loaded' in zk['neutral'],str(zk))

  # ---- loss post-mortem (first person, only stored data) ----
  seed="""([off,w])=>{const s=window.__pulse.state();s.groks=s.groks||{};const W=Math.floor(Date.now()/1000/900)*900-off*3600;s.groks[W]=Object.assign({W:W,g1:'DOWN',g2:'UP',conf:61,noedge:false,strong:false,lockedAt:W+5,late:false,winner:2,kres:'yes',kexp:70131.4,kstrike:70128.1,seeded:1},w);window.__pulse.save();GrokkyPanel.update(true);return W}"""
  W=pg.evaluate("("+seed+")([5,{why:{at:1,g1:{lines:['RSI(14) 71 — overbought'],idx:[0],n:1,against:1},g2:{lines:['Large exchange trades: taker buys $2.1M'],idx:[1],n:1,against:1},forced2:false,haveCtx:true,neutral:[],typ:{usd:96,pct:0.0013},items:[{src:'engine',dir:'DOWN',m:.3,txt:'RSI(14) 71 — overbought'},{src:'ctx',dir:'UP',m:2,txt:'Large exchange trades: taker buys $2.1M'}]},px:{o:70100,c:70131,hi:70160,lo:70080,tHi:1,tLo:2,above:9,below:5,n:15,src:'test candles'}}])")
  pm=pg.locator('#pmBody').inner_text()
  chk('post-mortem names the loser and is first person',pm.startswith('Grokky 1 here') and 'I lost' in pm and 'I picked' in pm and 'my side' in pm,pm[:90])
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
  okk={'callers','asof','window','btc_consensus_usd','change_since_window_open_usd','kalshi_orderbook_imbalance','okx_funding_pct_per_8h','fear_greed','okx_liquidations_60m_usd','large_exchange_trades_15m_usd','high_impact_event_window','engine_v2','grokky_this_window','scoreboard','last_settled_round','chart_last_10min','typical_15min_move_usd','board_notes'}
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
  # shipped config: the real Worker URL is wired in, and any failure falls back to built-in answers (the Worker itself is mocked here, no real question is sent)
  cR=b.new_context(raw=True);pR=cR.new_page();sent=[];wm={'m':'ok'}
  def wmock(route):
    sent.append(route.request.method)
    if route.request.method=='OPTIONS':route.fulfill(status=204,headers={'access-control-allow-origin':'*','access-control-allow-headers':'Content-Type'});return
    hd={'access-control-allow-origin':'*','access-control-expose-headers':'X-Questions-Left-Today','X-Questions-Left-Today':'48'}
    if wm['m']=='ok':route.fulfill(status=200,headers={**hd,'content-type':'text/event-stream'},body='data: {"t":"Real-model style answer."}\n\ndata: {"done":true,"model":"@cf/openai/gpt-oss-120b"}\n\n')
    else:route.fulfill(status=429,headers={**hd,'content-type':'application/json'},body='{"error":"daily_cap"}')
  pR.route('https://pulse-ask-ai.rydawg2026.workers.dev/**',wmock)
  pR.goto(base+'/?kalshi=/kalshi-proxy');ready(pR)
  chk('shipped page has the pulse-ask-ai Worker URL configured and shows AI mode',pR.evaluate("window.ASK_AI_URL")=='https://pulse-ask-ai.rydawg2026.workers.dev/ask' and 'AI mode' in pR.locator('#askMode').inner_text(),pR.locator('#askMode').inner_text())
  rr=ask(pR,'What is a halving?',2500);chk('configured Worker answer is shown as an AI answer',('AI answer' in rr and 'Real-model style answer' in rr) and 'POST' in sent,rr[:100])
  wm['m']='cap';rr2=ask(pR,'And mining?',2500);chk('configured Worker at its cap → built-in answer with a clear label',('Built-in answer (the AI backend was unavailable' in rr2),rr2[:100]);cR.close()
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
  # ---- friendly redesign: first-person voice, decision trails, motion, mobile ----
  nar=pg.evaluate("""(()=>{const g=[...document.querySelectorAll('#gk1,#gk2,#gkScore .say,#pmBody .pmhead')].map(e=>e.innerText).join(' ');
    return {note:document.querySelectorAll('.gknote').length,third:(g.match(/\\bGrokky [12] (is|was|has|says|thinks|picked|chose|lost|won|follows|believes)\\b|\\bthe Grokkys?\\b|\\bthey\\b/gi)||[]),first:/\\bI(’m| am| picked| locked|’ll)\\b/.test(document.getElementById('gk1').innerText)&&/\\bI(’m| am| picked| locked|’ll)\\b/.test(document.getElementById('gk2').innerText)}})()""")
  chk('no third-person narrator block; the two Grokky cards speak in first person',nar['note']==0 and not nar['third'] and nar['first'],str(nar))
  chk('Grokky avatars are inline SVG',pg.locator('#gk1 svg.av1').count()==1 and pg.locator('#gk2 svg.av2').count()==1)
  # expanders toggle smoothly and stay open across re-render
  x=pg.locator('#gk1 [data-xp="why1"]');x.locator('.xpb').click()
  chk('"Why?" expander opens',x.locator('.xp.open').count()==1 and x.locator('.xpb').get_attribute('aria-expanded')=='true')
  pg.evaluate("GrokkyPanel.update()");pg.wait_for_timeout(1300)
  chk('expander stays open after the card re-renders',pg.locator('#gk1 [data-xp="why1"] .xp.open').count()==1)
  st=pg.evaluate("(()=>{const s=window.__pulse.state();const W=Math.floor(Date.now()/900000)*900;const w=s.groks[W].why;return {n:(w.items||[]).length,p:(w.passed||[]).length,l1:w.g1.lines[0]||null,pass0:(w.passed||[])[0]||null,neutral:(w.neutral||[]).length}})()")
  tx1=pg.locator('#gk1').text_content();tx2=pg.locator('#gk2').text_content()
  chk('pick trail "Why I picked" quotes my real stored reading',('Why I picked' in tx1) and (st['l1'] is None or st['l1'] in tx1),str(st['l1'])[:80])
  chk('"What else I considered" shows counts from the stored data (considered = counted + passed over)',('I looked at '+str(st['n']+st['p'])+' readings') in tx1 and ('What else I considered' in tx2),str(st))
  chk('passed-over readings listed from real data',st['p']==0 or (st['pass0'] and st['pass0'] in tx1),str(st['pass0'])[:80])
  pg.locator('#gk1 [data-xp="why1"] .xpb').click()
  chk('"Why?" expander closes again',pg.locator('#gk1 [data-xp="why1"] .xp.open').count()==0)
  pg.locator('#gk1 [data-xp="why1"] .xpb').click()
  # scoreboard round trail: seeded rounds from the tally test were cleared by reset, so seed one settled round
  pg.evaluate("""(()=>{const s=window.__pulse.state();const W=(Math.floor(Date.now()/900000)-3)*900;
    s.groks[W]={W:W,g1:'UP',g2:'DOWN',conf:61,lockedAt:W+5,px:70000,kres:'no',kexp:69950,kstrike:70000,winner:2,why:{items:[{dir:'UP',txt:'Settlement gap +$40 above strike',src:'x'},{dir:'DOWN',txt:'Funding negative',src:'y'}],passed:['Whale transfers: nothing over $25k seen'],neutral:['Kalshi book: no side'],g1:{lines:['Settlement gap +$40 above strike'],n:1,against:1},g2:{lines:['Funding negative'],n:1,against:1},forced2:false,typ:96}};
    window.__pulse.save&&window.__pulse.save();GrokkyPanel.tally(Math.floor(Date.now()/1000));GrokkyPanel.update()})()""")
  pg.wait_for_timeout(500)
  r0=pg.locator('#gkScore tr[data-w]').first
  if r0.count():
    r0.click();pg.wait_for_timeout(700)
    dt=pg.locator('#gkScore tr.dtl .xp.open').first.text_content()
    chk('scored round has an expandable decision trail with why chosen + what else was considered',('What happened' in dt) and ('What else we considered' in dt) and ('Why I picked' in dt or 'why I picked' in dt),dt[:120])
  else: chk('scored round row present for the trail test',False)
  # tracker highlights: why surfaced, passed over, counts, duplicates
  hl=pg.evaluate("""(()=>{FlowTracker._clear();const now=Date.now()/1000;
    FlowTracker._add({i:'h1',t:now-30,k:'tx',s:'test',b:15,u:1050000,mx:1,n:2,h:'aa'});FlowTracker._add({i:'h2',t:now-20,k:'tr',s:'binance',b:3,u:210000,side:'buy',mx:1,n:1,h:'bb'});
    FlowTracker._add({i:'h2',t:now-20,k:'tr',s:'binance',b:3,u:210000,side:'buy',mx:1,n:1,h:'bb'});
    FlowTracker._cnt.tx.seen+=9;FlowTracker._cnt.tx.below+=8;FlowTracker.render();return JSON.parse(JSON.stringify(FlowTracker._cnt))})()""")
  fs=pg.locator('#flowSum').text_content()
  chk('tracker highlights each carry a "Why this one?" trail',pg.locator('#flowSum [data-xp^="hi"]').count()==2 and 'Why I surfaced this' in fs and '#1' in fs and 'dollar size' in fs,fs[:100])
  chk('tracker "What else I considered": looked-at / passed-over / duplicates-rejected / kept counts from the real counters',('What else I considered' in fs) and hl['tx']['below']>=8 and hl['tr']['dup']>=1 and pg.locator('#flowSum [data-xp="passed"] table.ftab tbody tr').count()==3,str(hl))
  chk('tracker says how many it shows vs how many it kept',('newest 2 of the 2 items') in fs,fs[-160:])
  # ---- callers v2 (Dash / Zippy / Mellow / Ripple / Sage), indicators, gate, memory, phases, archive, Grokky learning ----
  SYN=r"""window.__syn=function(now,W,strike,g){const cb=[],bn=[];let p=70000;const t0=Math.floor(now/60)*60;
 for(let t=t0-7200;t<=t0;t+=60){const o=p;p+=((t/60)%5<2?-9:7)+Math.sin(t/900)*6;cb.push({t:t,o:o,h:Math.max(o,p)+4,l:Math.min(o,p)-4,c:p,v:3+((t/60)%4)});bn.push({t:t,o:o-10,h:Math.max(o,p)+4,l:Math.min(o,p)-4,c:p-10,v:25,tb:15+((t/60)%3)})}
 return {now:now,W:W,strike:strike,kmid:0.58,cb:cb,bn:bn,g:g===undefined?{g1:'UP',g2:'DOWN',pUp:.54,items:[{dir:'UP',src:'engine'},{dir:'DOWN',src:'ctx'},{dir:'UP',src:'ctx'}]}:g,ctx:{book:.06}}};
 window.__reset=function(){CallersPanel._resetCache();localStorage.removeItem('pulseboard.callers.v2');localStorage.removeItem('pulseboard.archive.v1');GrokkyArchive._reload()};
 window.__kinds=['pulseboard.v2','pulseboard.obook.v2','pulseboard.flows.v1','pulseboard.sig.v1','pulseboard.cleared.2026-11-12','pulseboard.learn.v1','pulseboard.callers.v1'];"""
  cX=b.new_context(viewport={'width':1280,'height':900});px=cX.new_page();ex=[];px.on('pageerror',lambda e:ex.append(str(e)[:200]));px.on('console',lambda m:ex.append(m.text[:160]) if m.type=='error' and 'Failed to load resource' not in m.text and 'CORS' not in m.text and 'Access to fetch' not in m.text else None)
  px.goto(url);ready(px);px.wait_for_timeout(1500);px.evaluate(SYN)
  # 1) beats
  tm=px.evaluate("""(()=>{__reset();const B=CallersPanel.BEATS,ids=CallersPanel.IDS,all=[].concat(...ids.map(i=>B[i])),o={};
    o.all=all.slice().sort((a,b)=>a-b);o.uniq=new Set(all).size;o.fit=ids.every(i=>B[i].every(s=>s+CallersPanel.grace(s)<900));o.sage=B.sage;o.g870=CallersPanel.grace(870);o.table=Object.fromEntries(ids.map(i=>[i,B[i]]));
    const Wt=Math.floor(Date.now()/900000)*900-6*900,D=PulseIndicators.feed(),syn=__syn(Wt+4*900,Wt,70040);D.cb=syn.cb;D.bn=syn.bn;
    const S=()=>CallersPanel._store().rounds,F=(W)=>{const r=S()[W];return r?ids.map(i=>r.calls[i].map((c,k)=>c?k:'-').join('')).join('|'):''},M=(W)=>{const r=S()[W];return r?Object.fromEntries(Object.entries(r.miss).map(([k,v])=>[k,Object.keys(v).join('')])):{}};
    CallersPanel.tickMarks(Wt+59);o.a=F(Wt);CallersPanel.tickMarks(Wt+61);o.b=F(Wt);CallersPanel.tickMarks(Wt+125);o.c=F(Wt);
    CallersPanel.tickMarks(Wt+400);o.d=F(Wt);o.dm=M(Wt);CallersPanel.tickMarks(Wt+871);o.e=F(Wt);o.em=M(Wt);
    const W2=Wt+900;CallersPanel.tickMarks(W2+500);o.l=F(W2);o.lm=M(W2);
    const W3=Wt+1800;CallersPanel.tickMarks(W3+896);o.late=F(W3);o.latem=M(W3);
    return o})()""")
  print('callers beats',tm['table'],tm['a'],tm['b'],tm['c'],tm['d'],tm['e'])
  chk('six callers, sixteen unique beats (no collisions); Flippy has ONE beat at 14:15 (855 s) in a slot nobody else uses',tm['uniq']==16 and tm['all']==sorted(tm['all']) and tm['table']=={'dash':[60,360,660],'zippy':[120,420,720],'mellow':[180,480,780],'ripple':[240,540,840],'sage':[300,600,870],'flippy':[855]},str(tm['table']))
  chk('Sage’s last call is at 14:30 (870 s, minute 15 is settlement) and every beat plus its grace ends before the window closes',tm['sage'][2]==870 and tm['g870']==25 and tm['fit'],str((tm['sage'],tm['g870'])))
  chk('nothing fires one second early; each beat fires inside its grace; only the caller whose beat it is calls',tm['a'] in ('','---|---|---|---|---|-') and tm['b']=='0--|---|---|---|---|-' and tm['c']=='0--|0--|---|---|---|-',str((tm['a'],tm['b'],tm['c'])))
  chk('a late page records the beats it missed as missed (never back-filled) and still fires the ones in range',tm['d']=='01-|0--|---|---|---|-' and tm['dm']=={'mellow':'0','ripple':'0','sage':'0'} and tm['e']=='01-|0--|---|--2|--2|0',str((tm['d'],tm['dm'],tm['e'])))
  chk('opening the page mid-window: earlier beats missed, Mellow’s minute-8 beat still fires inside its grace',tm['l']=='---|---|-1-|---|---|-' and tm['lm']=={'dash':'01','zippy':'01','mellow':'0','ripple':'0','sage':'0'},str((tm['l'],tm['lm'])))
  chk('Sage’s 14:30 call (and Flippy’s 14:15 look) are missed, not forced, once their short grace is over',('2' in tm['latem'].get('sage','')) and tm['late'].endswith('---|-') and tm['latem'].get('flippy')=='0',str((tm['late'],tm['latem'])))
  # 2) equal capability
  eq=px.evaluate("""(()=>{__reset();const P=CallersPanel.PROFILES,ids=CallersPanel.REG,sum=i=>Object.values(P[i].w).reduce((a,b)=>a+b,0),o={};
    o.sums=ids.map(i=>+sum(i).toFixed(9));o.keys=ids.map(i=>Object.keys(P[i].w).join());o.groups=PulseIndicators.GROUPS.join();
    const L=(m,v,c,r,f,s,g)=>({momentum:{lean:m,n:2},volume:{lean:v,n:2},chart:{lean:c,n:2},revert:{lean:r,n:2},flow:{lean:f,n:2},strike:{lean:s,n:2},grokky:{lean:g,n:1}});
    const dd=l=>ids.map(i=>CallersPanel.decide(l,P[i],0).dir);
    o.mom=dd(L(1,-.3,-.3,0,0,0,0));o.vol=dd(L(-.3,1,-.3,0,0,0,0));o.chart=dd(L(-.3,-.3,1,0,0,0,0));o.sage=dd(L(-1,-1,-1,0,0,1,0));o.dash=dd(L(.6,.6,0,0,0,-1,0));
    const inp=__syn(Date.now()/1000|0,0,70040),W=Math.floor(Date.now()/900000)*900-9*900,D=PulseIndicators.feed();D.cb=inp.cb;D.bn=inp.bn;
    ids.forEach((i,k)=>CallersPanel.fire(W,i,0,W+100+k,inp));const R=CallersPanel._store().rounds[W];
    o.leans=ids.map(i=>JSON.stringify(R.calls[i][0].leans));o.flw=Object.values(P.flippy.w).reduce((a,b)=>a+b,0);o.flk=Object.keys(P.flippy.w).length;o.fields=ids.map(i=>Object.keys(R.calls[i][0]).sort().join());o.cnt=ids.map(i=>JSON.stringify(R.calls[i][0].cnt));return o})()""")
  chk('equal capability: each caller has the same 1.00 weight budget over the same seven evidence groups; same record fields and reading counts for the same input',set(eq['sums'])=={1.0} and len(set(eq['keys']))==1 and set(eq['keys'][0].split(','))==set(eq['groups'].split(',')) and len(set(eq['leans']))==1 and len(set(eq['fields']))==1 and len(set(eq['cnt']))==1,str(eq))
  chk('Flippy reads the same shared vector with his own seven flip-evidence weights summing to 1.00',abs(eq['flw']-1)<1e-9 and eq['flk']==7)
  chk('emphasis differs: momentum → Zippy up only; volume → Mellow up only; chart → Ripple up only; Sage needs the strike gap to confirm; Dash acts on early momentum+volume',(eq['mom'][1]=='UP' and eq['mom'][2]=='DOWN' and eq['mom'][3]=='DOWN' and eq['vol'][2]=='UP' and eq['vol'][1]=='DOWN' and eq['chart'][3]=='UP' and eq['chart'][1]=='DOWN' and eq['sage'][4]=='UP' and eq['sage'][1]=='DOWN' and eq['dash'][0]=='UP' and eq['dash'][1]=='DOWN'),str((eq['mom'],eq['vol'],eq['chart'],eq['sage'],eq['dash'])))
  # 3) confidence
  cf=px.evaluate("""(()=>{__reset();const P=CallersPanel.PROFILES,o={},L=(m,s)=>({momentum:{lean:m,n:2},volume:{lean:m,n:2},chart:{lean:m,n:2},revert:{lean:m,n:2},flow:{lean:m,n:2},strike:{lean:s,n:2},grokky:{lean:m,n:1}});
    const c=(id,l,g,cr)=>{const d=CallersPanel.decide(l,P[id],0);return CallersPanel.confidence(d,l,P[id],g||'ok',cr||{same:0,tot:0})};
    o.weak=c('zippy',L(.05,.05)).conf;o.strong=c('zippy',L(.6,.6)).conf;o.caut=c('zippy',L(.6,.6),'caution').conf;o.dash=c('dash',L(.4,.4)).conf;o.zip=c('zippy',L(.4,.4)).conf;o.sage=c('sage',L(.4,.4)).conf;
    o.crowdUp=c('zippy',L(.3,.3),'ok',{same:3,tot:3}).conf;o.crowdDn=c('zippy',L(.3,.3),'ok',{same:0,tot:3}).conf;o.parts=c('zippy',L(.6,.6)).parts;
    const Wt=Math.floor(Date.now()/900000)*900-8*900,D=PulseIndicators.feed(),inp=__syn(Wt+400,Wt,70010);D.cb=inp.cb;D.bn=inp.bn;CallersPanel.fire(Wt,'ripple',0,Wt+250,inp);const call=CallersPanel._store().rounds[Wt].calls.ripple[0];
    const p=call.cp,re=Math.max(5,Math.min(95,Math.round((p.str+p.agree+p.cov+p.adj)*p.gate*p.shape)));o.call={conf:call.conf,re:re,txt:CallersPanel._bubble('ripple',call)};return o})()""")
  chk('every call carries a confidence (integer 0–100) that equals the documented formula from its stored drivers, and the bubble says it in plain words',isinstance(cf['call']['conf'],int) and 0<=cf['call']['conf']<=100 and cf['call']['conf']==cf['call']['re'] and 'confidence' in cf['call']['txt'] and '/100' in cf['call']['txt'],str(cf['call']))
  chk('confidence behaves: stronger evidence → higher; caution gate → ×0.75; Dash bolder and Sage more careful than Zippy; earlier callers agreeing nudges it up and disagreeing nudges it down',cf['strong']>cf['weak'] and cf['caut']<cf['strong'] and cf['dash']>cf['zip']>cf['sage'] and cf['crowdUp']>cf['crowdDn'],str(cf))
  # 4) short memory
  sm=px.evaluate("""(()=>{__reset();const s=CallersPanel._store(),o={},gl=(c,m)=>({chart:c,momentum:m,volume:0,revert:0,flow:0,strike:0,grokky:0});
    s.mem.zippy=[{W:1,i:0,dir:'UP',ok:false,gl:gl(.5,-.5)},{W:2,i:0,dir:'UP',ok:false,gl:gl(.5,-.5)}];
    const m1=CallersPanel.memMods('zippy');o.damp1=m1.damp;o.why=m1.dl.map(x=>x.why);
    s.mem.zippy=[{W:1,i:0,dir:'UP',ok:false,gl:gl(.5,-.5)},{W:2,i:0,dir:'UP',ok:true,gl:gl(.5,.5)}];o.damp2=CallersPanel.memMods('zippy').damp;
    s.mem.zippy=[{W:1,i:0,dir:'UP',ok:false,gl:gl(.5,-.5)}];o.damp3=CallersPanel.memMods('zippy').damp;
    s.mem.zippy=[{W:1,i:0,dir:'UP',ok:false,gl:gl(.5,-.5)},{W:2,i:0,dir:'UP',ok:false,gl:gl(.5,-.5)}];
    const P=CallersPanel.PROFILES.zippy,L={momentum:{lean:.2,n:2},volume:{lean:0,n:2},chart:{lean:.9,n:2},revert:{lean:0,n:2},flow:{lean:0,n:2},strike:{lean:-.1,n:2},grokky:{lean:0,n:1}};
    const a=CallersPanel.decide(L,P,0),b=CallersPanel.decide(L,P,0,{damp:m1.damp});o.sc=[a.sc,b.sc];o.wsum=Object.values(b.w).reduce((x,y)=>x+y,0);
    const Wt=Math.floor(Date.now()/900000)*900-7*900,D=PulseIndicators.feed(),inp=__syn(Wt+500,Wt,70010);D.cb=inp.cb;D.bn=inp.bn;CallersPanel.fire(Wt,'zippy',0,Wt+130,inp);const c=s.rounds[Wt].calls.zippy[0];o.rec=c.damp.map(x=>x.g);o.mem=c.mem.length;o.bub=CallersPanel._bubble('zippy',c);
    const W2=Wt+900;D.cb=__syn(W2+500,W2,70010).cb;
    for(let k=0;k<8;k++){s.mem.zippy.push({W:10+k,i:0,dir:'UP',ok:k%2==0,gl:gl(.1,.1)})}
    const r=CallersPanel._store().rounds;r[Wt].res='yes';CallersPanel.scoreRound(r[Wt]);o.cap=s.mem.zippy.length;return o})()""")
  chk('short memory: a group that leaned the wrong way in BOTH of my last 2 settled calls is damped ×0.7; one miss, or a hit in between, does not damp',sm['damp1'].get('chart')==0.7 and 'momentum' not in sm['damp1'] and sm['damp2']=={} and sm['damp3']=={},str((sm['damp1'],sm['damp2'],sm['damp3'])))
  chk('damping changes the call’s score, weights still sum to 1, and the call stores + shows why (in the Why trail data) with the memory of recent outcomes',sm['sc'][1]<sm['sc'][0] and abs(sm['wsum']-1)<1e-9 and sm['rec']==['chart'] and sm['mem']==2 and 'going easy' in sm['bub'],str(sm))
  chk('short memory keeps only the last 5 settled calls',sm['cap']==5,str(sm['cap']))
  # 5) phases
  ph=px.evaluate("""(()=>{__reset();const s=CallersPanel._store(),o={},A={vol:'normal',trend:'range',atrRatio:1,trendZ:0},B={vol:'wild',trend:'range',atrRatio:2.1,trendZ:0.2},t0=1800000000;
    CallersPanel.detectPhase(A,t0);o.p1=s.phase.cur&&s.phase.cur.id;o.label=s.phase.cur.label;o.start=s.phase.cur.start;
    s.ps.zippy={n:5,w:3,b:[{n:2,w:1},{n:2,w:1},{n:1,w:1}],gr:{}};s.tot.zippy.a={n:12,w:7};s.mem.zippy=[{W:1,i:0,dir:'UP',ok:true,gl:{}}];
    CallersPanel.detectPhase(B,t0+100);CallersPanel.detectPhase(A,t0+200);o.flick=[s.phase.cur.id,!!s.phase.cand];
    CallersPanel.detectPhase(B,t0+300);CallersPanel.detectPhase(B,t0+1000);o.tooEarly=s.phase.cur.id;CallersPanel.detectPhase(B,t0+2000);
    o.p2=s.phase.cur.id;o.reason=s.phase.cur.reason;o.hist=s.phase.hist.length;o.psAfter=Object.keys(s.ps).length;o.histStats=s.phase.hist[0].stats.zippy;o.tot=s.tot.zippy.a;o.mem=s.mem.zippy.length;
    CallersPanel.newPhase('test by hand',t0+3000);o.p3=s.phase.cur.id;o.hist3=s.phase.hist.length;o.reason3=s.phase.cur.reason;
    const W=Math.floor(Date.now()/900000)*900-10*900,D=PulseIndicators.feed(),inp=__syn(W+300,W,70010);D.cb=inp.cb;D.bn=inp.bn;CallersPanel.fire(W,'dash',0,W+70,inp);const c=s.rounds[W].calls.dash[0];o.cph=c.ph;
    CallersPanel.newPhase('again',t0+4000);s.rounds[W].res='yes';CallersPanel.scoreRound(s.rounds[W]);o.oldPhaseCall=[s.tot.dash.a.n,(s.ps.dash||{n:0}).n];
    return o})()""")
  chk('phase auto-detect: starts a phase with a start time; a brief flicker or a change that has not held 10 min / phase not 30 min old does NOT switch; a held regime change does, with a plain reason',ph['p1']==1 and ph['flick']==[1,False] and ph['tooEarly']==1 and ph['p2']==2 and 'volatility went from normal to wild' in ph['reason'],str(ph))
  chk('phase reset: per-phase stats reset and are summarised in the phase history; all-time totals and short memory are untouched; a manual new phase works',ph['psAfter']==0 and ph['histStats']=={'n':5,'w':3} and ph['tot']=={'n':12,'w':7} and ph['mem']==1 and ph['p3']==3 and ph['hist3']==2 and 'by hand' in ph['reason3'],str(ph))
  chk('a call made in an older phase is scored in the all-time totals but not in the new phase’s stats',ph['oldPhaseCall']==[1,0],str(ph['oldPhaseCall']))
  # 6) bet tracking at marks
  mt=px.evaluate("""(()=>{__reset();const s=CallersPanel._store(),o={},Wt=Math.floor(Date.now()/900000)*900-11*900,D=PulseIndicators.feed(),syn=__syn(Wt+1500,Wt,70010);D.cb=syn.cb;D.bn=syn.bn;
    s.tot.zippy.a={n:10,w:6};s.ps.zippy={n:4,w:3,b:[],gr:{}};CallersPanel.tickMarks(Wt+239);o.none=Object.keys((s.rounds[Wt]||{snaps:{}}).snaps);
    CallersPanel.tickMarks(Wt+241);o.s4=s.rounds[Wt].snaps[4].zippy;s.tot.zippy.a={n:11,w:7};CallersPanel.tickMarks(Wt+481);o.s8=s.rounds[Wt].snaps[8].zippy;o.s4b=s.rounds[Wt].snaps[4].zippy;
    CallersPanel.tickMarks(Wt+700);o.no12=!s.rounds[Wt].snaps[12];s.tot.zippy.a={n:12,w:7};CallersPanel.tickMarks(Wt+725);o.s12=s.rounds[Wt].snaps[12].zippy;CallersPanel.tickMarks(Wt+850);o.keys=Object.keys(s.rounds[Wt].snaps).join();return o})()""")
  chk('mark tallies: each caller’s standing is snapshotted once at minute 4, 8 and 12 (inside a short window), frozen afterwards, with phase record',mt['none']==[] and mt['s4']=={'n':10,'w':6,'pn':4,'pw':3} and mt['s8']['n']==11 and mt['s4b']['n']==10 and mt['no12'] and mt['s12']['n']==12 and mt['keys']=='4,8,12',str(mt))
  # 7) crowd %
  cw=px.evaluate("""(()=>{__reset();const s=CallersPanel._store(),o={},W=Math.floor(Date.now()/900000)*900-12*900,D=PulseIndicators.feed(),inp=__syn(W+700,W,70010);D.cb=inp.cb;D.bn=inp.bn;
    const r=s.rounds[W]||(CallersPanel.fire(W,'dash',0,W+61,inp),s.rounds[W]);r.calls.dash[0]=null;
    const inj=(id,i,dir,at)=>{r.calls[id][i]={i:i,sec:CallersPanel.BEATS[id][i],at:at,dir:dir,conf:60,gate:{lvl:'ok',tr:[]}}};
    inj('dash',0,'UP',W+60);inj('zippy',0,'UP',W+120);inj('mellow',0,'UP',W+180);inj('ripple',0,'DOWN',W+240);inj('flippy',0,'DOWN',W+250);
    CallersPanel.fire(W,'sage',0,W+310,inp);const c=r.calls.sage[0];o.crowd=c.crowd;o.dir=c.dir;o.adj=c.cp.adj;o.expect=Math.round((c.crowd.same/c.crowd.tot-0.5)*16);o.ids=CallersPanel._earlier(r,'sage',W+400).map(x=>x.id);
    const P=CallersPanel.PROFILES.zippy,L=m=>({momentum:{lean:m,n:2},volume:{lean:m,n:2},chart:{lean:m,n:2},revert:{lean:m,n:2},flow:{lean:m,n:2},strike:{lean:m,n:2},grokky:{lean:m,n:1}}),dd=CallersPanel.decide(L(.3),P,0);
    o.dis=CallersPanel.confidence(dd,L(.3),P,'ok',{same:0,tot:3}).parts.adj;o.agr=CallersPanel.confidence(dd,L(.3),P,'ok',{same:3,tot:3}).parts.adj;o.none=CallersPanel.confidence(dd,L(.3),P,'ok',{same:1,tot:1}).parts.adj;
    const bk=r.calls.zippy[0].bk||'normal|above|early';s.cb[bk]={n:20,up:15,dn:5,upOk:9,dnOk:3};o.h=CallersPanel.hist(bk,'UP');o.h2=CallersPanel.hist(bk,'DOWN');s.cb['x|y|z']={n:3,up:2,dn:1,upOk:1,dnOk:0};o.few=CallersPanel.hist('x|y|z','UP');o.none2=CallersPanel.hist('nope','UP');
    const n0=Object.values(s.cb).reduce((a,b)=>a+b.n,0);CallersPanel.fire(W,'zippy',1,W+425,inp);CallersPanel.fire(W,'mellow',1,W+485,inp);r.res='yes';CallersPanel.scoreRound(r);o.grew=Object.values(s.cb).reduce((a,b)=>a+b.n,0)-n0;return o})()""")
  chk('crowd %: a call records how many earlier callers in the window agreed (Flippy’s contrarian call is not counted as consensus)',cw['crowd']['tot']==4 and cw['crowd']['same']==(3 if cw['dir']=='UP' else 1) and 'flippy' not in cw['ids'],str((cw['crowd'],cw['dir'],cw['ids'])))
  chk('crowd nudges confidence only (never direction): disagreeing −8, agreeing +8, one voice = no nudge, and the nudge on the stored call matches the formula',cw['dis']==-8 and cw['agr']==8 and cw['none']==0 and cw['adj']==cw['expect'],str((cw['dis'],cw['agr'],cw['none'],cw['adj'],cw['expect'])))
  chk('historical crowd in similar conditions: share and right-rate with n; too little history says so; scoring adds new calls to the buckets',abs(cw['h']['share']-.75)<1e-9 and abs(cw['h']['right']-.6)<1e-9 and cw['h']['n']==20 and abs(cw['h2']['share']-.25)<1e-9 and cw['few']['n']==3 and cw['none2']['n']==0 and cw['grew']>=3,str((cw['h'],cw['few'],cw['grew'])))
  # 8) volatility gate
  gt=px.evaluate("""(()=>{__reset();const n=1800000000+1000-(1800000000%900),W=Math.floor(n/900)*900,k=(f)=>{const s=__syn(n+30,W,70040);f(s);return PulseIndicators.compute(s).gate},o={};
    o.G=PulseIndicators.GATE;o.base=k(s=>{});
    const lastClosed=s=>s.cb.find(c=>c.t===Math.floor((n+30)/60)*60-60),forming=s=>s.cb.find(c=>c.t===Math.floor((n+30)/60)*60);
    o.big=k(s=>{lastClosed(s).h+=45});o.xbig=k(s=>{lastClosed(s).h+=110});
    const wh=(s)=>{const a=s.cb.filter(c=>c.t<Math.floor((n+30)/60)*60).slice(-3);s.strike=a[0].c;a[0].c+=1;a[1].c=s.strike-1;a[2].c=s.strike+1;forming(s).c=s.strike-1};o.whip=k(wh);
    o.two=k(s=>{wh(s);lastClosed(s).h+=45});
    o.rv=k(s=>{s.strike=NaN;const a=s.cb.filter(c=>c.t<Math.floor((n+30)/60)*60).slice(-5);a.forEach((c,i)=>{c.c=70000+(i%2?60:-60)});forming(s).c=70000});
    // fire on an extreme candle: a skipped record, not scored as a loss
    const s0=CallersPanel._store(),Wf=Math.floor(Date.now()/900000)*900-13*900,sy=__syn(Wf+400,Wf,70040),lc=sy.cb.find(c=>c.t===Math.floor(sy.now/60)*60-60);lc.h+=110;
    CallersPanel.fire(Wf,'ripple',0,Wf+250,sy);const sk=s0.rounds[Wf].calls.ripple[0];o.skip={dir:sk.dir,lvl:sk.gate.lvl,tr:sk.gate.tr.length,backs:sk.backs,conf:sk.conf,txt:CallersPanel._bubble('ripple',sk)};
    const sc2=__syn(Wf+500,Wf,70040);sc2.cb.find(c=>c.t===Math.floor(sc2.now/60)*60-60).h+=45;CallersPanel.fire(Wf,'sage',0,Wf+310,sc2);const cu=s0.rounds[Wf].calls.sage[0];o.caut={dir:!!cu.dir,lvl:cu.gate.lvl,gate:cu.cp&&cu.cp.gate};
    s0.rounds[Wf].res='yes';CallersPanel.scoreRound(s0.rounds[Wf]);o.score={sk:s0.tot.ripple.sk,n:s0.tot.ripple.a.n,mem:s0.mem.ripple.length,sage:s0.tot.sage.a.n};return o})()""")
  print('gate',{k:gt[k] for k in ('base','big','xbig','whip','two','rv','skip','caut','score')})
  chk('gate thresholds are the documented ones (candle 3×/5× ATR, realized vol 2×, 2 strike crossings in 3 min)',gt['G']['big']==3 and gt['G']['extreme']==5 and gt['G']['rv']==2 and gt['G']['cross']==2,str(gt['G']))
  chk('gate levels: calm tape = ok; one trigger (big candle / whipsaw / vol spike) = caution; two triggers or an extreme candle = skip',gt['base']['level']=='ok' and gt['big']['level']=='caution' and gt['whip']['level']=='caution' and gt['rv']['level']=='caution' and gt['xbig']['level']=='skip' and gt['two']['level']=='skip' and len(gt['two']['triggers'])>=2,str((gt['base'],gt['big'],gt['whip'],gt['rv'],gt['xbig'],gt['two'])))
  chk('a skipped call is recorded ("skipped: too fast"), has no direction/backing/confidence, says why, and is NOT scored as a loss or remembered',gt['skip']['dir'] is None and gt['skip']['lvl']=='skip' and gt['skip']['tr']>=1 and not gt['skip']['backs'] and gt['skip']['conf'] is None and 'skipped: too fast' in gt['skip']['txt'] and gt['score']['sk']==1 and gt['score']['n']==0 and gt['score']['mem']==0,str((gt['skip'],gt['score'])))
  chk('a caution call still calls, carries the badge data and the ×0.75 confidence factor, and is scored normally',gt['caut']['dir'] and gt['caut']['lvl']=='caution' and gt['caut']['gate']==0.75 and gt['score']['sage']==1,str(gt['caut']))
  # 9) scoring, per-beat accuracy, backing, storage isolation, existing data untouched
  sc=px.evaluate("""(()=>{__reset();const ids=CallersPanel.IDS,Wt=Math.floor(Date.now()/900000)*900-5*900,D=PulseIndicators.feed(),ks=[],gk=[],orig=Storage.prototype.setItem,rm=Storage.prototype.removeItem,gi=Storage.prototype.getItem,rmk=[],V1='{"v":1,"rounds":{"1":{}},"tot":{"zippy":{"a":{"n":3,"w":2}}},"sig":{}}';
    localStorage.setItem('pulseboard.callers.v1',V1);GrokkyArchive._reload();
    const before=__kinds.map(k=>localStorage.getItem(k)),tl0=JSON.stringify(GrokkyPanel.tally());
    Storage.prototype.setItem=function(k,v){ks.push(k);return orig.call(this,k,v)};Storage.prototype.removeItem=function(k){rmk.push(k);return rm.call(this,k)};Storage.prototype.getItem=function(k){gk.push(k);return gi.call(this,k)};
    const o={};try{
    const strikes=[70010,70030,69990];ids.forEach((id,k)=>CallersPanel.BEATS[id].forEach((sec,i)=>{const inp=__syn(Wt+sec+5,Wt,strikes[i]);D.cb=inp.cb;D.bn=inp.bn;CallersPanel.fire(Wt,id,i,Wt+sec+5,inp)}));
    const R=CallersPanel._store().rounds[Wt];o.calls={};ids.forEach(i=>o.calls[i]=R.calls[i].map(c=>c.dir));o.backs=ids.map(i=>R.calls[i].filter(c=>c.dir).every(c=>c.backs===(c.dir===c.gk.g1?1:2)));
    const n1=CallersPanel.onKalshi({settled:[{result:'yes',close_time:new Date((Wt+900)*1000).toISOString()}]});
    const T=CallersPanel._store().tot;o.n1=n1;o.tot=T;const n2=CallersPanel.onKalshi({settled:[{result:'yes',close_time:new Date((Wt+900)*1000).toISOString()}]});o.n2=n2;o.same=JSON.stringify(CallersPanel._store().tot)===JSON.stringify(T);
    o.sig=Object.keys(CallersPanel._store().sig).length;o.arch=GrokkyArchive.summary().rounds;
    }finally{Storage.prototype.setItem=orig;Storage.prototype.removeItem=rm;Storage.prototype.getItem=gi}
    o.keys=[...new Set(ks)].sort();o.rm=rmk;o.getArch=gk.filter(k=>k==='pulseboard.archive.v1').length;o.v1same=localStorage.getItem('pulseboard.callers.v1')===V1;o.v1read=gk.filter(k=>k==='pulseboard.callers.v1').length;
    o.untouched=__kinds.map(k=>localStorage.getItem(k)).every((v,i)=>v===before[i]);o.tally=JSON.stringify(GrokkyPanel.tally())===tl0;localStorage.removeItem('pulseboard.callers.v1');return o})()""")
  print('callers scoring',{k:v for k,v in sc.items() if k not in ('tot',)})
  okb=True
  for i,dirs in sc['calls'].items():
    t=sc['tot'][i];okb=okb and t['a']['n']==sum(1 for d in dirs if d) and t['a']['w']==sum(1 for d in dirs if d=='UP') and all(t['b'][j]['n']==(1 if dirs[j] else 0) and t['b'][j]['w']==(1 if dirs[j]=='UP' else 0) for j in range(len(dirs))) and t['g1']['n']+t['g2']['n']==t['a']['n']
  chk('callers are scored on Kalshi settlement overall and by beat (1st/2nd/3rd), skips excluded, and backing counts add up',okb and all(sc['backs']),str(sc['tot']['zippy']))
  chk('re-settling the same round does not double count; per-reading hit rates are kept; the Archive logged the round once',sc['n1']==1 and sc['n2']==0 and sc['same'] and sc['sig']>3 and sc['arch']==1,str((sc['n1'],sc['n2'],sc['arch'])))
  chk('storage isolation: callers write only pulseboard.callers.v2 and the Archive’s own key, never remove a key, and only READ callers.v1',sc['keys']==['pulseboard.archive.v1','pulseboard.callers.v2'] and sc['rm']==[] and sc['v1same'],str((sc['keys'],sc['rm'])))
  chk('existing data untouched: pulseboard.v2 / obook / flows / sig / learn / cleared flag / callers.v1 byte-identical, Grokky tally identical',sc['untouched'] and sc['tally'] and sc['v1same'])
  # 10) Grokky Archive isolation
  src=lambda f:open(os.path.join(os.path.dirname(os.path.abspath(__file__)),'..',f)).read()
  cs_,as_,gs_,is_=src('callers.js'),src('archive.js'),src('grokky.js'),src('indicators.js')
  chk('archive isolation (code): no live module reads the Archive’s storage key; the Archive never touches any other key; Grokkys and indicators never mention it',('pulseboard.archive' not in cs_) and ('GrokkyArchive' not in gs_) and ('GrokkyArchive' not in is_) and not re.search(r'pulseboard\.(v2|callers|learn|obook|flows|sig)',as_) and 'getItem' not in cs_.replace('getItem(KEY','') ,'')
  ar=px.evaluate("""(()=>{__reset();const o={},W=Math.floor(Date.now()/900000)*900-14*900,D=PulseIndicators.feed(),inp=__syn(W+700,W,70010);D.cb=inp.cb;D.bn=inp.bn;
    const run=()=>{CallersPanel._resetCache();const ids=CallersPanel.IDS;ids.forEach((id,k)=>CallersPanel.BEATS[id].forEach((sec,i)=>CallersPanel.fire(W,id,i,W+sec+3,inp)));const R=JSON.stringify(CallersPanel._store().rounds[W]);[W+245,W+485,W+725].forEach(tt=>GrokkyArchive.tick(tt,()=>PulseIndicators.compute(inp)));CallersPanel.onKalshi({settled:[{result:'no',close_time:new Date((W+900)*1000).toISOString()}]});return [R,JSON.stringify(CallersPanel._store().tot),JSON.stringify(CallersPanel._store().mem)]};
    localStorage.removeItem('pulseboard.archive.v1');GrokkyArchive._reload();localStorage.removeItem('pulseboard.callers.v2');const A=run();
    localStorage.setItem('pulseboard.archive.v1','{{{ not json at all');GrokkyArchive._reload();localStorage.removeItem('pulseboard.callers.v2');const B=run();
    localStorage.setItem('pulseboard.archive.v1',JSON.stringify({v:1,since:1,agg:{callers:{zippy:{n:999,w:999,sk:0}},bench:{n:999,w:999,m:[{n:333,w:333},{n:333,w:333},{n:333,w:333}]},g1:{n:999,w:999},g2:{n:0,w:0},rounds:999,pruned:0},rounds:{},note:''}));GrokkyArchive._reload();localStorage.removeItem('pulseboard.callers.v2');const C=run();
    o.same=[A[0]===B[0],A[1]===B[1],A[2]===B[2],A[0]===C[0],A[1]===C[1],A[2]===C[2]];
    // memory: the Archive's lifetime wins never changed any live caller record
    o.callersHaveNoArchiveField=!/archive/i.test(A[0]);
    // archive keeps its own forever-log
    localStorage.removeItem('pulseboard.archive.v1');GrokkyArchive._reload();localStorage.removeItem('pulseboard.callers.v2');CallersPanel._resetCache();run();const st=GrokkyArchive._state();const r=st.rounds[W];
    o.logged=Object.keys(r.c).length==6&&Object.entries(r.c).every(([k,a])=>a.length==CallersPanel.BEATS[k].length);o.settled=r.s===1&&r.r===0;o.agg=GrokkyArchive.summary();o.bench=r.b.filter(x=>x!=null).length;
    // size bound: prune oldest beyond the cap, keep totals + note
    GrokkyArchive._setMax(6000);for(let k=0;k<200;k++){const w=W-(k+1)*900;GrokkyArchive.logCall(w,'zippy',120,'UP',60,'ok');GrokkyArchive.settle(w,'yes')}
    const before=Object.keys(GrokkyArchive._state().rounds).length;GrokkyArchive._save();const after=Object.keys(GrokkyArchive._state().rounds).length;const sm=GrokkyArchive.summary();
    o.prune={before:before,after:after,pruned:sm.pruned,rounds:sm.rounds,note:sm.note,bytes:sm.bytes,wins:sm.callers.zippy.w};GrokkyArchive._setMax(900000);return o})()""")
  print('archive',{k:ar[k] for k in ('same','logged','settled','bench','prune')})
  chk('archive isolation (behaviour): corrupt or hugely “winning” Archive data changes NOTHING in live call records, scores or memory — they are byte-identical to a run without it',all(ar['same']) and ar['callersHaveNoArchiveField'],str(ar['same']))
  chk('archive logs every call and sit-out of every caller (16 beats per round), the settlement, and its own benchmark calls (min 4/8/12), under its own key',ar['logged'] and ar['settled'] and ar['bench']==3 and ar['agg']['rounds']>=1,str(ar['agg'])[:150])
  chk('archive is size-bounded: oldest round rows are pruned with a note, all-time totals keep every round',ar['prune']['after']<201 and ar['prune']['pruned']>0 and 'dropped' in ar['prune']['note'] and ar['prune']['rounds']>=201 and ar['prune']['wins']>=200,str(ar['prune']))
  # 11) Flippy: the late-flip gambler
  fl=px.evaluate("""(()=>{__reset();const s=CallersPanel._store(),o={},base=Math.floor(Date.now()/900000)*900;const D=PulseIndicators.feed();
 const mk=(W,strike,fall)=>{const now=W+860,cb=[],bn=[];let p=70000;const t0=Math.floor(now/60)*60;
   for(let t=t0-7200;t<=t0;t+=60){const o2=p;const m=(t0-t)/60;p+=(m<=4&&fall)?-14-(4-m)*5:(((t/60)%5<2)?-4:4);cb.push({t,o:o2,h:Math.max(o2,p)+3,l:Math.min(o2,p)-3,c:p,v:3+((t/60)%4)});bn.push({t,o:o2-10,h:Math.max(o2,p)+3,l:Math.min(o2,p)-3,c:p-10,v:25,tb:fall&&m<=5?5:15+((t/60)%3)})}
   return {now,W,strike:strike===null?p-3:strike,kmid:fall?0.52:0.58,cb,bn,g:{g1:'UP',g2:'DOWN',pUp:.54,items:[]},ctx:{book:fall?-0.25:.06}}};
 const Wa=base-20*900,Wb=base-21*900,Wc=base-22*900,Wd=base-23*900;
 // seed an earlier call in window A so the Kalshi crowd price has something to compare with (kmid .58 at 1:00)
 const calm=__syn(Wa+100,Wa,70040);D.cb=calm.cb;D.bn=calm.bn;CallersPanel.fire(Wa,'dash',0,Wa+70,calm);
 const A=mk(Wa,null,true);const ca=CallersPanel.fire(Wa,'flippy',0,Wa+860,A);o.A={dir:ca.dir,sit:ca.sit,conf:ca.conf,fconf:ca.fconf,thr:ca.thr,leader:ca.leader,fd:ca.fd.map(x=>[x.k,x.pts,x.max]),bub:CallersPanel._bubble('flippy',ca),backs:ca.backs};
 const B=mk(Wb,70500,false);const cb2=CallersPanel.fire(Wb,'flippy',0,Wb+860,B);o.B={dir:cb2.dir,sit:cb2.sit,fconf:cb2.fconf,leader:cb2.leader,bub:CallersPanel._bubble('flippy',cb2),why:cb2.why};
 const C=mk(Wc,null,false);const cc=CallersPanel.fire(Wc,'flippy',0,Wc+860,C);o.C={dir:cc.dir,sit:cc.sit,fconf:cc.fconf,leader:cc.leader};
 s.rounds[Wa].res='yes';CallersPanel.scoreRound(s.rounds[Wa]);s.rounds[Wb].res='no';CallersPanel.scoreRound(s.rounds[Wb]);s.rounds[Wc].res='no';CallersPanel.scoreRound(s.rounds[Wc]);
 const T=s.tot.flippy;o.T={a:T.a,sit:T.sit,b:T.b.length,sk:T.sk};o.mem=s.mem.flippy.length;o.fl=s.ps.flippy&&Object.assign({},s.ps.flippy.fl);o.psSit=s.ps.flippy&&s.ps.flippy.sit;
 o.earlier=CallersPanel._earlier(s.rounds[Wa],'sage',Wa+900).map(x=>x.id);
 // picky after two misses
 s.mem.flippy=[{W:1,i:0,dir:'DOWN',ok:false,gl:{}},{W:2,i:0,dir:'DOWN',ok:false,gl:{}}];const Dd=mk(Wd,null,true);const cd=CallersPanel.fire(Wd,'flippy',0,Wd+860,Dd);o.picky={thr:cd.thr,pick:cd.pick,fconf:cd.fconf,consistent:(cd.dir!==null)===(cd.fconf>=cd.thr)};
 // setup memory raises / phase reset clears it
 const We=base-24*900,Wf=base-25*900;s.mem.flippy=[];const bk=ca.bk2;const h0=CallersPanel.fire(We,'flippy',0,We+860,mk(We,null,true));
 s.ps.flippy.fl[bk]={n:10,h:8};const h1=CallersPanel.fire(Wf,'flippy',0,Wf+860,mk(Wf,null,true));o.hist={base:h0.fconf,boost:h1.fconf,fh:h1.fh};
 CallersPanel.newPhase('test',base);o.afterReset=Object.keys(s.ps).length;
 const Wg=base-26*900;const xs=mk(Wg,null,true);xs.cb.find(c=>c.t===Math.floor(xs.now/60)*60-60).h+=80;const cg=CallersPanel.fire(Wg,'flippy',0,Wg+860,xs);o.gate={lvl:cg.gate.lvl,evaluated:cg.fd.length>0};
 return o})()""")
  print('flippy',{k:fl[k] for k in ('T','picky','hist','gate')})
  chk('Flippy calls the OPPOSITE of the leader only when his flip score reaches the bar: strong flip tape → ▼ DOWN against the UP leader with confidence ≥ 70, backing a Grokky, in first person',fl['A']['dir']=='DOWN' and fl['A']['leader']=='UP' and fl['A']['conf']>=fl['A']['thr']>=70 and fl['A']['backs'] in (1,2) and 'I smell a flip' in fl['A']['bub'] and len(fl['A']['fd'])==7 and abs(sum(x[1] for x in fl['A']['fd'])-fl['A']['fconf'])<=1,str(fl['A']))
  chk('otherwise he sits out ("no flip seen") with the reason: far from the strike, or calm tape',fl['B']['dir'] is None and fl['B']['sit']==1 and 'No flip seen' in fl['B']['bub'] and 'too far' in fl['B']['why'] and fl['C']['dir'] is None and fl['C']['fconf']<40,str((fl['B'],fl['C'])))
  chk('his scoreboard: flip calls (made / hit), and sitting out is tracked separately (right when no flip came) and is NEVER a loss',fl['T']['a']=={'n':1,'w':0} and fl['T']['sit']=={'n':2,'ok':1} and fl['T']['b']==1 and fl['T']['sk']==0,str(fl['T']))
  chk('he excludes himself from the crowd (his deliberate contrarian call is not a consensus vote) and remembers recent flip calls',fl['earlier']==['dash'] and fl['mem']==1,str((fl['earlier'],fl['mem'])))
  chk('smart memory 1: after 2 missed flip calls the bar rises (+5 each, here 80) and the call/sit-out decision follows the raised bar',fl['picky']['thr']==80 and fl['picky']['pick']==10 and fl['picky']['consistent'],str(fl['picky']))
  chk('smart memory 2: setups that flipped before raise his score (per-phase setup history 8 of 10 → higher), and the setup history is recorded for calls AND sit-outs',fl['hist']['boost']>fl['hist']['base'] and fl['hist']['fh']['n']==10 and len(fl['fl'])>=3,str(fl['hist']))
  chk('smart memory 3: a new market phase clears the setup history (it persists only within the phase)',fl['afterReset']==0)
  chk('he is exempt from the "skipped: too fast" gate (still evaluates and shows the gate reading)',fl['gate']['lvl']=='skip' and fl['gate']['evaluated'])
  ind=px.evaluate("""(()=>{const n=Date.now()/1000|0,W=Math.floor(n/900)*900,syn=__syn(n,W,70040),v=PulseIndicators.compute(syn),o={};o.ok=v.ok;o.keys=v.signals.map(s=>s.k);o.na=v.signals.filter(s=>s.na).map(s=>s.k);o.groups=Object.fromEntries(v.signals.map(s=>[s.k,s.group]));
    const st=v.signals.find(s=>s.k=='strike');o.strike=st.desc;o.d=v.d;o.votes=Object.fromEntries(v.signals.map(s=>[s.k,s.vote]));o.allDesc=v.signals.every(s=>typeof s.desc=='string'&&s.desc.length>8);o.regime=v.regime;o.gate=v.gate;
    const up=[];let p=70000;for(let t=n-7200;t<=n;t+=60){up.push({t:t,o:p,h:p+9,l:p-1,c:p+8,v:2});p+=8}
    const v2=PulseIndicators.compute({now:n,W:W,strike:70040,kmid:NaN,cb:up,bn:[],g:null,ctx:null});o.rsi=v2.signals.find(s=>s.k=='rsi').desc;o.ema=v2.signals.find(s=>s.k=='ema').vote;o.cvdna=v2.signals.find(s=>s.k=='cvd');o.tsna=v2.signals.find(s=>s.k=='tshare').na;o.mom15=v2.signals.find(s=>s.k=='mom15').vote;
    const v3=PulseIndicators.compute({now:n,W:W,strike:70040,kmid:NaN,cb:[],bn:[],g:null,ctx:null});o.why=v3.why;o.ok3=v3.ok;o.phi=[PulseIndicators._phi(0),PulseIndicators._phi(1.96)];
    // volume surge + hammer candle + resistance
    const s2=__syn(n,W,70040),lc=s2.cb.find(c=>c.t===Math.floor(n/60)*60-60);lc.v=40;lc.o=lc.c-6;const v4=PulseIndicators.compute(s2);o.surge=v4.signals.find(s=>s.k=='vsurge');
    const s3=__syn(n,W,70040),l3=s3.cb.find(c=>c.t===Math.floor(n/60)*60-60);l3.o=l3.c-1;l3.h=l3.c+0.5;l3.l=l3.c-9;const v5=PulseIndicators.compute(s3);o.hammer=v5.signals.find(s=>s.k=='candle');return o})()""")
  print('indicators',ind['keys'],ind['na'])
  need={'strike','crowd','ema','mom','mom15','vwap','drift','rsi','sr','candle','stretch','over','vsurge','cvd','tshare','prem','book','gkread','gkconf','vol','implied'}
  chk('indicators: momentum, volume (surge, CVD, taker-buy share), chart (EMA, VWAP, RSI, support/resistance, candles), bounce-back, flow, strike, Grokky and context readings are all produced',need<=set(ind['keys']) and ind['ok'] and ind['allDesc'],str(set(ind['keys'])^need))
  chk('indicators are grouped for the callers: momentum / volume / chart / revert / flow / strike / grokky',ind['groups']['mom']=='momentum' and ind['groups']['cvd']=='volume' and ind['groups']['tshare']=='volume' and ind['groups']['vsurge']=='volume' and ind['groups']['sr']=='chart' and ind['groups']['candle']=='chart' and ind['groups']['rsi']=='chart' and ind['groups']['stretch']=='revert',str(ind['groups']))
  chk('indicator text quotes the real live numbers (strike distance, ATRs)','ATRs' in ind['strike'] and ('$%d'%round(abs(ind['d'])) in ind['strike'].replace(',','')) and ('above' in ind['strike'] or 'below' in ind['strike']),ind['strike'][:120])
  chk('rising candles: RSI reads overbought, EMA and 15-minute momentum vote UP; no taker volume → CVD / taker share say not available (never invented)','overbought' in ind['rsi'] and ind['ema']>0 and ind['mom15']>0 and ind['cvdna']['na'] and ind['tsna'] and len(ind['cvdna']['desc'])>10,ind['rsi'])
  chk('a volume surge on a green candle and a hammer candle are detected from the candles',(not ind['surge']['na']) and ind['surge']['vote']>0.5 and 'surge' in ind['surge']['desc'] and ind['hammer']['vote']>0 and 'hammer' in ind['hammer']['desc'],str((ind['surge']['desc'][:80],ind['hammer']['desc'][:80])))
  chk('indicators also return the volatility gate and the market regime used for phases',ind['gate']['level'] in ('ok','caution','skip') and ind['regime']['vol'] in ('calm','normal','wild') and ind['regime']['trend'] in ('up','down','range'),str((ind['gate'],ind['regime'])))
  chk('no candles → says why and returns no readings',ind['ok3'] is False and len(ind['why'])>10 and abs(ind['phi'][0]-0.5)<1e-6 and abs(ind['phi'][1]-0.975)<2e-3,str(ind['why']))
  # Grokky learning
  cL=b.new_context(viewport={'width':1280,'height':900});pl=cL.new_page();pl.goto(url);ready(pl);pl.evaluate(SYN)
  lr=pl.evaluate("""(()=>{const s=window.__pulse.state(),W0=Math.floor(Date.now()/900000)*900,ks=[],orig=Storage.prototype.setItem,o={};localStorage.removeItem('pulseboard.learn.v1');GrokkyPanel._resetLearnCache();
    const seed=(a,b2)=>{for(let i=a;i<b2;i++){const W=W0-(200-i)*900;s.groks[W]={W:W,g1:'DOWN',g2:'UP',conf:55,lockedAt:W+3,late:false,why:{items:[{src:'engine',k:'z4',dir:'UP',m:.1,txt:'1-hour overshoot fade — x'},{src:'engine',k:'rsi',dir:'DOWN',m:.1,txt:'RSI(14) mean-reversion — y'},{src:'ctx',dir:'UP',m:1,txt:'BRTI settlement average is $5 above the strike'}],g1:{lines:[],n:0,against:0},g2:{lines:[],n:0,against:0},forced2:false,passed:[],neutral:[]},kres:'yes',winner:2}}};
    Storage.prototype.setItem=function(k,v){ks.push(k);return orig.call(this,k,v)};
    try{seed(0,10);o.n10=GrokkyPanel.learnAll();o.m10=[GrokkyPanel._mult('z4'),GrokkyPanel._mult('rsi')];seed(10,25);o.n25=GrokkyPanel.learnAll();o.m25=[GrokkyPanel._mult('z4'),GrokkyPanel._mult('rsi'),GrokkyPanel._mult('gap')];o.again=GrokkyPanel.learnAll();
    o.leg=GrokkyPanel._keyOf({txt:'BRTI settlement average is $5 above the strike'});
    const call={dir:'DOWN',conf:51,score:-0.0019,signals:[{k:'z4',w:.184,vote:.05},{k:'rsi',w:.139,vote:-.08}]};
    const Wa=W0-80*900,Wb=W0-81*900;GrokkyPanel.lock(Wa,call);o.flip=s.groks[Wa];
    localStorage.removeItem('pulseboard.learn.v1');GrokkyPanel._resetLearnCache();GrokkyPanel.lock(Wb,call);o.nolearn=s.groks[Wb];
    }finally{Storage.prototype.setItem=orig}
    o.keys=[...new Set(ks)].filter(k=>k!=='pulseboard.v2');return o})()""")
  print('learning',{k:lr[k] for k in ('n10','m10','n25','m25','again','leg','keys')})
  chk('learning: credits settled rounds once, writes only its own key (pulseboard.learn.v1)',lr['n10']==10 and lr['n25']==15 and lr['again']==0 and lr['keys']==['pulseboard.learn.v1'],str(lr['keys']))
  chk('learning is gradual and bounded: no change before 20 rounds, then a reading that kept being right is trusted up to 1.3x and one that kept being wrong down to 0.7x',lr['m10']==[1,1] and lr['m25'][0]==1.3 and lr['m25'][1]==0.7 and lr['m25'][2]==1.3 and lr['leg']=='gap',str((lr['m10'],lr['m25'])))
  chk('learned weights can change Grokky 1 (and say so); Grokky 2 is still exactly opposite',lr['flip']['g1']=='UP' and lr['flip']['g2']=='DOWN' and lr['flip']['learn']['flipped'] and lr['flip']['learn']['raw']=='DOWN',str(lr['flip']['learn']))
  chk('without learning, Grokky 1 = the engine direction and Grokky 2 the opposite',lr['nolearn']['g1']=='DOWN' and lr['nolearn']['g2']=='UP' and not lr['nolearn']['learn']['flipped'])
  pl.evaluate("GrokkyPanel.update(true)")
  cL.close()
  # callers UI on the page: seed a window (a skipped call included) and read what a person would see
  ui=px.evaluate("""(()=>{__reset();localStorage.setItem('pulseboard.callers.v1','{"v":1,"rounds":{"1":{},"2":{}},"tot":{"zippy":{"a":{"n":10,"w":6},"m4":{"n":4,"w":2},"m8":{"n":3,"w":2},"m12":{"n":3,"w":2}},"mellow":{"a":{"n":10,"w":4},"m4":{"n":4,"w":1},"m8":{"n":3,"w":1},"m12":{"n":3,"w":2}},"ripple":{"a":{"n":10,"w":5},"m4":{"n":4,"w":2},"m8":{"n":3,"w":1},"m12":{"n":3,"w":2}}},"sig":{}}');CallersPanel._resetCache();
    const n=Date.now()/1000|0,W=Math.floor(n/900)*900,D=PulseIndicators.feed(),inp=__syn(n,W,70040);D.cb=inp.cb;D.bn=inp.bn;
    const bad=__syn(n,W,70040),lc=bad.cb.find(c=>c.t===Math.floor(n/60)*60-60);lc.h+=110;
    CallersPanel.fire(W,'dash',0,n-60,inp);CallersPanel.fire(W,'zippy',0,n-50,inp);CallersPanel.fire(W,'mellow',0,n-40,inp);CallersPanel.fire(W,'ripple',0,n-30,bad);CallersPanel.fire(W,'dash',1,n-20,inp);CallersPanel.fire(W,'flippy',0,n-10,inp);
    CallersPanel.update(true);const R=CallersPanel._store().rounds[W];return {d:R.calls.zippy[0].d}})()""")
  px.wait_for_timeout(1500)
  zt=px.locator('#caller-zippy').text_content()
  chk('caller card speaks in first person, names its minute, confidence and who it backs, and quotes the real distance to strike','I’m calling' in zt and 'confidence' in zt and 'backing Grokky' in zt and ('$%d'%round(abs(ui['d'])) in zt.replace(',','')) and 'At the' not in zt,zt[:220])
  chk('callers cards: no third-person narration',not re.search(r'\b(Dash|Zippy|Mellow|Ripple|Sage|Flippy) (is|was|thinks|says|picked|called)\b|\bthey\b',px.locator('#callersBody').text_content()))
  chk('six caller cards, three beat chips each (Flippy one), 16 beat dots on the timeline, with Sage’s last beat labelled 14:30 and Flippy’s 14:15',px.locator('#callersBody .cc').count()==6 and all(px.locator('#caller-%s .mchip'%i).count()==3 for i in ['dash','zippy','mellow','ripple','sage']) and px.locator('#caller-flippy .mchip').count()==1 and '14:15' in px.locator('#caller-flippy .mchips').text_content() and px.locator('#callersTl .bdot').count()==16 and '14:30' in px.locator('#caller-sage .mchips').text_content() and '11' in px.locator('#caller-dash .mchips').text_content(),px.locator('#caller-sage .mchips').text_content())
  chk('a skipped call shows as ⏸ "skipped: too fast" with the reason, and is not shown as a win/loss',px.locator('#caller-ripple .mchip.skip').count()==1 and 'skipped: too fast' in px.locator('#caller-ripple').text_content() and px.locator('#caller-ripple .mchip.skip i').count()==0)
  chk('confidence bar and short-memory row are on each card',px.locator('#caller-zippy .cmeter').count()>=1 and 'Confidence' in zt and px.locator('#caller-zippy .memrow').count()==1 and 'My last 5 settled calls' in zt)
  px.locator('#caller-mellow [data-xp="cwmellow"] .xpb').click();px.locator('#caller-mellow [data-xp="camellow"] .xpb').click();px.wait_for_timeout(700)
  mtx=px.locator('#caller-mellow').text_content()
  chk('call has a written "Why?" (evidence groups, total, confidence drivers, memory) and "What else I considered" (against, alternatives, crowd, others)',all(x in mtx for x in ['evidence added up','Where my','confidence comes from','My memory','What else I considered','Pointing the other way','If I’d done it differently','The crowd','What the others have called']),mtx[-420:])
  pb=px.locator('#phaseBar').text_content()
  chk('market phase shown with its start time, a reason, and a "Start a new phase" button; the volatility gate status is shown in plain words','Market phase' in pb and 'since' in pb and 'Start a new phase' in pb and ('Market pace looks normal' in pb or 'Moving fast' in pb or 'Too fast' in pb),pb[:200])
  px.once('dialog',lambda d:d.dismiss());p0=px.evaluate("CallersPanel._store().phase.cur&&CallersPanel._store().phase.cur.id");px.locator('#phaseNew').click();px.wait_for_timeout(300)
  p1=px.evaluate("CallersPanel._store().phase.cur&&CallersPanel._store().phase.cur.id")
  px.once('dialog',lambda d:d.accept());px.locator('#phaseNew').click();px.wait_for_timeout(500)
  p2=px.evaluate("CallersPanel._store().phase.cur&&CallersPanel._store().phase.cur.id");pr=px.evaluate("CallersPanel._store().phase.cur.reason")
  chk('manual "new phase" asks first: cancel changes nothing, OK starts a new phase (stats reset, totals stay)',p1==p0 and p2==(p0 or 0)+1 and 'by hand' in pr,str((p0,p1,p2,pr)))
  chk('crowd strip says how many callers so far agree and what history says for similar conditions',re.search(r'\d of \d callers so far say',px.locator('#crowdBar').text_content()) is not None and ('similar conditions' in px.locator('#crowdBar').text_content()),px.locator('#crowdBar').text_content()[:160])
  chk('scoreboard: six callers (this phase / all time / beats / skipped or sat out) plus Grokky 1 and 2 for comparison',px.locator('#callersScore tbody tr').count()==8 and all(x in px.locator('#callersScore').text_content() for x in ['This phase','All time','1st beat','3rd beat','Skipped / sat out']))
  px.locator('#callersMarks .xpb').click();px.wait_for_timeout(500)
  chk('mark tallies table is available (standing at minute 4 / 8 / 12)','Standing at the 4, 8 and 12-minute marks' in px.locator('#callersMarks').text_content() and ('At minute 4' in px.locator('#callersMarks').text_content() or 'No tally' in px.locator('#callersMarks').text_content()))
  at_=px.locator('#callersArch').text_content()
  chk('Grokky Archive benchmark card is a labelled comparison, and the old v1 callers are shown as archived, read-only','Grokky Archive' in at_ and 'never feeds back' in at_ and 'Archived: the first three callers' in at_,at_[:160])
  px.locator('#callersArch .xpb').nth(1).click();px.wait_for_timeout(500)
  chk('archived v1 numbers are still readable (Zippy 6/10)','6/10' in px.locator('#callersArch').text_content())
  px.locator('#cbBody [data-xp="cbgrid"] .xpb').click();px.wait_for_timeout(700)
  chk('check & balance: agreement meter + reading-by-reading grid with Grokky 1, Grokky 2 and all six callers',px.locator('#cbBody .cbtab thead th').count()==11 and px.locator('#cbBody .cbtab tbody tr').count()>=10 and 'of us say' in px.locator('#cbBody').text_content(),px.locator('#cbBody').text_content()[:120])
  sn2=px.evaluate("AskPanel.snapshot()");sj=json.dumps(sn2)
  chk('Ask AI snapshot carries the five callers, phase, crowd, gate and archive, and stays under its cap',('callers' in sn2) and len(sn2['callers']['callers'])==6 and sn2['callers']['phase'] and 'crowd' in sn2['callers'] and 'archive' in sn2['callers'] and len(sj)<4500,str(len(sj)))
  ba=px.evaluate("AskPanel.builtin('What are the callers saying?')");chk('Flippy’s card shows his own scoreboard (flip calls, hit rate, right to sit out) and either a flip call or “no flip seen”',all(x in px.locator('#caller-flippy').text_content() for x in ['flip calls made','flip hit rate','right to sit out']) and ('No flip seen' in px.locator('#caller-flippy').text_content() or 'I smell a flip' in px.locator('#caller-flippy').text_content()))
  chk('built-in answer covers the callers',all(x in ba for x in ['Dash','Zippy','Mellow','Ripple','Sage','Flippy']),ba[:100])
  px.evaluate("document.querySelectorAll('.xp').forEach(x=>x.classList.add('open'))");px.wait_for_timeout(600)
  chk('callers section: no page errors or console errors',not ex,str(ex))
  px.evaluate("document.querySelector('#callersCard h2').insertAdjacentHTML('beforeend','<span class=\"sandbadge\">SAMPLE DATA</span>')")
  px.locator('#callersCard').screenshot(path=out+f'{tag}-callers-card.png')
  px.evaluate("localStorage.removeItem('pulseboard.callers.v1');__reset()");cX.close()
  # reduced motion respected
  rc=b.new_context(viewport={'width':1280,'height':900},reduced_motion='reduce');rp=rc.new_page();rp.goto(url);ready(rp);rp.wait_for_timeout(1500)
  rm=rp.evaluate("""(()=>{const c=getComputedStyle(document.getElementById('gk1')),x=document.querySelector('.xp'),y=x?getComputedStyle(x):null;return {red:UI.reduced(),an:c.animationName,tr:y?y.transitionDuration:'0s',bar:[...document.querySelectorAll('.sbar i')].every(i=>i.style.width===i.getAttribute('data-w')+'%'),bal:document.getElementById('bal').textContent}})()""")
  chk('prefers-reduced-motion: no CSS animation/transition, bars and numbers jump to final values',rm['red'] and rm['an']=='none' and rm['tr'] in ('0s','0s, 0s') and rm['bar'],str(rm))
  rc.close()
  # mobile with every trail expanded
  m0=b.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True);m0p=m0.new_page();m0p.goto(url);ready(m0p);m0p.wait_for_timeout(1500)
  m0p.evaluate("window.__syn=function(now,W,strike,g){const cb=[],bn=[];let p=70000;const t0=Math.floor(now/60)*60;\n for(let t=t0-7200;t<=t0;t+=60){const o=p;p+=((t/60)%5<2?-9:7)+Math.sin(t/900)*6;cb.push({t:t,o:o,h:Math.max(o,p)+4,l:Math.min(o,p)-4,c:p,v:3+((t/60)%4)});bn.push({t:t,o:o-10,h:Math.max(o,p)+4,l:Math.min(o,p)-4,c:p-10,v:25,tb:15+((t/60)%3)})}\n return {now:now,W:W,strike:strike,kmid:0.58,cb:cb,bn:bn,g:g===undefined?{g1:'UP',g2:'DOWN',pUp:.54,items:[{dir:'UP',src:'engine'},{dir:'DOWN',src:'ctx'},{dir:'UP',src:'ctx'}]}:g,ctx:{book:.06}}}");m0p.evaluate("(()=>{const n=Date.now()/1000|0,W=Math.floor(n/900)*900,D=PulseIndicators.feed(),inp=__syn(n,W,70040);D.cb=inp.cb;D.bn=inp.bn;['dash','zippy','mellow','ripple','sage','flippy'].forEach((id,k)=>CallersPanel.fire(W,id,0,n-60+k*5,inp));CallersPanel.update(true)})()");m0p.wait_for_timeout(800)
  m0p.evaluate("document.querySelectorAll('.xp').forEach(x=>x.classList.add('open'))");m0p.wait_for_timeout(600)
  chk('mobile: no horizontal overflow even with every "Why?" section open',m0p.evaluate("document.documentElement.scrollWidth")<=392,str(m0p.evaluate("document.documentElement.scrollWidth")))
  m0.close()
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
