import fs from 'node:fs/promises';
import G from 'gtfs-realtime-bindings/gtfs-realtime.js';
const originals=JSON.parse(await fs.readFile('reports/r2-original-check/comparison.json','utf8'));
const seen=new Set(),groups=new Map();
const has=(o,k)=>o!=null&&Object.prototype.hasOwnProperty.call(o,k);
for(let i=0;i<originals.length;i++){
 const sample=originals[i];if(sample.feed!=='trip-updates')continue;
 const identity=sample.date+'/'+sample.source+'/'+sample.rawHash;if(seen.has(identity))continue;seen.add(identity);
 const lookup=JSON.parse((await fs.readFile(`reports/static-check/${sample.date}/${sample.source}/lookup.json`,'utf8')).replace(/^\uFEFF/,''));
 const stops=new Set(lookup.stops.map(s=>s.stop_id));
 const bytes=await fs.readFile(`reports/r2-original-check/${sample.date}-${sample.source}-${sample.feed}-${i}.pb`);
 const feed=G.transit_realtime.FeedMessage.decode(bytes);
 const key=sample.date+'/'+sample.source;
 const result=groups.get(key)||{date:sample.date,source:sample.source,uniqueSnapshots:0,tripUpdates:0,tripDelayValues:[],stopUpdates:0,stopIdPresent:0,stopJoined:0,arrivalDelayValues:[],departureDelayValues:[],arrivalTimePresent:0,departureTimePresent:0};result.uniqueSnapshots++;
 for(const entity of feed.entity){const t=entity.tripUpdate;if(!t)continue;result.tripUpdates++;if(has(t,'delay'))result.tripDelayValues.push(t.delay);
  for(const stop of t.stopTimeUpdate){result.stopUpdates++;if(has(stop,'stopId')){result.stopIdPresent++;if(stops.has(stop.stopId))result.stopJoined++;}
   for(const event of ['arrival','departure']){const e=stop[event];if(has(e,'delay'))result[event+'DelayValues'].push(e.delay);if(has(e,'time'))result[event+'TimePresent']++;}
  }
 }groups.set(key,result);
}
function stats(values){if(!values.length)return {count:0};const a=[...values].sort((a,b)=>a-b);return {count:a.length,meanSeconds:a.reduce((a,b)=>a+b,0)/a.length,medianSeconds:a.length%2?a[(a.length-1)/2]:(a[a.length/2-1]+a[a.length/2])/2,maxSeconds:a.at(-1),minSeconds:a[0]};}
const report={scope:'Five adjacent archived snapshots per source/date, deduplicated by raw SHA-256; not daily delay statistics',method:'Only explicitly present protobuf delay fields, seconds; arrival/departure/trip kept separate. No schedule-derived delay inferred.',groups:[...groups.values()].map(r=>({...r,tripDelayValues:stats(r.tripDelayValues),arrivalDelayValues:stats(r.arrivalDelayValues),departureDelayValues:stats(r.departureDelayValues)}))};
await fs.writeFile('reports/original-delay-audit.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
