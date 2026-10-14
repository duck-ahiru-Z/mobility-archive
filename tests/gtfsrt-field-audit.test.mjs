import {describe,expect,it} from 'vitest';
import G from 'gtfs-realtime-bindings/gtfs-realtime.js';
import {consumeDecodedFeed,createFeedStats,pickSamples,SAMPLE_MINUTES} from '../scripts/analyze-gtfsrt-fields.mjs';

describe('read-only GTFS-RT field audit helpers',()=>{
  it('selects only the 144 JST 10-minute buckets and honors the UTC/JST date edge',()=>{
    const keys=[
      {Key:'raw/gtfs-rt/wakayama-bus/vehicle-positions/20261008/150040.pb'},
      {Key:'raw/gtfs-rt/wakayama-bus/vehicle-positions/20261008/151040.pb'},
      {Key:'raw/gtfs-rt/wakayama-bus/vehicle-positions/20261009/145040.pb'},
      {Key:'raw/gtfs-rt/wakayama-bus/vehicle-positions/20261008/150100.pb'}
    ];
    expect(SAMPLE_MINUTES).toHaveLength(144);
    expect(pickSamples(keys,'2026-10-09').map(x=>x.Key)).toEqual([keys[0].Key,keys[1].Key,keys[2].Key]);
  });

  it('counts explicitly set zero values as present and separates empty valid feeds',()=>{
    const T=G.transit_realtime;
    const bytes=T.FeedMessage.encode(T.FeedMessage.create({header:{gtfsRealtimeVersion:'2.0',incrementality:0,timestamp:0},entity:[{id:'synthetic',vehicle:{position:{latitude:0,longitude:0,bearing:0,speed:0},timestamp:0,currentStopSequence:0,occupancyPercentage:0}}]})).finish();
    const decoded=T.FeedMessage.decode(bytes),stats=createFeedStats();
    consumeDecodedFeed(stats,'vehicle-positions',decoded);
    expect(stats.validSnapshots).toBe(1);
    expect(stats.validEmptySnapshots).toBe(0);
    expect(stats.header.timestamp.present).toBe(1);
    expect(stats.vehiclePositionFields['position.latitude'].present).toBe(1);
    expect(stats.vehiclePositionFields['position.latitude'].denominator).toBe(1);
    expect(stats.vehiclePositionFields['position.speed'].present).toBe(1);
    expect(stats.vehiclePositionFields.currentStopSequence.present).toBe(1);

    const empty=createFeedStats();
    consumeDecodedFeed(empty,'trip-updates',T.FeedMessage.decode(T.FeedMessage.encode(T.FeedMessage.create({header:{gtfsRealtimeVersion:'2.0',incrementality:0,timestamp:1},entity:[]})).finish()));
    expect(empty.validEmptySnapshots).toBe(1);
    expect(empty.tripUpdateEntities).toBe(0);
  });

  it('reports binding gaps as unsupported rather than absent',()=>{
    const stats=createFeedStats();
    expect(stats.header.feedVersion.supported).toBe(false);
    expect(stats.vehiclePositionFields['trip.modifiedTrip'].supported).toBe(false);
    expect(stats.vehiclePositionFields['vehicle.wheelchairAccessible'].supported).toBe(false);
    expect(stats.stopTimeUpdateFields['arrival.scheduledTime'].supported).toBe(false);
  });
});
