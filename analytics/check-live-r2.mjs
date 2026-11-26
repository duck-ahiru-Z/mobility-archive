import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import G from 'gtfs-realtime-bindings/gtfs-realtime.js';
const config=await fs.readFile(path.join(process.env.APPDATA,'xdg.config/.wrangler/config/default.toml'),'utf8');
const token=config.match(/oauth_token\s*=\s*"([^"]+)"/)?.[1];
if(!token)throw new Error('Cloudflare authentication required');
const base='https://api.cloudflare.com/client/v4/accounts/6e7eb718fcb7f81bf3ee26bade1cb6d5/r2/buckets/mobility-archive-raw/objects';
const headers={Authorization:`Bearer ${token}`};
const now=new Date();const date=now.toISOString().slice(0,10).replaceAll('-','');
const results=[];
for(const source of ['wakayama-bus','wakayama-bus-naga'])for(const feed of ['vehicle-positions','trip-updates']){
 const url=new URL(base);url.searchParams.set('prefix',`raw/gtfs-rt/${source}/${feed}/${date}/${now.toISOString().slice(11,16).replace(':','').slice(0,3)}`);
 url.searchParams.set('limit','1000');const response=await fetch(url,{headers});if(!response.ok)throw new Error(`List HTTP ${response.status}`);
 const listing=await response.json();if(!listing.success)throw new Error('R2 listing failed');
 for(const object of listing.result.sort((a,b)=>a.key.localeCompare(b.key))){
  const r=await fetch(`${base}/${object.key}`,{headers});if(!r.ok)throw new Error(`GET HTTP ${r.status}`);
  const bytes=Buffer.from(await r.arrayBuffer());const message=G.transit_realtime.FeedMessage.decode(bytes);
  const metadata=object.custom_metadata||{};const header=Number(message.header.timestamp);
  results.push({source,feed,key:object.key,fetchedAt:metadata.fetched_at,headerAt:new Date(header*1000).toISOString(),ageSeconds:(Date.parse(metadata.fetched_at)-header*1000)/1000,sha256:createHash('sha256').update(bytes).digest('hex'),entities:message.entity.length,lastModified:metadata.last_modified,positions:message.entity.filter(e=>e.vehicle?.position).map(e=>({entity:e.id,vehicle:e.vehicle.vehicle?.id??null,trip:e.vehicle.trip?.tripId??null,route:e.vehicle.trip?.routeId??null,latitude:e.vehicle.position.latitude,longitude:e.vehicle.position.longitude,vehicleTimestamp:e.vehicle.timestamp?Number(e.vehicle.timestamp):null}))});
 }
}
let previous=[];
try{previous=JSON.parse(await fs.readFile('reports/live-r2-freshness.json','utf8')).results;}catch(error){if(error.code!=='ENOENT')throw error;}
const merged=new Map(previous.map(r=>[r.key,r]));for(const r of results)merged.set(r.key,r);
const result={checkedAt:new Date().toISOString(),results:[...merged.values()].sort((a,b)=>a.key.localeCompare(b.key))};
await fs.writeFile('reports/live-r2-freshness.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
