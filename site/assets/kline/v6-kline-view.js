import{createVegasEmaOverlay}from"./v6-vegas-ema.js?v=cc-batch-20261112-1";
import{VIEWPORT_STORAGE_KEY,captureViewportState,normalizeViewportState,removeLegacyViewportState,resolveViewportRight}from"./v6-viewport-state.js?v=cc-batch-20261112-1";
export function createV6KlineView({host,onInteractionChange=()=>{}}){
if(!host)throw new TypeError("K-line host element is required");
const abort=new AbortController(),{signal}=abort,canvas=document.createElement("canvas");
canvas.style.cssText="position:absolute;inset:0;width:100%;height:100%;display:block;z-index:0;background:transparent;touch-action:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none";host.appendChild(canvas);
let viewportState=null,viewportKeyInitialized=false;try{removeLegacyViewportState(localStorage);viewportState=normalizeViewportState(JSON.parse(localStorage.getItem(VIEWPORT_STORAGE_KEY)||"null"));viewportKeyInitialized=Boolean(viewportState);}catch(_){}
const ctx=canvas.getContext("2d"),overlayCanvas=document.createElement("canvas");overlayCanvas.setAttribute("aria-hidden","true");overlayCanvas.style.cssText="position:absolute;inset:0;width:100%;height:100%;display:block;z-index:1;background:transparent;pointer-events:none";host.appendChild(overlayCanvas);
const overlay=createVegasEmaOverlay({canvas:overlayCanvas}),T0=10,B=10,MINW=2,MAXW=40,RIGHT_GAP_BARS=.5;
let C=[],W=0,H=0,dpr=1,barW=viewportState?.barW??9,right=0,lo=0,hi=1,inited=false,vel=0,lastT=0,raf=0,destroyed=false;
const P=new Map();let pinch=null,hist=[];const clamp=(v,a,b)=>Math.min(b,Math.max(a,v)),xOf=i=>W-(right-i+.5)*barW,iAt=x=>right+.5-(W-x)/barW;
function setRight(v){
 const maxRight=Math.max(0,C.length-1+W/barW-.5);
 right=clamp(v,0,maxRight);
}
function saveViewport(){const next=captureViewportState(C,right,barW);if(!next)return;viewportState=next;try{localStorage.setItem(VIEWPORT_STORAGE_KEY,JSON.stringify(next))}catch(_){}}
function migrateLegacyViewportKey(key){if(viewportKeyInitialized||typeof key!=="string"||!key)return;viewportKeyInitialized=true;try{const legacy=normalizeViewportState(JSON.parse(localStorage.getItem("vegas-v6-viewport:"+key)||"null"));if(legacy){viewportState=legacy;localStorage.setItem(VIEWPORT_STORAGE_KEY,JSON.stringify(legacy));}}catch(_){}}
function ask(){if(!raf&&!destroyed)raf=requestAnimationFrame(loop)}
function resize(){if(destroyed)return;if(P.size||pinch)resetInteraction();dpr=Math.min(window.devicePixelRatio||1,2);const r=host.getBoundingClientRect();W=r.width;H=r.height;setRight(right);canvas.width=Math.max(1,Math.round(W*dpr));canvas.height=Math.max(1,Math.round(H*dpr));ask()}
function yOf(p){return T0+(Math.log(hi)-Math.log(p))/(Math.log(hi)-Math.log(lo))*(H-T0-B)}
function draw(i0,i1){ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,W,H);let bw=Math.max(1,Math.round(barW*.7));if(bw>2&&bw%2===0)bw--;const fu=new Path2D(),fd=new Path2D(),su=new Path2D(),sd=new Path2D();for(let i=i0;i<=i1;i++){const c=C[i],up=c.c>=c.o,F=up?fu:fd,S=up?su:sd,x=xOf(i),yh=yOf(c.h),yl=yOf(c.l),yo=yOf(c.o),yc=yOf(c.c),top=Math.min(yo,yc),bot=Math.max(yo,yc),wx=Math.round(x-.5);if(c.c>=c.o&&bw>=3&&bot-top>2){F.rect(wx,yh,1,Math.max(0,top-yh));F.rect(wx,bot,1,Math.max(0,yl-bot));S.rect(Math.round(x-bw/2)+.5,Math.round(top)+.5,bw-1,Math.round(bot-top)-1)}else{F.rect(wx,yh,1,Math.max(1,yl-yh));if(barW>=3)F.rect(Math.round(x-bw/2),top,bw,Math.max(1,bot-top))}}ctx.fillStyle="#22b07d";ctx.fill(fu);ctx.fillStyle="#e5484d";ctx.fill(fd);ctx.lineWidth=1;ctx.strokeStyle="#22b07d";ctx.stroke(su);ctx.strokeStyle="#e5484d";ctx.stroke(sd)}
function viewport(){return Object.freeze({barW,right,lo,hi,W,H,T0,B,rightGap:0})}
function frame(){
 const n=C.length;if(!n||!W)return;const i0=Math.max(0,Math.floor(iAt(0))),i1=Math.min(n-1,Math.ceil(iAt(W)));let mn=Infinity,mx=-Infinity;
 for(let i=i0;i<=i1;i++){if(C[i].l<mn)mn=C[i].l;if(C[i].h>mx)mx=C[i].h}
 if(mn===Infinity){mn=lo;mx=hi}
 const emaRange=overlay.getVisibleRange(i0,i1);
 if(emaRange){mn=Math.min(mn,emaRange.min);mx=Math.max(mx,emaRange.max)}
 const m=(mx-mn)*.08||mn*.001;mn=Math.max(Number.MIN_VALUE,mn-m);mx+=m;
 if(!inited){lo=mn;hi=mx;inited=true}else{lo+=(mn-lo)*.3;hi+=(mx-hi)*.3;if(Math.abs(mn-lo)+Math.abs(mx-hi)>(mx-mn)*.002)ask();else{lo=mn;hi=mx}}
 draw(i0,i1);overlay.setView(viewport())
}
function loop(t){raf=0;if(destroyed)return;const dt=Math.min(t-lastT,40)||16;lastT=t;if(Math.abs(vel)>.0004){const r0=right;setRight(right+vel*dt);if(right===r0)vel=0;vel*=Math.pow(.94,dt/16);ask()}else{if(vel!==0)saveViewport();vel=0;}frame()}
function pos(e){const r=canvas.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top}}
function startPinch(){const[a,b]=[...P.values()];pinch={d0:Math.max(Math.hypot(a.x-b.x,a.y-b.y),10),bw0:barW,ai:iAt((a.x+b.x)/2)};vel=0}
function updatePinch(){const[a,b]=[...P.values()],d=Math.hypot(a.x-b.x,a.y-b.y),mx=(a.x+b.x)/2;barW=clamp(pinch.bw0*d/pinch.d0,MINW,MAXW);setRight(pinch.ai-.5+(W-mx)/barW);saveViewport();ask()}
let activePointers=0,wheelEndTimer=null;const activeInteractionSources=new Set();function interaction(source,active){const was=activeInteractionSources.has(source);if(active)activeInteractionSources.add(source);else activeInteractionSources.delete(source);if(was!==active)onInteractionChange(source,active)}
function resetInteraction(){const ids=[...P.keys()];P.clear();activePointers=0;pinch=null;hist=[];vel=0;lastT=0;if(wheelEndTimer!==null){clearTimeout(wheelEndTimer);wheelEndTimer=null}for(const id of ids){try{if(canvas.hasPointerCapture(id))canvas.releasePointerCapture(id)}catch(_){}}interaction("kline-pointer",false);interaction("kline-wheel",false)}
canvas.addEventListener("pointerdown",e=>{e.preventDefault();if(P.size>=2)return;if(activePointers++===0)interaction("kline-pointer",true);try{canvas.setPointerCapture(e.pointerId)}catch(_){}const p=pos(e);P.set(e.pointerId,{x:p.x,y:p.y});vel=0;if(P.size===1)hist=[];else if(P.size===2)startPinch()},{signal});
canvas.addEventListener("pointermove",e=>{const s=P.get(e.pointerId);if(!s)return;e.preventDefault();const p=pos(e);if(P.size>=2){s.x=p.x;s.y=p.y;if(pinch)updatePinch();return}const dx=p.x-s.x;if(dx!==0){setRight(right-dx/barW);saveViewport();hist.push({t:e.timeStamp,r:right});while(hist.length>1&&e.timeStamp-hist[0].t>100)hist.shift()}s.x=p.x;s.y=p.y;ask()},{signal});
function end(e){if(!P.delete(e.pointerId))return;activePointers=P.size;if(pinch&&P.size<2){pinch=null;hist=[]}if(P.size>0)return;interaction("kline-pointer",false);if(e.type==="pointerup"&&hist.length>=2){const a=hist[0],b=hist[hist.length-1];if(e.timeStamp-b.t<60){vel=clamp((b.r-a.r)/Math.max(b.t-a.t,16),-1.5,1.5);lastT=performance.now();ask()}}hist=[]}
canvas.addEventListener("pointerup",end,{signal});canvas.addEventListener("pointercancel",e=>{if(P.has(e.pointerId))resetInteraction()},{signal});canvas.addEventListener("lostpointercapture",e=>{if(P.has(e.pointerId))resetInteraction()},{signal});
canvas.addEventListener("wheel",e=>{e.preventDefault();if(e.deltaX===0&&e.deltaY===0)return;interaction("kline-wheel",true);if(wheelEndTimer!==null)clearTimeout(wheelEndTimer);wheelEndTimer=setTimeout(()=>{wheelEndTimer=null;interaction("kline-wheel",false)},350);if(Math.abs(e.deltaX)>Math.abs(e.deltaY)&&!e.ctrlKey)setRight(right+e.deltaX/barW);else{const x=pos(e).x,ai=iAt(x);barW=clamp(barW*Math.exp(-e.deltaY*(e.ctrlKey?.01:.0015)),MINW,MAXW);setRight(ai-.5+(W-x)/barW)}saveViewport();ask()},{passive:false,signal});
canvas.addEventListener("touchmove",e=>e.preventDefault(),{passive:false,signal});canvas.addEventListener("contextmenu",e=>e.preventDefault(),{signal});["gesturestart","gesturechange","gestureend"].forEach(n=>canvas.addEventListener(n,e=>e.preventDefault(),{signal}));
const observer=new ResizeObserver(resize);observer.observe(host);window.addEventListener("pagehide",()=>{resetInteraction();saveViewport()},{signal});window.addEventListener("pageshow",resetInteraction,{signal});window.addEventListener("blur",resetInteraction,{signal});document.addEventListener("visibilitychange",()=>{if(document.hidden){resetInteraction();saveViewport()}else resetInteraction()},{signal});resize();
function setCandles(a){C=Array.isArray(a)?a:[];inited=false;vel=0;if(!C.length){ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);overlay.setCandles([]);host.dataset.emaHistoryStatus="empty";host.dataset.emaHistorySymbol="";host.dataset.emaHistoryCount="0";host.dataset.emaAvailablePeriods="";ask();return;}if(viewportState){barW=viewportState.barW;const mapped=resolveViewportRight(C,viewportState,W);if(mapped!==null)right=mapped;else setRight(C.length-1+RIGHT_GAP_BARS);}else{setRight(C.length-1+RIGHT_GAP_BARS);saveViewport();}setRight(right);ask();}
function setVegasEmaCandles(a){overlay.setCandles(Array.isArray(a)?a:[])}
function setHistoryStatus(symbol,count,complete,state,error,timeframe="4H"){
 const status=state||(complete?(count>=676?"ready":"exchange-history-exhausted"):"incomplete");
 host.dataset.emaHistoryStatus=status;host.dataset.emaHistorySymbol=symbol;host.dataset.emaHistoryCount=String(count);
 host.dataset.emaAvailablePeriods=[12,36,43,144,169,576,676].filter(period=>count>=period).join(",");
 if(status==="exchange-history-exhausted")console.warn("[VEGAS V6] "+symbol+" exchange history exhausted at "+count+" "+timeframe+" candles; available EMA periods: "+host.dataset.emaAvailablePeriods);
 if(status==="request-failed")console.warn("[VEGAS V6] "+symbol+" history request failed; retained "+count+" cached/latest "+timeframe+" candles.",error||"");
}
function destroy(){if(destroyed)return;resetInteraction();destroyed=true;abort.abort();observer.disconnect();if(raf)cancelAnimationFrame(raf);overlay.destroy();canvas.remove();overlayCanvas.remove();C=[]}
host.classList.add("is-ready");return Object.freeze({setCandles,setVegasEmaCandles,setHistoryStatus,migrateLegacyViewportKey,destroy})
}