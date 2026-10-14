import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {GetObjectCommand,ListObjectsV2Command,S3Client} from '@aws-sdk/client-s3';
import G from 'gtfs-realtime-bindings/gtfs-realtime.js';
import {keyTimestamp,listAllObjects,localDateOfKey,utcDatesForJstDate} from './daily-archive-lib.mjs';

export const TARGET_DATES=['2026-10-09','2026-10-11'];
export const SOURCES=['wakayama-bus','wakayama-bus-naga'];
export const FEEDS=['vehicle-positions','trip-updates'];
export const SAMPLE_MINUTES=Array.from({length:144},(_,i)=>i*10);

const VP_FIELDS={
  'trip.tripId':['TripDescriptor','tripId'],'trip.routeId':['TripDescriptor','routeId'],'trip.directionId':['TripDescriptor','directionId'],'trip.startTime':['TripDescriptor','startTime'],'trip.startDate':['TripDescriptor','startDate'],'trip.scheduleRelationship':['TripDescriptor','scheduleRelationship'],'trip.modifiedTrip':['TripDescriptor','modifiedTrip'],
  'vehicle.id':['VehicleDescriptor','id'],'vehicle.label':['VehicleDescriptor','label'],'vehicle.licensePlate':['VehicleDescriptor','licensePlate'],'vehicle.wheelchairAccessible':['VehicleDescriptor','wheelchairAccessible'],
  'position.latitude':['Position','latitude'],'position.longitude':['Position','longitude'],'position.speed':['Position','speed'],'position.bearing':['Position','bearing'],'position.odometer':['Position','odometer'],
  currentStopSequence:['VehiclePosition','currentStopSequence'],stopId:['VehiclePosition','stopId'],currentStatus:['VehiclePosition','currentStatus'],timestamp:['VehiclePosition','timestamp'],congestionLevel:['VehiclePosition','congestionLevel'],occupancyStatus:['VehiclePosition','occupancyStatus'],occupancyPercentage:['VehiclePosition','occupancyPercentage'],multiCarriageDetails:['VehiclePosition','multiCarriageDetails']
};
const TU_FIELDS={
  timestamp:['TripUpdate','timestamp'],delay:['TripUpdate','delay'],tripProperties:['TripUpdate','tripProperties'],
  'trip.tripId':['TripDescriptor','tripId'],'trip.routeId':['TripDescriptor','routeId'],'trip.directionId':['TripDescriptor','directionId'],'trip.startTime':['TripDescriptor','startTime'],'trip.startDate':['TripDescriptor','startDate'],'trip.scheduleRelationship':['TripDescriptor','scheduleRelationship'],'trip.modifiedTrip':['TripDescriptor','modifiedTrip'],
  'vehicle.id':['VehicleDescriptor','id'],'vehicle.label':['VehicleDescriptor','label'],'vehicle.licensePlate':['VehicleDescriptor','licensePlate'],'vehicle.wheelchairAccessible':['VehicleDescriptor','wheelchairAccessible']
};
const STOP_FIELDS={
  stopId:['StopTimeUpdate','stopId'],stopSequence:['StopTimeUpdate','stopSequence'],scheduleRelationship:['StopTimeUpdate','scheduleRelationship'],arrival:['StopTimeUpdate','arrival'],departure:['StopTimeUpdate','departure'],arrivalOccupancyStatus:['StopTimeUpdate','arrivalOccupancyStatus'],departureOccupancyStatus:['StopTimeUpdate','departureOccupancyStatus'],stopTimeProperties:['StopTimeUpdate','stopTimeProperties'],
  'arrival.time':['StopTimeEvent','time'],'arrival.delay':['StopTimeEvent','delay'],'arrival.uncertainty':['StopTimeEvent','uncertainty'],'arrival.scheduledTime':['StopTimeEvent','scheduledTime'],
  'departure.time':['StopTimeEvent','time'],'departure.delay':['StopTimeEvent','delay'],'departure.uncertainty':['StopTimeEvent','uncertainty'],'departure.scheduledTime':['StopTimeEvent','scheduledTime'],
  'stopTimeProperties.assignedStopId':['StopTimeProperties','assignedStopId'],'stopTimeProperties.stopHeadsign':['StopTimeProperties','stopHeadsign'],'stopTimeProperties.pickupType':['StopTimeProperties','pickupType'],'stopTimeProperties.dropOffType':['StopTimeProperties','dropOffType']
};
const TRIP_PROPERTY_FIELDS={tripId:['TripProperties','tripId'],startDate:['TripProperties','startDate'],startTime:['TripProperties','startTime']};
const CARRIAGE_FIELDS={id:['CarriageDetails','id'],label:['CarriageDetails','label'],occupancyStatus:['CarriageDetails','occupancyStatus'],occupancyPercentage:['CarriageDetails','occupancyPercentage'],carriageSequence:['CarriageDetails','carriageSequence']};
const HEADER_FIELDS={gtfsRealtimeVersion:['FeedHeader','gtfsRealtimeVersion'],incrementality:['FeedHeader','incrementality'],timestamp:['FeedHeader','timestamp'],feedVersion:['FeedHeader','feedVersion']};
const CLASSES={FeedHeader:G.transit_realtime.FeedHeader,VehiclePosition:G.transit_realtime.VehiclePosition,Position:G.transit_realtime.Position,TripDescriptor:G.transit_realtime.TripDescriptor,VehicleDescriptor:G.transit_realtime.VehicleDescriptor,TripUpdate:G.transit_realtime.TripUpdate,StopTimeUpdate:G.transit_realtime.TripUpdate.StopTimeUpdate,StopTimeEvent:G.transit_realtime.TripUpdate.StopTimeEvent,StopTimeProperties:G.transit_realtime.TripUpdate.StopTimeUpdate.StopTimeProperties,TripProperties:G.transit_realtime.TripUpdate.TripProperties,CarriageDetails:G.transit_realtime.VehiclePosition.CarriageDetails};

