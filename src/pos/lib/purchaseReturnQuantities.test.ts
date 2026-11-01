import { describe, expect, it } from 'vitest';
import { purchaseUnitBuckets, returnedPurchaseBuckets, validatePurchaseEditAgainstReturns, purchaseReturnBlockReason } from './purchaseReturnQuantities';

describe('purchase return quantity safety', () => {
  const returns = [
    { originalPurchaseId: 'purchase', totalUnitsReturned: 10, paidUnitsReturned: 10 },
    { originalPurchaseId: 'purchase', totalUnitsReturned: 2, paidUnitsReturned: 2 },
  ];
  it('identifies the arq-e-gulab conflict without changing purchase, returns or stock', () => {
    const purchase = { id: 'purchase', paidUnits: 0, bonusUnits: 1, totalUnitsAdded: 1 };
    const medicine = { id: 'batch', stock: 333, unitsPerBox: 30, bonusStockUnits: 1 };
    const before = JSON.stringify({ purchase, medicine, returns });
    expect(purchaseReturnBlockReason(purchase, medicine, returns)).toContain('12 paid');
    expect(JSON.stringify({ purchase, medicine, returns })).toBe(before);
  });
  it('rejects reducing quantities below existing returns', () => {
    expect(validatePurchaseEditAgainstReturns({ id: 'purchase', totalUnitsAdded: 360 }, { paidUnits: 0, bonusUnits: 1 }, returns)).toContain('cannot be reduced');
    expect(validatePurchaseEditAgainstReturns({ id: 'purchase', totalUnitsAdded: 360 }, { paidUnits: 12, bonusUnits: 0 }, returns)).toBe('');
  });
  it('allows unchanged quantities during legacy cost or metadata repairs', () => {
    expect(validatePurchaseEditAgainstReturns({ id: 'purchase', paidUnits: 0, bonusUnits: 1 }, { paidUnits: 0, bonusUnits: 1 }, returns)).toBe('');
  });
  it('keeps paid and bonus counts separate for legacy rows', () => {
    expect(purchaseUnitBuckets({ totalUnitsAdded: 12, bonusUnits: 2 })).toEqual({ paid: 10, bonus: 2, total: 12 });
    expect(returnedPurchaseBuckets('purchase', [{ originalPurchaseId: 'purchase', totalUnitsReturned: 4, bonusUnitsReturned: 1 }])).toEqual({ paid: 3, bonus: 1, total: 4 });
  });
  it('handles old box/loose purchase fields without NaN', () => {
    expect(purchaseUnitBuckets({ boxes: 2, looseUnits: 3, unitsPerBox: 30 })).toEqual({ paid: 63, bonus: 0, total: 63 });
  });
  it('excludes deleted and unrelated returns', () => {
    expect(returnedPurchaseBuckets('purchase', [...returns, { originalPurchaseId: 'other', totalUnitsReturned: 90 }, { originalPurchaseId: 'purchase', totalUnitsReturned: 40, deleted: true }])).toEqual({ paid: 12, bonus: 0, total: 12 });
  });
  it('rejects changing paid/bonus allocation below either returned bucket', () => {
    expect(validatePurchaseEditAgainstReturns({ id: 'purchase', paidUnits: 10, bonusUnits: 2 }, { paidUnits: 12, bonusUnits: 0 }, [{ originalPurchaseId: 'purchase', paidUnitsReturned: 0, bonusUnitsReturned: 2, totalUnitsReturned: 2 }])).not.toBe('');
  });
  it('blocks missing and archived batches', () => {
    expect(purchaseReturnBlockReason({ id: 'p' }, undefined, [])).toContain('identified safely');
    expect(purchaseReturnBlockReason({ id: 'p' }, { archived: true }, [])).toContain('archived');
    expect(purchaseReturnBlockReason({ id: 'p', totalUnitsAdded: 3 }, { stock: 3 }, [])).toBe('');
  });
});
