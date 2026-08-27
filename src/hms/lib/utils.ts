import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { clinicDateKey, CLINIC_TIME_ZONE } from '../../lib/clinicDate';
import { trustedNow, trustedNowISO } from '../../lib/trustedClock';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-PK', {
    style: 'currency',
    currency: 'PKR',
    minimumFractionDigits: 0,
  }).format(amount);
}

export function formatDate(dateStr: string) {
  if (!dateStr) return '-';
  try {
    return new Intl.DateTimeFormat('en-PK', {
      day: '2-digit', month: 'short', year: 'numeric', timeZone: CLINIC_TIME_ZONE,
    }).format(new Date(dateStr));
  } catch {
    return dateStr;
  }
}

export function today() {
  return clinicDateKey(trustedNow());
}

export function nowISO() {
  return trustedNowISO();
}
