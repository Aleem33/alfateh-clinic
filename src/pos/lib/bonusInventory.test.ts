import { describe, expect, it } from 'vitest';
import { allocateCartBonusCost, allocatePaidFirst, allocateReceiptReturn, getBonusAwareStockValue, getMedicineStockBuckets } from './bonusInventory';

describe('bonus inventory', () => {
  it('treats legacy stock as paid stock', () => {
    expect(getMedicineStockBuckets({ id: 'legacy', stock: 25 })).toEqual({ stock: 25, paidStockUnits: 25, bonusStockUnits: 0 });
  });

  it('consumes paid stock before zero-cost bonus stock', () => {
    expect(allocatePaidFirst(12, 10, 5)).toEqual({ paidUnits: 10, bonusUnits: 2, totalUnits: 12 });
  });

  it('freezes actual COGS on each sale line', () => {
    const [line] = allocateCartBonusCost(
      [{ medicineId: 'm1', quantity: 12, sellType: 'unit', unitsPerBox: 10, costPrice: 100 }],
      [{ id: 'm1', stock: 15, bonusStockUnits: 5, unitsPerBox: 10, costPrice: 100 }],
    );
    expect(line).toMatchObject({ paidUnitsSold: 10, bonusUnitsSold: 2, costTotal: 100 });
  });

  it('excludes bonus units from stock purchase value', () => {
    expect(getBonusAwareStockValue({ id: 'm1', stock: 120, bonusStockUnits: 20, unitsPerBox: 10, costPrice: 100 })).toBe(1000);
  });

  it('restores the original sale buckets without exceeding either allocation', () => {
    expect(allocateReceiptReturn(3, 0, 10, 2)).toEqual({ paidUnitsRestored: 1, bonusUnitsRestored: 2 });
    expect(allocateReceiptReturn(4, 3, 10, 2)).toEqual({ paidUnitsRestored: 4, bonusUnitsRestored: 0 });
  });
});
