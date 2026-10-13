import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {describe,it,expect} from 'vitest';
import {makeArchive,restoreArchive} from '../scripts/r2-backup-verify.mjs';
import {utcDatesForJstDate,localDateOfKey} from '../scripts/daily-archive-lib.mjs';

describe('reversible raw backup archive',()=>{
  it('round-trips raw bytes, exact object keys and metadata',async()=>{
    const temp=await mkdtemp(path.join(os.tmpdir(),'mobility-backup-test-'));
    try{
      const body=Buffer.from([0,1,2,255,10]),entry={key:'raw/gtfs-rt/example/vehicle-positions/20261008/150000.pb',body,sha256:'eed8a2a3c089e83511e2a44b8a7e8788bd40bd88026f8b1d89c95ddbeb4a5f82',metadata:{content_type:'application/x-protobuf',content_length:5,custom_metadata:{scheduled_at:'2026-10-08T15:00:00.000Z',requested_at:'2026-10-08T15:00:01.000Z'}}};
      const {createHash}=await import('node:crypto');entry.sha256=createHash('sha256').update(body).digest('hex');
      const manifest={entries:[{key:entry.key,metadata:entry.metadata,sha256:entry.sha256,size:body.length}]};
      const archive=await makeArchive([entry],manifest),restored=await restoreArchive(archive,path.join(temp,'restore'));
      expect(restored).toHaveLength(1);expect(await readFile(path.join(temp,'restore','objects',...entry.key.split('/')))).toEqual(body);
      expect(JSON.parse(await readFile(path.join(temp,'restore','metadata',...entry.key.split('/'))+'.json','utf8'))).toEqual(entry.metadata);
    }finally{await rm(temp,{recursive:true,force:true});}
  });

  it('rejects payload tampering and unsafe keys',async()=>{
    const {createHash}=await import('node:crypto');
    const body=Buffer.from('original'),entry={key:'raw/test.pb',body,sha256:createHash('sha256').update(body).digest('hex'),metadata:{}};
    const archive=await makeArchive([entry],{entries:[]});
    const temp=await mkdtemp(path.join(os.tmpdir(),'mobility-backup-tamper-'));
    try{const damaged=Buffer.from(archive);damaged[damaged.length-10]^=1;await expect(restoreArchive(damaged,path.join(temp,'restore'))).rejects.toThrow();}
    finally{await rm(temp,{recursive:true,force:true});}
    await expect(makeArchive([{...entry,key:'../escape'}],{entries:[]})).rejects.toThrow(/Unsafe object key/);
  });

  it('lists both UTC dates spanning a JST day and filters by the JST key date',()=>{
    expect(utcDatesForJstDate('2026-10-09')).toEqual(['20261008','20261009']);
    expect(localDateOfKey('raw/gtfs-rt/x/vehicle-positions/20261008/150000.pb')).toBe('2026-10-09');
    expect(localDateOfKey('raw/gtfs-rt/x/vehicle-positions/20261009/145959.pb')).toBe('2026-10-09');
    expect(localDateOfKey('raw/gtfs-rt/x/vehicle-positions/20261009/150000.pb')).toBe('2026-10-10');
  });
});
