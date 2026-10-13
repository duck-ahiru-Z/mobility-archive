import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import zlib from 'node:zlib';
import {promisify} from 'node:util';
import {S3Client,GetObjectCommand,ListObjectsV2Command} from '@aws-sdk/client-s3';
import {listAllObjects,localDateOfKey,utcDatesForJstDate} from './daily-archive-lib.mjs';

const gzip=promisify(zlib.gzip);
const gunzip=promisify(zlib.gunzip);
const MAGIC=Buffer.from('MOBILITY-RAW-BACKUP\u0001\n');
const sources=['wakayama-bus','wakayama-bus-naga'];
const feeds=['vehicle-positions','trip-updates'];

function safeRelativeKey(key){
  if(typeof key!=='string'||!key||key.startsWith('/')||key.includes('\\')||key.split('/').some(p=>p==='..'||p==='.'||p==='')) throw new Error('Unsafe object key in R2 listing');
  return key;
}

function metadataFor(response){
  return {
    content_type:response.ContentType??null,
    content_length:Number(response.ContentLength??0),
    etag:response.ETag??null,
    last_modified:response.LastModified?.toISOString?.()??null,
    version_id:response.VersionId??null,
    cache_control:response.CacheControl??null,
    content_disposition:response.ContentDisposition??null,
    content_encoding:response.ContentEncoding??null,
    expires:response.Expires?.toISOString?.()??null,
    storage_class:response.StorageClass??null,
    custom_metadata:Object.fromEntries(Object.entries(response.Metadata??{}).sort(([a],[b])=>a.localeCompare(b)))
  };
}

function jsonBytes(value){return Buffer.from(JSON.stringify(value));}
function frame(header,payload){
  const h=jsonBytes(header), p=Buffer.from(payload);
  const prefix=Buffer.alloc(12);prefix.writeUInt32BE(h.length,0);prefix.writeBigUInt64BE(BigInt(p.length),4);
  return Buffer.concat([prefix,h,p]);
}

export async function makeArchive(entries,manifest){
  const chunks=[MAGIC];
  for(const entry of entries) chunks.push(frame({key:safeRelativeKey(entry.key),metadata:entry.metadata,sha256:entry.sha256},entry.body));
  const trailer=jsonBytes(manifest), length=Buffer.alloc(4);length.writeUInt32BE(0,0);
  const trailerLength=Buffer.alloc(4);trailerLength.writeUInt32BE(trailer.length,0);
  chunks.push(length,trailerLength,trailer);
  return gzip(Buffer.concat(chunks),{level:9});
}

export async function restoreArchive(archive,destination){
  const data=await gunzip(archive);
  if(!data.subarray(0,MAGIC.length).equals(MAGIC)) throw new Error('Backup archive signature mismatch');
  let offset=MAGIC.length;const entries=[];let manifest;
  while(offset<data.length){
    if(offset+4>data.length)throw new Error('Truncated archive frame');
    const hlen=data.readUInt32BE(offset);offset+=4;
    if(hlen===0){
      if(offset+4>data.length)throw new Error('Missing archive manifest length');
      const mlen=data.readUInt32BE(offset);offset+=4;
      if(offset+mlen!==data.length)throw new Error('Archive manifest length mismatch');
      manifest=JSON.parse(data.subarray(offset,offset+mlen).toString('utf8'));offset+=mlen;break;
    }
    if(offset+8+hlen>data.length)throw new Error('Truncated archive header');
    const size=data.readBigUInt64BE(offset);offset+=8;
    if(size>BigInt(Number.MAX_SAFE_INTEGER)||offset+hlen+Number(size)>data.length)throw new Error('Invalid archive payload length');
    const header=JSON.parse(data.subarray(offset,offset+hlen).toString('utf8'));offset+=hlen;
    const body=data.subarray(offset,offset+Number(size));offset+=Number(size);
    const key=safeRelativeKey(header.key),digest=crypto.createHash('sha256').update(body).digest('hex');
    if(digest!==header.sha256)throw new Error(`Payload checksum mismatch for ${key}`);
    const objectPath=path.join(destination,'objects',...key.split('/'));
    const metadataPath=path.join(destination,'metadata',...key.split('/'))+'.json';
    await fs.mkdir(path.dirname(objectPath),{recursive:true});await fs.mkdir(path.dirname(metadataPath),{recursive:true});
    await fs.writeFile(objectPath,body,{flag:'wx'});
    await fs.writeFile(metadataPath,JSON.stringify(header.metadata,null,2)+'\n',{flag:'wx'});
    entries.push({key,sha256:digest,size:Number(size),metadata:header.metadata});
  }
  if(!manifest||offset!==data.length)throw new Error('Archive manifest missing or trailing bytes detected');
  if(entries.length!==manifest.entries.length)throw new Error('Restored object count differs from archive manifest');
  const expected=new Map(manifest.entries.map(e=>[e.key,e]));
  for(const entry of entries){const m=expected.get(entry.key);if(!m||m.sha256!==entry.sha256||m.size!==entry.size||JSON.stringify(m.metadata)!==JSON.stringify(entry.metadata))throw new Error(`Restored metadata/checksum mismatch for ${entry.key}`);}
  return entries;
}

