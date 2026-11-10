import { describe, expect, it } from 'vitest';
import { expiringStockWithinSixMonths, purchaseMedicineOptions } from './medicineAvailability';

describe('stock availability display filters', () => {
  it('includes stocked expired and six-calendar-month boundary batches, excludes empty and later batches', () => {
    const medicines = [
      { id: 'expired', stock: 1, expiryDate: '2026-10-01' },
      { id: 'boundary', stock: 2, expiryDate: '2027-05-10' },
      { id: 'later', stock: 1, expiryDate: '2027-05-11' },
      { id: 'empty', stock: 0, expiryDate: '2026-12-01' },
      { id: 'negative', stock: -1, expiryDate: '2026-12-01' },
      { id: 'archived', stock: 2, expiryDate: '2026-12-01', archived: true },
      { id: 'deleted', stock: 2, expiryDate: '2026-12-01', deleted: true },
      { id: 'invalid', stock: 2, expiryDate: '2027-02-30' },
      { id: 'missing', stock: 2 },
    ];
    const before = JSON.stringify(medicines);
    expect(expiringStockWithinSixMonths(medicines, '2026-11-10').map(m => m.id)).toEqual(['expired', 'boundary']);
    expect(JSON.stringify(medicines)).toBe(before);
  });
  it('clamps six months to the end of February, not a fixed 180-day window', () => {
    expect(expiringStockWithinSixMonths([
      { id: 'end', stock: '1', expiryDate: '2027-02-28' },
      { id: 'later', stock: 1, expiryDate: '2027-03-01' },
    ], '2026-08-31').map(m => m.id)).toEqual(['end']);
    expect(expiringStockWithinSixMonths([], 'invalid')).toEqual([]);
  });
  it('hides empty purchase batches by default but keeps every record selectable on request', () => {
    const medicines = [
      { id: 'a', name: 'Rose water', stock: 1, batchNo: 'A' },
      { id: 'b', name: 'Rose water', stock: 0, batchNo: 'B' },
      { id: 'c', name: 'Rose water', stock: 3, batchNo: 'C' },
    ];
    const before = JSON.stringify(medicines);
    const options = purchaseMedicineOptions(medicines, 'rose', false);
    expect(options.visible.map(m => m.id)).toEqual(['a', 'c']);
    expect(options).toMatchObject({ total: 3, hidden: 1 });
    expect(purchaseMedicineOptions(medicines, 'rose', true).visible).toHaveLength(3);
    expect(purchaseMedicineOptions(medicines, 'B', true).visible.map(m => m.id)).toContain('b');
    expect(JSON.stringify(medicines)).toBe(before);
  });
  it('offers a way to reveal matches when all batches have zero stock', () => {
    const options = purchaseMedicineOptions([{ id: 'empty', name: 'Medicine', stock: 0 }], 'medicine', false);
    expect(options).toMatchObject({ visible: [], total: 1, hidden: 1 });
  });
});
