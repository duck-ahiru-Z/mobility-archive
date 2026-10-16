import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import parquet from 'parquetjs-lite';
import G from 'gtfs-realtime-bindings';
import { S3Client, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { listAllObjects, localDateOfKey, localMinuteSlotOfKey, missingJstMinuteSlots, utcDatesForJstDate } from './daily-archive-lib.mjs';
import { growthEstimate, PROCESS_BATCH_SIZE, processInBatches, R2_GET_CONCURRENCY } from './daily-archive-processing.mjs';

const startedAt = Date.now();
const date = process.env.ARCHIVE_DATE;
const out = process.env.OUTPUT_DIR || 'archive';
if (!date) throw new Error('ARCHIVE_DATE is required');

const sources = ['wakayama-bus', 'wakayama-bus-naga'];
const feeds = ['vehicle-positions', 'trip-updates'];
const expectedRunsPerFeed = 1440;
const client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
});

const schema = new parquet.ParquetSchema({
  observed_at: { type: 'TIMESTAMP_MILLIS' }, source_id: { type: 'UTF8' }, feed_type: { type: 'UTF8' },
  entity_id: { type: 'UTF8', optional: true }, trip_id: { type: 'UTF8', optional: true }, route_id: { type: 'UTF8', optional: true },
  vehicle_id: { type: 'UTF8', optional: true }, latitude: { type: 'DOUBLE', optional: true }, longitude: { type: 'DOUBLE', optional: true },
  delay_seconds: { type: 'INT64', optional: true }, raw_object_key: { type: 'UTF8' }, raw_sha256: { type: 'UTF8' },
  collector_version: { type: 'UTF8' },
});

const log = (event, fields = {}) => console.log(JSON.stringify({ event, ...fields }));
const objects = [];
const utcDates = utcDatesForJstDate(date);
log('daily_archive_started', { date, timezone: 'Asia/Tokyo', utc_prefix_dates: utcDates, get_concurrency: R2_GET_CONCURRENCY, batch_size: PROCESS_BATCH_SIZE });

for (const source of sources) {
  for (const feed of feeds) {
    const listed = [];
    for (const utcDate of utcDates) {
      const prefix = `raw/gtfs-rt/${source}/${feed}/${utcDate}/`;
      const pageObjects = await listAllObjects(client, (input) => new ListObjectsV2Command(input), {
        bucket: process.env.R2_BUCKET,
        prefix,
        log: (details) => log('r2_prefix_listed', { prefix: details.prefix, pages_fetched: details.pages_fetched, objects_listed: details.objects_listed }),
      });
      listed.push(...pageObjects.map((object) => ({ ...object, source, feed })));
    }
    const filtered = listed.filter((object) => localDateOfKey(object.Key) === date);
    log('jst_filter', { source_id: source, feed_type: feed, objects_before_jst_filter: listed.length, objects_after_jst_filter: filtered.length });
    objects.push(...filtered);
  }
}

let r2Bytes = null;
try {
  const month = date.slice(0, 7).replace('-', '');
  const body = await (await client.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: `_control/monthly/${month}.json` }))).Body.transformToString();
  r2Bytes = JSON.parse(body).bytes;
} catch {
  log('r2_estimated_usage_unavailable');
}

const dailyRawBytes = objects.reduce((total, object) => total + Number(object.Size || 0), 0);
const { projected_30_day_growth, projected_365_day_growth, projection_basis, r2_growth_24h_bytes, r2_growth_24h_basis } = growthEstimate(dailyRawBytes);
const storageStatus = r2Bytes == null ? 'unknown' : r2Bytes >= 10_000_000_000 ? 'over_free_tier' : r2Bytes >= 9_500_000_000 ? 'emergency' : r2Bytes >= 9_000_000_000 ? 'critical' : r2Bytes >= 8_000_000_000 ? 'warning' : 'normal';
const outDir = path.join(out, date.replaceAll('-', '/'));
await fs.mkdir(outDir, { recursive: true });

