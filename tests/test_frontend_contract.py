from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parents[1]
class CCFrontendContractTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.index=(ROOT/"site/index.html").read_text(encoding="utf-8");cls.app=(ROOT/"site/assets/app.js").read_text(encoding="utf-8")
  cls.media=(ROOT/"site/assets/css/full-screen-dynamic.css").read_text(encoding="utf-8");cls.module_css=(ROOT/"site/assets/css/v6-modules.css").read_text(encoding="utf-8");cls.tf_responsive=(ROOT/"site/assets/modules/timeframe-switch/responsive.css").read_text(encoding="utf-8")
  cls.logo=(ROOT/"site/assets/modules/logo/logo.js").read_text(encoding="utf-8");cls.tf=(ROOT/"site/assets/modules/timeframe-switch/index.html").read_text(encoding="utf-8")
  cls.ticker=(ROOT/"site/assets/modules/signal-ticker/ticker.js").read_text(encoding="utf-8");cls.kline=(ROOT/"site/assets/kline/tencent-kline-controller.js").read_text(encoding="utf-8")
  cls.scanner=(ROOT/"scripts/a_share_cache.py").read_text(encoding="utf-8")
  cls.kline_controller=(ROOT/"site/assets/kline/tencent-kline-controller.js").read_text(encoding="utf-8")
 def test_seven_systems_are_hosted(self):
  for x in ('id="kline-host"','id="logo-frame"','id="timeframe-frame"','id="rolling-cards-frame"','id="signal-ticker"'):self.assertIn(x,self.index)
  for x in ("createV6KlineView","createSignalTicker","createTencentKlineController","VEGAS_LOGO_SET_SYMBOL","window.setCardOrder"):self.assertIn(x,self.app)
  self.assertIn("full-screen-dynamic.css",self.index)
 def test_media_viewport_and_gesture_system_is_present(self):
  self.assertIn("100dvh",self.media);self.assertIn("safe-area-inset-bottom",self.media)
  self.assertIn("pointerdown",(ROOT/"site/assets/kline/v6-kline-view.js").read_text(encoding="utf-8"))
  self.assertIn("cc-kline-viewport",(ROOT/"site/assets/kline/v6-viewport-state.js").read_text(encoding="utf-8"))
 def test_tencent_qfq_daily_is_configured(self):
  self.assertIn("stock_zh_a_hist_tx",self.scanner);self.assertIn("Tencent qt.gtimg.cn",self.scanner)
  self.assertIn('TIMEFRAME="1D"',self.kline);self.assertIn('DB_NAME="cc-market-cache"',self.kline)
 def test_daily_timeframe_and_logo_linkage(self):
  self.assertIn(">1D<",self.tf);self.assertIn('timeframe:"1D"',self.app)
  self.assertIn("VEGAS_LOGO_SET_SYMBOL",self.logo);self.assertIn("VEGAS_LOGO_SET_SYMBOL",self.app)
 def test_cards_and_signal_flow(self):
  self.assertIn("confirmation_date!==summary.market_date",self.app);self.assertIn("VEGAS_CARD_SELECT",self.app);self.assertIn("No change",self.ticker)
 def test_daily_signal_snapshot_is_shared_and_persistent(self):
  for marker in ('SIGNAL_SNAPSHOT_KEY="cc-daily-signal-snapshot-v1"',"readSignalSnapshot()","persistSignalSnapshot(snapshot)","summary.market_date<=activeSignalDate","applySignalSnapshot(snapshot)","confirmation_date!==summary.market_date"):
   self.assertIn(marker,self.app)
  self.assertIn('cc-daily-snapshot-20261112-',self.index)
  self.assertIn(r"/^\d{4}-\d{2}-\d{2}$/",self.app)
  self.assertIn('if(!activeSignalDate)ticker.render([],"unavailable")',self.app)
 def test_fullscreen_panel_geometry(self):
  for x in ("#kline-host","#rolling-cards-frame","#signal-ticker","safe-area-inset-bottom"):self.assertIn(x,self.media)
 def test_single_fullscreen_geometry_authority(self):
  self.assertFalse((ROOT/"site/assets/full-screen.css").exists())
  self.assertNotIn("full-screen.css",self.index)
  self.assertIn("html.page-hidden",self.module_css)
 def test_fullscreen_rules_are_centralized(self):
  self.assertNotIn("full-screen-dynamic.css",self.tf)
  self.assertIn("responsive.css",self.tf)
  self.assertIn("100dvh",self.media)
  self.assertIn("safe-area-inset-bottom",self.media)
  self.assertIn("height:100%",self.tf_responsive)
  self.assertIn("?v=cc-batch-20261112-1",self.index)
 def test_browser_kline_cache_is_bounded(self):
  self.assertIn("MAX_CACHED_CANDLES=1200",self.kline_controller)
  self.assertIn("MAX_CACHE_SYMBOLS=40",self.kline_controller)
  self.assertIn("slice(-MAX_CACHED_CANDLES)",self.kline_controller)
  self.assertIn("current.slice(MAX_CACHE_SYMBOLS)",self.kline_controller)
  self.assertIn("schemaVersion===CACHE_SCHEMA",self.kline_controller)
  self.assertIn('"history_complete":len(chart_bars)==x["valid_bars"]',self.scanner)
 def test_no_second_pages_publisher(self):self.assertFalse((ROOT/".github/workflows/pages.yml").exists())

 def test_tencent_cache_uses_media_resilience_mechanisms(self):
  for marker in ("MEMORY_MAX_PER_SYMBOL=1200","MEMORY_MAX_SYMBOLS=8","mode:\"memory-fallback\"","dbRetryAt=Date.now()+15000","navigator.storage?.estimate","usageRatio:ratio","attempt<3","retryDelay(350*Math.pow(2,attempt)"):
   self.assertIn(marker,self.kline_controller)

 def test_residual_asset_cache_is_busted_across_page_and_modules(self):
  logo_html=(ROOT/"site/assets/modules/logo/logo.html").read_text(encoding="utf-8")
  view=(ROOT/"site/assets/kline/v6-kline-view.js").read_text(encoding="utf-8")
  for content in (self.index,logo_html):
   self.assertNotIn("cc-viewport-20261110-1",content)
   self.assertIn("cc-batch-20261112-1",content)
  self.assertIn("?v=cc-batch-20261112-1",self.app)
  self.assertIn("?v=cc-batch-20261112-1",view)
 def test_cards_share_one_initial_snapshot_request(self):
  cards=(ROOT/"site/assets/rolling-cards.js").read_text(encoding="utf-8")
  self.assertIn("__CC_CARD_DATA_READY__=fetch(\"./data/cards.json\"",cards)
  self.assertIn("window.__CC_CARD_DATA__=rows",cards)
  self.assertIn("window.__CC_CARD_DATA_READY__",self.app)
  self.assertIn("refreshCards({force:true})",self.app)
  self.assertIn("if(force||!Array.isArray(rows))",self.app)
  self.assertIn("lifecycle.interval(()=>{if(!isHidden())void refreshCards({force:true})},300000)",self.app)
 def test_kline_controller_destroy_is_safe_before_indexeddb_opens(self):
  self.assertIn("if(dbp)dbp.then(db=>db?.close()).catch(()=>{});",self.kline_controller)


if __name__=="__main__":unittest.main()
