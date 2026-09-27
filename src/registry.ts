import type {Source} from './types';
import bus from '../sources/wakayama-bus.json'; import naga from '../sources/wakayama-bus-naga.json';
export const sources: Source[]=[bus,naga] as Source[];
export function validateSource(s:Source){if(!s.id||!s.name||!s.feeds?.vehicle_positions||!s.feeds?.trip_updates||!s.feeds?.static_gtfs) throw new Error(`Invalid source: ${s.id}`); return s;}
