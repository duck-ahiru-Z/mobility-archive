import fs from 'node:fs/promises';

function formatBytes(value) {
  if (value == null || !Number.isFinite(Number(value))) return 'unavailable';
  return `${Number(value).toLocaleString('en-US')} bytes (${(Number(value) / 1e9).toFixed(3)} GB)`;
}

export function renderJobSummary(manifest, { jobStatus = 'unknown', workflowElapsedMs = null, runUrl = '' } = {}) {
  const lines = [
    `## Mobility Archive daily archive — ${manifest?.date ?? 'date unavailable'} (JST)`,
    '',
    `- Workflow status at summary: **${jobStatus}**`,
    `- Job elapsed since archive-date resolution at summary: ${workflowElapsedMs == null ? 'unavailable' : `${Math.round(workflowElapsedMs / 1000)} s`}`,
    `- Dataset processing duration: ${manifest?.processing?.duration_ms == null ? 'unavailable' : `${(manifest.processing.duration_ms / 1000).toFixed(1)} s`}`,
    `- R2 estimate: ${formatBytes(manifest?.r2_estimated_bytes)} (${manifest?.storage_status ?? 'unknown'}; ${manifest?.storage_measurement_basis ?? 'basis unavailable'})`,
    `- Raw bytes for this JST date (measured sum of listed object sizes): ${formatBytes(manifest?.daily_growth_bytes)}`,
    `- 24-hour bucket growth: ${manifest?.r2_growth_24h_bytes == null ? 'not measured' : formatBytes(manifest.r2_growth_24h_bytes)}`,
    `- 30-day / 365-day growth projection (estimate only): ${formatBytes(manifest?.projected_30_day_growth)} / ${formatBytes(manifest?.projected_365_day_growth)}`,
    `- Projection basis: ${manifest?.projection_basis ?? 'unavailable'}`,
    '',
    '| Source / feed | Expected | Saved objects | HTTP 2xx | Decoded OK (empty included) | Empty | Invalid | Hash mismatch | HTTP failure | R2 read failure | Missing JST minutes | Success rate |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
  ];
  for (const source of manifest?.sources ?? []) {
    for (const feed of source.feeds ?? []) {
      lines.push(`| ${source.source_id} / ${feed.feed_type} | ${feed.expected_fetch_count} | ${feed.saved_raw_object_count} | ${feed.http_successful_fetch_count ?? 0} | ${feed.valid_feed_count} | ${feed.valid_empty_feed_count} | ${feed.invalid_feed_count} | ${feed.checksum_mismatch_count ?? 0} | ${feed.http_failure_count} | ${feed.r2_read_failure_count ?? 0} | ${feed.missing_interval_count} | ${(feed.success_rate * 100).toFixed(2)}% |`);
      if (feed.missing_intervals?.length) {
        const times = feed.missing_intervals.slice(0, 30).map((slot) => `${slot.slice(8, 10)}:${slot.slice(10, 12)}`);
        lines.push(`| ↳ Missing JST times${feed.missing_intervals.length > 30 ? ` (first 30 of ${feed.missing_intervals.length})` : ''} |  |  |  |  |  |  |  |  |  | ${times.join(', ')}${feed.missing_intervals.length > 30 ? ', …' : ''} |  |`);
      }
    }
  }
  if (runUrl) lines.push('', `[Open this Actions run](${runUrl})`);
  if (process.env.WORKFLOW_URL) lines.push(`[View daily workflow run history](${process.env.WORKFLOW_URL})`);
  lines.push('', '> Summary contains aggregate operational metrics only; raw payloads, object keys, and credentials are intentionally omitted.', '');
  return lines.join('\n');
}

export function elapsedSinceEpochMs(startedAtMs, nowMs = Date.now()) {
  const started = Number(startedAtMs);
  if (!Number.isFinite(started) || started <= 0 || !Number.isFinite(nowMs) || nowMs < started) return null;
  return nowMs - started;
}

const summaryPath = process.env.GITHUB_STEP_SUMMARY;
if (summaryPath) {
  let manifest = null;
  try {
    const date = process.env.ARCHIVE_DATE;
    manifest = JSON.parse(await fs.readFile(`${process.env.OUTPUT_DIR || 'data-repo/archive'}/${date.replaceAll('-', '/')}/manifest.json`, 'utf8'));
  } catch {
    // A workflow failure before manifest generation is still summarized below.
  }
  const workflowElapsedMs = elapsedSinceEpochMs(process.env.WORKFLOW_STARTED_AT);
  const text = renderJobSummary(manifest, { jobStatus: process.env.JOB_STATUS, workflowElapsedMs, runUrl: process.env.RUN_URL });
  await fs.appendFile(summaryPath, text, 'utf8');
  if (!manifest && process.env.JOB_STATUS === 'success') process.exitCode = 1;
}
