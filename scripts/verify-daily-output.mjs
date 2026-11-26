import fs from 'node:fs/promises';
import path from 'node:path';
import parquet from 'parquetjs-lite';
import {localDateOfKey,localMinuteSlotOfKey} from './daily-archive-lib.mjs';

const root = process.env.OUTPUT_DIR || 'archive';
const date = process.env.ARCHIVE_DATE;
if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('ARCHIVE_DATE required');
const directory = path.join(root, ...date.split('-'));
const manifest = JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8'));
const errors = [], warnings = [], feeds = [];
if (manifest.date !== date || manifest.timezone !== 'Asia/Tokyo') errors.push('Manifest date/timezone mismatch');
if (manifest.processing?.status !== 'success') errors.push('Daily processing did not succeed');
const requiredSources = ['wakayama-bus', 'wakayama-bus-naga'];
if (manifest.sources.length !== requiredSources.length || requiredSources.some(id => !manifest.sources.some(s => s.source_id === id))) errors.push('Expected source set mismatch');
for (const source of manifest.sources) {
  if (!source.snapshot_files?.length || source.snapshot_schema_version !== '2') errors.push(`Snapshot v2 missing ${source.source_id}`);
  if (source.feeds.length !== 2 || ['vehicle-positions','trip-updates'].some(type => !source.feeds.some(f => f.feed_type === type))) errors.push(`Expected feed set mismatch ${source.source_id}`);
  let entities = 0, snapshots = 0, legacyRows = 0;
  const stats = new Map(), keys = new Set();
  for (const file of source.output_files || []) {
    // Legacy count verification needs the footer count, not timestamp decoding.
    // rawStatistics avoids parquetjs-lite's BigInt timestamp statistics bug.
    const reader = await parquet.ParquetReader.openFile(path.join(root, file), {rawStatistics:true});
    try { legacyRows += Number(reader.getRowCount()); }
    finally { await reader.close(); }
  }
  for (const file of source.snapshot_files || []) {
    const reader = await parquet.ParquetReader.openFile(path.join(root, file));
    try {
      const cursor = reader.getCursor(); let row;
      while ((row = await cursor.next())) {
        snapshots++;
        if (keys.has(row.raw_object_key)) errors.push(`Duplicate object ${row.raw_object_key}`);
        keys.add(row.raw_object_key);
        const metadata = JSON.parse(row.metadata_json), header = JSON.parse(row.header_json);
        const decoded = JSON.parse(row.decoded_entities_json);
        entities += decoded.length;
        if (decoded.length !== Number(row.entity_count)) errors.push(`Entity count mismatch ${row.raw_object_key}`);
        const fetched = Date.parse(metadata.fetched_at);
        if (!Number.isFinite(fetched)) errors.push(`Missing fetch timestamp ${row.raw_object_key}`);
        else if (new Date(fetched + 9 * 3600000).toISOString().slice(0,10) !== date) warnings.push(`Fetch crossed JST boundary ${row.raw_object_key}`);
        const stat = stats.get(row.feed_type) || {source:source.source_id,feed:row.feed_type,count:0,nonempty:0,stale:0,payloads:new Set(),slots:new Set()};
        const slot=localMinuteSlotOfKey(row.raw_object_key);
        if (!slot || localDateOfKey(row.raw_object_key)!==date) errors.push(`Invalid snapshot partition ${row.raw_object_key}`);
        else stat.slots.add(slot);
        stat.count++; stat.payloads.add(row.raw_sha256);
        if (decoded.length) {
          stat.nonempty++;
          const headerMs = Number(header.timestamp)*1000;
          if (!header.timestamp || !Number.isFinite(headerMs) || fetched-headerMs>300000 || headerMs-fetched>60000) stat.stale++;
        }
        for (const entity of decoded) {
          const p = entity.vehicle?.position;
          if (p && (!Number.isFinite(p.latitude) || !Number.isFinite(p.longitude) || Math.abs(p.latitude)>90 || Math.abs(p.longitude)>180)) errors.push(`Invalid coordinates ${row.raw_object_key}`);
        }
        stats.set(row.feed_type, stat);
      }
    } finally { await reader.close(); }
  }
  if (legacyRows !== source.parsed_entity_count || entities !== source.parsed_entity_count || snapshots !== source.snapshot_count) errors.push(`Parquet/manifest mismatch ${source.source_id}`);
  for (const expected of source.feeds) {
    const stat = stats.get(expected.feed_type);
    if (!stat || stat.count !== expected.valid_feed_count) errors.push(`Snapshot/feed count mismatch ${source.source_id}/${expected.feed_type}`);
    if (stat && stat.slots.size !== expected.unique_valid_slot_count) errors.push(`Snapshot/minute coverage mismatch ${source.source_id}/${expected.feed_type}`);
    if (expected.unique_valid_slot_count < expected.expected_fetch_count) warnings.push(`Missing successful minutes ${source.source_id}/${expected.feed_type}: ${expected.expected_fetch_count-expected.unique_valid_slot_count}`);
  }
  for (const stat of stats.values()) {
    if (stat.nonempty && stat.stale/stat.nonempty > 0.1) warnings.push(`Stale feed exceeds 10% ${stat.source}/${stat.feed}: ${stat.stale}/${stat.nonempty}`);
    feeds.push({...stat,payloads:stat.payloads.size,slots:stat.slots.size});
  }
}
const report = {date,checked_at:new Date().toISOString(),status:errors.length?'failed':warnings.length?'degraded':'passed',policy:{max_header_age_seconds:300,max_stale_nonempty_fraction:0.1,expected_minute_coverage:1,publication:'Block corruption; preserve valid degraded archives with explicit warnings'},errors,warnings,feeds};
await fs.writeFile(path.join(directory,'quality.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
if (process.env.GITHUB_ACTIONS) {
  if (warnings.length) console.log(`::warning title=Archive quality degraded::${warnings.length} quality warnings for ${date}; see quality.json and job summary`);
  if (errors.length) console.log(`::error title=Archive integrity failed::${errors.length} integrity errors for ${date}; publication blocked`);
}
if(errors.length) process.exitCode=1;
