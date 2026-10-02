import { describe, expect, it } from 'vitest';
import { purchaseReportLine, summarizePurchases } from './purchaseReporting';

describe('purchase reports', () => {
  it('normalizes legacy boxes and loose units without assigning a cost to bonuses', () => {
    const line = purchaseReportLine({ id: 'old', boxes: 10, looseUnits: 3, unitsPerBox: 10, bonusBoxes: 2, costPerBox: 100, totalCost: 1030, createdAt: '2026-09-30T20:00:00Z' });
    expect(line).toMatchObject({ date: '2026-10-01', paid: 103, bonus: 20, total: 123, payable: 1030, cost: 100 });
  });
  it('keeps same-name batches separate and preserves invoice and supplier totals', () => {
    const records = [
      { id: 'a', invoiceId: 'invoice', medicineId: 'batch-a', medicineName: 'Medicine', supplierId: 'supplier', supplierName: 'Supplier', paidUnits: 100, bonusUnits: 20, totalUnitsAdded: 120, totalCost: 1000 },
      { id: 'b', invoiceId: 'invoice', medicineId: 'batch-b', medicineName: 'Medicine', supplierId: 'supplier', supplierName: 'Supplier', paidUnits: 50, bonusUnits: 0, totalUnitsAdded: 50, totalCost: 600 },
    ];
    const before = JSON.stringify(records);
    const lines = records.map(purchaseReportLine);
    expect(summarizePurchases(lines, 'medicine')).toHaveLength(2);
    expect(summarizePurchases(lines, 'supplier')[0]).toMatchObject({ lines: 2, paid: 150, bonus: 20, total: 170, payable: 1600 });
    expect(summarizePurchases(lines, 'invoice')).toHaveLength(1);
    expect(JSON.stringify(records)).toBe(before);
  });
});
