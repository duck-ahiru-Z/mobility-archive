import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

const output = process.env.EXPLORER_OUTPUT || 'reports/explorer';
const index = JSON.parse(fs.readFileSync(`${output}/data/index.json`, 'utf8'));

describe('generated Mobility Archive Explorer', () => {
  it('formats UTC timestamps across the JST date boundary', () => {
    const page=fs.readFileSync(`${output}/index.html`,'utf8');
    const formatter=page.match(/function jst\(value\)\{[^}]+\}\)[^}]+\}/)?.[0];
    expect(formatter).toBeTruthy();
    expect(vm.runInNewContext(`${formatter};jst('2026-09-28T20:24:00Z')`)).toBe('2026-09-29 05:24 JST');
  });
  it('discovers the available daily archive dates in order', () => {
    expect(index.dates.length).toBeGreaterThanOrEqual(1);
    expect(index.dates).toEqual([...index.dates].sort());
    expect(index.days.map((d: { date: string }) => d.date)).toEqual(index.dates);
  });

  it('has internally consistent daily counts', () => {
    for (const d of index.days) {
      expect(d.entityCount).toBe(d.vehiclePositions + d.tripUpdates);
      expect(d.coveragePercent).toBeGreaterThanOrEqual(0);
      expect(d.coveragePercent).toBeLessThanOrEqual(100);
      expect(d.coveragePercent).toBeCloseTo((d.expected - d.missing.length) / d.expected * 100, 8);
    }
  });

  it('uses raw-key snapshot time for replay and presents the controls', () => {
    const date = index.dates.at(-1);
    const day = JSON.parse(fs.readFileSync(`${output}/data/${date}.json`, 'utf8'));
    expect(day.replay.length).toBeGreaterThan(0);
    expect(day.replay.every((r: { t: string }) => Number.isFinite(Date.parse(r.t)))).toBe(true);
    expect(day.first).toBe(day.replay.map((r: { t: string }) => r.t).sort()[0]);
    expect(day.last).toBe(day.replay.map((r: { t: string }) => r.t).sort().at(-1));
    expect(day.quality.invalidCoordinates).toBe(0);
    expect(day.quality.invalidTimestamps).toBe(0);
    expect(day.vehiclePositions).toBeGreaterThan(0);

    const page = fs.readFileSync(`${output}/index.html`, 'utf8');
    for (const control of ['id="date"', 'id="play"', 'id="step"', 'id="slider"', 'id="map"']) {
      expect(page).toContain(control);
    }
    expect(page).toContain('First key time');
    expect(page).toContain('Last key time');
  });

  it('keeps valid empty feeds separate from invalid feeds', () => {
    const day = index.days.at(-1);
    expect(day.empty).toBeGreaterThanOrEqual(0);
    expect(day.invalid).toBeGreaterThanOrEqual(0);
  });

  it('compares actual manifest source counts against Parquet counts', () => {
    for (const day of index.days) {
      expect(day.quality.sourceCountChecks.length).toBeGreaterThan(0);
      for (const source of day.quality.sourceCountChecks) {
        const manifestSource = day.manifest.sources.find((s: {source_id:string}) => s.source_id === source.source_id);
        expect(source.manifestRows).toBe(manifestSource.parsed_entity_count ?? null);
        expect(source.parquetRows).toBe(day.sourceStats[source.source_id] || 0);
      }
      expect(day.quality.manifestParquetMismatch).toBe(day.quality.sourceCountChecks.filter((s: {manifestRows:number|null;parquetRows:number}) => s.manifestRows != null && s.manifestRows !== s.parquetRows).length);
    }
  });
});
