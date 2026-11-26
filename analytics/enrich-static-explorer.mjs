import fs from 'node:fs/promises';
const root=process.argv[2]||'reports/verified-explorer';
const selected=JSON.parse(await fs.readFile('reports/static-check/selected.json','utf8'));
const checks=JSON.parse(await fs.readFile('reports/static-check/join-results.json','utf8'));
const delayAudit=JSON.parse(await fs.readFile('reports/original-delay-audit.json','utf8'));
const index=JSON.parse(await fs.readFile(`${root}/data/index.json`,'utf8'));
for(const date of [...new Set(selected.map(v=>v.date))]){
 const day=JSON.parse(await fs.readFile(`${root}/data/${date}.json`,'utf8'));
 const lookups=new Map();
 for(const version of selected.filter(v=>v.date===date)){
  const raw=JSON.parse((await fs.readFile(version.dir+'/lookup.json','utf8')).replace(/^\uFEFF/,''));
  lookups.set(version.source,{trips:new Map(raw.trips.map(t=>[t.trip_id,t])),routes:new Map(raw.routes.map(r=>[r.route_id,r]))});
 }
 for(const p of day.replay){const lookup=lookups.get(p.source),trip=lookup?.trips.get(p.trip),route=lookup?.routes.get(p.route);p.routeShortName=route?.route_short_name||null;p.routeLongName=route?.route_long_name||null;p.destination=trip?.trip_headsign||null;}
 day.quality.staticJoinChecks=checks.filter(c=>c.date===date);
 day.quality.rawDelaySamples=delayAudit.groups.filter(c=>c.date===date);
 await fs.writeFile(`${root}/data/${date}.json`,JSON.stringify(day));
 const summary=index.days.find(d=>d.date===date);summary.quality=day.quality;
}
await fs.writeFile(`${root}/data/index.json`,JSON.stringify(index));
console.log('Enriched measured static joins for '+[...new Set(selected.map(v=>v.date))].join(', '));
