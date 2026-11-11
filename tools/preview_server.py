#!/usr/bin/env python3
"""Local preview ONLY: serves the repo and emulates the CORS proxy at /kalshi-proxy/* (GET, KXBTC15M public data only).
usage: python3 tools/preview_server.py [port]   then open http://localhost:PORT/?kalshi=/kalshi-proxy"""
import http.server,sys,urllib.request,re,os
API='https://api.elections.kalshi.com/trade-api/v2'
class H(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith('/kalshi-proxy/'):
            p=self.path[len('/kalshi-proxy'):]
            ok=(p.startswith('/markets?') and 'series_ticker=KXBTC15M' in p) or re.match(r'^/series/KXBTC15M/markets/[A-Z0-9-]+/candlesticks\?',p) or re.match(r'^/markets/KXBTC15M-[A-Z0-9-]{3,40}/orderbook(\?depth=\d{1,2})?$',p) or re.match(r'^/live_data/events/KXBTC15M-[A-Z0-9-]{3,40}$',p)
            if not ok: self.send_error(403);return
            try:
                r=urllib.request.urlopen(urllib.request.Request(API+p,headers={'User-Agent':'Mozilla/5.0'}),timeout=15);b=r.read();c=r.status
            except Exception as e: b=str(e).encode();c=502
            self.send_response(c);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(b);return
        return super().do_GET()
    def log_message(self,*a):pass
os.chdir(os.path.dirname(os.path.abspath(__file__))+'/..')
http.server.ThreadingHTTPServer(('127.0.0.1',int(sys.argv[1]) if len(sys.argv)>1 else 8765),H).serve_forever()
