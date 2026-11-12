from __future__ import annotations
import argparse,base64,gzip,multiprocessing,os,re,time,json
from concurrent.futures import ProcessPoolExecutor,as_completed
from datetime import date,datetime,timedelta,timezone,time as dt_time
from pathlib import Path
try:
 from .trading_calendar import china_today,is_a_share_trading_day,previous_a_share_trading_day
except ImportError:
 from trading_calendar import china_today,is_a_share_trading_day,previous_a_share_trading_day
import numpy as np
import pandas as pd
import requests
SOURCE="Tencent via AKShare stock_zh_a_hist_tx"; NAME_SOURCE="Tencent qt.gtimg.cn"; SCHEMA=4; START="19900101"; OVERLAP_DAYS=14; WARMUP=676
PERIODS=(12,36,43,144,169,576,676)
CHART_BAR_LIMIT=1200
def to_tencent_symbol(value):
 c=str(value).strip().lower().replace(".","")
 if c.startswith(("sh","sz","bj")) and len(c)==8:return c
 if not re.fullmatch(r"\d{6}",c):raise ValueError(f"invalid A-share code: {value}")
 if c.startswith(("60","68","90")):return "sh"+c
 if c.startswith(("00","30")):return "sz"+c
 if c.startswith(("4","8")):return "bj"+c
 raise ValueError(f"unsupported A-share code: {value}")
def load_universe(path):
 raw=gzip.decompress(base64.b64decode(Path(path).read_text(encoding="ascii"))).decode().splitlines()
 codes=[to_tencent_symbol(x) for x in raw if x.strip()]
 if len(codes)!=500 or len(set(codes))!=500:raise RuntimeError(f"CN500 must contain 500 unique codes, got {len(codes)}")
 return codes
def excluded_name(name):return bool(re.search(r"ST|退",str(name or ""),re.I))
def parse_tencent_quote_text(text):
 names={}
 for match in re.finditer(r'v_s_(sh|sz|bj)(\d{6})="([^"]*)"',str(text)):
  fields=match.group(3).split("~")
  if len(fields)>1 and fields[1].strip():names[match.group(1)+match.group(2)]=fields[1].strip()
 return names
def read_names(symbols,retries=3):
 session=requests.Session();session.headers.update({"Referer":"https://gu.qq.com/","User-Agent":"Mozilla/5.0"})
 names={}
 for start in range(0,len(symbols),50):
  chunk=symbols[start:start+50];url="https://qt.gtimg.cn/q="+",".join("s_"+s for s in chunk);last=None
  for attempt in range(retries+1):
   try:
    response=session.get(url,timeout=20);response.raise_for_status()
    names.update(parse_tencent_quote_text(response.content.decode("gbk",errors="replace")));last=None;break
   except Exception as exc:
    last=exc
    if attempt<retries:time.sleep(min(8,2**attempt))
  if last is not None:raise RuntimeError(f"Tencent stock-name request failed for batch {start//50+1}: {last}") from last
  time.sleep(.12)
 for attempt in range(retries):
  missing=[s for s in symbols if s not in names]
  if not missing:break
  print(f"Tencent stock-name response incomplete: {len(names)}/{len(symbols)}; retrying {len(missing)} missing symbols ({attempt+1}/{retries})",flush=True)
  for start in range(0,len(missing),50):
   chunk=missing[start:start+50];url="https://qt.gtimg.cn/q="+",".join("s_"+s for s in chunk)
   try:
    response=session.get(url,timeout=20);response.raise_for_status()
    names.update(parse_tencent_quote_text(response.content.decode("gbk",errors="replace")))
   except Exception as exc:
    print(f"Tencent stock-name retry batch failed: {str(exc)[:160]}",flush=True)
   time.sleep(.2)
 if len(names)!=len(symbols):
  missing=[s for s in symbols if s not in names]
  raise RuntimeError(f"Tencent stock-name response incomplete after retries: {len(names)}/{len(symbols)}; missing={missing[:20]}")
 return names
