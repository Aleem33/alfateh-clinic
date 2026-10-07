import { describe, expect, it } from 'vitest';
import { resolvePurchaseReturnFinancials, resolvePurchaseUnitCost } from './purchaseReturnFinancials';

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
});

