import { describe, expect, it } from 'vitest';
import { clinicDateKey, clinicTimeLabel, isOnClinicDate, recordClinicDateKey, recordClinicDateTimeLabel } from './clinicDate';

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

  it('prefers a repaired trusted timestamp over the original device timestamp', () => {
    expect(recordClinicDateKey({
      trustedDate: '2026-08-27T12:00:00.000Z',
      date: '2026-08-28T12:00:00.000Z',
    })).toBe('2026-08-27');
  });

  it('supports Firestore Timestamp values', () => {
    expect(recordClinicDateKey({
      trustedDate: { toDate: () => new Date('2026-08-27T19:30:00.000Z') },
    })).toBe('2026-08-28');
    expect(recordClinicDateKey({
      trustedDate: { seconds: Date.parse('2026-08-27T12:00:00.000Z') / 1_000, nanoseconds: 0 },
    })).toBe('2026-08-27');
  });

  it('rejects impossible business dates and falls back to the trusted timestamp', () => {
    expect(recordClinicDateKey({
      businessDate: '2026-02-31',
      trustedDate: '2026-02-27T12:00:00.000Z',
    })).toBe('2026-02-27');
  });

  it('formats every receipt time explicitly in Pakistan time', () => {
    expect(clinicTimeLabel('2026-08-27T12:00:00.000Z')).toBe('17:00');
    expect(recordClinicDateTimeLabel({
      businessDate: '2026-08-27',
      trustedDate: '2026-08-27T12:00:00.000Z',
      date: '2026-08-28T00:00:00.000Z',
    })).toBe('27/08/2026 17:00');
  });
});