const manifest = {
  date, timezone: 'Asia/Tokyo', dataset_schema_version: '1', generated_at: new Date().toISOString(),
  expected_fetch_count: sources.length * feeds.length * expectedRunsPerFeed,
  saved_raw_object_count: objects.length,
  r2_estimated_bytes: r2Bytes,
  r2_estimated_gb: r2Bytes == null ? null : r2Bytes / 1e9,
  storage_status: storageStatus,
  storage_measurement_basis: r2Bytes == null ? 'unavailable' : 'bytes field from _control/monthly/<YYYYMM>.json; refresh timing/source is not verified here, and it is not a live R2 inventory listing',
  daily_growth_bytes: dailyRawBytes,
  daily_growth_basis: 'measured sum of listed raw object sizes for this JST date; not net bucket growth',
  r2_growth_24h_bytes,
  r2_growth_24h_basis,
  projected_30_day_growth,
  projected_365_day_growth,
  projection_basis,
  processing: { get_concurrency: R2_GET_CONCURRENCY, batch_size: PROCESS_BATCH_SIZE, duration_ms: null },
  quality_metric_semantics: {
    successful_fetch_count: 'Successfully decoded GTFS-Realtime objects; includes valid empty feeds and preserves the existing manifest meaning',
    success_rate: 'Unique JST minute slots with a successfully decoded feed divided by 1440; valid empty feeds count as success, duplicates cannot exceed 100%',
    valid_feed_count: 'Decode-successful objects, including valid empty feeds; valid_empty_feed_count is a subset',
    invalid_feed_count: 'HTTP-successful archived objects that were zero-byte or failed protobuf validation',
    http_failure_count: 'Archived objects whose stored provider HTTP status was non-2xx; absence is counted as a missing interval, not an inferred HTTP failure',
    r2_read_failure_count: 'R2 GetObject/body-read failures during this daily job',
    missing_interval_count: 'Expected JST minutes without an archived object having a successful stored provider HTTP status',
  },
  sources: [],
  license_note: 'Raw-derived datasets remain private; no redistribution is performed.',
};