def normalize(df):
 cols=["date","open","high","low","close","volume","amount"]
 if df is None or df.empty:return pd.DataFrame(columns=cols)
 x=df.copy();aliases={"日期":"date","开盘":"open","最高":"high","最低":"low","收盘":"close","成交量":"volume","成交额":"amount","vol":"volume"}
 x=x.rename(columns={k:v for k,v in aliases.items() if k in x.columns and v not in x.columns})
 for c in cols:
  if c not in x:x[c]=np.nan
 x["date"]=pd.to_datetime(x["date"],errors="coerce")
 for c in cols[1:]:x[c]=pd.to_numeric(x[c],errors="coerce")
 return x[cols].dropna(subset=["date"]).drop_duplicates("date",keep="last").sort_values("date").reset_index(drop=True)
def merge_frames(old,new):
 frames=[normalize(x) for x in (old,new) if x is not None and not x.empty]
 if not frames:return normalize(None)
 return pd.concat(frames,ignore_index=True).drop_duplicates("date",keep="last").sort_values("date").reset_index(drop=True)
def latest_completed_session(run_date,local_now):
 """Return today's session only after the 15:30 China close; otherwise use the prior session."""
 if is_a_share_trading_day(run_date) and local_now.time().replace(tzinfo=None)>=dt_time(15,30):
  return run_date
 return previous_a_share_trading_day(run_date)
def through_date(df,end):
 x=normalize(df)
 return x.loc[x.date<=pd.Timestamp(end)].reset_index(drop=True)
def valid_bars(df):
 if df is None or df.empty:return normalize(None)
 x=normalize(df);p=x[["open","high","low","close"]];turnover=x[["volume","amount"]]
 mask=np.isfinite(p).all(axis=1)&p.gt(0).all(axis=1)&x.high.ge(p[["open","close"]].max(axis=1))&x.low.le(p[["open","close"]].min(axis=1))&x.high.ge(x.low)
 mask &= np.isfinite(turnover).all(axis=1)&turnover.ge(0).all(axis=1)
 return x.loc[mask].reset_index(drop=True)
def ema(values,period):
 a=values.to_numpy(dtype=float);out=np.full(len(a),np.nan)
 if len(a)<period:return pd.Series(out,index=values.index)
 alpha=2/(period+1);v=float(np.mean(a[:period]));out[period-1]=v
 for i in range(period,len(a)):v=alpha*a[i]+(1-alpha)*v;out[i]=v
 return pd.Series(out,index=values.index)
def cache_paths(cache,symbol):
 safe=symbol.replace(".","-");root=Path(cache);return root/(safe+".csv.gz"),root/(safe+".meta.json")
def read_meta(path):
 try:return json.loads(path.read_text(encoding="utf-8"))
 except Exception:return {}
def atomic_json(path,obj):
 path.parent.mkdir(parents=True,exist_ok=True);tmp=path.with_suffix(path.suffix+".tmp");tmp.write_text(json.dumps(obj,ensure_ascii=False,indent=2),encoding="utf-8");os.replace(tmp,path)
def fetch_tencent(symbol,start,end,retries=4):
 import akshare as ak
 last=None
 for attempt in range(retries+1):
  try:
   df=ak.stock_zh_a_hist_tx(symbol=symbol,start_date=start,end_date=end,adjust="qfq");out=normalize(df)
   if out.empty:raise RuntimeError(f"Tencent returned empty history {symbol} {start}-{end}")
   return out
  except Exception as exc:
   last=exc
   if attempt<retries:
    delay=min(15,2**attempt);print(f"{symbol}: Tencent retry {attempt+1}/{retries}: {str(exc)[:160]}",flush=True);time.sleep(delay)
 raise RuntimeError(f"Tencent history failed {symbol}: {last}") from last