function hasFieldValue(object,key){return object!=null&&Object.prototype.hasOwnProperty.call(object,key)&&object[key]!==undefined&&object[key]!==null;}
function protoFieldSupported([messageName,fieldName]){const C=CLASSES[messageName];return Boolean(C&&fieldName in C.prototype);}
function fieldCounter(definitions){return Object.fromEntries(Object.entries(definitions).map(([name,descriptor])=>[name,{supported:protoFieldSupported(descriptor),present:0,denominator:0}]));}
function valueAt(root,pathText){let current=root;for(const key of pathText.split('.')){if(!hasFieldValue(current,key))return false;current=current[key];}return true;}
function updateCounters(counters,definitions,message){for(const [name,descriptor] of Object.entries(definitions)){const counter=counters[name];if(!counter.supported)continue;counter.denominator++;if(valueAt(message,name))counter.present++;}}
function summarizeCounters(counters){return Object.fromEntries(Object.entries(counters).map(([name,c])=>[name,{supported:c.supported,present:c.supported?c.present:null,denominator:c.supported?c.denominator:null,percent:c.supported&&c.denominator?round(100*c.present/c.denominator):null}]));}
function round(n){return Math.round(n*100)/100;}

export function pickSamples(objects,date){
  const wanted=new Set(SAMPLE_MINUTES),byBucket=new Map();
  for(const object of objects){if(!object.Key||localDateOfKey(object.Key)!==date)continue;const t=keyTimestamp(object.Key);if(!t)continue;const local=new Date(t.getTime()+9*60*60*1000),minute=local.getUTCHours()*60+local.getUTCMinutes();if(!wanted.has(minute%60))continue;const bucket=Math.floor(minute/10),old=byBucket.get(bucket);if(!old||t<keyTimestamp(old.Key))byBucket.set(bucket,object);}
  return [...byBucket.values()].sort((a,b)=>keyTimestamp(a.Key)-keyTimestamp(b.Key));
}

