import { describe, expect, it } from 'vitest';
import { saleBreakdownLines, summarizeSalesByMedicine, summarizeSalesBySupplier } from './salesBreakdown';

describe('sales breakdown reporting', () => {
  const sales = [{
    id: 'sale-1', total: 270,
    items: [
      { medicineId: 'batch-a', name: 'Alpha', supplierName: 'Supplier One', batchNo: 'A1', quantity: 1, sellType: 'box', unitsPerBox: 10, total: 200 },
      { medicineId: 'batch-b', name: 'Beta', supplierName: 'Supplier One', batchNo: 'B1', quantity: 2, sellType: 'unit', unitsPerBox: 20, total: 100 },
    ],
  }, {
    id: 'sale-2', total: 50,
    items: [{ medicineId: 'batch-a', name: 'Alpha', supplierName: 'Supplier One', batchNo: 'A1', quantity: 5, sellType: 'unit', unitsPerBox: 10, total: 50 }],
  }];

  it('allocates bill discount proportionally while preserving unit quantities', () => {
    const lines = saleBreakdownLines(sales);
    expect(lines.map(line => line.units)).toEqual([10, 2, 5]);
    expect(lines[0].amount).toBe(180);
    expect(lines[1].amount).toBe(90);
    expect(lines.reduce((sum, line) => sum + line.amount, 0)).toBe(320);
  });

  it('groups each batch medicine independently and counts receipts once', () => {
    const summaries = summarizeSalesByMedicine(saleBreakdownLines(sales));
    expect(summaries).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'batch-a', units: 15, amount: 230, receiptCount: 2 }),
      expect.objectContaining({ key: 'batch-b', units: 2, amount: 90, receiptCount: 1 }),
    ]));
  });

  it('groups supplier sales without double-counting medicines or receipts', () => {
    expect(summarizeSalesBySupplier(saleBreakdownLines(sales))).toEqual([
      expect.objectContaining({ supplierName: 'Supplier One', medicineCount: 2, units: 17, amount: 320, receiptCount: 2 }),
    ]);
  });

  it('uses quantity and price for legacy lines that do not contain a line total', () => {
    const [line] = saleBreakdownLines([{
      id: 'legacy', total: 75,
      items: [{ name: 'Legacy', quantity: 3, price: 25, sellType: 'unit' }],
    }]);
    expect(line.amount).toBe(75);
    expect(line.units).toBe(3);
  });

  it('keeps suppliers with identical names separate when frozen supplier IDs are available', () => {
    const summaries = summarizeSalesBySupplier(saleBreakdownLines([{
      id: 'same-name', total: 20,
      items: [
        { medicineId: 'a', supplierId: 'supplier-a', supplierName: 'Same Name', quantity: 1, price: 10, total: 10 },
        { medicineId: 'b', supplierId: 'supplier-b', supplierName: 'Same Name', quantity: 1, price: 10, total: 10 },
      ],
    }]));
    expect(summaries).toHaveLength(2);
    expect(summaries.map(summary => summary.key).sort()).toEqual(['supplier-a', 'supplier-b']);
  });
});
