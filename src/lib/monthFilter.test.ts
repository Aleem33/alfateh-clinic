import { describe, expect, it } from 'vitest';
import { historyDateKey, matchesMonth, monthDateRange } from './monthFilter';

describe('month history filtering', () => {
  it('includes every day of leap years and handles year boundaries', () => {
    expect(monthDateRange('2024-02')).toEqual({ start: '2024-02-01', end: '2024-02-29' });
    expect(monthDateRange('2100-02')?.end).toBe('2100-02-28');
    expect(monthDateRange('2026-12')?.end).toBe('2026-12-31');
    expect(monthDateRange('2026-13')).toBeNull();
    expect(monthDateRange('')).toBeNull();
  });
  it('uses the Pakistan business date for records uploaded across a month boundary', () => {
    const record = { date: '2026-09-30T20:00:00Z', createdAt: '2026-10-05T00:00:00Z' };
    expect(matchesMonth(record, '2026-10')).toBe(true);
    expect(matchesMonth(record, '2026-09')).toBe(false);
    expect(matchesMonth({ ...record, businessDate: '2026-09-30' }, '2026-09')).toBe(true);
    expect(historyDateKey({ createdAt: { seconds: 1790798400, nanoseconds: 0 } })).toBe('2026-10-01');
  });
  it('preserves all records when cleared and excludes undated entries only while filtering', () => {
    expect(matchesMonth({}, '')).toBe(true);
    expect(matchesMonth({}, '2026-10')).toBe(false);
    expect(matchesMonth({ date: '2026-10-31' }, '2026-10')).toBe(true);
    expect(matchesMonth({ date: '2026-11-01' }, '2026-10')).toBe(false);
  });
});
