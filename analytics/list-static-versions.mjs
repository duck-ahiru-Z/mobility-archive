import fs from 'node:fs/promises';
import path from 'node:path';
const config=await fs.readFile(path.join(process.env.APPDATA,'xdg.config/.wrangler/config/default.toml'),'utf8');
const token=config.match(/oauth_token\s*=\s*"([^"]+)"/)?.[1];
if(!token)throw new Error('Cloudflare authentication required');
const report=[];
for(const source of ['wakayama-bus','wakayama-bus-naga']){
 const objects=[];let cursor;let pages=0;
 do{
  const u=new URL('https://api.cloudflare.com/client/v4/accounts/6e7eb718fcb7f81bf3ee26bade1cb6d5/r2/buckets/mobility-archive-raw/objects');
  u.searchParams.set('prefix',`static/${source}/versions/`);if(cursor)u.searchParams.set('cursor',cursor);
  const response=await fetch(u,{headers:{Authorization:`Bearer ${token}`}});if(!response.ok)throw new Error(`List HTTP ${response.status}`);
  const page=await response.json();if(!page.success)throw new Error('R2 list failed');objects.push(...page.result);pages++;
  cursor=page.result_info?.is_truncated?page.result_info.cursor:null;
  if(page.result_info?.is_truncated&&!cursor)throw new Error('Missing continuation cursor');
 }while(cursor);
 objects.sort((a,b)=>a.last_modified.localeCompare(b.last_modified));report.push({source,pages,objects});
}
await fs.writeFile('reports/static-versions.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report.map(r=>({source:r.source,versions:r.objects.length,pages:r.pages,first:r.objects[0]?.last_modified,last:r.objects.at(-1)?.last_modified})),null,2));