export function createFeedStats(){return {sampledSnapshots:0,validSnapshots:0,validEmptySnapshots:0,invalidSnapshots:0,vehiclePositionEntities:0,tripUpdateEntities:0,stopTimeUpdateCount:0,carriageCount:0,sampledBuckets:0,missingSampleBuckets:0,header:fieldCounter(HEADER_FIELDS),vehiclePositionFields:fieldCounter(VP_FIELDS),tripUpdateFields:fieldCounter(TU_FIELDS),stopTimeUpdateFields:fieldCounter(STOP_FIELDS),tripPropertiesFields:fieldCounter(TRIP_PROPERTY_FIELDS),carriageFields:fieldCounter(CARRIAGE_FIELDS)};}

export function consumeDecodedFeed(stats,feedType,feed){
  stats.validSnapshots++;
  const header=feed?.header;if(header)updateCounters(stats.header,HEADER_FIELDS,header);
  const entities=Array.isArray(feed?.entity)?feed.entity:[];
  if(entities.length===0)stats.validEmptySnapshots++;
  if(feedType==='vehicle-positions')for(const entity of entities){if(!entity?.vehicle)continue;stats.vehiclePositionEntities++;updateCounters(stats.vehiclePositionFields,VP_FIELDS,entity.vehicle);const carriages=entity.vehicle.multiCarriageDetails??[];stats.carriageCount+=carriages.length;for(const carriage of carriages)updateCounters(stats.carriageFields,CARRIAGE_FIELDS,carriage);}
  if(feedType==='trip-updates')for(const entity of entities){const update=entity?.tripUpdate;if(!update)continue;stats.tripUpdateEntities++;updateCounters(stats.tripUpdateFields,TU_FIELDS,update);updateCounters(stats.tripPropertiesFields,TRIP_PROPERTY_FIELDS,update.tripProperties??{});const stops=Array.isArray(update.stopTimeUpdate)?update.stopTimeUpdate:[];stats.stopTimeUpdateCount+=stops.length;for(const stop of stops)updateCounters(stats.stopTimeUpdateFields,STOP_FIELDS,stop);}
}

async function getBytes(body){return Buffer.from(await body.transformToByteArray());}
async function runPool(items,limit,worker){let cursor=0;await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{for(;;){const i=cursor++;if(i>=items.length)return;await worker(items[i],i);}}));}

