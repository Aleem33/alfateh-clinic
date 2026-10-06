import { describe, expect, it } from 'vitest';
import { getPurchaseBillNo } from './purchaseBillNumbers';

describe('purchase bill numbers', () => {
  it('uses the assigned professional purchase bill number', () => {
    expect(getPurchaseBillNo({
      id: 'firestore-id',
      purchaseBillNo: 'PUR-R4U6-000123',
      invoiceNo: 'SUPPLIER-77',
    })).toBe('PUR-R4U6-000123');
  });

  it('presents legacy random IDs as stable numeric references without rewriting data', () => {
    const record = { id: 'line-id', invoiceId: 'Aq9randomFirestoreInvoiceId' };
    const first = getPurchaseBillNo(record);
    expect(first).toMatch(/^PUR-OLD-\d{8}$/);
    expect(getPurchaseBillNo(record)).toBe(first);
  });
});
