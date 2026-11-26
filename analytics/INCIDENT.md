# Realtime freshness incident — 2026-11-26

Forty R2 originals were directly downloaded: five consecutive snapshots for each of four feeds on 2026-09-29 and 2026-11-25. All raw SHA-256 values matched the corresponding daily Parquet records, and sampled entity coordinates matched. Each five-snapshot group contained a single identical payload. The daily conversion did not create those repetitions.

R2 custom metadata for Wakayama VehiclePosition at 2026-09-29 12:00:10 UTC recorded fetched_at 12:00:10.309, while upstream Last-Modified and feed header were 10:52:47 UTC. Thus an already stale response was saved. Contemporary direct-origin probes returned fresh, changing responses for all four feeds.

The deployed Worker used plain fetch without cache bypass. Realtime fetch now uses cache: no-store; Static GTFS behavior is unchanged. Production version 582ba7e5-a451-4340-9352-339b91bbc135 was deployed with user approval on November 26. At 05:22 UTC, all four feeds saved fresh headers with ages 5.8–7.8 seconds; preceding snapshots had ages around 22–29 minutes. This supports caching on the outbound fetch path as the cause. Longer observation remains necessary to establish sustained health.

Cron remains every minute. No old R2 object was overwritten or deleted by the investigation. Historical missing movement cannot be reconstructed from repeated bytes; keep old data with freshness qualifications. Local raw samples and generated Explorer datasets are intentionally excluded from commits.

Checks: two Collector cache-policy tests and TypeScript pass. The Explorer exposes manifest-derived minute coverage separately from header freshness and provides JST replay controls. Its availability does not imply historical minute trajectory accuracy.

## Fields recoverable from originals

Historical static versions preceding the observation dates were downloaded and hash-verified for September 29 and November 25. All present trip_id and route_id values in both operators' Parquet rows joined those selected versions. This verifies identifier consistency, not complete service-calendar validation.

Raw TripUpdate contains explicit stop arrival/departure delay values omitted by the v1 Parquet projection. The five-adjacent-object sample deduplicates to one payload per source/date. September 29 Wakayama has 753 stop updates, arrival delay mean 163.36 seconds, median 141, max 738; Naga has 164, mean 152.47, median 124, max 415. All sampled stop IDs join Static GTFS. These are predicted stop-event values from a single stale snapshot per operator, not daily vehicle-delay averages. Arrival and departure statistics must remain separate. The originals can recover these omitted fields, although they cannot recover vehicle movements absent from the repeated original snapshots.
