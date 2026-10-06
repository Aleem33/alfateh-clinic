import { describe, expect, it } from 'vitest';
import { groupPurchaseInvoices, purchaseReportLine, summarizePurchases } from './purchaseReporting';

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

  it('groups a multi-medicine supplier bill without merging duplicate visible bill numbers', () => {
    const records = [
      { id: 'a', invoiceId: 'internal-a', invoiceNo: 'CASE-123', medicineName: 'One', supplierId: 's1', supplierName: 'Supplier 1', paidUnits: 10, bonusUnits: 2, totalUnitsAdded: 12, totalCost: 100 },
      { id: 'b', invoiceId: 'internal-a', invoiceNo: 'CASE-123', medicineName: 'Two', supplierId: 's1', supplierName: 'Supplier 1', paidUnits: 20, bonusUnits: 0, totalUnitsAdded: 20, totalCost: 200 },
      { id: 'c', invoiceId: 'internal-b', invoiceNo: 'CASE-123', medicineName: 'Three', supplierId: 's2', supplierName: 'Supplier 2', paidUnits: 5, totalUnitsAdded: 5, totalCost: 50 },
    ];
    const groups = groupPurchaseInvoices(records);
    expect(groups).toHaveLength(2);
    expect(groups.find(group => group.key === 'internal-a')).toMatchObject({
      invoiceNumber: 'CASE-123', lineCount: 2, paidUnits: 30, bonusUnits: 2,
      receivedUnits: 32, payable: 300,
    });
  });
});
