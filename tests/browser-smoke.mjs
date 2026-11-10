import {chromium} from "playwright";
const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
page.on("pageerror",e=>errors.push(e.message));
try{
 await page.goto("http://127.0.0.1:8765/",{waitUntil:"domcontentloaded"});
 await page.waitForFunction(()=>typeof window.setCardOrder==="function",{timeout:30000});
 await page.waitForFunction(()=>window.__CC_READY__===true,{timeout:30000});
 const data=await page.evaluate(async()=>{
  const [summary,universe,signals]=await Promise.all(["summary.json","universe.json","signals.json"].map(async n=>{const r=await fetch("./data/"+n);if(!r.ok)throw new Error(n+" unavailable");return r.json()}));
  const expected=signals.filter(x=>x.confirmation_date===summary.market_date&&universe.some(s=>s.symbol===x.symbol)).length;
  const symbol=universe[0]?.symbol;if(!symbol)throw new Error("No eligible chart symbol");
  const r=await fetch("./data/charts/"+encodeURIComponent(symbol)+".json.gz");if(!r.ok)throw new Error("Compressed chart missing");
  const chart=await new Response(new Blob([await r.arrayBuffer()]).stream().pipeThrough(new DecompressionStream("gzip"))).json();
  return {expected,active:document.querySelectorAll("#vp>.c").length,bars:chart.bars?.length||0,ticker:document.querySelector("#signal-track").textContent.trim()};
 });
 if(data.bars<1||data.active!==data.expected||!data.ticker)throw new Error("A-share data/card/ticker contract failed");
 for(const v of [{width:390,height:844},{width:844,height:390},{width:320,height:740},{width:768,height:1024},{width:1024,height:768}]){
  await page.setViewportSize(v);await page.waitForTimeout(80);
  const l=await page.evaluate(()=>Object.fromEntries(["#app","#page-background","#logo-frame","#timeframe-frame","#kline-host","#rolling-cards-frame","#signal-ticker"].map(s=>{const r=document.querySelector(s).getBoundingClientRect();return[s,{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,z:getComputedStyle(document.querySelector(s)).zIndex}]})));
  for(const s of ["#app","#page-background","#logo-frame","#kline-host","#rolling-cards-frame","#signal-ticker"])if(l[s].width<innerWidth-2||l[s].left< -1||l[s].right>innerWidth+1)throw new Error("Viewport bounds failed: "+s);
  if(l["#kline-host"].top<l["#logo-frame"].bottom-1||l["#kline-host"].bottom>l["#rolling-cards-frame"].top+1)throw new Error("K-line panel overlap");
  if(l["#rolling-cards-frame"].bottom>l["#signal-ticker"].top+1)throw new Error("Card/ticker overlap");
 }
 if(errors.length)throw new Error(errors.join(" | "));
 console.log("CC browser smoke passed: Tencent daily chart, CN500 signal cards, ticker, and five viewport layouts.");
}finally{await browser.close()}
