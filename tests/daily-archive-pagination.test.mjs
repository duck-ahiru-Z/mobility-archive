import { describe, expect, it, vi } from 'vitest';
import { listAllObjects, keyTimestamp, localDateOfKey, utcDatesForJstDate } from '../scripts/daily-archive-lib.mjs';

const objects = count => Array.from({ length: count }, (_, i) => ({ Key: `raw/feed/20261001/${String(i).padStart(6, '0')}.pb`, Size: 1 }));
function pagedClient(all) { return { send: vi.fn(async input => { const start = input.ContinuationToken ? Number(input.ContinuationToken) : 0; const page = all.slice(start, start + 1000); const next = start + page.length < all.length ? String(start + page.length) : undefined; return { Contents: page, IsTruncated: Boolean(next), ...(next ? { NextContinuationToken: next } : {}) }; }) }; }

describe('daily archive R2 listing pagination', () => {
  for (const count of [999, 1000, 1001, 1440]) it(`lists all ${count} objects`, async () => { const listed = await listAllObjects(pagedClient(objects(count)), input => input, { bucket: 'test', prefix: 'raw/', log: () => {} }); expect(listed).toHaveLength(count); });
  it('uses both UTC prefixes for a JST day', () => { expect(utcDatesForJstDate('2026-10-02')).toEqual(['20261001', '20261002']); expect(keyTimestamp('raw/x/20261001/150010.pb').toISOString()).toBe('2026-10-01T15:00:10.000Z'); expect(localDateOfKey('raw/x/20261001/150010.pb')).toBe('2026-10-02'); expect(localDateOfKey('raw/x/20261002/140010.pb')).toBe('2026-10-02'); });
});
