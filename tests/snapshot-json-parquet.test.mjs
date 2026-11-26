import {it,expect} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import parquet from 'parquetjs-lite';
import G from 'gtfs-realtime-bindings/gtfs-realtime.js';
it('round-trips empty snapshots and explicit zero event fields without default synthesis',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'mobility-snapshot-'));
 try{
  const messages=[{header:{gtfsRealtimeVersion:'2.0',timestamp:1},entity:[]},{header:{gtfsRealtimeVersion:'2.0',timestamp:2},entity:[{id:'t',tripUpdate:{trip:{tripId:'trip'},stopTimeUpdate:[{stopId:'stop',arrival:{delay:0,time:0},departure:{delay:12}}]}}]}];
  const expected=messages.map(m=>G.transit_realtime.FeedMessage.toObject(G.transit_realtime.FeedMessage.decode(G.transit_realtime.FeedMessage.encode(m).finish()),{longs:String,enums:Number,defaults:false}));
  const file=path.join(dir,'snapshots.parquet');const writer=await parquet.ParquetWriter.openFile(new parquet.ParquetSchema({json:{type:'UTF8'}}),file);
  for(const value of expected)await writer.appendRow({json:JSON.stringify(value)});await writer.close();
  const reader=await parquet.ParquetReader.openFile(file);const cursor=reader.getCursor();const actual=[];let row;while((row=await cursor.next())!==null)actual.push(JSON.parse(row.json));await reader.close();
  expect(actual).toEqual(expected);expect(actual[0].entity||[]).toEqual([]);
  const stop=actual[1].entity[0].tripUpdate.stopTimeUpdate[0];expect(stop.arrival.delay).toBe(0);expect(stop.arrival.time).toBe('0');expect(stop.departure).not.toHaveProperty('time');
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
