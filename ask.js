/* Ask AI — a small Bitcoin Q&A panel. INFORMATION ONLY: it cannot place bets, orders or trades, and its answers are not financial advice.
   Two modes, always labelled on every answer:
     • AI mode  — only when window.ASK_AI_URL points at the separate "pulse-ask-ai" Cloudflare Worker (Workers AI, no API key anywhere in this page). The page sends the question,
                  the last few chat turns and a compact JSON snapshot of the board (price, window, picks, flows…) — nothing else, no account data. The reply streams back.
     • Built-in — a fixed Bitcoin/Kalshi FAQ plus answers assembled from the live board data. Used when no AI backend is configured or the Worker is unreachable / over its daily cap.
   Left empty by default: nothing contacts any AI service until ASK_AI_URL is set (see tools/ask-ai-worker/DEPLOY.md). */
(function(){
'use strict';
var Q=900,MAXQ=600,H=[],busy=false,lastAt=0,left=null,cfgNote='';
function $(i){return document.getElementById(i)}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function nowS(){return Math.floor(Date.now()/1000)}
function num(x){var v=parseFloat(x);return isFinite(v)?v:NaN}
function usd(x,d){return isFinite(x)?'$'+x.toLocaleString('en-US',{minimumFractionDigits:d==null?0:d,maximumFractionDigits:d==null?0:d}):'—'}
function fu(x){x=Math.abs(x);return x>=1e6?'$'+(x/1e6).toFixed(2)+'M':x>=1e3?'$'+Math.round(x/1e3)+'k':'$'+Math.round(x)}
function hhmm(t){return new Date(t*1000).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}
function mmss(s){s=Math.max(0,Math.round(s));return Math.floor(s/60)+':'+('0'+(s%60)).slice(-2)}
function cfgUrl(){
  var u=window.ASK_AI_URL||'';
  try{var q=new URLSearchParams(location.search).get('askurl');if(q&&/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(q))u=q}catch(e){}   // local testing only; a public link can't redirect your question elsewhere
  return /^https:\/\/[a-z0-9.-]+\.workers\.dev\/ask$/.test(u)||/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/.*/.test(u)?u:'';
}

/* ================= compact live snapshot (this is the only board data sent to the AI) ================= */
function snapshot(){
  var g=window.__pulseNow||{},now=nowS(),W=Math.floor(now/Q)*Q,o={asof:new Date().toISOString(),window:{start:new Date(W*1000).toISOString(),secs_left:W+Q-now}};
  if(isFinite(g.med))o.btc_consensus_usd=Math.round(g.med*100)/100;
  if(isFinite(g.med)&&isFinite(g.winOpen))o.change_since_window_open_usd=Math.round((g.med-g.winOpen)*100)/100;
  var c=window.ChartPanel&&ChartPanel.curWindow&&ChartPanel.curWindow();if(c&&isFinite(c.strike)){o.window.strike_usd=c.strike;o.window.strike_source=c.src}
  var kp=window.KalshiPanel,l=kp&&kp.last&&kp.last(),m=l&&l.current;
  if(m){var b=num(m.yes_bid_dollars),a=num(m.yes_ask_dollars),p=num(m.last_price_dollars),mid=(b>0&&a>0&&a<=1)?(b+a)/2:p;if(isFinite(mid)&&mid>0)o.window.kalshi_up_price_cents=Math.round(mid*100)}
  var cx=window.ContextPanel&&ContextPanel.snapshot&&ContextPanel.snapshot(W);
  if(cx){if(cx.gap)o.window.brti_avg_minus_strike_usd=Math.round(cx.gap.gap*100)/100;if(cx.book)o.kalshi_orderbook_imbalance=Math.round(cx.book.imb*100)/100;
    if(cx.funding)o.okx_funding_pct_per_8h=cx.funding.rate;if(cx.fng)o.fear_greed={v:cx.fng.v,label:cx.fng.cls};if(cx.liq)o.okx_liquidations_60m_usd={longs:Math.round(cx.liq.L),shorts:Math.round(cx.liq.S)};
    if(cx.flow)o.large_exchange_trades_15m_usd={taker_buys:Math.round(cx.flow.buy),taker_sells:Math.round(cx.flow.sell),watched_secs:Math.round(cx.flow.cover)};if(cx.sit)o.high_impact_event_window=cx.sit}
  var call=g.call;if(call)o.engine_v2={direction:call.dir,own_probability_pct:call.conf,no_edge:!!call.noedge,top_signals:(call.signals||[]).filter(function(s){return Math.abs(s.w*s.vote)>=.003}).sort(function(x,y){return Math.abs(y.w*y.vote)-Math.abs(x.w*x.vote)}).slice(0,4).map(function(s){return (s.name+': '+s.desc).slice(0,140)})};
  var gp=window.GrokkyPanel,G=(window.__pulse&&window.__pulse.state&&window.__pulse.state().groks)||{},r=G[W];
  if(r){o.grokky_this_window={grokky1:r.g1,grokky2:r.g2,locked_at:new Date(r.lockedAt*1000).toISOString(),grokky1_reasons:r.why?r.why.g1.lines.slice(0,3).map(function(x){return x.slice(0,170)}):'not frozen yet',grokky2_reasons:r.why?(r.why.forced2?['forced opposite pick, nothing points that way']:r.why.g2.lines.slice(0,3).map(function(x){return x.slice(0,170)})):'not frozen yet'}}
  if(gp){var t=gp.tally();o.scoreboard={rounds_scored:t.n,grokky1_correct:t.w1,grokky2_correct:t.w2,grokky1_streak:t.cur1,grokky2_streak:t.cur2,last5:t.scored.slice(-5).map(function(x){return {window:hhmm(x.W),winner:'Grokky '+x.winner,kalshi:x.kres}})};
    var ls=t.scored[t.scored.length-1];if(ls&&isFinite(ls.kexp)&&isFinite(ls.kstrike))o.last_settled_round={window:hhmm(ls.W),winner:'Grokky '+ls.winner,loser:'Grokky '+(ls.winner===1?2:1),settled_at_usd:ls.kexp,strike_usd:ls.kstrike,move_usd:Math.round((ls.kexp-ls.kstrike)*100)/100}}
  var rd=window.ChartPanel&&ChartPanel.reading&&ChartPanel.reading();if(rd)o.chart_last_10min={move_usd:Math.round(rd.move),size_vs_typical_10min_move:Math.round(rd.z*10)/10};
  var ty=window.ChartPanel&&ChartPanel.typical15&&ChartPanel.typical15();if(ty)o.typical_15min_move_usd=Math.round(ty.usd);
  o.board_notes=['Grokky 1 = engine side, Grokky 2 = opposite side; paper picks only','backtests: no reliable 15-minute edge from news, whale transfers, funding, OI or order-book imbalance'];
  return o;
}

/* ================= built-in answers ================= */
var FAQ=[
 [/halving|halve/,'<b>Halving.</b> Roughly every 210,000 blocks (about four years) the block reward miners receive is cut in half. It was 50 BTC at the start, and after the April 2024 halving it is 3.125 BTC per block. The next halving is expected around 2028. It slows how fast new bitcoin is created; it does not guarantee any price move.'],
 [/21 million|supply|max(imum)? (coins|bitcoin)|how many (bitcoin|btc)/,'<b>Supply.</b> Bitcoin’s protocol caps the supply at 21 million BTC. New coins come only as block rewards, which keep halving, so the last coins are expected around the year 2140. Some coins are lost forever, so the usable supply is lower than what has been issued.'],
 [/mining|miner|proof.of.work|hash ?rate/,'<b>Mining.</b> Miners bundle transactions into blocks and compete to find a valid hash (proof of work). The winner earns the block reward plus fees. Difficulty adjusts about every two weeks so blocks arrive roughly every 10 minutes no matter how much computing power joins or leaves.'],
 [/satoshi|sats\b|smallest unit/,'<b>Satoshis.</b> 1 BTC = 100,000,000 satoshis (sats). Bitcoin’s pseudonymous creator, Satoshi Nakamoto, published the white paper in 2008; the first block was mined on 3 January 2009.'],
 [/mempool|fees?\b|unconfirmed/,'<b>Mempool and fees.</b> Transactions wait in the mempool until a miner includes them in a block. Fees are bidding for limited block space, so they rise when many people transact. The board’s whale box lists large <i>unconfirmed</i> transfers from the mempool; their amounts include change sent back to the sender.'],
 [/wallet|seed phrase|private key|cold storage|self.custody|custody/,'<b>Keys and wallets.</b> Whoever controls the private key (usually backed up as a seed phrase) controls the coins. Exchanges hold keys for you; a self-custody wallet means you do. Never share a seed phrase with anyone or any website, and keep an offline backup. Nothing on this page asks for one.'],
 [/\betf\b|etfs/,'<b>Spot Bitcoin ETFs.</b> US-listed spot Bitcoin ETFs began trading in January 2024. They let people hold bitcoin exposure in a normal brokerage account. Fund flows get a lot of attention, but this board has not tested them as a 15-minute signal.'],
 [/lightning/,'<b>Lightning.</b> A second layer on top of Bitcoin for fast, cheap payments through payment channels, settling to the main chain only when channels open or close.'],
 [/what is bitcoin|^bitcoin\?$|explain bitcoin/,'<b>Bitcoin.</b> A decentralized digital currency that runs on a public ledger (the blockchain) maintained by thousands of computers. It has a fixed supply of 21 million coins, no central issuer, and transactions are confirmed by proof-of-work mining.'],
 [/volatil/,'<b>Volatility.</b> Bitcoin’s price swings are large compared with most assets. The “Volatility regime” box on this page shows how wide recent moves are; wide regimes make the 15-minute outcome even harder to guess.'],
 [/backtest|\bedge\b|accura|win rate|hit rate|does it work/,'<b>How well does the engine work?</b> Honestly: barely. On held-out data v2 hit about 51.8% (a coin flip is 50%). Later tests found news, large transfers, funding, open interest and order-book imbalance did <i>not</i> predict 15-minute moves beyond Kalshi’s own price, and a delayed-call test found no edge after price. Expect long losing streaks.'],
 [/no edge/,'<b>“No edge” rounds.</b> The engine’s signals nearly cancel out, so its call is close to a coin flip. They’re still scored, because one Grokky is always right.'],
 [/paper|play.money|fake money|real money|place (a )?bet/,'<b>Paper only.</b> Nothing on this page places a bet, order or trade with Kalshi or anyone else, and I can’t either. The “bets” are play-money entries in your browser; the Grokky picks are records, not orders.'],
 [/how.*(engine|call).*work|what.*engine|signals? mean/,'<b>The engine.</b> v2 looks only at closed 15-minute candles and scores five mean-reversion signals (1-hour overshoot, last-candle overshoot, RSI extremes, where the last candle closed in its range, and the USD-vs-USDT premium), then locks UP or DOWN for the window. See the “How it works” section lower on the page.'],
 [/brti|cf benchmarks/,'<b>BRTI.</b> The CF Benchmarks Bitcoin Real-Time Index is a blended price from several exchanges. Kalshi’s 15-minute market settles on the average of its last 60 seconds before the close compared with the strike.']
];
function wantsAdvice(q){return /\b(should i|shall i|do you (recommend|think i should)|tell me (to|what to) (buy|sell|bet)|which side should|is it (a )?(good|safe) (time|idea) to|invest|all.?in|financial advice|price (target|prediction)|will (btc|bitcoin|it|the price) (go|hit|reach|moon|crash|be)|predict (the )?(price|next)|(buy|sell|short|long)\b.*\b(now|today|this window)|place (a|the|my) (bet|order|trade)|bet (for|on) me)/i.test(q)}
function pctS(x){return (x>=0?'+':'−')+Math.abs(x*100).toFixed(2)+'%'}
function lastLoss(){var t=window.GrokkyPanel&&GrokkyPanel.tally();return t&&t.scored.length?t.scored[t.scored.length-1]:null}
function stateLine(sn){
  var a=[];if(sn.btc_consensus_usd)a.push('BTC is about <b>'+usd(sn.btc_consensus_usd,2)+'</b> (board consensus)');
  if(sn.change_since_window_open_usd!=null)a.push((sn.change_since_window_open_usd>=0?'up ':'down ')+usd(Math.abs(sn.change_since_window_open_usd),2)+' since this window opened');
  var s=a.join(', ');if(sn.window.strike_usd)s+=(s?'. ':'')+'The window’s strike is '+usd(sn.window.strike_usd,2)+(sn.window.brti_avg_minus_strike_usd!=null?' and the BRTI average is '+(sn.window.brti_avg_minus_strike_usd>=0?'above':'below')+' it by '+usd(Math.abs(sn.window.brti_avg_minus_strike_usd),0):'')+', with '+mmss(sn.window.secs_left)+' left';
  if(sn.window.kalshi_up_price_cents!=null)s+='. Kalshi prices UP at '+sn.window.kalshi_up_price_cents+'¢';
  return s?s+'.':'I don’t have a live price yet — the sources are still loading.';
}
function builtin(q){
  var l=q.toLowerCase().trim(),sn=snapshot(),h='';
  if(wantsAdvice(l))return 'I can’t tell you what to buy, sell or bet, and I can’t place anything — that’s your call, and this isn’t financial advice. What I <i>can</i> do is show what the board sees right now: '+stateLine(sn)+(sn.engine_v2?' The v2 engine leans <b>'+sn.engine_v2.direction+'</b> at '+sn.engine_v2.own_probability_pct+'%'+(sn.engine_v2.no_edge?' (flagged <i>no edge</i>)':'')+', but its tested edge is only about a coin flip, so please don’t treat that as a forecast.':'');
  if(/(why|how).*(grokky|pick|it|you).*(lose|lost|fail|wrong|miss)|post.?mortem|what went wrong|why did .*lose/.test(l)){
    var r=lastLoss();if(!r)return 'No round has been scored yet, so there’s no loss to explain. Each round has exactly one loser; once Kalshi settles one, whoever lost will explain it in their own words in the “When one of us gets it wrong” card.';
    return '<div class="askpm">'+GrokkyPanel.postMortem(r,false)+'</div>';}
  if(/grokky|picks?\b|scoreboard|who.*(winning|ahead|leading)|streak/.test(l)){
    var gw=sn.grokky_this_window,sb=sn.scoreboard;
    h=gw?'<b>This window</b> — <b>Grokky 1:</b> “I’m going <b>'+gw.grokky1+'</b>'+(Array.isArray(gw.grokky1_reasons)&&gw.grokky1_reasons.length?', mostly because '+esc(gw.grokky1_reasons[0]):'')+'.” <b>Grokky 2:</b> “I’m taking <b>'+gw.grokky2+'</b>, the opposite side, like always'+(Array.isArray(gw.grokky2_reasons)&&gw.grokky2_reasons.length?'; what I leaned on was '+esc(gw.grokky2_reasons[0]):'')+'.” <span class="mut">(locked '+hhmm(Date.parse(gw.locked_at)/1000)+'; open “Why?” on our cards for the full trail)</span> ':'Neither of us has locked a pick for this window yet — we’ll share as soon as the engine has its call. ';
    h+=sb&&sb.rounds_scored?'<br><b>Our scoreboard:</b> Grokky 1 “I’m '+sb.grokky1_correct+' / '+sb.rounds_scored+' correct.” Grokky 2 “And I’m '+sb.grokky2_correct+' / '+sb.rounds_scored+'.” We’re always on opposite sides, so one of us is right every round — please don’t read that as skill.':'<br>No rounds have been scored yet, so we’re both at the starting line.';
    return h;}
  if(/flow|whale|large (trade|transfer)|big (trade|buy|sell)|taker/.test(l)){
    var f=sn.large_exchange_trades_15m_usd;return f?'In the last 15 minutes, large (≥$25k) exchange trades on Binance and OKX show taker buys of <b>'+fu(f.taker_buys)+'</b> vs taker sells of <b>'+fu(f.taker_sells)+'</b> (watched '+Math.round(f.watched_secs/60)+' min on this page). That’s real exchange data, but earlier backtests found it didn’t predict the next 15 minutes beyond Kalshi’s price. On-chain mempool transfers carry no direction at all, because outputs include change.':'I haven’t recorded large-trade flow yet — it only counts while this page is open and its feeds are live.';}
  if(/funding|open interest|\boi\b|liquidat/.test(l)){
    var p=[];if(sn.okx_funding_pct_per_8h!=null)p.push('OKX perpetual funding is <b>'+(sn.okx_funding_pct_per_8h>=0?'+':'')+sn.okx_funding_pct_per_8h.toFixed(4)+'%</b> per 8 h ('+(sn.okx_funding_pct_per_8h>0?'longs pay shorts':sn.okx_funding_pct_per_8h<0?'shorts pay longs':'flat')+')');
    if(sn.okx_liquidations_60m_usd)p.push('in the last hour OKX liquidated <b>'+fu(sn.okx_liquidations_60m_usd.longs)+'</b> of longs and <b>'+fu(sn.okx_liquidations_60m_usd.shorts)+'</b> of shorts');
    return (p.length?p.join('; ')+'. ':'Those feeds haven’t loaded yet. ')+'<br><span class="mut">Funding is a periodic payment between longs and shorts on perpetual futures; liquidations are forced closes when a leveraged position runs out of margin; open interest is the total value of open contracts. They describe positioning, and my backtests found no 15-minute edge in them.</span>';}
  if(/order.?book|imbalance|depth/.test(l))return sn.kalshi_orderbook_imbalance!=null?'The Kalshi order book is leaning <b>'+(sn.kalshi_orderbook_imbalance>=0?'UP':'DOWN')+'</b> by '+Math.round(Math.abs(sn.kalshi_orderbook_imbalance)*100)+'% more resting size on that side. Backtests found this didn’t beat Kalshi’s own price as a predictor.':'The Kalshi order book hasn’t loaded yet (it needs the read-only relay).';
  if(/fear|greed|sentiment/.test(l))return sn.fear_greed?'The Fear &amp; Greed index is <b>'+sn.fear_greed.v+'</b> ('+esc(sn.fear_greed.label)+'). It’s a daily, slow-moving sentiment score, so it says almost nothing about the next 15 minutes.':'The Fear & Greed index hasn’t loaded yet.';
  if(/chart|candle|green|red|strike line|boundar/.test(l))return 'On the price chart, <b>green</b> candles closed above where they opened and <b>red</b> ones closed below. The dashed amber line is the current window’s strike (what BRTI must finish above for UP), and the dotted grey verticals are the 15-minute window boundaries. Use the 1m / 5m / 15m tabs to zoom the timeframe.';
  if(/strike|window|settle|kalshi|resolve|how does .*(work|payout)/.test(l)){return 'Each Kalshi “BTC up in 15 minutes?” market sets a <b>strike</b> at the window start and settles on the average of the BRTI index over the last 60 seconds before the close: above the strike = UP/Yes, otherwise DOWN/No. '+stateLine(sn)}
  for(var i=0;i<FAQ.length;i++)if(FAQ[i][0].test(l))return FAQ[i][1];
  if(/\b(price|market|doing|right now|current|btc now|bitcoin now|how is (bitcoin|btc))\b/.test(l))return stateLine(sn)+(sn.engine_v2?' The v2 engine leans '+sn.engine_v2.direction+' ('+sn.engine_v2.own_probability_pct+'%'+(sn.engine_v2.no_edge?', no edge':'')+').':'')+(sn.chart_last_10min?' Over the last 10 minutes BTC moved '+(sn.chart_last_10min.move_usd>=0?'+':'−')+usd(Math.abs(sn.chart_last_10min.move_usd))+'.':'');
  return 'Hmm, I don’t have a built-in answer for that one yet. I’d be happy to talk about the live price and window, the Grokky picks and why one lost, large-trade flows, funding and liquidations, the order book, how Kalshi settles, and basics like halvings, mining, wallets and ETFs. For open-ended Bitcoin questions, the AI mode answers these once it’s connected.';
}

/* ================= UI ================= */
function mdLite(t){ // tiny, safe formatter: escape first, then **bold**, bullets, line breaks
  var s=esc(t).replace(/\*\*([^*\n]+)\*\*/g,'<b>$1</b>');
  var lines=s.split('\n'),out=[],inList=false;
  lines.forEach(function(ln){var m=/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(ln);if(m){if(!inList){out.push('<ul>');inList=true}out.push('<li>'+m[1]+'</li>')}else{if(inList){out.push('</ul>');inList=false}out.push(ln.trim()?'<p>'+ln+'</p>':'')}});
  if(inList)out.push('</ul>');return out.join('');
}
function addMsg(role,html,tag,id){
  var log=$('askLog');if(!log)return null;var d=document.createElement('div');d.className='askmsg '+role;
  d.innerHTML=(role==='bot'?'<div class="asktag">'+(tag||'')+'</div>':'')+'<div class="askbody">'+html+'</div>';if(id)d.id=id;log.appendChild(d);log.scrollTop=log.scrollHeight;return d;
}
function modeLabel(){var u=cfgUrl();return u?'<span class="pill ok">AI mode · Cloudflare Workers AI</span>'+(left!=null?' <span class="mut" style="font-size:12px">'+left+' AI answers left today</span>':''):'<span class="pill">Built-in answers · no AI backend connected</span>'}
function setMode(){var e=$('askMode');if(e)e.innerHTML=modeLabel()+(cfgNote?' <span class="warn" style="font-size:12px">'+esc(cfgNote)+'</span>':'')}
function reply(q){
  var url=cfgUrl();
  if(!url){var b=builtin(q);addMsg('bot',b,'Built-in answer · from this page’s live data + a fixed FAQ · not an AI model');H.push({role:'user',content:q},{role:'assistant',content:b.replace(/<[^>]+>/g,' ').slice(0,600)});busy=false;var sb=$('askSend');if(sb)sb.disabled=false;return}
  var holder=addMsg('bot','<span class="mut">thinking…</span>','AI · connecting…'),body=holder.querySelector('.askbody'),tag=holder.querySelector('.asktag'),got='',model='',fin=false;
  var ac=new AbortController(),first=setTimeout(function(){ac.abort()},20000),hard=setTimeout(function(){ac.abort()},120000);
  function fallback(why){clearTimeout(first);clearTimeout(hard);cfgNote='AI backend unavailable ('+why+') — using built-in answers';setMode();if(got){body.innerHTML=mdLite(got)+'<p class="mut">…the connection dropped, so this answer may be cut short.</p>';tag.textContent='AI · '+(model||'')+' · interrupted'}else{var b=builtin(q);body.innerHTML=b;tag.textContent='Built-in answer (the AI backend was unavailable: '+why+') · from this page’s live data + a fixed FAQ';}busy=false;done()}
  function done(){var l=$('askLog');if(l)l.scrollTop=l.scrollHeight;var btn=$('askSend');if(btn)btn.disabled=false}
  fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:q,snapshot:JSON.stringify(snapshot()),history:H.slice(-6)}),signal:ac.signal,cache:'no-store'}).then(function(res){
    clearTimeout(first);
    if(!res.ok){var why=res.status===429?'daily/rate limit reached':res.status===503?'AI temporarily unavailable':res.status===403?'blocked':'HTTP '+res.status;throw new Error(why)}
    var lq=res.headers.get('X-Questions-Left-Today');if(lq!=null&&lq!=='')left=+lq;cfgNote='';setMode();
    var rd=res.body.getReader(),dec=new TextDecoder(),buf='';tag.textContent='AI answer · generating…';
    function pump(){return rd.read().then(function(r){
      if(r.done){return}
      buf+=dec.decode(r.value,{stream:true});var i;
      while((i=buf.indexOf('\n'))>=0){var ln=buf.slice(0,i).trim();buf=buf.slice(i+1);if(ln.indexOf('data:')!==0)continue;var o;try{o=JSON.parse(ln.slice(5))}catch(e){continue}
        if(o.t){got+=o.t;body.innerHTML=mdLite(got)}else if(o.done){fin=true;model=o.model||model}else if(o.error)throw new Error('stream error')}
      $('askLog').scrollTop=$('askLog').scrollHeight;return pump()})}
    return pump().then(function(){clearTimeout(hard);
      if(!got)throw new Error('empty answer');
      tag.textContent='AI answer · '+(model||'Workers AI')+' · generated by a model with a live-board snapshot; can be wrong · not financial advice';
      H.push({role:'user',content:q},{role:'assistant',content:got.slice(0,700)});busy=false;done()});
  })["catch"](function(e){fallback(e&&e.name==='AbortError'?'timed out':(e&&e.message)||'network error')});
}
function submit(q){
  q=String(q||'').trim().slice(0,MAXQ);if(!q||busy)return;
  if(Date.now()-lastAt<1500)return;lastAt=Date.now();busy=true;var btn=$('askSend');if(btn)btn.disabled=true;
  addMsg('user',esc(q));setTimeout(function(){try{reply(q)}catch(e){busy=false;if(btn)btn.disabled=false;addMsg('bot','Sorry, something went wrong while answering. Please try again.','error')}},30);
}
function init(){
  var f=$('askForm');if(!f)return;setMode();
  f.addEventListener('submit',function(e){e.preventDefault();var i=$('askInput');var q=i.value;i.value='';submit(q)});
  [].forEach.call(document.querySelectorAll('#askChips button'),function(b){b.onclick=function(){submit(b.textContent)}});
  var c=$('askClear');if(c)c.onclick=function(){H=[];$('askLog').innerHTML='';addMsg('bot',intro(),'Hello')};
  addMsg('bot',intro(),'Hello');
}
function intro(){return cfgUrl()?'Hi there! 😊 I’m your friendly Bitcoin helper. Ask me anything about Bitcoin, Kalshi’s 15-minute markets, or what the board is showing right now — I get a compact snapshot of the live board with each question. I’m an AI, so I can be wrong, and none of this is financial advice. I can’t place bets or trades.':'Hi there! 😊 I’m the board’s built-in Bitcoin helper. Right now I answer from this page’s live data and a fixed FAQ (no AI model is connected yet), so try the quick questions below. None of this is financial advice, and I can’t place bets or trades.'}
window.AskPanel={init:init,snapshot:snapshot,builtin:builtin,submit:submit,_cfgUrl:cfgUrl,_mdLite:mdLite};
})();
