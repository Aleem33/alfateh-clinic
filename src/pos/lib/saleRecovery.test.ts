import { describe, expect, it } from 'vitest';
import { buildSaleRecoveryPlan } from './saleRecovery';
import type { PendingPosSale } from './offlineSalesOutbox';

const savedSale = (): PendingPosSale => ({
  saleId: 'offline-sale', createdAt: '2026-09-28T04:51:00Z',
  saleData: { receiptNo: 'SALE-R1W4-002483', date: '2026-09-28T04:51:00Z', businessDate: '2026-09-28',
    total: 500, amountPaid: 450, pendingAmount: 50,
    items: [{ medicineId: 'batch-a', name: 'orglu 30 s', quantity: 5, sellType: 'unit', unitsPerBox: 10,
      price: 100, costPrice: 500, paidUnitsSold: 5, bonusUnitsSold: 0, costTotal: 250 }] },
  movements: [{ id: 'move-a', data: { medicineId: 'batch-a', quantity: -5, paidUnits: -5, bonusUnits: 0 } }],
  stockAdjustments: [{ medicineId: 'batch-a', units: 5 }],
  customerAdjustment: { customerId: 'customer-a', pendingAmount: 50 },
});

describe('completed offline sale recovery', () => {
  it('preserves the complete five-unit receipt when only four units remain, explicitly recording the shortfall', () => {
    const sale = savedSale();
    const plan = buildSaleRecoveryPlan(sale, [{ id: 'batch-a', stock: 4, costPrice: 999 }], '2026-09-30T00:00:00Z');
    expect(plan.saleData).toMatchObject(sale.saleData);
    expect(plan.medicineUpdates).toEqual([{ id: 'batch-a', stock: 0, bonusStockUnits: 0 }]);
    expect(plan.movements[0].data).toMatchObject({ quantity: -5, appliedQuantity: -4, unappliedUnits: 1 });
    expect(plan.discrepancies).toEqual([expect.objectContaining({ requestedUnits: 5, appliedUnits: 4, unappliedUnits: 1, status: 'pending' })]);
    expect(sale.stockAdjustments[0].units).toBe(5);
  });

  it('keeps paid/bonus COGS frozen while recording changed cloud bucket allocation', () => {
    const sale = savedSale();
    const plan = buildSaleRecoveryPlan(sale, [{ id: 'batch-a', stock: 8, bonusStockUnits: 5, costPrice: 999 }], 'later');
    expect(plan.saleData.items[0]).toEqual(sale.saleData.items[0]);
    expect(plan.medicineUpdates).toEqual([{ id: 'batch-a', stock: 3, bonusStockUnits: 3 }]);
    expect(plan.discrepancies[0]).toMatchObject({ reason: 'bonus-allocation-changed', unappliedUnits: 0, appliedBonusUnits: 2 });
  });

  it('does not fabricate a missing batch or change an invalid negative balance to zero', () => {
    for (const medicines of [[], [{ id: 'batch-a', stock: -5 }]]) {
      const plan = buildSaleRecoveryPlan(savedSale(), medicines, 'later');
      expect(plan.medicineUpdates).toEqual([]);
      expect(plan.saleData.total).toBe(500);
      expect(plan.discrepancies[0].unappliedUnits).toBe(5);
    }
  });

  it('aggregates box and loose sales in the same batch without consuming another batch', () => {
    const sale = savedSale();
    sale.saleData.items = [
      { medicineId: 'batch-a', quantity: 1, sellType: 'box', unitsPerBox: 10, bonusUnitsSold: 0 },
      { medicineId: 'batch-a', quantity: 3, sellType: 'unit', unitsPerBox: 10, bonusUnitsSold: 2 },
    ];
    sale.stockAdjustments = [{ medicineId: 'batch-a', units: 13, bonusUnits: 2 }];
    sale.movements = [
      { id: 'move-a', data: { medicineId: 'batch-a', quantity: -10 } },
      { id: 'move-b', data: { medicineId: 'batch-a', quantity: -3 } },
    ];
    const plan = buildSaleRecoveryPlan(sale, [
      { id: 'batch-a', stock: 13, bonusStockUnits: 2 }, { id: 'batch-b', stock: 50 },
    ], 'later');
    expect(plan.discrepancies).toEqual([]);
    expect(plan.medicineUpdates).toEqual([{ id: 'batch-a', stock: 0, bonusStockUnits: 0 }]);
    expect(plan.movements.map(movement => movement.data.appliedQuantity)).toEqual([-10, -3]);
  });

  it('keeps malformed recovery records for review instead of fabricating a stock change', () => {
    const sale = savedSale();
    sale.stockAdjustments[0].units = 2;
    expect(() => buildSaleRecoveryPlan(sale, [], 'later')).toThrow('stock quantities do not match');
  });
});