def fetch_cached(symbol,end,cache):
 dp,mp=cache_paths(cache,symbol);meta=read_meta(mp);old=None
 if dp.exists():
  try:old=normalize(pd.read_csv(dp,compression="gzip"))
  except Exception:old=None
 valid_cache=meta.get("schema_version")==SCHEMA and meta.get("source")==SOURCE and meta.get("adjust")=="qfq" and meta.get("symbol")==symbol and meta.get("frequency")=="daily" and meta.get("complete") is True and old is not None and not old.empty
 usable_old=through_date(old,end) if valid_cache else normalize(None)
 start=max(pd.Timestamp(START),usable_old.date.max()-pd.Timedelta(days=OVERLAP_DAYS)).strftime("%Y%m%d") if not usable_old.empty else START
 fresh=fetch_tencent(symbol,start,end);merged=through_date(merge_frames(usable_old,fresh),end)
 if merged.empty:raise RuntimeError("empty merged history")
 dp.parent.mkdir(parents=True,exist_ok=True);tmp=dp.with_suffix(".csv.gz.tmp");merged.to_csv(tmp,index=False,compression="gzip",date_format="%Y-%m-%d");os.replace(tmp,dp)
 good=valid_bars(merged);meta={"schema_version":SCHEMA,"source":SOURCE,"name_source":NAME_SOURCE,"symbol":symbol,"frequency":"daily","adjust":"qfq","updated_at_utc":datetime.now(timezone.utc).isoformat(),"requested_start":start,"first_date":merged.date.min().date().isoformat(),"last_date":merged.date.max().date().isoformat(),"raw_bars":len(merged),"valid_bars":len(good),"complete":True,"overlap_days":OVERLAP_DAYS,"cache_file":dp.name}
 atomic_json(mp,meta);return good,meta
def analyze_one(item,end,cache):
 symbol,name=item["symbol"],item["name"]
 if not name:return {"status":"pass","symbol":symbol,"name":"","reason":"missing_stock_name"}
 if excluded_name(name):return {"status":"pass","symbol":symbol,"name":name,"reason":"ST_or_delisted_name"}
 bars,meta=fetch_cached(symbol,end,cache)
 if bars.empty:return {"status":"pass","symbol":symbol,"name":name,"reason":"no_valid_bars"}
 last=bars.date.max().date()
 if (date.fromisoformat(end)-last).days>15:return {"status":"pass","symbol":symbol,"code":symbol[2:],"name":name,"reason":"stale_history","last_date":last.isoformat(),"latest_close":float(bars.close.iloc[-1]),"previous_close":float(bars.close.iloc[-2]) if len(bars)>1 else None}
 if len(bars)<WARMUP:return {"status":"pass","symbol":symbol,"code":symbol[2:],"name":name,"reason":"less_than_676_valid_bars","valid_bars":len(bars),"last_date":last.isoformat(),"latest_close":float(bars.close.iloc[-1]),"previous_close":float(bars.close.iloc[-2]) if len(bars)>1 else None}
 bars=bars.sort_values("date").reset_index(drop=True)
 for p in PERIODS:bars[f"ema{p}"]=ema(bars.close,p)
 signals=[];pending=None
 for _,r in bars.iterrows():
  touched=[]
  for label,a,b in (("中锋",144,169),("红峰",576,676)):
   x,y=r[f"ema{a}"],r[f"ema{b}"]
   if pd.notna(x) and pd.notna(y) and r.low<=max(x,y) and r.high>=min(x,y):touched.append(label)
  if touched:pending={"date":r.date.date().isoformat(),"zones":touched};continue
  if pending and pd.notna(r.ema12):
   side="上方" if r.close>r.ema12 else "下方" if r.close<r.ema12 else None
   if side:signals.append({"code":symbol[2:],"symbol":symbol,"name":name,"observation_date":pending["date"],"confirmation_date":r.date.date().isoformat(),"observation_zone":",".join(pending["zones"]),"close":round(float(r.close),4),"ema12":round(float(r.ema12),4),"confirmation_side":side});pending=None
 chart=[[r.date.date().isoformat(),*[round(float(r[c]),6) for c in ("open","high","low","close")]] for _,r in bars.iterrows()]
 return {"status":"ok","symbol":symbol,"code":symbol[2:],"name":name,"valid_bars":len(bars),"first_date":bars.date.iloc[0].date().isoformat(),"last_date":last.isoformat(),"latest_close":float(bars.close.iloc[-1]),"previous_close":float(bars.close.iloc[-2]),"median_amount_20d":float(bars.tail(20).amount.median()),"signals":signals,"chart_bars":chart,"cache":meta}
