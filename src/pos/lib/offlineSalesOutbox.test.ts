import { describe, expect, it } from 'vitest';
import { aggregateSaleStockAdjustments } from './offlineSalesOutbox';

describe('offline sales outbox', () => {
  it('aggregates box and loose-unit deductions for the same medicine batch', () => {
    expect(aggregateSaleStockAdjustments([
      { medicineId: 'batch-a', quantity: 2, sellType: 'box', unitsPerBox: 10 },
      { medicineId: 'batch-a', quantity: 3, sellType: 'unit', unitsPerBox: 10 },
      { medicineId: 'batch-b', quantity: 1, sellType: 'unit', unitsPerBox: 1 },
    ])).toEqual([
      { medicineId: 'batch-a', units: 23 },
      { medicineId: 'batch-b', units: 1 },
    ]);
  });
});
