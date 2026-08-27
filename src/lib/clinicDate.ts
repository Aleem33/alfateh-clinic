export const CLINIC_TIME_ZONE = 'Asia/Karachi';

const clinicDateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: CLINIC_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const clinicTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: CLINIC_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

type FirestoreTimestampLike = {
  toDate?: () => Date;
  seconds?: unknown;
  nanoseconds?: unknown;
};

function dateFromValue(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (!value || typeof value !== 'object') return null;
  const timestamp = value as FirestoreTimestampLike;
  if (typeof timestamp.toDate === 'function') {
    try {
      const date = timestamp.toDate();
      return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
    } catch {
      return null;
    }
  }
  const seconds = Number(timestamp.seconds);
  const nanoseconds = Number(timestamp.nanoseconds || 0);
  if (!Number.isFinite(seconds) || !Number.isFinite(nanoseconds)) return null;
  const date = new Date((seconds * 1_000) + (nanoseconds / 1_000_000));
  return Number.isNaN(date.getTime()) ? null : date;
}

function validDateKey(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function clinicDateKey(value: unknown): string {
  const date = dateFromValue(value);
  if (!date) return '';
  const parts = clinicDateFormatter.formatToParts(date);
  const year = parts.find(part => part.type === 'year')?.value;
  const month = parts.find(part => part.type === 'month')?.value;
  const day = parts.find(part => part.type === 'day')?.value;
  return year && month && day ? `${year}-${month}-${day}` : '';
}

export function clinicTimeLabel(value: unknown): string {
  const date = dateFromValue(value);
  return date ? clinicTimeFormatter.format(date) : '';
}

export function isOnClinicDate(value: string | number | Date | null | undefined, dateKey: string): boolean {
  return value != null && clinicDateKey(value) === dateKey;
}

type DatedRecord = {
  businessDate?: unknown;
  date?: unknown;
  trustedDate?: unknown;
};

export function recordClinicTimestamp(record: DatedRecord | null | undefined): Date | null {
  if (!record) return null;
  return dateFromValue(record.trustedDate) || dateFromValue(record.date);
}

export function recordClinicDateKey(record: DatedRecord | null | undefined): string {
  if (!record) return '';
  const businessDate = typeof record.businessDate === 'string' ? record.businessDate.trim() : '';
  if (validDateKey(businessDate)) return businessDate;
  return clinicDateKey(recordClinicTimestamp(record));
}

export function recordClinicDateTimeLabel(record: DatedRecord | null | undefined): string {
  const dateKey = recordClinicDateKey(record);
  if (!dateKey) return '';
  const [year, month, day] = dateKey.split('-');
  const time = clinicTimeLabel(recordClinicTimestamp(record));
  return `${day}/${month}/${year}${time ? ` ${time}` : ''}`;
}
