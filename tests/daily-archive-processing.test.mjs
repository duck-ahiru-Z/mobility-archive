import { describe, expect, it } from 'vitest';
import { processInBatches, percentile, growthEstimate, PROCESS_BATCH_SIZE, R2_GET_CONCURRENCY } from '../scripts/daily-archive-processing.mjs';
import { localDateOfKey, localMinuteSlotOfKey, missingJstMinuteSlots, utcDatesForJstDate } from '../scripts/daily-archive-lib.mjs';

describe('daily archive processing helpers', () => {
  it('bounds each processing batch and preserves input result order', async () => {
    let active = 0;
    let maxActive = 0;
    const items = Array.from({ length: 41 }, (_, i) => i);
    const result = [];
    await processInBatches(items, PROCESS_BATCH_SIZE, R2_GET_CONCURRENCY, async (value) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, value % 3));
      active -= 1;
      return value * 2;
    }, (batch) => result.push(...batch));
    expect(maxActive).toBeLessThanOrEqual(R2_GET_CONCURRENCY);
    expect(result).toEqual(items.map((value) => value * 2));
  });

  it('uses a small fixed batch to bound in-flight raw payloads', () => {
    expect(PROCESS_BATCH_SIZE).toBe(16);
    expect(R2_GET_CONCURRENCY).toBe(8);
  });

  it('selects JST date across previous and current UTC prefixes', () => {
    expect(utcDatesForJstDate('2026-10-02')).toEqual(['20261001', '20261002']);
    expect(localDateOfKey('raw/gtfs-rt/wakayama-bus/vehicle-positions/20261001/150000.pb')).toBe('2026-10-02');
    expect(localDateOfKey('raw/gtfs-rt/wakayama-bus/vehicle-positions/20261002/145900.pb')).toBe('2026-10-02');
    expect(localDateOfKey('raw/gtfs-rt/wakayama-bus/vehicle-positions/20261002/150000.pb')).toBe('2026-10-03');
    expect(localMinuteSlotOfKey('raw/gtfs-rt/wakayama-bus/vehicle-positions/20261001/150000.pb')).toBe('202610020000');
    expect(localMinuteSlotOfKey('raw/gtfs-rt/wakayama-bus/vehicle-positions/20261002/145900.pb')).toBe('202610022359');
  });

  it('counts missing JST minute slots, independent of the existence of empty feeds', () => {
    const seen = new Set(['202610020000', '202610020002']);
    const missing = missingJstMinuteSlots('2026-10-02', seen);
    expect(missing).toHaveLength(1438);
    expect(missing.slice(0, 2)).toEqual(['202610020001', '202610020003']);
    expect(missing.at(-1)).toBe('202610022359');
  });

  it('reports measured percentiles and keeps projections explicitly estimated', () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2);
    expect(growthEstimate(100)).toEqual({
      projected_30_day_growth: 3000,
      projected_365_day_growth: 36500,
      projection_basis: 'estimate from this JST date raw-object bytes × days; not an R2 inventory delta',
      r2_growth_24h_bytes: null,
      r2_growth_24h_basis: 'not_measured',
    });
  });
});
