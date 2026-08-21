import { describe, expect, it } from 'vitest';
import { calculateReturnRefund, calculateReturnStockUnits } from './saleReturn';

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
});