export async function runFieldAudit({env=process.env,log=console.log}={}){
  for(const name of ['R2_ACCOUNT_ID','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY','R2_BUCKET'])if(!env[name])throw new Error(`Missing required environment setting: ${name}`);
  const started=Date.now(),client=new S3Client({region:'auto',endpoint:`https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,credentials:{accessKeyId:env.R2_ACCESS_KEY_ID,secretAccessKey:env.R2_SECRET_ACCESS_KEY}}),report=[];
  try{
    for(const date of TARGET_DATES){const utcDates=utcDatesForJstDate(date);for(const source of SOURCES)for(const feedType of FEEDS){
      const listed=[];for(const utcDate of utcDates){const prefix=`raw/gtfs-rt/${source}/${feedType}/${utcDate}/`;listed.push(...await listAllObjects(client,input=>new ListObjectsV2Command(input),{bucket:env.R2_BUCKET,prefix,log:()=>{}}));}
      const samples=pickSamples(listed,date),stats=createFeedStats();stats.sampledBuckets=SAMPLE_MINUTES.length;stats.sampledSnapshots=samples.length;stats.missingSampleBuckets=SAMPLE_MINUTES.length-samples.length;
      const presentBuckets=new Set(samples.map(o=>{const t=keyTimestamp(o.Key),jst=new Date(t.getTime()+9*60*60*1000);return Math.floor((jst.getUTCHours()*60+jst.getUTCMinutes())/10);}));stats.missingSampleBuckets=SAMPLE_MINUTES.length-presentBuckets.size;
      let completed=0;await runPool(samples,4,async(object)=>{try{const result=await client.send(new GetObjectCommand({Bucket:env.R2_BUCKET,Key:object.Key}));const bytes=await getBytes(result.Body);if(bytes.length===0){stats.invalidSnapshots++;return;}const decoded=G.transit_realtime.FeedMessage.decode(bytes);if(!decoded.header?.gtfsRealtimeVersion){stats.invalidSnapshots++;return;}consumeDecodedFeed(stats,feedType,decoded);}catch{stats.invalidSnapshots++;}finally{completed++;if(completed%24===0||completed===samples.length)log({event:'sample_progress',date,source_id:source,feed_type:feedType,processed:completed,total:samples.length});}});
      const item={date,source_id:source,feed_type:feedType,utc_prefix_dates:utcDates,listed_objects_for_date:listed.filter(o=>o.Key&&localDateOfKey(o.Key)===date).length,expected_sample_buckets:SAMPLE_MINUTES.length,sampled_snapshots:samples.length,missing_sample_buckets:stats.missingSampleBuckets,valid_snapshots:stats.validSnapshots,valid_empty_snapshots:stats.validEmptySnapshots,invalid_snapshots:stats.invalidSnapshots,vehicle_position_entities:stats.vehiclePositionEntities,trip_update_entities:stats.tripUpdateEntities,stop_time_update_count:stats.stopTimeUpdateCount,carriage_count:stats.carriageCount,header_denominator:'valid sampled snapshots',vehicle_position_denominator:'VehiclePosition entities',trip_update_denominator:'TripUpdate entities',stop_time_update_denominator:'StopTimeUpdate elements',trip_properties_denominator:'TripUpdate entities',carriage_denominator:'CarriageDetails elements',header_field_presence:summarizeCounters(stats.header),vehicle_position_field_presence:summarizeCounters(stats.vehiclePositionFields),trip_update_field_presence:summarizeCounters(stats.tripUpdateFields),stop_time_update_field_presence:summarizeCounters(stats.stopTimeUpdateFields),trip_properties_field_presence:summarizeCounters(stats.tripPropertiesFields),carriage_field_presence:summarizeCounters(stats.carriageFields)};report.push(item);log({event:'feed_sample_summary',...item});
    }}
    const result={dates:TARGET_DATES,method:'one existing raw snapshot at JST minutes 00/10/20/30/40/50 each hour when present; maximum 144 snapshots per feed/date; GET concurrency 4; aggregate counts only',elapsed_ms:Date.now()-started,feeds:report};
    if(env.GITHUB_STEP_SUMMARY){const lines=['## GTFS-Realtime raw field sample audit','','Sampling: one snapshot per 10-minute JST bucket where available; GET concurrency 4. Percentages use the explicitly named entity/snapshot/stop-update denominator. Unknown fields not recognized by the bundled protobuf decoder are marked unsupported, not absent.',''];for(const item of report){lines.push(`### ${item.date} · ${item.source_id} · ${item.feed_type}`,'',`- Sample buckets: ${item.sampled_snapshots}/${item.expected_sample_buckets}; missing sample buckets: ${item.missing_sample_buckets}`,`- Valid: ${item.valid_snapshots}; valid empty: ${item.valid_empty_snapshots}; invalid/un-decodable: ${item.invalid_snapshots}`,`- VehiclePosition entities: ${item.vehicle_position_entities}; TripUpdate entities: ${item.trip_update_entities}; StopTimeUpdates: ${item.stop_time_update_count}`,'','| Field | Present / denominator | Rate | Decoder |','|---|---:|---:|---|');for(const group of ['header_field_presence','vehicle_position_field_presence','trip_update_field_presence','stop_time_update_field_presence','trip_properties_field_presence','carriage_field_presence'])for(const [name,value] of Object.entries(item[group]??{})){const v=value;lines.push(`| ${group.replace('_field_presence','')}.${name} | ${v.supported?`${v.present}/${v.denominator}`:'—'} | ${v.percent==null?'—':`${v.percent}%`} | ${v.supported?'supported':'unsupported'} |`);}lines.push('');}lines.push(`Elapsed: ${(result.elapsed_ms/1000).toFixed(1)} seconds.`);await (await import('node:fs/promises')).appendFile(env.GITHUB_STEP_SUMMARY,lines.join('\n')+'\n');}
    return result;
  }finally{client.destroy();}
}

if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(fileURLToPath(import.meta.url))){try{await runFieldAudit();}catch(error){console.error(`GTFS-RT field audit failed: ${error instanceof Error?error.message:'unknown error'}`);process.exitCode=1;}}
