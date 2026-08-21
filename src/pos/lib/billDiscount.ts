export type BillDiscountType = 'rs' | 'pct';

export function normalizeBillDiscountValue(type: BillDiscountType, value: number) {
  const finiteValue = Number.isFinite(value) ? Math.max(0, value) : 0;
  return type === 'pct' ? Math.min(100, finiteValue) : finiteValue;
}

export function calculateBillDiscount(baseAmount: number, type: BillDiscountType, value: number) {
  const safeBase = Math.max(0, Number(baseAmount) || 0);
  const safeValue = normalizeBillDiscountValue(type, value);
  const requested = type === 'pct' ? safeBase * safeValue / 100 : safeValue;
  return Math.min(safeBase, requested);
}

