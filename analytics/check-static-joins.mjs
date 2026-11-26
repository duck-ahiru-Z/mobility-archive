import fs from 'node:fs/promises';
import parquet from 'parquetjs-lite';
const selected=JSON.parse(await fs.readFile('reports/static-check/selected.json','utf8'));
const results=[];
for(const version of selected){
 const lookup=JSON.parse((await fs.readFile(version.dir+'/lookup.json','utf8')).replace(/^\uFEFF/,''));
 const trips=new Set(lookup.trips.map(t=>t.trip_id)),routes=new Set(lookup.routes.map(r=>r.route_id));
 const result={date:version.date,source:version.source,staticHash:version.hash,rows:0,tripPresent:0,tripJoined:0,routePresent:0,routeJoined:0,stopJoin:'not available in v1 Parquet'};
 const reader=await parquet.ParquetReader.openFile(`data-source/archive/${version.date.replaceAll('-','/')}/${version.source}.parquet`);const cursor=reader.getCursor();let row;
 while((row=await cursor.next())!==null){result.rows++;if(row.trip_id){result.tripPresent++;if(trips.has(row.trip_id))result.tripJoined++;}if(row.route_id){result.routePresent++;if(routes.has(row.route_id))result.routeJoined++;}}
 await reader.close();results.push(result);
}
await fs.writeFile('reports/static-check/join-results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
