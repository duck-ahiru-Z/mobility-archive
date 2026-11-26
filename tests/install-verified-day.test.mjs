import {it, expect} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {installVerifiedDay} from '../scripts/install-verified-day.mjs';

it('rejects failed staging without touching the old day, then replaces the whole verified day', async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'archive-install-'));
  try {
    const staging=path.join(root,'staging'), target=path.join(root,'archive');
    const day=path.join(target,'2026','11','25'), draft=path.join(staging,'2026','11','25');
    await fs.mkdir(day,{recursive:true}); await fs.mkdir(draft,{recursive:true});
    await fs.writeFile(path.join(day,'old-part.parquet'),'previous');
    await fs.writeFile(path.join(draft,'quality.json'),JSON.stringify({date:'2026-11-25',status:'failed',errors:['mismatch']}));
    await expect(installVerifiedDay(staging,target,'2026-11-25')).rejects.toThrow();
    expect(await fs.readFile(path.join(day,'old-part.parquet'),'utf8')).toBe('previous');
    await fs.writeFile(path.join(draft,'quality.json'),JSON.stringify({date:'2026-11-25',status:'degraded',errors:[]}));
    await fs.writeFile(path.join(draft,'new-part.parquet'),'new');
    await installVerifiedDay(staging,target,'2026-11-25');
    expect(await fs.readFile(path.join(day,'new-part.parquet'),'utf8')).toBe('new');
    await expect(fs.stat(path.join(day,'old-part.parquet'))).rejects.toThrow();
    expect(await fs.readFile(path.join(staging,'2026-11-25.previous','old-part.parquet'),'utf8')).toBe('previous');
  } finally {await fs.rm(root,{recursive:true,force:true});}
});
