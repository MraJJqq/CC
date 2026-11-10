export const EMA_DEFS=Object.freeze([{period:12,color:"#f5d76e",width:1.45},{period:36,color:"#BEE9F0",width:1.15},{period:43,color:"#BEE9F0",width:1.05},{period:144,color:"#f4d35e",width:1.3},{period:169,color:"#f4d35e",width:1.15},{period:576,color:"#ff4e5e",width:1.3},{period:676,color:"#ff4e5e",width:1.15}]);
function calculateEmaFrom(candles,period,previous,prefix){const out=new Float64Array(candles.length);out.fill(NaN);if(candles.length<period)return out;let start=0,value=0;if(previous&&prefix>=period&&previous.length>=prefix){out.set(previous.subarray(0,prefix));start=prefix;value=out[start-1]}else{let sum=0;for(let i=0;i<period;i++)sum+=candles[i].c;value=sum/period;out[period-1]=value;start=period}const alpha=2/(period+1);for(let i=start;i<candles.length;i++){value=candles[i].c*alpha+value*(1-alpha);out[i]=value}return out}
export function calculateEma(candles,period){if(!Number.isInteger(period)||period<1)throw new RangeError("EMA period must be a positive integer");return calculateEmaFrom(candles,period,null,0)}
export function calculateVegasEma(candles){return new Map(EMA_DEFS.map(d=>[d.period,calculateEma(candles,d.period)]))}
export function createVegasEmaOverlay({canvas,view=null}={}){
 if(!(canvas instanceof HTMLCanvasElement))throw new TypeError("A canvas element is required");
 const ctx=canvas.getContext("2d",{alpha:true});let candles=[],emas=new Map(),W=0,H=0,dpr=1,currentView=view,raf=0,destroyed=false;
 function ask(){if(!destroyed&&!raf)raf=requestAnimationFrame(draw)}
 function resize(){if(destroyed)return;dpr=Math.min(window.devicePixelRatio||1,2);const r=canvas.getBoundingClientRect();W=r.width;H=r.height;canvas.width=Math.max(1,Math.round(W*dpr));canvas.height=Math.max(1,Math.round(H*dpr));ask()}
 function getVisibleRange(start,end){
  let min=Infinity,max=-Infinity;
  for(const def of EMA_DEFS){const values=emas.get(def.period);if(!values)continue;const a=Math.max(0,start),b=Math.min(values.length-1,end);for(let i=a;i<=b;i++){const value=values[i];if(Number.isFinite(value)&&value>0){if(value<min)min=value;if(value>max)max=value;}}}
  return min===Infinity?null:{min,max};
 }
 function draw(){
  raf=0;if(destroyed)return;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,W,H);
  const v=currentView;if(!candles.length||!v||!W||!H||!(v.barW>0)||!(v.hi>v.lo)||v.lo<=0)return;
  const{barW,right,lo,hi}=v,rightGap=Number.isFinite(v.rightGap)?v.rightGap:0,xOf=i=>v.W-rightGap-(right-i+.5)*barW,yOf=p=>v.T0+(Math.log(hi)-Math.log(p))/(Math.log(hi)-Math.log(lo))*(v.H-v.T0-v.B),iAt=x=>right+.5-(v.W-rightGap-x)/barW,i0=Math.max(0,Math.floor(iAt(0))),i1=Math.min(candles.length-1,Math.ceil(iAt(v.W)));
  for(const def of EMA_DEFS){const values=emas.get(def.period);if(!values)continue;ctx.beginPath();let started=false;for(let i=i0;i<=i1;i++){const value=values[i];if(!Number.isFinite(value)){started=false;continue}const x=xOf(i),y=yOf(value);if(!started){ctx.moveTo(x,y);started=true}else ctx.lineTo(x,y)}if(started){ctx.strokeStyle=def.color;ctx.lineWidth=def.width;ctx.lineJoin="round";ctx.lineCap="round";ctx.stroke()}}
 }
 function setCandles(next){const incoming=Array.isArray(next)?next:[];let prefix=0,limit=Math.min(candles.length,incoming.length);while(prefix<limit&&candles[prefix].t===incoming[prefix].t&&candles[prefix].c===incoming[prefix].c)prefix++;if(prefix===candles.length&&prefix===incoming.length)return;const nextEmas=new Map();for(const def of EMA_DEFS)nextEmas.set(def.period,calculateEmaFrom(incoming,def.period,emas.get(def.period),prefix));candles=incoming;emas=nextEmas;ask()}
 function renderNow(){if(destroyed)return;if(raf){cancelAnimationFrame(raf);raf=0}draw()}
 function setView(next){if(!next||![next.barW,next.right,next.lo,next.hi,next.W,next.H,next.T0,next.B].every(Number.isFinite))return;currentView=next;ask()}
 const observer=new ResizeObserver(resize);observer.observe(canvas);resize();
 function destroy(){if(destroyed)return;destroyed=true;observer.disconnect();if(raf)cancelAnimationFrame(raf);ctx.clearRect(0,0,canvas.width,canvas.height);candles=[];emas.clear();currentView=null}
 return Object.freeze({setCandles,setView,getVisibleRange,renderNow,destroy})
}