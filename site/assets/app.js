import {createV6KlineView} from "./kline/v6-kline-view.js";
import {createTencentKlineController} from "./kline/tencent-kline-controller.js";
import {createLifecycleScope} from "./shared/lifecycle.js";
import {createPageLifecycle} from "./shared/page-lifecycle-v6.js";
import {createSignalTicker} from "./modules/signal-ticker/ticker.js";
const DATA="./data/",$=id=>document.getElementById(id),lifecycle=createLifecycleScope();
window.__CC_READY__=false;
let pageLifecycle=null,universe=[],signalStocks=[],carouselIndex=0,carouselTimer=null,transitionTimer=null,transitionToken=0,destroyed=false,lastSignalPayload="";
const interactionLocks=new Set();let signalTimer=null,klineTimer=null;
const ROTATION_START_KEY="cc-last-random-start",logoFrame=$("logo-frame"),timeframeFrame=$("timeframe-frame");
const isHidden=()=>pageLifecycle?pageLifecycle.isSuspended():document.hidden;
const host=$("kline-host"),chart=createV6KlineView({host,onInteractionChange:setInteractionLock});
const controller=createTencentKlineController({frame:{contentWindow:chart},isHidden,onState:s=>{if(s.status==="request-failed")console.warn("[CC Tencent K-line]",s)}});
const ticker=createSignalTicker({container:$("signal-ticker"),track:$("signal-track")});
function createNonRepeatingQueue(items){
 const queue=[...items];for(let i=queue.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[queue[i],queue[j]]=[queue[j],queue[i]]}
 let previous="";try{previous=localStorage.getItem(ROTATION_START_KEY)||""}catch(_){}
 const different=queue.findIndex(item=>item.symbol!==previous);if(different>0)queue.push(...queue.splice(0,different));
 try{if(queue.length)localStorage.setItem(ROTATION_START_KEY,queue[0].symbol)}catch(_){}return queue;
}
function sendFrame(frame,payload){try{frame?.contentWindow?.postMessage(payload,location.origin)}catch(_){}}
function sendTimeframe(){sendFrame(timeframeFrame,{type:"VEGAS_TIMEFRAME_SET",timeframe:"1D"})}
function sendLogo(item,market){
 if(!item){sendFrame(logoFrame,{type:"VEGAS_LOGO_CLEAR"});return}
 const code=String(item.code||item.symbol||"").replace(/^(SH|SZ|BJ)/,"");
 sendFrame(logoFrame,{type:"VEGAS_LOGO_SET_SYMBOL",symbol:String(item.symbol||code),name:String(item.name||market?.name||code),code,timeframe:"1D"});
}
function syncFrames(){sendTimeframe();const item=signalStocks[carouselIndex];if(item)sendLogo(item,universe.find(s=>s.symbol===item.symbol))}
function revealFrame(frame){if(frame?.contentWindow?.document?.readyState==="complete")frame.classList.add("is-ready")}
function clearSelectedStock(){sendLogo(null);chart.setCandles([]);chart.setVegasEmaCandles([])}
function stopCarousel(){if(carouselTimer!==null)clearTimeout(carouselTimer);if(transitionTimer!==null)clearTimeout(transitionTimer);carouselTimer=transitionTimer=null;transitionToken++;$("app").classList.remove("is-symbol-transitioning")}
function waitTransition(ms,token){return new Promise(resolve=>{transitionTimer=setTimeout(()=>{transitionTimer=null;resolve(token===transitionToken)},ms)})}
function setInteractionLock(source,active){if(destroyed)return;if(active){interactionLocks.add(source);stopCarousel();return}interactionLocks.delete(source);if(!interactionLocks.size&&!isHidden()&&signalStocks.length)scheduleNext()}
async function transitionToIndex(index,{initial=false}={}){
 if(destroyed||isHidden()||(!initial&&interactionLocks.size)||!signalStocks.length)return;
 if(carouselTimer!==null)clearTimeout(carouselTimer);carouselTimer=null;if(transitionTimer!==null)clearTimeout(transitionTimer);transitionTimer=null;
 const token=++transitionToken;carouselIndex=(index+signalStocks.length)%signalStocks.length;
 const item=signalStocks[carouselIndex],market=universe.find(s=>s.symbol===item.symbol);$("app").classList.add("is-symbol-transitioning");
 if(!initial&&!await waitTransition(1500,token))return;
 const loaded=await controller.select(item.symbol,market?.last_date||"");if(destroyed||token!==transitionToken)return;
 const state=controller.state;
 if(!loaded&&!(state.symbol===item.symbol&&state.count>0)){$("app").classList.remove("is-symbol-transitioning");console.warn("[CC] Tencent chart not ready",item.symbol);scheduleNext();return}
 sendLogo(item,market);$("app").classList.remove("is-symbol-transitioning");
 transitionTimer=setTimeout(()=>{transitionTimer=null;if(token===transitionToken)scheduleNext()},1500);
}
function scheduleNext(){if(destroyed||isHidden()||interactionLocks.size||signalStocks.length<2)return;if(carouselTimer!==null)clearTimeout(carouselTimer);carouselTimer=setTimeout(()=>{carouselTimer=null;void transitionToIndex(carouselIndex+1)},7000)}
function startCarousel(index=0){stopCarousel();void transitionToIndex(index,{initial:true})}
async function refreshSignals(){
 try{
  const [summary,stocks,today]=await Promise.all(["summary.json","universe.json","signals.json"].map(n=>fetch(DATA+n,{cache:"no-store"}).then(r=>{if(!r.ok)throw new Error("data "+n+" unavailable");return r.json()})));
  if(!summary?.market_date||!Array.isArray(stocks)||!Array.isArray(today))throw new Error("CC market snapshot incomplete");
  universe=stocks;const current=signalStocks[carouselIndex];if(current){const m=universe.find(s=>s.symbol===current.symbol);controller.setExpectedLastDate(m?.last_date||"")}
  const next=today.filter(x=>x.confirmation_date===summary.market_date&&universe.some(s=>s.symbol===x.symbol));
  ticker.render(next,"ready");const payload=JSON.stringify(next);
  if(payload!==lastSignalPayload){lastSignalPayload=payload;signalStocks=createNonRepeatingQueue(next);
   if(typeof window.setCardOrder==="function"){if(!window.setCardOrder(signalStocks.map(x=>x.symbol)))console.error("[CC] card order rejected");else $("rolling-cards-frame").classList.add("is-ready")}
   if(signalStocks.length)startCarousel(0);else{stopCarousel();clearSelectedStock()}
  }return summary;
 }catch(error){ticker.render([],"unavailable");throw error}
}
async function boot(){ticker.render([],"waiting");syncFrames();await refreshSignals();window.__CC_READY__=true}
function stopForegroundTimers(){signalTimer?.();klineTimer?.();signalTimer=klineTimer=null}
function startForegroundTimers(){
 if(destroyed||isHidden())return;
 if(!signalTimer)signalTimer=lifecycle.interval(()=>{if(!isHidden())void refreshSignals().catch(e=>console.warn("[CC] signal refresh failed",e))},60000);
 if(!klineTimer)klineTimer=lifecycle.interval(()=>{if(!isHidden())void controller.refresh()},300000);
}
function suspendRuntime(){if(destroyed)return;document.documentElement.classList.add("page-hidden");stopCarousel();stopForegroundTimers();interactionLocks.clear();controller.suspend();ticker.setPaused(true)}
function resumeRuntime(){if(destroyed||isHidden())return;document.documentElement.classList.remove("page-hidden");controller.resume();ticker.setPaused(false);startForegroundTimers();if(signalStocks.length&&!interactionLocks.size)scheduleNext()}
function teardown(){if(destroyed)return;destroyed=true;stopCarousel();stopForegroundTimers();interactionLocks.clear();pageLifecycle?.destroy();controller.destroy();chart.destroy();ticker.destroy();lifecycle.destroy()}
pageLifecycle=createPageLifecycle({documentRef:document,windowRef:window,onSuspend:suspendRuntime,onResume:resumeRuntime,onPageHideFinal:teardown});
document.documentElement.classList.toggle("page-hidden",isHidden());
lifecycle.listen(logoFrame,"load",()=>{logoFrame.classList.add("is-ready");syncFrames()});lifecycle.listen(timeframeFrame,"load",()=>{timeframeFrame.classList.add("is-ready");syncFrames()});revealFrame(logoFrame);revealFrame(timeframeFrame);
lifecycle.listen(window,"vegas-cards-ready",()=>{if(typeof window.setCardOrder==="function"&&window.setCardOrder(signalStocks.map(x=>x.symbol)))$("rolling-cards-frame").classList.add("is-ready")});
lifecycle.listen(window,"message",event=>{
 if(event.origin!==location.origin)return;
 if(event.source===timeframeFrame?.contentWindow&&event.data?.type==="VEGAS_TIMEFRAME_SELECT"){sendTimeframe();return}
 if(event.source!==window)return;
 if(event.data?.type==="VEGAS_CARD_INTERACTION"&&typeof event.data.active==="boolean"){setInteractionLock("rolling-cards",event.data.active);return}
 if(event.data?.type==="VEGAS_CARD_SELECT"){const symbol=String(event.data.symbol||""),index=signalStocks.findIndex(x=>x.symbol===symbol);if(index>=0)void transitionToIndex(index)}
});
lifecycle.listen(window,"beforeunload",teardown,{once:true});startForegroundTimers();
boot().catch(error=>{clearSelectedStock();ticker.render([],"unavailable");console.error("[CC] initialization failed",error)});
