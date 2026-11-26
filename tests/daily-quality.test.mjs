import {it,expect} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import parquet from 'parquetjs-lite';
const run=promisify(execFile);

it('distinguishes fresh empty feeds, stale feeds and corrupted entity counts',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'archive-quality-'));
  const date='2026-11-25', day=path.join(root,'2026','11','25');
  const sources=['wakayama-bus','wakayama-bus-naga'];
  const schema=new parquet.ParquetSchema({raw_object_key:{type:'UTF8'},raw_sha256:{type:'UTF8'},feed_type:{type:'UTF8'},metadata_json:{type:'UTF8'},header_json:{type:'UTF8'},decoded_entities_json:{type:'UTF8'},entity_count:{type:'INT64'}});
  try {
    await fs.mkdir(day,{recursive:true});
    async function build(stale=false,corrupt=false){
      for(const source of sources){
        const writer=await parquet.ParquetWriter.openFile(schema,path.join(day,source+'.parquet'));
        for(const feed of ['vehicle-positions','trip-updates']){
          const decoded=stale?[{id:'entity'}]:[];
          await writer.appendRow({raw_object_key:`raw/gtfs-rt/${source}/${feed}/20261125/010000.pb`,raw_sha256:'fixture',feed_type:feed,metadata_json:JSON.stringify({fetched_at:'2026-11-25T01:00:00Z'}),header_json:JSON.stringify({timestamp:Date.parse(stale?'2026-11-25T00:00:00Z':'2026-11-25T01:00:00Z')/1000}),decoded_entities_json:JSON.stringify(decoded),entity_count:corrupt?99:decoded.length});
        }
        await writer.close();
      }
      // Legacy entities are independently counted by the verifier.
      const entitySchema=new parquet.ParquetSchema({id:{type:'UTF8'},observed_at:{type:'TIMESTAMP_MILLIS'}});
      const manifest={date,timezone:'Asia/Tokyo',processing:{status:'success'},sources:[]};
      for(const source of sources){
        const writer=await parquet.ParquetWriter.openFile(entitySchema,path.join(day,source+'-entities.parquet'));
        if(stale){await writer.appendRow({id:'one',observed_at:new Date('2026-11-25T01:00:00Z')});await writer.appendRow({id:'two',observed_at:new Date('2026-11-25T01:01:00Z')});}
        await writer.close();
        manifest.sources.push({source_id:source,snapshot_schema_version:'2',snapshot_count:2,parsed_entity_count:stale?2:0,snapshot_files:[`2026/11/25/${source}.parquet`],output_files:[`2026/11/25/${source}-entities.parquet`],feeds:['vehicle-positions','trip-updates'].map(feed_type=>({feed_type,valid_feed_count:1,unique_valid_slot_count:1,expected_fetch_count:1}))});
      }
      await fs.writeFile(path.join(day,'manifest.json'),JSON.stringify(manifest));
    }
    const execute=()=>run(process.execPath,['scripts/verify-daily-output.mjs'],{env:{...process.env,ARCHIVE_DATE:date,OUTPUT_DIR:root}});
    await build(); await execute();
    expect(JSON.parse(await fs.readFile(path.join(day,'quality.json'))).status).toBe('passed');
    await build(true);await execute();
    const stale=JSON.parse(await fs.readFile(path.join(day,'quality.json')));
    expect(stale.status).toBe('degraded');expect(stale.warnings).toHaveLength(4);
    await build(true,true);await expect(execute()).rejects.toThrow();
    expect(JSON.parse(await fs.readFile(path.join(day,'quality.json'))).status).toBe('failed');
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
