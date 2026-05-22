const DEFAULT_RECEIPT_FALLBACK = 'Unnumbered';

export function getSaleReceiptNo(sale: any, fallback = DEFAULT_RECEIPT_FALLBACK): string {
  const receiptNo = String(sale?.receiptNo || '').trim();
  return receiptNo || fallback;
}

export function getSaleReceiptLabel(sale: any, fallback = DEFAULT_RECEIPT_FALLBACK): string {
  const receiptNo = getSaleReceiptNo(sale, fallback);
  return receiptNo === fallback ? receiptNo : `Receipt #${receiptNo}`;
}

export function getReturnNo(returnDoc: any, field = 'returnNo', fallback = DEFAULT_RECEIPT_FALLBACK): string {
  const returnNo = String(returnDoc?.[field] || '').trim();
  return returnNo || fallback;
}
