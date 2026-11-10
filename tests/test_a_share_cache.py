import unittest
import pandas as pd
import json
import gzip
import tempfile
from pathlib import Path
from datetime import date
from unittest.mock import patch
from scripts.trading_calendar import is_a_share_trading_day,previous_a_share_trading_day,upcoming_trading_days
from scripts.a_share_cache import require_complete_fetch,fetch_cached,cache_paths,atomic_json,SOURCE,SCHEMA
from scripts.a_share_cache import to_tencent_symbol,parse_tencent_quote_text,merge_frames,through_date,valid_bars,excluded_name,ema,normalize
from scripts.validate_pages_payload import validate_payload

class TradingCalendarTests(unittest.TestCase):
 def test_weekend_is_not_a_trading_day(self):
  self.assertFalse(is_a_share_trading_day(date(2026, 11, 7)))
 def test_public_holiday_is_not_a_trading_day(self):
  self.assertFalse(is_a_share_trading_day(date(2026, 10, 1)))
 def test_normal_weekday_is_a_trading_day(self):
  self.assertTrue(is_a_share_trading_day(date(2026, 11, 10)))
 def test_previous_session_skips_public_holiday(self):
  self.assertEqual(previous_a_share_trading_day(date(2026, 10, 8)),date(2026, 9, 30))
 def test_upcoming_sessions_skip_public_holiday(self):
  self.assertEqual(upcoming_trading_days(date(2026, 10, 1),1),["2026-10-08"])
 def test_partial_fetch_is_rejected(self):
  with self.assertRaisesRegex(RuntimeError,"refusing partial CN500 publish"):
   require_complete_fetch([{"symbol":"sh600000","reason":"network timeout"}])
 def test_complete_fetch_is_accepted(self):
  require_complete_fetch([])

class TencentCacheTests(unittest.TestCase):
 def test_symbol_map(self):
  self.assertEqual(to_tencent_symbol("600000"),"sh600000")
  self.assertEqual(to_tencent_symbol("000001"),"sz000001")
  self.assertEqual(to_tencent_symbol("sh.600000"),"sh600000")
  self.assertEqual(to_tencent_symbol("830001"),"bj830001")
  with self.assertRaises(ValueError):to_tencent_symbol("ABC")
 def test_schema(self):
  x=normalize(pd.DataFrame([{"date":"2024-01-02","open":10,"high":11,"low":9,"close":10,"volume":100,"amount":1000}]))
  self.assertEqual(list(x.columns),["date","open","high","low","close","volume","amount"]);self.assertEqual(len(x),1)
 def test_overlap_merge(self):
  cols=["date","open","high","low","close","volume","amount"]
  a=pd.DataFrame([["2024-01-02",10,11,9,10,100,1000]],columns=cols)
  b=pd.DataFrame([["2024-01-02",10,12,9,11,120,1200],["2024-01-03",11,12,10,11,110,1100]],columns=cols)
  m=merge_frames(a,b);self.assertEqual(len(m),2);self.assertEqual(float(m.iloc[0].close),11)
 def test_cache_trims_in_progress_or_future_dates(self):
  cols=["date","open","high","low","close","volume","amount"]
  x=pd.DataFrame([["2024-01-02",10,11,9,10,100,1000],["2024-01-03",11,12,10,11,110,1100]],columns=cols)
  m=through_date(x,"2024-01-02")
  self.assertEqual(len(m),1);self.assertEqual(str(m.iloc[0].date.date()),"2024-01-02")
 def test_invalid_ohlc(self):
  cols=["date","open","high","low","close","volume","amount"]
  x=pd.DataFrame([["2024-01-02",10,11,9,10,100,1000],["2024-01-03",10,9,11,10,100,1000]],columns=cols)
  self.assertEqual(len(valid_bars(x)),1)
 def test_invalid_turnover_is_rejected(self):
  cols=["date","open","high","low","close","volume","amount"]
  x=pd.DataFrame([["2024-01-02",10,11,9,10,100,1000],["2024-01-03",10,11,9,10,-1,1000],["2024-01-04",10,11,9,10,100,None]],columns=cols)
  self.assertEqual(len(valid_bars(x)),1)
 def test_ema(self):
  x=ema(pd.Series(range(1,20),dtype=float),12);self.assertTrue(pd.isna(x.iloc[10]));self.assertTrue(pd.notna(x.iloc[11]))
 def test_names(self):
  self.assertTrue(excluded_name("ST某某"));self.assertTrue(excluded_name("某某退"));self.assertFalse(excluded_name("贵州茅台"))
 def test_corrupt_cache_is_rebuilt_from_tencent(self):
  with tempfile.TemporaryDirectory() as directory:
   data,meta=cache_paths(directory,"sh600000")
   data.write_bytes(b"not a gzip file")
   atomic_json(meta,{"schema_version":SCHEMA,"source":SOURCE,"adjust":"qfq","symbol":"sh600000","frequency":"daily","complete":True})
   fresh=pd.DataFrame([{"date":"2024-01-02","open":10,"high":11,"low":9,"close":10,"volume":100,"amount":1000}])
   with patch("scripts.a_share_cache.fetch_tencent",return_value=fresh) as fetch:
    bars,info=fetch_cached("sh600000","2024-01-02",directory)
   self.assertEqual(len(bars),1)
   self.assertEqual(fetch.call_args.args[1],"19900101")
   self.assertTrue(info["complete"])
   self.assertEqual(len(pd.read_csv(data,compression="gzip")),1)
   self.assertTrue(json.loads(meta.read_text(encoding="utf-8"))["complete"])

