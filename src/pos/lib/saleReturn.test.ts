import { describe, expect, it } from 'vitest';
import { calculateNetSalesProfit, calculateReturnedCost, calculateReturnRefund, calculateReturnStockUnits } from './saleReturn';

describe('receipt-less medicine returns', () => {
  it('restores loose units to the selected medicine record', () => {
    expect(calculateReturnStockUnits(3, 'unit', 10)).toBe(3);
  });

  it('converts returned boxes to stock units', () => {
    expect(calculateReturnStockUnits(2, 'box', 10)).toBe(20);
  });

  it('calculates the refund from quantity and entered unit/box price', () => {
    expect(calculateReturnRefund(2, 125.5)).toBe(251);
  });

  it('calculates returned cost across multiple medicines and pack types', () => {
    expect(calculateReturnedCost([
      { returnQty: 2, sellType: 'box', unitsPerBox: 10, costPrice: 100 },
      { returnQty: 3, sellType: 'unit', unitsPerBox: 10, costPrice: 100 },
    ])).toBe(230);
  });

  it('uses frozen paid-only return cost for bonus-aware receipt returns', () => {
    expect(calculateReturnedCost([
      { returnQty: 3, sellType: 'unit', unitsPerBox: 10, costPrice: 100, costTotal: 10 },
    ])).toBe(10);
  });

  it('subtracts refunds from revenue and reverses returned inventory cost from profit', () => {
    expect(calculateNetSalesProfit(1000, 600, [
      { totalRefund: 200, items: [{ returnQty: 1, sellType: 'box', unitsPerBox: 10, costPrice: 120 }] },
    ], 50)).toEqual({ refunds: 200, returnedCost: 120, netRevenue: 800, netCost: 480, netProfit: 270 });
  });
});

