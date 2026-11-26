import parquet from 'parquetjs-lite';
import fs from 'node:fs/promises';
import path from 'node:path';
import { assertPublishableFiles } from './publish-size-guard.mjs';
export class SnapshotParts {
 constructor(schema,base,{maxBytes=16*1024*1024}={}){this.schema=schema;this.base=base;this.maxBytes=maxBytes;this.files=[];this.bytes=0;this.writer=null;}
 async appendRow(row){
  const bytes=Buffer.byteLength(JSON.stringify(row),'utf8');
  if(bytes>this.maxBytes)throw new Error('Snapshot exceeds per-part size budget');
  if(this.writer&&this.bytes+bytes>this.maxBytes){await this.writer.close();this.writer=null;this.bytes=0;}
  if(!this.writer){const file=this.base.replace(/\.parquet$/,`.part-${String(this.files.length).padStart(4,'0')}.parquet`);await fs.mkdir(path.dirname(file),{recursive:true});this.writer=await parquet.ParquetWriter.openFile(this.schema,file);this.files.push(file);}
  await this.writer.appendRow(row);this.bytes+=bytes;
 }
 async close(){if(this.writer){await this.writer.close();this.writer=null;}await assertPublishableFiles(this.files);}
}
