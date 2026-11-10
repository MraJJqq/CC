from __future__ import annotations
import base64,gzip,json
from datetime import date,timedelta
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
codes=gzip.decompress(base64.b64decode((ROOT/"config/cn500.codes.gz.b64").read_text(encoding="ascii"))).decode().splitlines()
if len(codes)!=500 or len(set(codes))!=500:raise SystemExit("CN500 source list must contain 500 unique codes")
def symbol(code):
 c=code.strip()
 if c.startswith(("sh","sz","bj")):return c
 if c.startswith(("60","68","90")):return "sh"+c
 if c.startswith(("00","30")):return "sz"+c
 if c.startswith(("4","8")):return "bj"+c
 raise ValueError(c)
items=[symbol(x) for x in codes]
market_date="2026-11-09"
cards=[{"symbol":s,"code":s[2:],"name":f"测试股票{i+1}","latest_close":10.0+i/100,"previous_close":9.9+i/100} for i,s in enumerate(items)]
selected=cards[0]
universe=[{"symbol":selected["symbol"],"code":selected["code"],"name":selected["name"],"last_date":market_date}]
signals=[{"symbol":selected["symbol"],"code":selected["code"],"name":selected["name"],"confirmation_date":market_date,"observation_date":"2026-11-06"}]
data=ROOT/"site/data";(data/"charts").mkdir(parents=True,exist_ok=True)
def write(name,value):(data/name).write_text(json.dumps(value,ensure_ascii=False),encoding="utf-8")
write("cards.json",cards)
write("summary.json",{"market_date":market_date,"universe_size":500,"eligible_count":1,"fetch_error_count":0})
write("universe.json",universe);write("signals.json",signals);write("signals.previous.json",[])
write("trading-calendar.json",{"trading_days":["2026-11-10","2026-11-11"]})
bars=[]
d=date(2024,1,2)
while len(bars)<700:
 if d.weekday()<5:
  v=10+len(bars)*0.001
  bars.append([d.isoformat(),v,v+0.2,v-0.2,v+0.1])
 d+=timedelta(days=1)
chart={"symbol":selected["symbol"],"history_complete":True,"bars":bars}
(data/"charts"/(selected["symbol"]+".json.gz")).write_bytes(gzip.compress(json.dumps(chart,separators=(",",":")).encode(),mtime=0))
print("Generated isolated browser fixtures: 500 CN500 cards, 1 eligible signal, 700 daily candles.")
