export function inspectSnapshot({now, fetchedAt, httpStatus, bytes, message}) {
  const fetched=Date.parse(fetchedAt);
  if(!Number.isFinite(fetched)||now-fetched>180000||fetched-now>60000)throw new Error('Latest saved snapshot is missing or older than three minutes');
  if(!bytes)throw new Error('Zero-byte snapshot');
  if(!Number.isFinite(Number(httpStatus))||Number(httpStatus)<200||Number(httpStatus)>=300)throw new Error('Missing or failed provider HTTP status');
  if(message.header.gtfsRealtimeVersion!=='2.0')throw new Error('Unsupported feed version');
  const empty=message.entity.length===0;
  const age=(fetched-Number(message.header.timestamp)*1000)/1000;
  return {fetched_at:new Date(fetched).toISOString(),entities:message.entity.length,valid_empty_feed:empty,header_age_seconds:Number.isFinite(age)?age:null,stale:!empty&&(!message.header.timestamp||!Number.isFinite(age)||age>300||age< -60)};
}
