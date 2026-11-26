import {S3Client,ListObjectsV2Command,GetObjectCommand} from '@aws-sdk/client-s3';
import G from 'gtfs-realtime-bindings';
import {listAllObjects} from './daily-archive-lib.mjs';
import {inspectSnapshot} from './realtime-health.mjs';
const now=Date.now(), cutoff=now-15*60000;
const client=new S3Client({region:'auto',endpoint:`https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,credentials:{accessKeyId:process.env.R2_ACCESS_KEY_ID,secretAccessKey:process.env.R2_SECRET_ACCESS_KEY},maxAttempts:3,requestHandler:{connectionTimeout:10000,requestTimeout:30000}});
const bucket=process.env.R2_BUCKET||'mobility-archive-raw';
const issues=[], results=[];
const prefixes=[...new Set([cutoff,now].map(t=>{const iso=new Date(t).toISOString();return iso.slice(0,10).replaceAll('-','')+'/'+iso.slice(11,13);} ))];
for(const source of ['wakayama-bus','wakayama-bus-naga']) for(const feed of ['vehicle-positions','trip-updates']){
  try{
    const objects=[];
    for(const prefix of prefixes) objects.push(...await listAllObjects(client,input=>new ListObjectsV2Command(input),{bucket,prefix:`raw/gtfs-rt/${source}/${feed}/${prefix}`,log:()=>{}}));
    objects.sort((a,b)=>a.Key.localeCompare(b.Key));
    const latest=objects.at(-1);
    if(!latest)throw new Error('No saved objects');
    const response=await client.send(new GetObjectCommand({Bucket:bucket,Key:latest.Key}));
    const bytes=await response.Body.transformToByteArray();
    const message=G.transit_realtime.FeedMessage.decode(bytes);
    const health=inspectSnapshot({now,fetchedAt:response.Metadata?.fetched_at,httpStatus:response.Metadata?.http_status,bytes:bytes.length,message});
    if(health.stale)issues.push(`${source}/${feed}: stale or invalid header timestamp`);
    results.push({source,feed,...health});
  }catch(error){issues.push(`${source}/${feed}: ${error.name==='Error'?error.message:'R2 or decode failure'}`);}
}
console.log(JSON.stringify({checked_at:new Date(now).toISOString(),results,issues},null,2));
for(const issue of issues)console.log(`::error title=Realtime archive health::${issue}`);
if(process.env.GITHUB_STEP_SUMMARY){const fs=await import('node:fs/promises');await fs.appendFile(process.env.GITHUB_STEP_SUMMARY,`## Realtime archive health\n${issues.length?'FAILED':'PASSED'}\n\n`+results.map(r=>`- ${r.source}/${r.feed}: ${r.fetched_at}, ${r.entities} entities, header age ${(r.header_age_seconds == null ? 'unknown' : r.header_age_seconds.toFixed(1))} seconds${r.valid_empty_feed?' (valid empty)':''}`).join('\n')+'\n'+issues.map(x=>`- ${x}`).join('\n'));}
if(issues.length)process.exitCode=1;

