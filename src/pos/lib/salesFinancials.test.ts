import { describe, expect, it } from 'vitest';
import { calculateSaleCost, netSalesByDate, summarizeSalesFinancials } from './salesFinancials';

describe('shared sales financial calculations', () => {
  it('normalizes numeric strings instead of concatenating totals', () => {
    const summary = summarizeSalesFinancials(
      [{ total: '100', amountPaid: '80' }, { total: '50', amountPaid: '50' }],
      [{ totalRefund: '25' }],
    );

    expect(summary.grossRevenue).toBe(150);
    expect(summary.netRevenue).toBe(125);
    expect(summary.netCollected).toBe(105);
  });

  it('uses the cost per box correctly for boxes and loose units', () => {
    expect(calculateSaleCost({
      items: [
        { quantity: 2, sellType: 'box', unitsPerBox: 10, costPrice: 200 },
        { quantity: 5, sellType: 'unit', unitsPerBox: 10, costPrice: 200 },
      ],
    })).toBe(500);
  });

  it('subtracts refunds and reverses returned cost exactly once', () => {
    const summary = summarizeSalesFinancials(
      [{
        total: 1000,
        items: [{ quantity: 2, sellType: 'box', unitsPerBox: 10, costPrice: 300 }],
      }],
      [{
        totalRefund: 400,
        items: [{ returnQty: 1, sellType: 'box', unitsPerBox: 10, costPrice: 300 }],
      }],
      50,
    );

    expect(summary.netRevenue).toBe(600);
    expect(summary.netCost).toBe(300);
    expect(summary.netProfit).toBe(250);
  });

  it('rebuilds deterministic daily net totals without accumulating snapshots', () => {
    const sales = [
      { businessDate: '2026-08-27', total: 100 },
      { businessDate: '2026-08-27', total: 50 },
      { businessDate: '2026-08-28', total: 20 },
    ];
    const returns = [{ businessDate: '2026-08-27', totalRefund: 30 }];
    const getDateKey = (record: any) => record.businessDate;

    const first = netSalesByDate(sales, returns, getDateKey);
    const second = netSalesByDate(sales, returns, getDateKey);

    expect(Object.fromEntries(first)).toEqual({ '2026-08-27': 120, '2026-08-28': 20 });
    expect(Object.fromEntries(second)).toEqual(Object.fromEntries(first));
  });
});
