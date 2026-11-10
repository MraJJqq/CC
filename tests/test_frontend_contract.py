from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parents[1]
class CCFrontendContractTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.index=(ROOT/"site/index.html").read_text(encoding="utf-8");cls.app=(ROOT/"site/assets/app.js").read_text(encoding="utf-8")
  cls.layout=(ROOT/"site/assets/full-screen.css").read_text(encoding="utf-8");cls.media=(ROOT/"site/assets/css/full-screen-dynamic.css").read_text(encoding="utf-8")
  cls.logo=(ROOT/"site/assets/modules/logo/logo.js").read_text(encoding="utf-8");cls.tf=(ROOT/"site/assets/modules/timeframe-switch/index.html").read_text(encoding="utf-8")
  cls.ticker=(ROOT/"site/assets/modules/signal-ticker/ticker.js").read_text(encoding="utf-8");cls.kline=(ROOT/"site/assets/kline/tencent-kline-controller.js").read_text(encoding="utf-8")
  cls.scanner=(ROOT/"scripts/a_share_cache.py").read_text(encoding="utf-8")
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
  self.assertIn("confirmation_date===summary.market_date",self.app);self.assertIn("VEGAS_CARD_SELECT",self.app);self.assertIn("No change",self.ticker)
 def test_fullscreen_panel_geometry(self):
  for x in ("#kline-host","#rolling-cards-frame","#signal-ticker","safe-area-inset-bottom"):self.assertIn(x,self.layout)
 def test_no_second_pages_publisher(self):self.assertFalse((ROOT/".github/workflows/pages-deploy.yml").exists())
if __name__=="__main__":unittest.main()
