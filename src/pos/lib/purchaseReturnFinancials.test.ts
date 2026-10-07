import { describe, expect, it } from 'vitest';
import { findPurchaseReturnMedicine, resolvePurchaseReturnFinancials, resolvePurchaseUnitCost } from './purchaseReturnFinancials';

describe('purchase return financials', () => {
  it('uses the frozen unit cost when available', () => {
    expect(resolvePurchaseUnitCost({ costPricePerUnit: 5.1, costPrice: 999 })).toBe(5.1);
  });

  it('reconstructs legacy unit cost from payable and paid units', () => {
    expect(resolvePurchaseUnitCost({ totalCost: 510, paidUnits: 100, unitsPerBox: 100 })).toBe(5.1);
  });

  it('supports the legacy costPerBox field', () => {
    expect(resolvePurchaseUnitCost({ costPerBox: 1200, unitsPerBox: 20 })).toBe(60);
  });

  it('repairs a zero display refund from the linked purchase without mutating either record', () => {
    const purchaseReturn = { refundAmount: 0, paidUnitsReturned: 20, totalUnitsReturned: 20 };
    const purchase = { totalCost: 1000, paidUnits: 100 };
    const before = JSON.stringify({ purchaseReturn, purchase });
    expect(resolvePurchaseReturnFinancials(purchaseReturn, purchase)).toEqual({
      paidUnitsReturned: 20,
      costPricePerUnit: 10,
      refundAmount: 200,
      reconstructed: true,
    });
    expect(JSON.stringify({ purchaseReturn, purchase })).toBe(before);
  });

  it('preserves an existing non-zero frozen refund', () => {
    expect(resolvePurchaseReturnFinancials(
      { refundAmount: 726, paidUnitsReturned: 2, costPricePerUnit: 363 },
      { totalCost: 1, paidUnits: 1 },
    ).refundAmount).toBe(726);
  });

  it('uses the linked medicine batch cost only when legacy return and purchase costs are missing', () => {
    expect(resolvePurchaseReturnFinancials(
      { refundAmount: 0, paidUnitsReturned: 84 },
      { totalCost: 0, costPerBox: 0, unitsPerBox: 14 },
      { costPrice: 700, unitsPerBox: 14 },
    )).toMatchObject({ costPricePerUnit: 50, refundAmount: 4200, reconstructed: true });
  });

  it('keeps a bonus-only return at zero', () => {
    expect(resolvePurchaseReturnFinancials(
      { refundAmount: 0, paidUnitsReturned: 0, bonusUnitsReturned: 10 },
      null,
      { costPrice: 100, unitsPerBox: 10 },
    ).refundAmount).toBe(0);
  });

  it('recovers cost from the exact linked medicine even when that batch is archived', () => {
    const linked = findPurchaseReturnMedicine(
      { medicineId: 'archived-batch', medicineName: 'Nuberol P 1gm /100ml' },
      null,
      [
        { id: 'active-batch', name: 'Nuberol P 1gm /100ml', costPrice: 500 },
        { id: 'archived-batch', name: 'Nuberol P 1gm /100ml', archived: true, costPrice: 420 },
      ],
    );
    expect(linked).toMatchObject({ id: 'archived-batch', archived: true });
    expect(resolvePurchaseReturnFinancials(
      { refundAmount: 0, paidUnitsReturned: 20 },
      null,
      linked,
    )).toMatchObject({ costPricePerUnit: 420, refundAmount: 8400, reconstructed: true });
  });

  it('uses legacy name, supplier and batch identity only when the match is unambiguous', () => {
    expect(findPurchaseReturnMedicine(
      { medicineName: 'Nuberol P 1gm /100ml', supplierName: 'Aslam traders' },
      { batchNo: 'NB-10' },
      [
        { id: 'batch-a', name: 'Nuberol P 1gm /100ml', supplierName: 'Aslam traders', batchNo: 'NB-10' },
        { id: 'batch-b', name: 'Nuberol P 1gm /100ml', supplierName: 'Aslam traders', batchNo: 'NB-11' },
      ],
    )?.id).toBe('batch-a');
  });

  it('does not guess a cost when a legacy return matches multiple batches', () => {
    expect(findPurchaseReturnMedicine(
      { medicineName: 'Nuberol P 1gm /100ml', supplierName: 'Aslam traders' },
      null,
      [
        { id: 'batch-a', name: 'Nuberol P 1gm /100ml', supplierName: 'Aslam traders' },
        { id: 'batch-b', name: 'Nuberol P 1gm /100ml', supplierName: 'Aslam traders' },
      ],
    )).toBeUndefined();
  });
});

