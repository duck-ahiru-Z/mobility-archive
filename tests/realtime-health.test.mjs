import {it,expect} from 'vitest';
import {inspectSnapshot} from '../scripts/realtime-health.mjs';
const now=Date.parse('2026-11-26T10:00:00Z');
function sample(overrides={}){return {now,fetchedAt:new Date(now-10000).toISOString(),httpStatus:'200',bytes:15,message:{header:{gtfsRealtimeVersion:'2.0',timestamp:(now-15000)/1000},entity:[{id:'one'}]},...overrides};}
it('accepts a fresh recorded snapshot',()=>{expect(inspectSnapshot(sample()).stale).toBe(false);});
it('detects stopped saving and missing fetch timestamps',()=>{expect(()=>inspectSnapshot(sample({fetchedAt:new Date(now-240000).toISOString()}))).toThrow();expect(()=>inspectSnapshot(sample({fetchedAt:undefined}))).toThrow();});
it('detects cached and future header timestamps',()=>{for(const timestamp of [(now-3600000)/1000,(now+120000)/1000])expect(inspectSnapshot(sample({message:{header:{gtfsRealtimeVersion:'2.0',timestamp},entity:[{id:'one'}]}})).stale).toBe(true);});
it('accepts valid empty feeds even when their header is old',()=>{const result=inspectSnapshot(sample({message:{header:{gtfsRealtimeVersion:'2.0',timestamp:1},entity:[]}}));expect(result.valid_empty_feed).toBe(true);expect(result.stale).toBe(false);});
it('rejects zero bytes and failed HTTP metadata',()=>{expect(()=>inspectSnapshot(sample({bytes:0}))).toThrow();expect(()=>inspectSnapshot(sample({httpStatus:503}))).toThrow();});
