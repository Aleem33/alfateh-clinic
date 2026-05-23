const DEFAULT_RECEIPT_FALLBACK = 'Unnumbered';

function hashToSaleNumber(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return String((hash % 999999) + 1).padStart(6, '0');
}

function normalizeSaleNumber(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const prefixed = raw.match(/^SALE[-\s#]*(\d+)$/i);
  if (prefixed) return `SALE-${prefixed[1].padStart(6, '0')}`;

  if (/^\d+$/.test(raw)) return `SALE-${raw.padStart(6, '0')}`;

  if (/^[A-Za-z0-9]{12,}$/.test(raw)) return `SALE-${hashToSaleNumber(raw)}`;

  return raw;
}

export function getSaleReceiptNo(sale: any, fallback = DEFAULT_RECEIPT_FALLBACK): string {
  const receiptNo = normalizeSaleNumber(sale?.receiptNo);
  if (receiptNo) return receiptNo;

  const legacyId = normalizeSaleNumber(sale?.saleId || sale?.id);
  return legacyId || fallback;
}

export function getSaleReceiptLabel(sale: any, fallback = DEFAULT_RECEIPT_FALLBACK): string {
  const receiptNo = getSaleReceiptNo(sale, fallback);
  return receiptNo === fallback ? receiptNo : `Receipt #${receiptNo}`;
}

export function getReturnNo(returnDoc: any, field = 'returnNo', fallback = DEFAULT_RECEIPT_FALLBACK): string {
  const returnNo = String(returnDoc?.[field] || '').trim();
  return returnNo || fallback;
}
