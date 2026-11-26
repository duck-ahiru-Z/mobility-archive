import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import parquet from 'parquetjs-lite';
import G from 'gtfs-realtime-bindings/gtfs-realtime.js';
import assert from 'node:assert/strict';
const samples=JSON.parse(await fs.readFile('reports/r2-original-check/comparison.json','utf8'));
const out='reports/archive-v2-verification';await fs.mkdir(out,{recursive:true});
const schema=new parquet.ParquetSchema({snapshot_id:{type:'UTF8'},source_id:{type:'UTF8'},feed_type:{type:'UTF8'},raw_object_key:{type:'UTF8'},raw_sha256:{type:'UTF8'},header_json:{type:'UTF8'},entity_count:{type:'INT64'},decoded_entities_json:{type:'UTF8'}});
const expected=new Map();
const writer=await parquet.ParquetWriter.openFile(schema,out+'/snapshots.parquet');let count=0,entities=0;
try{for(let i=0;i<samples.length;i++){
 const sample=samples[i];const bytes=await fs.readFile(`reports/r2-original-check/${sample.date}-${sample.source}-${sample.feed}-${i}.pb`);
 const hash=createHash('sha256').update(bytes).digest('hex');if(hash!==sample.rawHash)throw new Error('Original hash mismatch');
 const decoded=G.transit_realtime.FeedMessage.decode(bytes);
 const json=G.transit_realtime.FeedMessage.toObject(decoded,{longs:String,enums:Number,defaults:false});
 expected.set(sample.key,{header:json.header,entities:json.entity||[],hash});
 await writer.appendRow({snapshot_id:createHash('sha256').update(sample.key).digest('hex'),source_id:sample.source,feed_type:sample.feed,raw_object_key:sample.key,raw_sha256:hash,header_json:JSON.stringify(json.header),entity_count:decoded.entity.length,decoded_entities_json:JSON.stringify(json.entity||[])});count++;entities+=decoded.entity.length;
}}finally{await writer.close();}
const reader=await parquet.ParquetReader.openFile(out+'/snapshots.parquet');const cursor=reader.getCursor();let row,read=0,readEntities=0;
try{while((row=await cursor.next())!==null){const e=JSON.parse(row.decoded_entities_json);if(e.length!==Number(row.entity_count))throw new Error('Entity count mismatch');const original=expected.get(row.raw_object_key);assert.ok(original);assert.deepEqual(e,original.entities);assert.deepEqual(JSON.parse(row.header_json),original.header);assert.equal(row.raw_sha256,original.hash);read++;readEntities+=e.length;}}finally{await reader.close();}
if(read!==count||readEntities!==entities)throw new Error('Round-trip count mismatch');
await fs.writeFile(out+'/manifest.json',JSON.stringify({schema_version:'2-verification',scope:'40 sampled original objects; not a production daily dataset',snapshots:count,entities,verifiedSnapshots:read,verifiedEntities:readEntities,representation:'one row per snapshot; all supported decoded entity fields retained as JSON; raw protobuf remains authoritative for unknown fields'},null,2));
console.log(JSON.stringify({snapshots:count,entities,verifiedSnapshots:read,verifiedEntities:readEntities}));
