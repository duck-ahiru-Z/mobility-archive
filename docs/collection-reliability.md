# Collection and recovery contract

The collector saves immutable raw GTFS-Realtime responses each minute. Raw keys
use UTC; daily archives use Asia/Tokyo and list both overlapping UTC dates.
`scheduled_at`, `requested_at`, `fetched_at`, feed header time and vehicle time
have different meanings. Replay uses fetched_at, never fabricated positions.

## Failure history and protections

- Cached provider responses can yield successful HTTP requests but stale data.
  Realtime fetches now use no-store; daily quality reports measure nonempty
  header age and unique payloads. A repeated payload alone is not an error.
- UTC/JST partition mismatch can retain only 15 hours. Both UTC prefixes are
  listed with pagination before JST filtering.
- Large snapshot files exceeded GitHub's file size limit. Snapshot v2 uses
  compressed bounded parts and a pre-publication size guard.
- R2 requests use bounded concurrency, three SDK attempts, 10-second connection
  and 60-second request timeouts. The Actions job has a 55-minute limit.
- Rebuilding over existing files can retain obsolete parts. Each run builds in
  a separate staging directory and verifies it before replacing the entire day.

## Quality and publication

Integrity failures block publication: missing source/feed/schema, row mismatch,
invalid fetch timestamps, duplicate object keys, impossible coordinates.
Missing minutes and stale provider data mark a day degraded; valid data is still
preserved. Empty successfully decoded feeds are valid, not missing or invalid.
Five minutes and 10% stale nonempty snapshots are operational warning thresholds,
not a provider freshness guarantee. quality.json and Actions summary expose them.
Diagnostics are retained as Actions artifacts for 14 days.

An hourly read-only R2 check independently validates the latest object of each
feed. Saving older than three minutes, nonempty header age above five minutes,
future timestamps, failed HTTP metadata and protobuf failures fail the health
job. This latest-object check does not prove every minute was saved; daily
coverage is checked separately. Actions schedules can be delayed and are not
a strict hourly availability guarantee. Failure notifications use the account's
existing GitHub Actions notification preferences; no external messaging is added.

Pull requests and main pushes run regression tests and TypeScript checks without
production credentials. Generated private Explorer checks skip in clean CI;
Parquet and transport fixture integration tests still run.

## Recovery

Run Daily mobility archive with archive_date set to the affected JST date.
The raw bucket is read-only during archive generation. Verification failure
leaves the committed date unchanged. Successful replacement removes old parts;
the previous directory is retained in runner staging for the job lifetime.
Git history retains prior published versions. Re-running creates a fresh staging
directory on the runner. A failed push can be retried by rerunning the workflow.

## Verification still required before rollout

- Verified 2026-11-26 18:18–18:32 JST: all four feeds updated each minute in
  the common inspected window; maximum observed header age about 22 seconds.
- Cloudflare deployment history read on 2026-11-26 identifies the latest 100%
  deployment as 582ba7e5-a451-4340-9352-339b91bbc135, deployed at 05:22 UTC.
  The original cd22584d is a historical version, not the current deployment.
- Fresh/empty, stale and entity-count corruption fixtures pass locally; health
  tests also cover stopped saving, future timestamps, zero bytes and HTTP errors.
- Run staged processing against a representative post-fix full JST day.
- Review and deploy the daily workflow, then inspect its actual execution.
- Inspect the exact deployed source if further Collector changes are proposed;
  the short real-object sample proves freshness only for its inspected window.

The current local implementation has not yet been deployed. Test success does
not prove future provider availability or historical one-minute position freshness.
