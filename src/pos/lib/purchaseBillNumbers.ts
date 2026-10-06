import { getNextLocalNumber } from '../../lib/offlineIdentity';

const PURCHASE_BILL_PREFIX = 'PUR';

export function getNextPurchaseBillNo(): string {
  return `${PURCHASE_BILL_PREFIX}-${getNextLocalNumber('posPurchaseBill')}`;
}

function legacyNumericReference(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return String(hash >>> 0).padStart(10, '0').slice(-8);
}

export function getPurchaseBillNo(record: Record<string, any>): string {
  const assigned = String(record.purchaseBillNo || '').trim();
  if (assigned) return assigned;

  // Existing records remain untouched. This converts their immutable internal
  // key into a stable numeric display reference instead of exposing a random ID.
  const legacyId = String(record.invoiceId || record.id || 'unknown-purchase');
  return `${PURCHASE_BILL_PREFIX}-OLD-${legacyNumericReference(legacyId)}`;
}