def worker(items,end,cache,wid):
 good=[];passed=[];errors=[]
 for i,item in enumerate(items,1):
  try:
   row=analyze_one(item,end,cache);(good if row["status"]=="ok" else passed).append(row)
  except Exception as exc:errors.append({"symbol":item["symbol"],"name":item["name"],"reason":str(exc)[:300]})
  if i%20==0 or i==len(items):print(f"worker {wid}: {i}/{len(items)} eligible={len(good)} pass={len(passed)} errors={len(errors)}",flush=True)
 return good,passed,errors
def require_complete_fetch(errors):
 if errors:
  preview="; ".join(f"{x.get('symbol')}: {x.get('reason')}" for x in errors[:10])
  raise RuntimeError(f"Tencent history fetch errors {len(errors)}; refusing partial CN500 publish. {preview}")
def write_text(path,content):
 path.parent.mkdir(parents=True,exist_ok=True);tmp=path.with_suffix(path.suffix+".tmp");tmp.write_text(content,encoding="utf-8");os.replace(tmp,path)
def write_gzip_json(path,obj):
 path.parent.mkdir(parents=True,exist_ok=True);tmp=path.with_suffix(path.suffix+".tmp");raw=json.dumps(obj,ensure_ascii=False,separators=(",",":")).encode("utf-8");tmp.write_bytes(gzip.compress(raw,compresslevel=9,mtime=0));os.replace(tmp,path)
