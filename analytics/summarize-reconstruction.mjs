import fs from 'node:fs/promises';
const root=process.argv[2]||'reports/rebuilt-explorer';
const index=JSON.parse(await fs.readFile(`${root}/data/index.json`,'utf8'));
const days=[];
for(const summary of index.days){
  const day=JSON.parse(await fs.readFile(`${root}/data/${summary.date}.json`,'utf8'));
  const ages=new Map();
  for(const row of day.replay){
    const age=(Date.parse(row.t)-Date.parse(row.observed_at))/1000;
    if(Number.isFinite(age)) ages.set(`${row.source}|${row.t}`,age);
  }
  const sorted=[...ages.values()].sort((a,b)=>a-b);
  days.push({date:day.date,saved:day.saved,expected:day.expected,coveragePercent:day.coveragePercent,missingFeedMinutes:day.missing.length,entities:day.entityCount,vehiclePositions:day.vehiclePositions,tripUpdates:day.tripUpdates,uniqueVehicles:day.uniqueVehicles,uniqueTrips:day.uniqueTrips,uniqueRoutes:day.uniqueRoutes,validEmptyFeeds:day.empty,vehicleSnapshotAge:{basis:'key scheduled time minus feed header; nonempty VehiclePosition snapshots only',count:sorted.length,medianSeconds:sorted.length?sorted[Math.floor(sorted.length/2)]:null,maxSeconds:sorted.at(-1)??null,overFiveMinutes:sorted.filter(x=>x>300).length},feedFreshness:day.feedFreshness});
}
const first=JSON.parse(await fs.readFile('reports/feed-probe-network.json','utf8'));
const second=JSON.parse(await fs.readFile('reports/feed-probe-network-second.json','utf8'));
const originComparison=second.results.filter(x=>x.mode==='default').map(current=>{
  const previous=first.results.find(x=>x.mode==='default'&&x.source_id===current.source_id&&x.feed_type===current.feed_type);
  return {source:current.source_id,feed:current.feed_type,previousHeader:previous?.header_timestamp,currentHeader:current.header_timestamp,payloadChanged:previous?.sha256!==current.sha256,ageSeconds:current.age_seconds,status:current.status};
});
await fs.writeFile('reports/reconstruction-audit.json',JSON.stringify({generatedAt:new Date().toISOString(),originComparison,days},null,2));
console.log(JSON.stringify({originComparison,days:days.length,representative:days.filter(x=>['2026-09-28','2026-09-29','2026-11-19'].includes(x.date))},null,2));
