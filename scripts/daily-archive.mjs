import fs from 'node:fs/promises';
import path from 'node:path';
import parquet from 'parquetjs-lite';
import G from 'gtfs-realtime-bindings';
import {S3Client, ListObjectsV2Command, GetObjectCommand} from '@aws-sdk/client-s3';

const date=process.env.ARCHIVE_DATE; const out=process.env.OUTPUT_DIR||'archive';
const client=new S3Client({region:'auto',endpoint:`https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,credentials:{accessKeyId:process.env.R2_ACCESS_KEY_ID,secretAccessKey:process.env.R2_SECRET_ACCESS_KEY}});
const schema=new parquet.ParquetSchema({observed_at:{type:'TIMESTAMP_MILLIS'},source_id:{type:'UTF8'},feed_type:{type:'UTF8'},entity_id:{type:'UTF8',optional:true},trip_id:{type:'UTF8',optional:true},route_id:{type:'UTF8',optional:true},vehicle_id:{type:'UTF8',optional:true},latitude:{type:'DOUBLE',optional:true},longitude:{type:'DOUBLE',optional:true},delay_seconds:{type:'INT64',optional:true},raw_object_key:{type:'UTF8'},raw_sha256:{type:'UTF8'},collector_version:{type:'UTF8'}});
const objects=[]; for(const source of ['wakayama-bus','wakayama-bus-naga']) for(const feed of ['vehicle-positions','trip-updates']){const p=`raw/gtfs-rt/${source}/${feed}/${date.replaceAll('-','')}/`;const r=await client.send(new ListObjectsV2Command({Bucket:process.env.R2_BUCKET,Prefix:p}));objects.push(...(r.Contents||[]).map(x=>({...x,source,feed})));}
await fs.mkdir(path.join(out,date.replaceAll('-','/')),{recursive:true}); const manifest={date,timezone:'Asia/Tokyo',dataset_schema_version:'1',generated_at:new Date().toISOString(),sources:[],license_note:'Raw-derived datasets are withheld until redistribution terms are explicitly confirmed.'};
for(const source of ['wakayama-bus','wakayama-bus-naga']){const rows=[];const related=objects.filter(o=>o.source===source);for(const o of related){const b=Buffer.from(await (await client.send(new GetObjectCommand({Bucket:process.env.R2_BUCKET,Key:o.Key}))).Body.transformToByteArray());const feed=G.transit_realtime.FeedMessage.decode(b);for(const e of feed.entity)rows.push({observed_at:new Date(Number(feed.header.timestamp||0)*1000),source_id:source,feed_type:o.feed,entity_id:e.id||null,trip_id:e.vehicle?.trip?.tripId||e.tripUpdate?.trip?.tripId||null,route_id:e.vehicle?.trip?.routeId||e.tripUpdate?.trip?.routeId||null,vehicle_id:e.vehicle?.vehicle?.id||null,latitude:e.vehicle?.position?.latitude||null,longitude:e.vehicle?.position?.longitude||null,delay_seconds:null,raw_object_key:o.Key,raw_sha256:'',collector_version:'0.1.0'});}
manifest.sources.push({source_id:source,feed_objects:related.length,parsed_entity_count:rows.length,publish_daily_dataset:false,output_files:[]});}
await fs.writeFile(path.join(out,date.replaceAll('-','/'),'manifest.json'),JSON.stringify(manifest,null,2));
