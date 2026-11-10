(async function(){
"use strict";
/* ============ 可调参数 ============ */
var SPEED=0.0104719755; // 巡航速度：10分钟完成一圈（弧度/秒）；0 = 默认静止，仅拖动时运动
var OPACITY=.85;   // 整体透明度 0~1（逐卡设置，不会让整体重新合成）
var SHOW=3.6;      // 正面可见范围（以卡片间距为单位，3.6 ≈ 7 张）
var CURVE=.28;     // 两侧卡片上翘幅度（占高度比例）
var FRICTION=1.8;  // 松手后回到巡航速度的快慢（越大停得越快）
var FLING_MAX=5;   // 惯性最大速度（弧度/秒）
var SLOP=4;        // 手指移动超过多少像素才算拖动（小于此值视为点按）
/* ================================= */

/* ---- 数据：[代码, 初始价] ；接口见文末 updateQuote / updateQuotes ---- */
var CARD_DATA=await fetch("./data/cards.json",{cache:"no-cache"}).then(r=>{if(!r.ok)throw new Error("CN500 cards unavailable");return r.json()});if(!Array.isArray(CARD_DATA)||CARD_DATA.length!==500)throw new Error("CN500 card count mismatch");var SYMS=CARD_DATA.map(x=>[x.symbol,Number(x.latest_close)||0]);
var N=SYMS.length,W=172,H=100,TAU=Math.PI*2,activeCount=0,step=TAU,A=SHOW*step;

/* ---- 状态：全部用定长数组，运行中零分配 ---- */
var ring=document.getElementById("ring"),vp=document.getElementById("vp");
var els=[],pe=[],ce=[];
var price=new Float64Array(N),open=new Float64Array(N),op=new Float64Array(N);
var dirty=new Uint8Array(N),hid=new Uint8Array(N).fill(1),dn=new Int8Array(N).fill(-1);
var order=new Uint16Array(N);for(var oi=0;oi<N;oi++)order[oi]=oi;

/* ---- 只为当前信号集创建卡片节点；轮播期间复用，切出信号集时卸载 ---- */
var tpl=document.createElement("div");
tpl.className="c";
tpl.innerHTML='<div class="fg"><div class="row"><div class="sym"><img class="ico" alt=""><span class="nm"></span></div></div><div class="quote"><div class="price"></div><div class="chg"></div></div></div>';
// Keep the 500-stock data arrays, but create DOM nodes only for active signal cards.
function createCard(i){
  var e=tpl.cloneNode(true),ic=e.querySelector(".ico");
  e.dataset.symbol=SYMS[i][0];
  ic.remove();
  e.querySelector(".nm").textContent=(CARD_DATA[i].name||CARD_DATA[i].code)+" · "+CARD_DATA[i].code;
  els[i]=e;pe[i]=e.querySelector(".price");ce[i]=e.querySelector(".chg");
  flush(i);
  return e;
}
for(var i=0;i<N;i++){
  price[i]=Number(CARD_DATA[i].latest_close)||0;open[i]=Number(CARD_DATA[i].previous_close)||0;dirty[i]=1;
}

/* ---- 文本刷新：只写变化的卡片，不可见的卡片等入场时再写 ---- */
function fmt(v){
  var d=v>=1000?1:v>=10?2:v>=1?3:v>=.01?4:8,s=v.toFixed(d);
  if(v>=1000){var p=s.split(".");s=p[0].replace(/\B(?=(\d{3})+(?!\d))/g,",")+"."+p[1]}
  return s;
}
function flush(i){
  if(!els[i])return;
  dirty[i]=0;
  var p=price[i],o=open[i];
  if(!(p>0)){pe[i].textContent="--";ce[i].textContent="--";return}
  var up=!(o>0)||p>=o,pct=o>0?(p-o)/o*100:0;
  pe[i].textContent=fmt(p);
  ce[i].textContent=o>0?(up?"▲ +":"▼ ")+Math.abs(pct).toFixed(2)+"%":"--";
  var d=up?0:1;
  if(d!==dn[i]){dn[i]=d;els[i].classList.toggle("dn",d===1)}
}

/* ---- 布局（尺寸变化时才算） ---- */
var Wd=0,Hd=0,bs=1,Rx=1,Ry=0,x0=0,y0=0;
function layout(){
  Wd=vp.clientWidth;Hd=vp.clientHeight;
  /* 小屏减少可见卡片数量，优先保证卡片文字可读；卡片原始样式与交互不变。 */
  SHOW=Wd<500?2.2:Wd<900?2.8:3.6;
  A=Math.min(SHOW*step,Math.PI*.9);
  var maxCardW=Math.min(W,Math.max(112,Math.min(172,Wd/3.2)));
  var maxCardH=Math.min(H,Math.max(58,Hd*.78));
  bs=Math.min(maxCardW/W,maxCardH/H);
  var cw=W*bs;
  Rx=cw*1.08/step;
  Ry=CURVE*Hd/(1-Math.cos(A));
  x0=Wd/2-W/2;
  y0=Hd*.96-cw*H/W/2-H/2;
  render(true);
}

/* ---- 渲染：每帧只写 transform / 透明度；样式类在运动中不再切换 ---- */
var pos=0;
function loadLogo(i){var img=els[i].querySelector(".ico");if(img&&!img.getAttribute("src")&&img.dataset.src)img.src=img.dataset.src;}
function render(calm){
  if(activeCount===0){for(var h=0;h<N;h++){if(!hid[h]){hid[h]=1;op[h]=0;els[h].style.opacity=0;els[h].classList.remove("is-visible");els[h].style.pointerEvents="none"}}return}
  for(var slot=0;slot<activeCount;slot++){
    var i=order[slot];
    var f=pos+slot*step;f-=TAU*Math.round(f/TAU);
    var a=f<0?-f:f,e=els[i];
    if(a>=A){if(!hid[i]){hid[i]=1;op[i]=0;e.style.opacity=0;e.classList.remove("is-visible");e.style.pointerEvents="none"}continue}   // 背面：透明且不再更新
    if(hid[i]){hid[i]=0;e.classList.add("is-visible");e.style.pointerEvents="auto";loadLogo(i);if(dirty[i])flush(i)}                           // 入场时文字已就绪
    else if(calm&&dirty[i])flush(i);
    var c=Math.cos(f);
    e.style.transform="translate3d("+(x0+Math.sin(f)*Rx).toFixed(1)+"px,"+(y0-(1-c)*Ry).toFixed(1)+"px,0) scale("+(bs*(.62+.38*c)).toFixed(3)+")";
    var o=(1-a/A)*2.4;o=o>1?1:o;o=Math.round(o*OPACITY*40)/40;
    if(o!==op[i]){op[i]=o;e.style.opacity=o}
  }
}

/* ---- 主循环：有事才跑，最高 60fps，静止时完全停止 ---- */
var vel=0,dir=1,vis=true,raf=0,last=0,drag=false;
var paused=SPEED===0||matchMedia("(prefers-reduced-motion: reduce)").matches;
var pid=-1,lx=0,cx=0,sx=0,lastTap=0,tapSymbol=null,lastTouchEnd=0;
var st=new Float64Array(8),sp=new Float64Array(8),sn=0;   // 拖动采样环形缓冲（松手惯性用）

function wake(){if(activeCount>0&&!raf&&vis&&!document.hidden){last=performance.now();raf=requestAnimationFrame(tick)}}
function stop(){if(raf){cancelAnimationFrame(raf);raf=0}}
function tick(ts){
  raf=0;
  if(!vis||document.hidden)return;
  if(ts-last<14){raf=requestAnimationFrame(tick);return}   // 120Hz 屏幕降到 60fps
  var dt=(ts-last)/1000;dt=dt>.05?.05:dt<0?0:dt;last=ts;
  var target=paused?0:dir*SPEED;
  if(pid!==-1&&drag){
    pos+=(cx-lx)/Rx;lx=cx;
    var k=sn&7;st[k]=ts;sp[k]=pos;sn++;
  }else{
    vel+=(target-vel)*(1-Math.exp(-dt*FRICTION));
    pos+=vel*dt;
  }
  render(!drag&&vel<.5&&vel>-.5);                          // 快速运动时不刷新文字
  if(drag||!paused||vel-target>.003||target-vel>.003)raf=requestAnimationFrame(tick);
  else vel=0;
}

/* ---- 手势 / 鼠标：只控制方向和速度 ---- */
function fling(now){                                       // 取最近 100ms 的平均速度
  var n=sn<8?sn:8,nk=(sn-1)&7;
  if(n<2||now-st[nk]>80)return 0;
  var ok=nk;
  for(var m=1;m<n;m++){var k=(sn-1-m)&7;if(st[nk]-st[k]>100)break;ok=k}
  var t=st[nk]-st[ok];
  return t>16?(sp[nk]-sp[ok])/(t/1000):0;
}
function setDir(){if(vel>.05)dir=1;else if(vel<-.05)dir=-1}
/* Block iOS Safari double-tap page zoom; pointerup keeps the existing card behavior. */
ring.addEventListener("touchend",function(e){if(e.changedTouches.length!==1||e.touches.length!==0)return;var now=performance.now();if(lastTouchEnd&&now-lastTouchEnd<=320){e.preventDefault();lastTouchEnd=0}else lastTouchEnd=now},{passive:false});
ring.addEventListener("touchcancel",function(){lastTouchEnd=0},{passive:true});
ring.addEventListener("pointerdown",function(e){
  if(pid!==-1)return;                                      // 只跟踪第一根手指
  if(e.pointerType==="mouse"&&e.button!==0)return;         // 鼠标只响应左键
  pid=e.pointerId;drag=false;sx=lx=cx=e.clientX;
  var hit=document.elementFromPoint(e.clientX,e.clientY),card=hit&&hit.closest?hit.closest(".c"):null;
  tapSymbol=card?card.dataset.symbol:null;
  ring.setPointerCapture(pid);
});
ring.addEventListener("pointermove",function(e){
  if(e.pointerId!==pid)return;
  if(!drag){
    if(Math.abs(e.clientX-sx)<SLOP)return;                 // 轻点不打断运动
    drag=true;window.parent.postMessage({type:"VEGAS_CARD_INTERACTION",active:true},"https://mrajjqq.github.io");tapSymbol=null;vel=0;sn=0;lx=cx=e.clientX;wake();return;
  }
  cx=e.clientX;
});
function end(e){
  if(e.pointerId!==pid)return;
  pid=-1;
  if(drag){
    drag=false;window.parent.postMessage({type:"VEGAS_CARD_INTERACTION",active:false},"https://mrajjqq.github.io");pos+=(cx-lx)/Rx;
    var v=fling(performance.now());vel=v>FLING_MAX?FLING_MAX:v<-FLING_MAX?-FLING_MAX:v;
    setDir();if(paused&&(vel>.3||vel<-.3))paused=false;
  }else if(e.type==="pointerup"){                          // 卡片点按选择；双击仍暂停 / 继续
    if(tapSymbol)window.parent.postMessage({type:"VEGAS_CARD_SELECT",symbol:tapSymbol},"https://mrajjqq.github.io");
    var t=performance.now();
    if(t-lastTap<320){paused=!paused;lastTap=0}else lastTap=t;
  }
  tapSymbol=null;
  wake();
}
ring.addEventListener("pointerup",end);
ring.addEventListener("pointercancel",end);
ring.addEventListener("lostpointercapture",end);
ring.addEventListener("wheel",function(e){
  e.preventDefault();
  var d=Math.abs(e.deltaX)>Math.abs(e.deltaY)?e.deltaX:e.deltaY;
  if(e.deltaMode===1)d*=16;else if(e.deltaMode===2)d*=Wd;  // 统一单位，触控板和滚轮手感一致
  vel-=d*.003;vel=vel>FLING_MAX?FLING_MAX:vel<-FLING_MAX?-FLING_MAX:vel;
  setDir();paused=false;wake();
},{passive:false});

/* ---- 系统事件：切后台 / 滚出可视区 / 尺寸变化 ---- */
document.addEventListener("visibilitychange",function(){if(document.hidden)stop();else wake()});
if("IntersectionObserver" in window)new IntersectionObserver(function(en){vis=en[0].isIntersecting;if(vis)wake()}).observe(ring);
var lr=0;
function relayout(){lr=0;layout();wake()}
if("ResizeObserver" in window)new ResizeObserver(function(){if(!lr)lr=requestAnimationFrame(relayout)}).observe(vp);
else addEventListener("resize",function(){if(!lr)lr=requestAnimationFrame(relayout)});

/* ---- 与父页面共用同一份随机轮播顺序 ---- */
window.setCardOrder=function(symbols){
  if(!Array.isArray(symbols)||symbols.length>N)return false;
  var next=new Uint16Array(N),seen=new Uint8Array(N);
  for(var slot=0;slot<symbols.length;slot++){
    var index=-1;
    for(var j=0;j<N;j++){if(SYMS[j][0]===symbols[slot]){index=j;break}}
    if(index<0||seen[index])return false;
    next[slot]=index;seen[index]=1;
  }
  for(var old=0;old<activeCount;old++){
    var oldIndex=order[old];
    if(!seen[oldIndex]&&els[oldIndex]){hid[oldIndex]=1;op[oldIndex]=0;els[oldIndex].style.opacity=0;els[oldIndex].classList.remove("is-visible");els[oldIndex].style.pointerEvents="none";els[oldIndex].remove()}
  }
  var fragment=document.createDocumentFragment();
  for(var slot=0;slot<symbols.length;slot++){
    var index=next[slot];
    if(!els[index])createCard(index);
    if(!els[index].isConnected)fragment.appendChild(els[index]);
  }
  vp.appendChild(fragment);
  order=next;
  activeCount=symbols.length;
  step=activeCount?TAU/activeCount:TAU;
  A=Math.min(SHOW*step,Math.PI*.9);
  pos=0;
  if(activeCount===0){stop();return true}
  layout();
  wake();
  return true;
};
window.addEventListener("message",function(event){
  if(event.origin!=="https://mrajjqq.github.io"||event.source!==window.parent)return;
  if(event.data?.type==="VEGAS_SET_CARD_ORDER")window.setCardOrder(event.data.symbols);
});

/* ---- 行情接口 ---- */
/* 单个：updateQuote(序号, 最新价[, 开盘价]) */
window.updateQuote=function(i,p,o){if(i>=0&&i<N&&Number.isFinite(p)&&p>0){price[i]=p;if(Number.isFinite(o)&&o>0)open[i]=o;dirty[i]=1;wake()}};
/* 批量（推荐，每秒一次）：updateQuotes([[序号,最新价,开盘价?],...]) */
window.updateQuotes=function(l){
  for(var k=0;k<l.length;k++){var q=l[k],i=q[0];if(i>=0&&i<N&&Number.isFinite(q[1])&&q[1]>0){price[i]=q[1];if(Number.isFinite(q[2])&&q[2]>0)open[i]=q[2];dirty[i]=1}}
  wake();
};


window.dispatchEvent(new Event("vegas-cards-ready"));
layout();wake();
})();
