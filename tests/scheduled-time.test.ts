import {describe, expect, it} from 'vitest';
import {scheduledCollectionTime} from '../src/index';
import {keyFor} from '../src/utils';

describe('scheduled collection timestamp', () => {
  it.each([
    ['2026-10-03T00:00:00.000Z', '20261003/000000'],
    ['2026-10-03T00:01:00.000Z', '20261003/000100'],
    ['2026-10-02T14:59:00.000Z', '20261002/145900'],
    ['2026-10-02T15:00:00.000Z', '20261002/150000'],
  ])('uses scheduledTime %s for the key', (scheduledTime, keyPart) => {
    const scheduledAt = scheduledCollectionTime({scheduledTime: Date.parse(scheduledTime)});
    expect(scheduledAt.toISOString()).toBe(scheduledTime);
    expect(keyFor('test', 'vehicle-positions', scheduledAt)).toContain(keyPart);
  });

  it('does not depend on delayed wall-clock execution', () => {
    const scheduledAt = scheduledCollectionTime({scheduledTime: Date.parse('2026-10-03T12:00:00.000Z')});
    const requestedAt = new Date('2026-10-03T12:01:03.000Z');
    const fetchedAt = new Date('2026-10-03T12:01:04.000Z');
    const key = keyFor('test', 'trip-updates', scheduledAt);
    expect(key).toContain('20261003/120000');
    expect(scheduledAt.getTime()).toBeLessThan(requestedAt.getTime());
    expect(requestedAt.getTime()).toBeLessThanOrEqual(fetchedAt.getTime());
  });

  it('keeps the scheduled minute when the request crosses a minute boundary', () => {
    const scheduledAt = scheduledCollectionTime({scheduledTime: Date.parse('2026-10-03T12:00:00.000Z')});
    const requestedAt = new Date('2026-10-03T12:01:03.000Z');
    const key = keyFor('test', 'vehicle-positions', scheduledAt);
    expect(key).toContain('20261003/120000');
    expect(key).not.toContain('20261003/120103');
    expect(requestedAt.getUTCMinutes()).toBe(1);
  });
});
