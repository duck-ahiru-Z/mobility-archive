# Mobility Archive Explorer and data coverage notes

## Reconstruction entry point (2026-11-26)

Generate and serve the current local Explorer:

```powershell
cd C:\Users\iwaku\pro\mobility-archive
node analytics/generate-explorer.mjs data-source/archive reports/verified-explorer
node analytics/serve-explorer.mjs
```

Open http://127.0.0.1:4173/ and leave the terminal running. The server binds only to the local computer and disables browser caching. The earlier `reports/explorer` and `reports/rebuilt-explorer` folders are previous outputs.

Current evidence is in `reports/reconstruction-audit.json`, `reports/feed-probe-network.json`, and `reports/feed-probe-network-second.json`. Two direct origin probes on November 26 returned valid nonempty feeds and changed hashes/header timestamps for all four feeds. These local probes do not exercise the deployed Worker's cache. Historical repeated payloads remain unsuitable for minute trajectory reconstruction; no interpolation can recover unrecorded movement. Production/R2 inspection requires Cloudflare authentication, and production deployment has not been performed.

The Explorer is a local, static view generated from the private daily archive (Parquet + manifest). It does not read or publish raw protobuf. Its map replay timestamp is derived from `raw_object_key`; GTFS-RT header time is kept separately as `observed_at` and must not be confused with collector snapshot time.

```powershell
node analytics/generate-explorer.mjs data-source/archive reports/explorer
npm test -- --run tests/explorer.test.ts
```

Serve `reports/explorer` using a local static server. The page loads Leaflet tiles and Chart.js from public CDNs. The current local input contains 54 JST dates through 2026-11-19 (some dates may be absent); regenerate whenever new daily Parquet arrives.

## What is in today's Parquet

The production writer in `scripts/daily-archive.mjs` currently writes one entity row with only:

`observed_at, source_id, feed_type, entity_id, trip_id, route_id, vehicle_id, latitude, longitude, delay_seconds, raw_object_key, raw_sha256, collector_version`

`delay_seconds` is explicitly written as null in the current writer. In particular, it does not currently persist: GTFS-RT header/incrementality/feed version, scheduled/requested/fetched times, vehicle bearing/speed/odometer/status/current-stop fields, congestion/occupancy, trip descriptor details, TripUpdate timestamp/top-level delay/trip properties, or the full repeated `stop_time_update[]` and arrival/departure events. `src/gtfsrt.ts` has a separate normalizer that reads a few extra values, but it is not the production daily Parquet writer; it only looks at the first stop-time update and also hardcodes schedule relationship and occupancy to null. Thus its existence does not mean the current dataset contains those values.

The stored Parquet schema proves only what the daily projection retained. It cannot prove those fields were absent in the source protobuf. No raw protobuf or Static GTFS ZIP is present in this local data checkout, and this session has no R2 credentials, so this checkout cannot establish presence rates for fields omitted by the Parquet writer. However, `raw_sha256` is computed from the exact R2 object bytes during daily processing; repeated hashes in the Parquet can establish when consecutive nonempty snapshots were byte-identical.

## Snapshot freshness audit (2026-11-20)

The 2026-09-29 and 2026-11-19 daily Parquets show that collection completeness and feed freshness are different metrics. On 2026-09-29, all 5,760 expected objects were saved and decoded, with 1,377 valid empty feeds and no invalid/HTTP failures. On 2026-11-19, 5,753/5,760 objects were saved; the seven absent objects are manifest missing intervals, with no invalid/HTTP failures. Among the nonempty objects represented in Parquet, each source/feed contains only 9–11 unique raw SHA-256 values for the day; 99.1–99.3% of adjacent nonempty snapshots have exactly the same hash, often in runs of 121 minute-keyed objects. This is direct evidence that the archived responses repeat byte-for-byte for roughly two hours. It rules out Parquet coordinate projection as the cause of those repeated payloads, but cannot distinguish the provider's refresh cadence from an upstream/intermediate cache.

Vehicle coordinates are also almost always repeated in successive entity rows: 99.35% on 2026-09-29 and 99.37% on 2026-11-19 when ordered by snapshot key and grouped by source/vehicle. Grouping by source/vehicle/trip yields 99.99% and 100.00% unchanged adjacent coordinates respectively. This archive is useful for proving fetch/decode availability and for coarse snapshots, but it does not support minute-resolution bus trajectories or reliable delay analysis as currently projected.

`observed_at` is copied from `FeedHeader.timestamp`, not the collection time. Since the protobuf body repeats, this timestamp repeats too and lags the object-key scheduled minute by about an hour at the median, up to about two hours in these samples. The R2 key is built from the scheduled event time; the collector's actual `fetched_at` metadata is not copied into Parquet. The Explorer therefore uses the key's scheduled minute for replay and labels it accordingly. The displayed `duplicate entity` check is scoped to `raw_object_key + source + feed + entity_id`; repeating the same entity in different snapshots is expected and is not counted as an entity duplicate.

## GTFS-Realtime fields to preserve

The current official GTFS-Realtime reference is versioned and evolves. Both feeds should be decoded against the supported protobuf schema while retaining the immutable raw object as the source of truth. The reference marks many data fields optional; absent values must stay null/absent, not be synthesized.

For these two feed types, preserve:

