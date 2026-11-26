import {it,expect} from 'vitest';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import parquet from 'parquetjs-lite';
import {SnapshotParts} from '../scripts/snapshot-parts.mjs';
import {assertPublishableFiles} from '../scripts/publish-size-guard.mjs';
it('splits before byte budget and reads every row back in order',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'snapshot-parts-'));
 try{const schema=new parquet.ParquetSchema({json:{type:'UTF8',compression:'GZIP'}});const parts=new SnapshotParts(schema,path.join(dir,'source.parquet'),{maxBytes:150});const values=Array.from({length:9},(_,i)=>({json:JSON.stringify({i,data:'x'.repeat(60)})}));for(const value of values)await parts.appendRow(value);await parts.close();expect(parts.files.length).toBeGreaterThan(1);const actual=[];for(const file of parts.files){const reader=await parquet.ParquetReader.openFile(file);const cursor=reader.getCursor();let row;while((row=await cursor.next())!==null)actual.push(row);await reader.close();}expect(actual).toEqual(values);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

it('stops publication with a named file before the repository hard limit',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'publish-size-'));
 try{const file=path.join(dir,'too-large.parquet');await fs.writeFile(file,Buffer.alloc(200));await expect(assertPublishableFiles([file],100)).rejects.toThrow(/too-large\.parquet.*0\.00 MiB/);}
 finally{await fs.rm(dir,{recursive:true,force:true});}
});
