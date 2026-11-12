const DB_NAME="cc-market-cache",DB_VERSION=1,STORE="candles";
const CACHE_SOURCE="CC Tencent A-share qfq",TIMEFRAME="1D",CACHE_PREFIX="cc-tencent-qfq:";
const CACHE_SCHEMA=3,MAX_CACHED_CANDLES=1200,MAX_CACHE_SYMBOLS=40;
const keyOf=symbol=>CACHE_PREFIX+symbol+":"+TIMEFRAME;
const merge=(...groups)=>{const rows=new Map();for(const group of groups)for(const candle of group||[])rows.set(candle.t,candle);return [...rows.values()].sort((a,b)=>a.t-b.t)};
const boundedMerge=(...groups)=>merge(...groups).slice(-MAX_CACHED_CANDLES);
function normalize(rows){
 return (Array.isArray(rows)?rows:[]).map(row=>({
  t:Date.parse(String(row[0])+"T00:00:00Z"),
  o:Number(row[1]),h:Number(row[2]),l:Number(row[3]),c:Number(row[4])
 })).filter(c=>Number.isFinite(c.t)&&c.t>0&&[c.o,c.h,c.l,c.c].every(v=>Number.isFinite(v)&&v>0)&&c.h>=Math.max(c.o,c.c)&&c.l<=Math.min(c.o,c.c)&&c.h>=c.l);
}
function openDB(){
 return new Promise((resolve,reject)=>{
  if(!("indexedDB" in window)){reject(new Error("IndexedDB unavailable; durable K-line cache cannot start"));return}
  const request=indexedDB.open(DB_NAME,DB_VERSION);
  request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(STORE))request.result.createObjectStore(STORE,{keyPath:"id"})};
  request.onsuccess=()=>{request.result.onversionchange=()=>request.result.close();resolve(request.result)};
  request.onerror=()=>reject(request.error||new Error("IndexedDB open failed"));
  request.onblocked=()=>reject(new Error("IndexedDB upgrade blocked"));
 });
}
async function decodeChart(response){
 if(!response.ok)throw new Error("Tencent daily chart HTTP "+response.status);
 const bytes=await response.arrayBuffer();
 try{
  if(!("DecompressionStream" in window))throw new Error("GZIP decompression is not supported");
  const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).json();
 }catch(gzipError){
  try{return JSON.parse(new TextDecoder().decode(bytes))}
  catch(_){throw gzipError}
 }
}

const MEMORY_MAX_PER_SYMBOL=1200,MEMORY_MAX_SYMBOLS=8;
const memoryCache=new Map();
let dbp=null,dbRetryAt=0,storageCheckAt=0;
async function getDB(onState=()=>{}){
 if(dbp)return dbp;
 if(Date.now()<dbRetryAt)return null;
 dbp=openDB().catch(error=>{
  dbRetryAt=Date.now()+15000;dbp=null;
  onState({status:"cache-unavailable",mode:"memory-fallback",retryInMs:15000,error:String(error?.message||error)});
  return null;
 });
 return dbp;
}
function trimMemory(){
 while(memoryCache.size>MEMORY_MAX_SYMBOLS){
  let oldestKey=null,oldest=Infinity;
  for(const [key,value] of memoryCache){if((value.updatedAt||0)<oldest){oldest=value.updatedAt||0;oldestKey=key}}
  if(oldestKey===null)break;
  memoryCache.delete(oldestKey);
 }
}
function putMemory(key,previous,rows,complete,status,error){
 const rawCount=(previous?.candles?.length||0)+(rows?.length||0);
 const data=boundedMerge(previous?.candles||[],rows||[]);
 const truncated=rawCount>MEMORY_MAX_PER_SYMBOL;
 memoryCache.set(key,{candles:data,historyComplete:complete===true&&!truncated,updatedAt:Date.now(),latestGapStatus:"not-assessed-by-trading-calendar",requestStatus:status||"memory-fallback",lastError:error?String(error):null,cacheMode:"memory",truncated});
 trimMemory();
}
async function checkStorage(onState=()=>{}){
 if(Date.now()-storageCheckAt<300000||!navigator.storage?.estimate)return;
 storageCheckAt=Date.now();
 try{
  const estimate=await navigator.storage.estimate(),usage=Number(estimate.usage)||0,quota=Number(estimate.quota)||0,ratio=quota?usage/quota:0;
  if(ratio>=.8)onState({status:"cache-storage-pressure",usageBytes:usage,quotaBytes:quota,usageRatio:ratio,level:ratio>=.9?"critical":"warning"});
 }catch(_){}
}
function retryDelay(ms,signal){
 return new Promise((resolve,reject)=>{
  if(signal.aborted){reject(new DOMException("Aborted","AbortError"));return}
  const finish=()=>{signal.removeEventListener("abort",abort);resolve()};
  const timer=setTimeout(finish,ms);
  function abort(){clearTimeout(timer);signal.removeEventListener("abort",abort);reject(new DOMException("Aborted","AbortError"))}
  signal.addEventListener("abort",abort,{once:true});
 });
}

