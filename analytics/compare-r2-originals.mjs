import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import parquet from 'parquetjs-lite';
import G from 'gtfs-realtime-bindings/gtfs-realtime.js';

// GET only. Decode the original downloaded bytes independently of the daily writer.
const results=[];
const dir=path.resolve('reports/r2-original-check');
await fs.mkdir(dir,{recursive:true});
for(const date of ['2026-09-29','2026-11-25']){
  for(const source of ['wakayama-bus','wakayama-bus-naga']){
    const reader=await parquet.ParquetReader.openFile(`data-source/archive/${date.replaceAll('-','/')}/${source}.parquet`);
    const cursor=reader.getCursor();const snapshots=new Map();let row;
    while((row=await cursor.next())!==null){
      if(!row.raw_object_key.includes('/120')) continue;
      const group=row.feed_type;
      let selected=snapshots.get(group);if(!selected){selected=new Map();snapshots.set(group,selected);}
      if(!selected.has(row.raw_object_key)&&selected.size<5) selected.set(row.raw_object_key,[]);
      selected.get(row.raw_object_key)?.push(row);
    }
    await reader.close();
    for(const [feed,selected] of snapshots)for(const [key,rows] of selected){
      const file=path.join(dir,`${date}-${source}-${feed}-${results.length}.pb`);
      execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','r2','object','get',`mobility-archive-raw/${key}`,'--remote','--file',file],{stdio:['ignore','pipe','pipe'],timeout:60000});
      const bytes=await fs.readFile(file),hash=createHash('sha256').update(bytes).digest('hex');
      const decoded=G.transit_realtime.FeedMessage.decode(bytes);
      const timestamp=Number(decoded.header.timestamp);
      const mismatches=[];
      for(const r of rows){
        const e=decoded.entity.find(e=>e.id===r.entity_id);
        if(!e){mismatches.push({entity:r.entity_id,reason:'entity absent in original'});continue;}
        const p=e.vehicle?.position;
        if(p&&(Number(r.latitude)!==p.latitude||Number(r.longitude)!==p.longitude))mismatches.push({entity:r.entity_id,reason:'coordinate mismatch'});
      }
      results.push({date,source,feed,key,bytes:bytes.length,rawHash:hash,parquetHashes:[...new Set(rows.map(r=>r.raw_sha256))],hashMatches:rows.every(r=>r.raw_sha256===hash),rawHeaderTimestamp:timestamp,rawEntities:decoded.entity.length,parquetRows:rows.length,mismatches});
      await fs.writeFile(path.join(dir,'comparison.json'),JSON.stringify(results,null,2));
    }
  }
}
console.log(JSON.stringify({objects:results.length,hashMismatches:results.filter(r=>!r.hashMatches).length,projectionMismatches:results.reduce((n,r)=>n+r.mismatches.length,0)},null,2));
if(!results.length||results.some(r=>!r.hashMatches||r.mismatches.length))process.exitCode=1;
