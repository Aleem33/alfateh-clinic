import { describe, expect, it } from 'vitest';
import { createPendingPurchaseReturn } from './offlinePurchaseReturnsOutbox';
import { buildPurchaseReturnRecoveryPlan } from './purchaseReturnRecovery';

const recoveredAt = '2026-10-14T13:10:00.000Z';

function record(paid: number, bonus = 0) {
  return createPendingPurchaseReturn('return-1', {
    returnNo: 'PR-R0N2-000033', medicineId: 'batch-a', medicineName: 'Medicine',
    totalUnitsReturned: paid + bonus, paidUnitsReturned: paid, bonusUnitsReturned: bonus,
    date: '2026-10-14T12:00:00.000Z',
  });
}

describe('purchase return recovery', () => {
  it('uploads the complete return while applying only available paid stock', () => {
    const plan = buildPurchaseReturnRecoveryPlan(record(119), {
      id: 'batch-a', name: 'Medicine', stock: 106, bonusStockUnits: 0,
    }, recoveredAt);
    expect(plan.medicineUpdate).toEqual({ stock: 0, bonusStockUnits: 0 });
    expect(plan.returnData).toMatchObject({
      totalUnitsReturned: 119, stockAppliedUnits: 106, stockUnappliedUnits: 13,
    });
    expect(plan.discrepancy).toMatchObject({
      requestedPaidUnits: 119, appliedPaidUnits: 106, unappliedPaidUnits: 13,
    });
  });

  it('keeps paid and bonus buckets separate and never makes either negative', () => {
    const plan = buildPurchaseReturnRecoveryPlan(record(8, 4), {
      id: 'batch-a', stock: 10, bonusStockUnits: 2,
    }, recoveredAt);
    expect(plan.medicineUpdate).toEqual({ stock: 0, bonusStockUnits: 0 });
    expect(plan.discrepancy).toMatchObject({
      requestedPaidUnits: 8, appliedPaidUnits: 8,
      requestedBonusUnits: 4, appliedBonusUnits: 2,
      unappliedUnits: 2,
    });
  });

  it('preserves the return and creates a full reconciliation when the batch is missing', () => {
    const plan = buildPurchaseReturnRecoveryPlan(record(5), null, recoveredAt);
    expect(plan.medicineUpdate).toBeNull();
    expect(plan.returnData.stockUnappliedUnits).toBe(5);
    expect(plan.discrepancy).toMatchObject({ reason: 'missing-batch', appliedUnits: 0, unappliedUnits: 5 });
  });

  it('does not create a reconciliation when all stock buckets can be applied', () => {
    const plan = buildPurchaseReturnRecoveryPlan(record(8, 2), {
      id: 'batch-a', stock: 20, bonusStockUnits: 5,
    }, recoveredAt);
    expect(plan.medicineUpdate).toEqual({ stock: 10, bonusStockUnits: 3 });
    expect(plan.discrepancy).toBeNull();
  });
});