export function createTencentKlineController({frame,isHidden=()=>document.hidden,onState=()=>{}}={}){
 const inflight=new Set();
 let symbol="",candles=[],historyComplete=false,selection=0,activeRequest=null,destroyed=false,paused=false,selectedExpectedDate="";
 const canWork=()=>!destroyed&&!paused&&!isHidden();
 async function read(key){
  const db=await getDB(onState);if(!db)return memoryCache.get(key)||{candles:[],historyComplete:false,updatedAt:0,latestGapStatus:"pending",cacheMode:"memory"};
  return new Promise((resolve,reject)=>{
   let tx;try{tx=db.transaction(STORE,"readonly")}catch(error){reject(error);return}
   const request=tx.objectStore(STORE).get(key);
   request.onsuccess=()=>{const value=request.result;resolve(value&&value.source===CACHE_SOURCE&&value.adjust==="qfq"&&value.timeframe===TIMEFRAME&&value.schemaVersion===CACHE_SCHEMA&&Array.isArray(value.candles)?{...value,candles:value.candles.slice(-MAX_CACHED_CANDLES)}:{candles:[],historyComplete:false,updatedAt:0,latestGapStatus:"pending"})};
   request.onerror=()=>reject(request.error||new Error("IndexedDB read failed"));
   tx.onerror=()=>reject(tx.error||new Error("IndexedDB read transaction failed"));
  });
 }
 async function write(key,rows,complete,status="ok",error=null){
  const db=await getDB(onState);if(!db){putMemory(key,memoryCache.get(key)||{},rows,complete,status,error);return;}
  await new Promise((resolve,reject)=>{
   let tx;try{tx=db.transaction(STORE,"readwrite")}catch(e){reject(e);return}
   const store=tx.objectStore(STORE),request=store.get(key);
   request.onsuccess=()=>{
    const value=request.result||{};
    const previous=value.source===CACHE_SOURCE&&value.adjust==="qfq"&&value.timeframe===TIMEFRAME&&value.schemaVersion===CACHE_SCHEMA&&Array.isArray(value.candles)?value.candles:[];
    const data=boundedMerge(previous,rows);
    const newest=data.at(-1)?.t??null,oldest=data[0]?.t??null;
    store.put({
     id:key,source:CACHE_SOURCE,adjust:"qfq",timeframe:TIMEFRAME,schemaVersion:CACHE_SCHEMA,
     updatedAt:Date.now(),historyComplete:complete===true,
     historyBoundaryReached:complete===true,
     historyBoundaryStatus:complete===true?"tencent-full-history-snapshot":"not-yet-confirmed",
     latestGapStatus:"clear",requestStatus:status,lastError:error,
     candleCount:data.length,oldestTimestamp:oldest,newestTimestamp:newest,candles:data
    });
    const all=store.getAll();
    all.onsuccess=()=>{
     const owned=all.result.filter(row=>typeof row.id==="string"&&row.id.startsWith(CACHE_PREFIX));
     const current=owned.filter(row=>row.schemaVersion===CACHE_SCHEMA&&row.source===CACHE_SOURCE&&row.adjust==="qfq"&&row.timeframe===TIMEFRAME);
     for(const row of owned)if(row.schemaVersion!==CACHE_SCHEMA||row.source!==CACHE_SOURCE||row.adjust!=="qfq"||row.timeframe!==TIMEFRAME)store.delete(row.id);
     current.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
     for(const row of current.slice(MAX_CACHE_SYMBOLS))store.delete(row.id);
    };
    all.onerror=()=>{tx.abort()};
   };
   request.onerror=()=>reject(request.error||new Error("IndexedDB cache merge failed"));
   tx.oncomplete=()=>resolve();
   tx.onerror=tx.onabort=()=>reject(tx.error||new Error("IndexedDB write failed"));
  }).catch(cacheError=>{putMemory(key,memoryCache.get(key)||{},rows,complete,status,cacheError);onState({symbol,timeframe:TIMEFRAME,count:rows.length,historyComplete:false,status:"cache-write-fallback",mode:"memory",error:String(cacheError?.message||cacheError)});}).then(()=>checkStorage(onState));
 }
 function render(rows,token,complete,status,error=""){
  if(destroyed||token!==selection)return;
  const target=frame?.contentWindow;if(!target)return;
  target.setCandles?.(rows);
  target.setVegasEmaCandles?.(rows);
  target.setHistoryStatus?.(symbol,rows.length,complete,status,error,TIMEFRAME);
  onState({symbol,timeframe:TIMEFRAME,count:rows.length,historyComplete:complete,status,error});
 }
 async function fetchSnapshot(nextSymbol,token,signal){
  let lastError=null;
  for(let attempt=0;attempt<3;attempt++){
   try{
    const response=await fetch("./data/charts/"+encodeURIComponent(nextSymbol)+".json.gz",{cache:"no-cache",signal});
    if(response.status===404)throw Object.assign(new Error("Tencent daily chart HTTP 404"),{permanent:true});
    if(!response.ok)throw new Error("Tencent daily chart HTTP "+response.status);
    return await decodeChart(response);
   }catch(error){
    if(error?.name==="AbortError"||signal.aborted||error?.permanent)throw error;
    lastError=error;if(attempt===2)break;
    await retryDelay(350*Math.pow(2,attempt),signal);
   }
  }
  throw lastError||new Error("Tencent daily chart unavailable");
 }
 async function select(nextSymbol,expectedLastDate=selectedExpectedDate){
  if(destroyed||!nextSymbol)return false;
  selectedExpectedDate=String(expectedLastDate||"");
  selection++;const token=selection;symbol=nextSymbol;historyComplete=false;frame?.contentWindow?.migrateLegacyViewportKey?.(nextSymbol);
  if(activeRequest)activeRequest.abort();
  if(!canWork())return false;
  const key=keyOf(nextSymbol),request=new AbortController();activeRequest=request;inflight.add(request);
  try{
   let cached;try{cached=await read(key)}catch(cacheError){cached=memoryCache.get(key)||{candles:[],historyComplete:false,updatedAt:0};onState({symbol,timeframe:TIMEFRAME,count:cached.candles.length,historyComplete:false,status:"cache-unavailable",mode:"memory-fallback",error:String(cacheError?.message||cacheError)})}
   if(!canWork()||token!==selection)return false;
   candles=boundedMerge(cached.candles);historyComplete=cached.historyComplete===true;
   if(candles.length)render(candles,token,historyComplete,"cache-loaded");
   onState({symbol,timeframe:TIMEFRAME,count:candles.length,historyComplete,status:"cache-loaded"});
   const expectedNewest=selectedExpectedDate?Date.parse(selectedExpectedDate+"T00:00:00Z"):NaN;
   const cacheMatchesDate=!Number.isFinite(expectedNewest)||cached.newestTimestamp===expectedNewest;
   if(candles.length&&cacheMatchesDate&&Number.isFinite(cached.updatedAt)&&Date.now()-cached.updatedAt<5*60*1000){
    onState({symbol,timeframe:TIMEFRAME,count:candles.length,historyComplete,status:"cache-fresh"});
    return true;
   }
   const payload=await fetchSnapshot(nextSymbol,token,request.signal);
   if(!canWork()||token!==selection)return false;
   const fresh=normalize(payload?.bars);
   if(!fresh.length)throw new Error("Tencent returned no valid daily candles");
   const merged=boundedMerge(candles,fresh),complete=payload.history_complete===true;
   candles=merged;historyComplete=complete;
   render(candles,token,complete,"ready");
   try{await write(key,merged,complete,"snapshot-updated")}catch(cacheError){onState({symbol,timeframe:TIMEFRAME,count:candles.length,historyComplete,status:"cache-write-failed",error:String(cacheError?.message||cacheError)})}
   return true;
  }catch(error){
   if(error?.name==="AbortError"||token!==selection)return false;
   render(candles,token,historyComplete,"request-failed",String(error?.message||error));
   onState({symbol,timeframe:TIMEFRAME,count:candles.length,historyComplete,status:"request-failed",error:String(error?.message||error)});
   return false;
  }finally{inflight.delete(request);if(activeRequest===request)activeRequest=null}
 }
 async function refresh(){
  if(!symbol||!canWork())return false;
  return select(symbol,selectedExpectedDate);
 }
 function setExpectedLastDate(value){selectedExpectedDate=String(value||"")}
 function suspend(){
  paused=true;
  for(const request of inflight)request.abort("page-hidden");
 }
 function resume(){if(destroyed||isHidden())return;paused=false;if(symbol)void select(symbol,selectedExpectedDate)}
 function destroy(){
  if(destroyed)return;destroyed=true;paused=true;selection++;
  for(const request of inflight)request.abort("controller-destroyed");
  inflight.clear();activeRequest=null;
  if(dbp)dbp.then(db=>db?.close()).catch(()=>{});
 }
 return Object.freeze({select,refresh,setExpectedLastDate,resume,suspend,destroy,get state(){return Object.freeze({symbol,timeframe:TIMEFRAME,count:candles.length,historyComplete})}});
}