def main():
 ap=argparse.ArgumentParser();ap.add_argument("--universe-file",default="config/cn500.codes.gz.b64");ap.add_argument("--cache-dir",default=".cache/cn500-tencent-qfq");ap.add_argument("--workers",type=int,default=4);ap.add_argument("--as-of",default=china_today().isoformat());ap.add_argument("--out",default="results/a-share");a=ap.parse_args()
 if a.workers<1:ap.error("--workers must be positive")
 run_date=date.fromisoformat(a.as_of)
 if not is_a_share_trading_day(run_date):
  print(f"{run_date.isoformat()} is not an A-share trading day; Tencent scan skipped.",flush=True)
  return
 local_now=datetime.now().astimezone(ZoneInfo("Asia/Shanghai"))
 end_date=latest_completed_session(run_date,local_now).isoformat()
 print(f"Using last completed A-share session: {end_date}; excluding the in-progress current-day candle.",flush=True)
 symbols=load_universe(a.universe_file);Path(a.cache_dir).mkdir(parents=True,exist_ok=True);names=read_names(symbols);items=[{"symbol":s,"name":names[s]} for s in symbols]
 n=min(a.workers,len(items));size=(len(items)+n-1)//n;chunks=[items[i:i+size] for i in range(0,len(items),size)];Path(a.cache_dir).mkdir(parents=True,exist_ok=True)
 good=[];passed=[];errors=[]
 with ProcessPoolExecutor(max_workers=n,mp_context=multiprocessing.get_context("spawn")) as pool:
  futures=[pool.submit(worker,chunk,end_date,a.cache_dir,i) for i,chunk in enumerate(chunks,1)]
  for f in as_completed(futures):
   g,p,e=f.result();good.extend(g);passed.extend(p);errors.extend(e)
 require_complete_fetch(errors)
 if not good:raise RuntimeError("No CN500 stock passed Tencent cache/data-quality checks; refusing empty publish")
 good.sort(key=lambda x:x["symbol"]);all_signals=[s for x in good for s in x["signals"]];market_date=max((x["last_date"] for x in good),default="");market_dates=sorted({bar[0] for x in good for bar in x["chart_bars"]});previous_market_date=max((d for d in market_dates if d<market_date),default="");today=[s for s in all_signals if s["confirmation_date"]==market_date];previous=[s for s in all_signals if s["confirmation_date"]==previous_market_date]
 data=Path("site/data");charts=data/"charts";charts.mkdir(parents=True,exist_ok=True)
 for p in list(charts.glob("*.json"))+list(charts.glob("*.json.gz")):p.unlink()
 for x in good:
  chart_bars=x["chart_bars"][-CHART_BAR_LIMIT:]
  write_gzip_json(charts/(x["symbol"]+".json.gz"),{"code":x["code"],"symbol":x["symbol"],"name":x["name"],"valid_bars":x["valid_bars"],"first_date":x["first_date"],"last_date":x["last_date"],"history_complete":len(chart_bars)==x["valid_bars"],"bars":chart_bars})
 universe=[{k:x[k] for k in ("symbol","code","name","valid_bars","first_date","last_date","latest_close","previous_close","median_amount_20d")} for x in good]
 good_by={x["symbol"]:x for x in good};pass_by={x["symbol"]:x for x in passed};error_by={x["symbol"]:x for x in errors}
 cards=[]
 for item in items:
  s=item["symbol"];x=good_by.get(s) or pass_by.get(s);err=error_by.get(s)
  row={"symbol":s,"code":s[2:],"name":item["name"],"status":"ready" if s in good_by else ("error" if err else "unavailable")}
  if x:
   for key in ("last_date","latest_close","previous_close","median_amount_20d","valid_bars"):
    if x.get(key) is not None:row[key]=x[key]
  if err:row["reason"]=err.get("reason","fetch_error")
  elif x and x.get("reason"):row["reason"]=x["reason"]
  cards.append(row)
 if len(cards)!=500 or len({x["symbol"] for x in cards})!=500:raise RuntimeError("CN500 cards output must contain exactly 500 unique symbols")
 write_text(data/"cards.json",json.dumps(cards,ensure_ascii=False,separators=(",",":")))
 summary={"generated_at_utc":datetime.now(timezone.utc).isoformat(),"source":SOURCE,"name_source":NAME_SOURCE,"adjust":"qfq","market":"沪深A股","frequency":"1D","universe_source":"CN500 verified code list","universe_size":len(symbols),"eligible_count":len(good),"passed_count":len(passed),"fetch_error_count":len(errors),"market_date":market_date,"previous_market_date":previous_market_date,"today_signal_count":len(today),"previous_signal_count":len(previous),"history_policy":"all Tencent-provided daily history; no fixed cache bar cap","web_chart_policy":"latest 1200 bars per eligible stock; full-history signal calculation remains server-side","cache_policy":"per-symbol gzip CSV and metadata; 14-day overlap incremental merge","warmup_policy":"at least 676 valid daily bars"}
 write_text(data/"summary.json",json.dumps(summary,ensure_ascii=False,indent=2));write_text(data/"universe.json",json.dumps(universe,ensure_ascii=False,separators=(",",":")));write_text(data/"signals.json",json.dumps(today,ensure_ascii=False,separators=(",",":")));write_text(data/"signals.previous.json",json.dumps(previous,ensure_ascii=False,separators=(",",":")) )
 out=Path(a.out);out.mkdir(parents=True,exist_ok=True);pd.DataFrame(passed).to_csv(out/"passed.csv",index=False);pd.DataFrame(errors).to_csv(out/"errors.csv",index=False);pd.DataFrame(universe).to_csv(out/"eligible.csv",index=False);write_text(out/"summary.json",json.dumps(summary,ensure_ascii=False,indent=2))
 manifest=[read_meta(p) for p in Path(a.cache_dir).glob("*.meta.json")];write_text(out/"cache-manifest.json",json.dumps({"schema_version":SCHEMA,"source":SOURCE,"adjust":"qfq","cached_symbols":len(manifest),"symbols":manifest},ensure_ascii=False,indent=2))
 print(json.dumps(summary,ensure_ascii=False,indent=2),flush=True)
if __name__=="__main__":main()