- Feed envelope/header: `gtfs_realtime_version`, `incrementality`, `timestamp`, optional `feed_version`; entity ordering and count.
- FeedEntity: `id`, `is_deleted`, and which payload is present. The specification also has other entity payload types (alerts, shapes, stops, trip modifications); if any occur in these endpoints, do not silently drop them.
- Shared TripDescriptor: `trip_id`, `route_id`, `direction_id`, `start_time`, `start_date`, `schedule_relationship`, and modified-trip selectors as supported by the protobuf version.
- Shared VehicleDescriptor: `id`, `label`, `license_plate`, `wheelchair_accessible`.
- VehiclePosition: nested `Position.latitude`, `longitude`, `bearing`, `odometer`, `speed`; `current_stop_sequence`, `stop_id`, `current_status`, `timestamp`, `congestion_level`, `occupancy_status`, `occupancy_percentage`, and repeated `multi_carriage_details` (including carriage ID/label, occupancy status/percentage, and seating capacity). Occupancy and carriage fields are experimental in the spec and must retain raw enum/numeric values as well as any decoded label.
- TripUpdate: required TripDescriptor; optional VehicleDescriptor, `timestamp`, trip-level `delay`, and TripProperties (`trip_id`, `start_date`, `start_time`); every element of repeated `stop_time_update[]` with its original index/order, `stop_sequence`, `stop_id`, `schedule_relationship`, `arrival_occupancy_status`, `departure_occupancy_status`, and StopTimeProperties (`assigned_stop_id`, `stop_headsign`, `pickup_type`, `drop_off_type`).
- Each arrival and departure StopTimeEvent: `delay`, absolute `time`, `scheduled_time` when permitted, and `uncertainty`. Keep arrival and departure independent; a stop can contain either or both. Preserve unknown enum values and raw protobuf for forward compatibility.

## Proposed loss-preserving analytical layout (design only)

Do not overwrite schema v1. Create a versioned v2 dataset side-by-side after a small validation run:

1. `snapshots`: one row per fetched R2 object, including source/feed, R2 key, SHA-256, object bytes, `scheduled_at`, `requested_at`, `fetched_at`, HTTP/content metadata, header fields, decode status, and entity count. This table represents empty-but-valid feeds too.
2. `entities`: one row per FeedEntity with stable `snapshot_id`, `entity_index`, entity ID/deletion/type and shared descriptor columns. Unknown payload types remain represented in a raw/extension field, not filtered out.
3. `vehicle_positions`: one row per vehicle entity; nullable position, movement, stop/status, congestion, occupancy, and vehicle/trip descriptor columns. Store enum code and decoded name separately.
4. `trip_updates`: one row per TripUpdate entity with TripDescriptor, VehicleDescriptor, update timestamp, trip-level delay, and trip properties.
5. `stop_time_updates`: one row per repeated stop-time update, keyed by `snapshot_id + entity_index + update_index`; keep sequence, stop, relationship, properties, arrival event fields, departure event fields, occupancy fields. Never collapse to the first stop.

All child tables use explicit nullable values and stable schema/version metadata. Retain the original R2 key and raw hash on every row or joinable snapshot ID. Preserve unrecognized protobuf data in the immutable raw object; a decoder/schema upgrade can regenerate analytical tables later. Use enum integer/code fields so an unknown future enum is not converted to null. Consider Parquet logical timestamps in UTC and source-local date only as partition metadata.

Migration should write to a new schema-version path (for example `archive-v2/...`) or a separate private verification output, compare counts/hashes/field-presence summaries, and only then consider changing consumers. Historical R2 reprocessing is technically supported by the existing raw key/time partitions and R2 list pagination helper, but it has not been run here. No old Parquet has been overwritten and no mass backfill was performed.

## Static GTFS relationship

The collector stores changed Static GTFS ZIP versions under `static/<source_id>/versions/<sha256>.zip`; identical content is deduplicated by hash and old versions are retained. There are no ZIP originals in the local `data-source/archive` checkout, so this inspection cannot enumerate the saved schedules or confirm each source's active hash. A future static extraction should be versioned by that hash: join TripUpdate/VehiclePosition `trip_id` to `trips.txt`, then `route_id` to `routes.txt`, `stop_id` and `stop_sequence` to `stops.txt`/`stop_times.txt`; use `calendar.txt` + `calendar_dates.txt` and service date for service validity, and `shape_id` + ordered `shape_pt_sequence` from `shapes.txt` for route geometry. Preserve service-day times above 24:00:00 and use source/static hash in joins; do not join against today's timetable when analyzing old observations.

## Current audit status

- Explorer input: daily Parquet/manifests through 2026-10-12 in the local private data checkout.
- Raw GTFS-RT R2 objects: unavailable locally; actual field-presence rates by operator remain unmeasured.
- Static GTFS ZIP originals: not in the daily-data checkout; stored R2 versions are not accessible from this local session.
- Current daily Parquet rows are processed projection, not a raw backup.

For field-presence statistics, a future manual, read-only analysis run must list all R2 pages for both UTC date prefixes spanning the JST target day, fetch each 4-feed object, decode in runner temp storage, and emit aggregate counts only (no raw field values, raw logs, artifacts, or public files). Denominators should distinguish valid nonempty entities, valid empty snapshots, invalid protobufs, and HTTP/fetch failures. A field's occurrence rate should be reported at the appropriate unit (snapshot/feed, entity, or stop-time-update), not one ambiguous percentage.

## References

- [GTFS-Realtime Reference](https://gtfs.org/documentation/realtime/reference/)
- [Vehicle Positions](https://gtfs.org/documentation/realtime/feed-entities/vehicle-positions/)
- [Trip Updates](https://gtfs.org/documentation/realtime/feed-entities/trip-updates/)