class TencentNameParserTests(unittest.TestCase):
 def test_parse_tencent_quote_text(self):
  raw='v_s_sh600000="1~浦发银行~600000~10.0";v_s_sz000001="1~平安银行~000001~11.0";'
  names=parse_tencent_quote_text(raw)
  self.assertEqual(names["sh600000"],"浦发银行")
  self.assertEqual(names["sz000001"],"平安银行")

class PagesPayloadValidationTests(unittest.TestCase):
 def _write_payload(self, root, dates=("2026-11-09","2026-11-06","2026-11-09"), fetch_errors=0, bad_chart=False):
  data=Path(root)/"data";charts=data/"charts";charts.mkdir(parents=True)
  cards=[{"symbol":f"CN{i:03d}"} for i in range(500)]
  universe=[]
  for i,last_date in enumerate(dates):
   symbol=f"sh60000{i}"
   universe.append({"symbol":symbol,"last_date":last_date})
   chart={"symbol":symbol,"last_date":("2026-11-05" if bad_chart and i==0 else last_date),"bars":[[last_date,10,11,9,10]]}
   with gzip.open(charts/(symbol+".json.gz"),"wt",encoding="utf-8") as handle:json.dump(chart,handle)
  summary={"universe_size":500,"eligible_count":len(universe),"fetch_error_count":fetch_errors,"market_date":max(dates)}
  payloads={"cards.json":cards,"summary.json":summary,"universe.json":universe,"signals.json":[{"symbol":universe[0]["symbol"],"confirmation_date":summary["market_date"]}],"signals.previous.json":[],"trading-calendar.json":{"trading_days":[]}}
  for name,value in payloads.items():(data/name).write_text(json.dumps(value),encoding="utf-8")
  return data
 def test_allows_eligible_stocks_with_older_last_dates(self):
  with tempfile.TemporaryDirectory() as directory:
   result=validate_payload(self._write_payload(directory))
   self.assertEqual(result["market_date"],"2026-11-09")
   self.assertEqual(result["eligible"],3)
 def test_rejects_tencent_fetch_errors(self):
  with tempfile.TemporaryDirectory() as directory:
   with self.assertRaisesRegex(ValueError,"Tencent fetch errors"):validate_payload(self._write_payload(directory,fetch_errors=1))
 def test_rejects_chart_date_mismatch(self):
  with tempfile.TemporaryDirectory() as directory:
   with self.assertRaisesRegex(ValueError,"date-mismatched"):validate_payload(self._write_payload(directory,bad_chart=True))
 def test_rejects_summary_market_date_not_newest(self):
  with tempfile.TemporaryDirectory() as directory:
   data=self._write_payload(directory)
   summary=json.loads((data/"summary.json").read_text(encoding="utf-8"));summary["market_date"]="2026-11-06"
   (data/"summary.json").write_text(json.dumps(summary),encoding="utf-8")
   with self.assertRaisesRegex(ValueError,"newest eligible-stock date"):validate_payload(data)

class WorkflowReliabilityTests(unittest.TestCase):
 def test_frontend_publish_is_decoupled_from_tencent_scan(self):
  root=Path(__file__).resolve().parents[1]
  scan=(root/".github/workflows/a-share-daily.yml").read_text(encoding="utf-8")
  publish=(root/".github/workflows/pages-publish.yml").read_text(encoding="utf-8")
  self.assertNotIn('      - "site/**"',scan)
  self.assertIn('      - "site/**"',publish)
  self.assertIn("cancel-in-progress: false",scan)
  self.assertIn("cancel-in-progress: false",publish)
 def test_bark_only_runs_after_payload_validation(self):
  root=Path(__file__).resolve().parents[1]
  scan=(root/".github/workflows/a-share-daily.yml").read_text(encoding="utf-8")
  self.assertLess(scan.index("Validate complete Pages data payload"),scan.index("Push CN500 daily signals to Bark"))
  self.assertIn("python scripts/validate_pages_payload.py",scan)

if __name__=="__main__":unittest.main()
