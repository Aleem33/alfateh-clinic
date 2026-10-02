import { clinicDateKey, recordClinicDateKey } from './clinicDate';

export function monthDateRange(month: string): { start: string; end: string } | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month.startsWith('0000')) return null;
  const [year, number] = month.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][number - 1];
  return { start: `${month}-01`, end: `${month}-${days}` };
}

export function historyDateKey(record: Record<string, any>): string {
  return recordClinicDateKey(record) || clinicDateKey(record.createdAt);
}

export function matchesMonth(record: Record<string, any>, month: string): boolean {
  const range = monthDateRange(month);
  if (!range) return true;
  const key = historyDateKey(record);
  return key >= range.start && key <= range.end;
}
