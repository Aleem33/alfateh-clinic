export const CLINIC_TIME_ZONE = 'Asia/Karachi';

const clinicDateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: CLINIC_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function clinicDateKey(value: string | number | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = clinicDateFormatter.formatToParts(date);
  const year = parts.find(part => part.type === 'year')?.value;
  const month = parts.find(part => part.type === 'month')?.value;
  const day = parts.find(part => part.type === 'day')?.value;
  return year && month && day ? `${year}-${month}-${day}` : '';
}

export function isOnClinicDate(value: string | number | Date | null | undefined, dateKey: string): boolean {
  return value != null && clinicDateKey(value) === dateKey;
}
