import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import G from 'gtfs-realtime-bindings/gtfs-realtime.js';

// Read-only diagnostic: no R2 writes and no Collector invocation.
const output=[];
for(const file of await fs.readdir('sources')) {
  if(!file.endsWith('.json')) continue;
  const source=JSON.parse(await fs.readFile(`sources/${file}`,'utf8'));
  if(!source.enabled) continue;
  for(const type of ['vehicle_positions','trip_updates']) {
    for(const mode of ['default','no-store']) {
      const requested_at=new Date().toISOString();
      try {
        const response=await fetch(source.feeds[type],{cache:mode,signal:AbortSignal.timeout(20000)});
        const bytes=Buffer.from(await response.arrayBuffer());
        const result={source_id:source.id,feed_type:type,mode,requested_at,fetched_at:new Date().toISOString(),http_status:response.status,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),headers:{}};
        for(const name of ['date','age','cache-control','expires','etag','last-modified','cf-cache-status','via','server']) result.headers[name]=response.headers.get(name);
        if(response.ok) {
          try {
            const feed=G.transit_realtime.FeedMessage.decode(bytes);
            const seconds=Number(feed.header.timestamp);
            result.header_timestamp=Number.isFinite(seconds)&&seconds>0?new Date(seconds*1000).toISOString():null;
            result.age_seconds=result.header_timestamp?(Date.parse(result.fetched_at)-seconds*1000)/1000:null;
            result.entity_count=feed.entity.length;
            result.status=feed.entity.length?'valid_nonempty_feed':'valid_empty_feed';
          } catch(error) {result.status='invalid_protobuf';result.error=error.message;}
        } else result.status='http_failure';
        output.push(result);
      } catch(error) {output.push({source_id:source.id,feed_type:type,mode,requested_at,status:'fetch_failure',error:error.message,cause:error.cause?.code??null});}
    }
  }
}
console.log(JSON.stringify({runtime:'local Node fetch; does not exercise Cloudflare outbound cache',generated_at:new Date().toISOString(),results:output},null,2));
if(output.some(x=>['fetch_failure','http_failure','invalid_protobuf'].includes(x.status))) process.exitCode=1;