for (const source of sources) {
  const sourceObjects = objects.filter((object) => object.source === source);
  const feedStats = [];
  let parsedEntityCount = 0;
  let writer = null;
  const outputFile = path.join(outDir, `${source}.parquet`);
  const publish = process.env.ALLOW_PRIVATE_DATASET === 'true';

  for (const feed of feeds) {
    const related = sourceObjects.filter((object) => object.feed === feed);
    const seenSlots = new Set();
    const validSlots = new Set();
    const errors = [];
    const feedStartedAt = Date.now();
    let valid = 0;
    let validEmpty = 0;
    let invalid = 0;
    let httpFailure = 0;
    let r2ReadFailure = 0;
    let httpSuccess = 0;
    let completed = 0;
    let feedEntityCount = 0;
    log('feed_processing_started', { source_id: source, feed_type: feed, objects: related.length });

    await processInBatches(related, PROCESS_BATCH_SIZE, R2_GET_CONCURRENCY, async (object) => {
      let response;
      try {
        response = await client.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: object.Key }));
      } catch {
        return { kind: 'get_error', key: object.Key };
      }
      const status = Number(response.Metadata?.http_status || 200);
      if (status < 200 || status >= 300) return { kind: 'http_failure', key: object.Key };
      let bytes;
      try {
        bytes = Buffer.from(await response.Body.transformToByteArray());
      } catch {
        return { kind: 'body_error', key: object.Key };
      }
      const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
      const expectedSha = response.Metadata?.sha256 || '';
      let checksumError = null;
      if (expectedSha && expectedSha !== sha256) checksumError = { key: object.Key, error: 'sha256_mismatch' };
      if (bytes.length === 0) return { kind: 'invalid', key: object.Key, slot: localMinuteSlotOfKey(object.Key), checksumError, parseError: 'zero_byte_object' };
      try {
        const message = G.transit_realtime.FeedMessage.decode(bytes);
        if (!message.header?.gtfsRealtimeVersion) throw new Error('missing GTFS-RT header');
        const rows = message.entity.map((entity) => ({
          observed_at: new Date(Number(message.header.timestamp || 0) * 1000),
          source_id: source,
          feed_type: feed,
          entity_id: entity.id || null,
          trip_id: entity.vehicle?.trip?.tripId || entity.tripUpdate?.trip?.tripId || null,
          route_id: entity.vehicle?.trip?.routeId || entity.tripUpdate?.trip?.routeId || null,
          vehicle_id: entity.vehicle?.vehicle?.id || null,
          latitude: entity.vehicle?.position?.latitude || null,
          longitude: entity.vehicle?.position?.longitude || null,
          delay_seconds: null,
          raw_object_key: object.Key,
          raw_sha256: sha256,
          collector_version: '0.1.0',
        }));
        return { kind: 'valid', key: object.Key, slot: localMinuteSlotOfKey(object.Key), rowCount: rows.length, rows, checksumError };
      } catch {
        return { kind: 'invalid', key: object.Key, slot: localMinuteSlotOfKey(object.Key), checksumError, parseError: 'protobuf_decode_failed' };
      }
    }, async (results, batchStart) => {
      for (const result of results) {
        completed++;
        if (result.kind === 'get_error') {
          r2ReadFailure++;
          errors.push({ key: result.key, error: 'r2_get_failed' });
        } else if (result.kind === 'http_failure') {
          httpFailure++;
          errors.push({ key: result.key, error: 'source_http_failure' });
        } else if (result.kind === 'body_error') {
          r2ReadFailure++;
          errors.push({ key: result.key, error: 'r2_body_read_failed' });
        } else {
          httpSuccess++;
          if (result.slot) seenSlots.add(result.slot);
          if (result.checksumError) errors.push(result.checksumError);
          if (result.kind === 'invalid') {
            invalid++;
            errors.push({ key: result.key, error: result.parseError });
          } else {
            valid++;
            if (result.slot) validSlots.add(result.slot);
            if (result.rowCount === 0) validEmpty++;
            feedEntityCount += result.rowCount;
            if (publish && result.rows.length) {
              if (!writer) writer = await parquet.ParquetWriter.openFile(schema, outputFile);
              for (const row of result.rows) await writer.appendRow(row);
            }
          }
        }
      }
      if (completed % 100 < results.length || completed === related.length) {
        log('feed_progress', { source_id: source, feed_type: feed, completed_objects: completed, total_objects: related.length, elapsed_ms: Date.now() - feedStartedAt, batch: Math.floor(batchStart / PROCESS_BATCH_SIZE) + 1 });
      }
    });

    const missing = missingJstMinuteSlots(date, seenSlots);
    parsedEntityCount += feedEntityCount;
    feedStats.push({
      feed_type: feed,
      expected_fetch_count: expectedRunsPerFeed,
      saved_raw_object_count: related.length,
      successful_fetch_count: valid,
      failed_fetch_count: Math.max(0, expectedRunsPerFeed - valid),
      success_rate: Math.min(1, validSlots.size / expectedRunsPerFeed),
      valid_feed_count: valid,
      valid_empty_feed_count: validEmpty,
      invalid_feed_count: invalid,
      http_successful_fetch_count: httpSuccess,
      http_failure_count: httpFailure,
      r2_read_failure_count: r2ReadFailure,
      unique_successful_slot_count: seenSlots.size,
      unique_valid_slot_count: validSlots.size,
      missing_interval_count: missing.length,
      missing_intervals: missing,
      validation_errors: errors,
      processing_duration_ms: Date.now() - feedStartedAt,
    });
    log('feed_processing_completed', { source_id: source, feed_type: feed, objects: related.length, decoded: valid, valid_empty: validEmpty, invalid, http_failure: httpFailure, r2_read_failure: r2ReadFailure, missing_intervals: missing.length, duration_ms: Date.now() - feedStartedAt });
  }

  if (writer) await writer.close();
  const outputFiles = writer ? [path.relative(out, outputFile).replaceAll('\\', '/')] : [];
  const total = feedStats.reduce((accumulator, stats) => {
    for (const key of ['expected_fetch_count', 'saved_raw_object_count', 'successful_fetch_count', 'failed_fetch_count', 'valid_feed_count', 'valid_empty_feed_count', 'invalid_feed_count', 'http_successful_fetch_count', 'http_failure_count', 'r2_read_failure_count', 'unique_successful_slot_count', 'unique_valid_slot_count', 'missing_interval_count']) accumulator[key] += stats[key];
    return accumulator;
  }, { expected_fetch_count: 0, saved_raw_object_count: 0, successful_fetch_count: 0, failed_fetch_count: 0, valid_feed_count: 0, valid_empty_feed_count: 0, invalid_feed_count: 0, http_successful_fetch_count: 0, http_failure_count: 0, r2_read_failure_count: 0, unique_successful_slot_count: 0, unique_valid_slot_count: 0, missing_interval_count: 0 });
  manifest.sources.push({
    source_id: source,
    ...total,
    success_rate: total.unique_valid_slot_count / total.expected_fetch_count,
    feeds: feedStats,
    parsed_entity_count: parsedEntityCount,
    publish_daily_dataset: false,
    private_archive: true,
    output_files: outputFiles,
  });
}

manifest.processing.duration_ms = Date.now() - startedAt;
await fs.writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
log('daily_archive_completed', { date, listed_objects: objects.length, daily_raw_bytes: dailyRawBytes, duration_ms: manifest.processing.duration_ms });