async function readBody(body){return Buffer.from(await body.transformToByteArray());}
async function readExpected(manifestPath){
  const m=JSON.parse(await fs.readFile(manifestPath,'utf8'));
  if(m.date!=='2026-10-09'||m.timezone!=='Asia/Tokyo')throw new Error('Expected manifest does not describe 2026-10-09 JST');
  const feedCounts=new Map();
  for(const source of m.sources??[])for(const feed of source.feeds??[])feedCounts.set(`${source.source_id}/${feed.feed_type}`,feed.saved_raw_object_count);
  return {manifest:m,total:m.saved_raw_object_count,feedCounts};
}

export async function runVerification({env=process.env,targetDate=process.env.BACKUP_DATE??'2026-10-09',manifestPath=process.env.EXPECTED_MANIFEST_PATH}={}){
  if(targetDate!=='2026-10-09')throw new Error('This verification is intentionally scoped to 2026-10-09 JST');
  if(!manifestPath)throw new Error('EXPECTED_MANIFEST_PATH is required');
  for(const name of ['R2_ACCOUNT_ID','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY','R2_BUCKET'])if(!env[name])throw new Error(`Missing required environment setting: ${name}`);
  const started=Date.now(),expected=await readExpected(manifestPath),utcDates=utcDatesForJstDate(targetDate),temp=await fs.mkdtemp(path.join(os.tmpdir(),'mobility-r2-verify-'));
  const originals=path.join(temp,'originals'),restored=path.join(temp,'restored'),archivePath=path.join(temp,'2026-10-09-jst.raw.gz');
  await fs.mkdir(originals);await fs.mkdir(restored);
  const client=new S3Client({region:'auto',endpoint:`https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,credentials:{accessKeyId:env.R2_ACCESS_KEY_ID,secretAccessKey:env.R2_SECRET_ACCESS_KEY}});
  const indexed=[];const feedCounts=Object.fromEntries(sources.flatMap(s=>feeds.map(f=>[`${s}/${f}`,0])));let listedRealtime=0,listedStatic=0,sourceBytes=0;
  try{
    for(const source of sources)for(const feed of feeds)for(const utcDate of utcDates){
      const prefix=`raw/gtfs-rt/${source}/${feed}/${utcDate}/`;
      const objects=await listAllObjects(client,input=>new ListObjectsV2Command(input),{bucket:env.R2_BUCKET,prefix,log:()=>{}});
      const selected=objects.filter(o=>o.Key&&localDateOfKey(o.Key)===targetDate);listedRealtime+=selected.length;
      for(const object of selected){
        const key=safeRelativeKey(object.Key),response=await client.send(new GetObjectCommand({Bucket:env.R2_BUCKET,Key:key})),body=await readBody(response.Body),metadata=metadataFor(response);
        if(body.length===0||metadata.content_length!==body.length)throw new Error('Empty or length-mismatched R2 object detected');
        const digest=crypto.createHash('sha256').update(body).digest('hex');
        const localPath=path.join(originals,'objects',...key.split('/')),metadataPath=path.join(originals,'metadata',...key.split('/'))+'.json';
        await fs.mkdir(path.dirname(localPath),{recursive:true});await fs.mkdir(path.dirname(metadataPath),{recursive:true});
        await fs.writeFile(localPath,body,{flag:'wx'});await fs.writeFile(metadataPath,JSON.stringify(metadata,null,2)+'\n',{flag:'wx'});
        indexed.push({key,body,metadata,sha256:digest,size:body.length});sourceBytes+=body.length;feedCounts[`${source}/${feed}`]++;
      }
    }
    for(const source of sources){
      const prefix=`static/${source}/versions/`,objects=await listAllObjects(client,input=>new ListObjectsV2Command(input),{bucket:env.R2_BUCKET,prefix,log:()=>{}});listedStatic+=objects.length;
      for(const object of objects){
        if(!object.Key)continue;const key=safeRelativeKey(object.Key),response=await client.send(new GetObjectCommand({Bucket:env.R2_BUCKET,Key:key})),body=await readBody(response.Body),metadata=metadataFor(response);
        if(body.length===0||metadata.content_length!==body.length)throw new Error('Empty or length-mismatched static GTFS object detected');
        const digest=crypto.createHash('sha256').update(body).digest('hex'),localPath=path.join(originals,'objects',...key.split('/')),metadataPath=path.join(originals,'metadata',...key.split('/'))+'.json';
        await fs.mkdir(path.dirname(localPath),{recursive:true});await fs.mkdir(path.dirname(metadataPath),{recursive:true});
        await fs.writeFile(localPath,body,{flag:'wx'});await fs.writeFile(metadataPath,JSON.stringify(metadata,null,2)+'\n',{flag:'wx'});
        indexed.push({key,body,metadata,sha256:digest,size:body.length});sourceBytes+=body.length;
      }
    }
    const expectedTotal=expected.total,actualRealtime=Object.values(feedCounts).reduce((a,b)=>a+b,0);
    if(actualRealtime!==expectedTotal)throw new Error(`R2 raw count (${actualRealtime}) does not match daily manifest (${expectedTotal})`);
    for(const [feed,count] of feedCounts)if(count!==expected.feedCounts.get(feed))throw new Error(`Feed count mismatch for ${feed}`);
    indexed.sort((a,b)=>a.key.localeCompare(b.key));
    const archiveManifest={format:'mobility-r2-backup-v1',date:targetDate,timezone:'Asia/Tokyo',generated_at:new Date().toISOString(),realtime_object_count:actualRealtime,static_version_count:listedStatic,source_bytes:sourceBytes,entries:indexed.map(({key,metadata,sha256,size})=>({key,metadata,sha256,size}))};
    const archive=await makeArchive(indexed,archiveManifest);await fs.writeFile(archivePath,archive,{flag:'wx'});
    const archiveSha256=crypto.createHash('sha256').update(archive).digest('hex');
    const restoredEntries=await restoreArchive(archive,restored);
    if(restoredEntries.length!==indexed.length)throw new Error('Restored object count does not match originals');
    for(const item of indexed){
      const body=await fs.readFile(path.join(restored,'objects',...item.key.split('/'))),metadata=JSON.parse(await fs.readFile(path.join(restored,'metadata',...item.key.split('/'))+'.json','utf8'));
      if(body.length!==item.size||crypto.createHash('sha256').update(body).digest('hex')!==item.sha256||JSON.stringify(metadata)!==JSON.stringify(item.metadata))throw new Error('Restored object differs from original');
    }
    const elapsed=Date.now()-started,summary={target_date:targetDate,timezone:'Asia/Tokyo',utc_prefix_dates:utcDates,realtime_objects:actualRealtime,realtime_counts_by_feed:feedCounts,static_versions:listedStatic,total_files:indexed.length,source_bytes:sourceBytes,archive_bytes:archive.length,compression_ratio:sourceBytes?archive.length/sourceBytes:null,archive_sha256:archiveSha256,restored_files:restoredEntries.length,all_sha256_and_metadata_match:true,manifest_count_match:true,elapsed_ms:elapsed};
    const summaryPath=process.env.GITHUB_STEP_SUMMARY;
    if(summaryPath)await fs.appendFile(summaryPath,`## R2 raw backup verification\n\n- Target: ${targetDate} JST\n- Realtime objects: ${actualRealtime}\n- Static GTFS versions: ${listedStatic}\n- Files restored and verified: ${restoredEntries.length}\n- Original payload bytes: ${sourceBytes}\n- gzip archive bytes: ${archive.length}\n- Compression ratio: ${(100*(archive.length/sourceBytes)).toFixed(2)}% of source size\n- Archive SHA-256: \`${archiveSha256}\`\n- Total elapsed: ${(elapsed/1000).toFixed(1)} seconds\n- Result: checksums, metadata and counts match\n`);
    return summary;
  }finally{client.destroy();await fs.rm(temp,{recursive:true,force:true});}
}

if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(fileURLToPath(import.meta.url))){
  try{const summary=await runVerification();console.log(JSON.stringify(summary,null,2));}
  catch(error){console.error(`R2 backup verification failed: ${error instanceof Error?error.message:'unknown error'}`);process.exitCode=1;}
}
