import {chromium} from "playwright";
const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
page.on("pageerror",e=>errors.push(e.message));
try{
 await page.goto("http://127.0.0.1:8765/",{waitUntil:"domcontentloaded"});
 await page.bringToFront();
 await page.waitForFunction(()=>document.visibilityState==="visible",{timeout:10000});
 await page.waitForFunction(()=>typeof window.setCardOrder==="function",{timeout:30000});
 await page.waitForFunction(()=>window.__CC_READY__===true,{timeout:30000});
 await page.waitForFunction(()=>["#logo-frame","#timeframe-frame","#rolling-cards-frame"].every(s=>{const e=document.querySelector(s);return e?.classList.contains("is-ready")&&Number(getComputedStyle(e).opacity)>=0.99}),{timeout:15000});
 const data=await page.evaluate(async()=>{
  const [summary,universe,signals]=await Promise.all(["summary.json","universe.json","signals.json"].map(async n=>{const r=await fetch("./data/"+n);if(!r.ok)throw new Error(n+" unavailable");return r.json()}));
  const expected=signals.filter(x=>x.confirmation_date===summary.market_date&&universe.some(s=>s.symbol===x.symbol)).length;
  const moduleState=Object.fromEntries(["#logo-frame","#timeframe-frame","#rolling-cards-frame"].map(s=>{const e=document.querySelector(s);return[s,{opacity:getComputedStyle(e).opacity,ready:e.classList.contains("is-ready")}]}));
  const visible=Object.values(moduleState).every(x=>Number(x.opacity)>=0.99);
  const symbol=universe[0]?.symbol;if(!symbol)throw new Error("No eligible chart symbol");
  const r=await fetch("./data/charts/"+encodeURIComponent(symbol)+".json.gz");if(!r.ok)throw new Error("Compressed chart missing");
  const chart=await new Response(new Blob([await r.arrayBuffer()]).stream().pipeThrough(new DecompressionStream("gzip"))).json();
  return {expected,active:document.querySelectorAll("#vp>.c").length,bars:chart.bars?.length||0,ticker:document.querySelector("#signal-track").textContent.trim(),visible,visibilityState:document.visibilityState,moduleState};
 });
 console.log("CC browser diagnostics:",JSON.stringify(data));
 if(data.bars<1||data.active!==data.expected||!data.ticker||!data.visible)throw new Error("A-share data/card/ticker/module visibility contract failed");
 for(const v of [{width:390,height:844},{width:844,height:390},{width:320,height:740},{width:768,height:1024},{width:1024,height:768}]){
  await page.setViewportSize(v);await page.waitForTimeout(80);
  const l=await page.evaluate(()=>Object.fromEntries(["#app","#page-background","#logo-frame","#timeframe-frame","#kline-host","#rolling-cards-frame","#signal-ticker"].map(s=>{const r=document.querySelector(s).getBoundingClientRect();return[s,{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,z:getComputedStyle(document.querySelector(s)).zIndex}]})));
  for(const s of ["#app","#page-background","#logo-frame","#kline-host","#rolling-cards-frame"])if(l[s].width<v.width-2||l[s].left< -1||l[s].right>v.width+1)throw new Error("Viewport bounds failed: "+s);
  if(l["#signal-ticker"].width<=0||l["#signal-ticker"].left<0||l["#signal-ticker"].right>v.width+1||l["#signal-ticker"].width>v.width-10)throw new Error("Ticker safe-area bounds failed at "+v.width+"x"+v.height+": "+JSON.stringify(l["#signal-ticker"]));
  const logo=await page.evaluate(()=>{const f=document.querySelector("#logo-frame"),d=f.contentDocument,w=f.clientWidth;const ids=["#logo-brand","#logo-line","#logo-image","#logo-symbol","#logo-code","#logo-countdown"];return {frameWidth:w,items:Object.fromEntries(ids.map(s=>{const e=d?.querySelector(s);if(!e)return[s,null];const r=e.getBoundingClientRect();return[s,{left:r.left,right:r.right,width:r.width,height:r.height,fontSize:getComputedStyle(e).fontSize}]}))}});
  if(!logo.items["#logo-brand"]||logo.items["#logo-brand"].left<0||logo.items["#logo-brand"].right>logo.frameWidth+1)throw new Error("Logo container overflow at "+v.width+"x"+v.height+": "+JSON.stringify(logo));
  for(const s of ["#logo-line","#logo-image","#logo-symbol","#logo-code","#logo-countdown"]){const x=logo.items[s];if(x&&(x.left<0||x.right>logo.frameWidth+1))throw new Error("Logo child overflow "+s+" at "+v.width+"x"+v.height+": "+JSON.stringify(x))}
  const tickerText=await page.evaluate(()=>{const e=document.querySelector("#signal-track .signal-row")||document.querySelector("#signal-track .signal-empty");return e?parseFloat(getComputedStyle(e).fontSize):0});
  if(tickerText<9)throw new Error("Ticker text below 9px at "+v.width+"x"+v.height);
  if(l["#kline-host"].top>1||l["#kline-host"].left>1||l["#kline-host"].right<v.width-1||l["#kline-host"].bottom<v.height-1)throw new Error("Full-screen K-line viewport contract failed");
  if(l["#rolling-cards-frame"].bottom<v.height-1||l["#signal-ticker"].bottom<v.height-1)throw new Error("Bottom overlay alignment failed");
  if(l["#timeframe-frame"].left<0||l["#timeframe-frame"].right>v.width+1||l["#timeframe-frame"].bottom>v.height+1)throw new Error("Timeframe safe-area bounds failed");
 }
 if(errors.length)throw new Error(errors.join(" | "));
 for(let pass=1;pass<=2;pass++){
  await page.reload({waitUntil:"domcontentloaded"});
  await page.waitForFunction(()=>window.__CC_READY__===true&&typeof window.setCardOrder==="function",{timeout:30000});
  await page.waitForFunction(()=>["#logo-frame","#timeframe-frame","#rolling-cards-frame"].every(s=>document.querySelector(s)?.classList.contains("is-ready")),{timeout:15000});
  const counts=await page.evaluate(()=>({mainCanvas:document.querySelectorAll("#kline-host>canvas").length,overlayCanvas:document.querySelectorAll("#kline-host>canvas[aria-hidden=true]").length,logoFrames:document.querySelectorAll("#logo-frame").length,timeframeFrames:document.querySelectorAll("#timeframe-frame").length,cardNodes:document.querySelectorAll("#vp>.c").length,tickerCycles:document.querySelectorAll("#signal-track>.signal-cycle").length}));
  if(counts.mainCanvas!==2||counts.overlayCanvas!==1||counts.logoFrames!==1||counts.timeframeFrames!==1)throw new Error("Reload left duplicate core module DOM: "+JSON.stringify(counts));
  if(counts.cardNodes!==data.expected)throw new Error("Reload left stale/duplicate card DOM: "+JSON.stringify(counts));
  if(counts.tickerCycles<1)throw new Error("Ticker did not recover after reload");
  console.log("CC reload pass "+pass+":",JSON.stringify(counts));
 }
 await page.evaluate(()=>{window.dispatchEvent(new PageTransitionEvent("pagehide",{persisted:true}));window.dispatchEvent(new PageTransitionEvent("pageshow",{persisted:true}))});
 await page.waitForFunction(()=>document.documentElement.classList.contains("page-hidden")===false);
 const restored=await page.evaluate(()=>({ticker:document.querySelector("#signal-track").textContent.trim(),canvas:document.querySelectorAll("#kline-host>canvas").length,frames:document.querySelectorAll("#logo-frame,#timeframe-frame,#rolling-cards-frame").length}));
 if(!restored.ticker||restored.canvas!==2||restored.frames!==3)throw new Error("BFCache-style pageshow recovery failed: "+JSON.stringify(restored));
 if(errors.length)throw new Error(errors.join(" | "));
 console.log("CC BFCache-style recovery:",JSON.stringify(restored));
 console.log("CC browser smoke passed: Tencent daily chart, CN500 signal cards, ticker, five viewport layouts, and two reload cycles.");
}finally{await browser.close()}
