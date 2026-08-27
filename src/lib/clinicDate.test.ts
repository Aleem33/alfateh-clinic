import { describe, expect, it } from 'vitest';
import { clinicDateKey, isOnClinicDate, recordClinicDateKey } from './clinicDate';

describe('clinic date grouping', () => {
  it('moves timestamps after 19:00 UTC into the next Pakistan calendar day', () => {
    expect(clinicDateKey('2026-08-25T19:30:00.000Z')).toBe('2026-08-26');
  });

  it('keeps timestamps before the Pakistan midnight boundary on the prior day', () => {
    expect(clinicDateKey('2026-08-25T18:59:59.999Z')).toBe('2026-08-25');
  });

  it('does not match missing or invalid timestamps', () => {
    expect(clinicDateKey('not-a-date')).toBe('');
    expect(isOnClinicDate(undefined, '2026-08-26')).toBe(false);
  });

  it('uses an immutable business date before the upload timestamp', () => {
    expect(recordClinicDateKey({
      businessDate: '2026-08-26',
      date: '2026-08-27T08:00:00.000Z',
    })).toBe('2026-08-26');
  });

  it('falls back to the timestamp for existing records', () => {
    expect(recordClinicDateKey({ date: '2026-08-25T19:30:00.000Z' })).toBe('2026-08-26');
  });
});
