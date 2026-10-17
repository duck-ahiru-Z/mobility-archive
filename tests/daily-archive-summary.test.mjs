import { describe, expect, it } from 'vitest';
import { elapsedSinceEpochMs, renderJobSummary } from '../scripts/daily-archive-summary.mjs';

describe('daily archive job summary', () => {
  it('shows feed-level quality and labels storage estimates without exposing raw keys', () => {
    const manifest = {
      date: '2026-10-15', storage_status: 'normal', r2_estimated_bytes: 1234,
      storage_measurement_basis: 'monthly estimate', daily_growth_bytes: 40,
      r2_growth_24h_bytes: null, projected_30_day_growth: 1200, projected_365_day_growth: 14600,
      projection_basis: 'estimated from sample day', processing: { duration_ms: 5000 },
      sources: [{ source_id: 'wakayama-bus', feeds: [{
        feed_type: 'vehicle-positions', expected_fetch_count: 1440, saved_raw_object_count: 1438,
        valid_feed_count: 1437, valid_empty_feed_count: 350, invalid_feed_count: 1,
        http_failure_count: 0, missing_interval_count: 2, success_rate: 1437 / 1440,
        missing_intervals: ['202610150900', '202610150901'], validation_errors: [{ key: 'do-not-show.pb' }],
      }] }],
    };
    const summary = renderJobSummary(manifest, { jobStatus: 'success', workflowElapsedMs: 10000 });
    expect(summary).toContain('2026-10-15 (JST)');
    expect(summary).toContain('| 1437 |');
    expect(summary).toContain('09:00, 09:01');
    expect(summary).toContain('not measured');
    expect(summary).toContain('estimate only');
    expect(summary).not.toContain('do-not-show.pb');
    expect(summary).not.toContain('validation_errors');
  });

  it('still emits a failure summary when no manifest exists', () => {
    const summary = renderJobSummary(null, { jobStatus: 'failure', workflowElapsedMs: null });
    expect(summary).toContain('Workflow status at summary: **failure**');
    expect(summary).toContain('date unavailable');
  });

  it('treats workflow start as numeric Unix epoch milliseconds', () => {
    expect(elapsedSinceEpochMs('1792191000000', 1792191005000)).toBe(5000);
    expect(elapsedSinceEpochMs('not-a-number', 1792191005000)).toBeNull();
    expect(elapsedSinceEpochMs('1792191006000', 1792191005000)).toBeNull();
  });
});
