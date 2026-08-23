import { describe, expect, it } from 'vitest';
import {
  calculatePurchaseQuantities,
  hasDuplicatePurchaseInvoiceLine,
  type PurchaseInvoiceLineIdentity,
} from './purchaseInvoice';

describe('multi-medicine purchase invoices', () => {
  it('calculates units and cost for boxes plus loose units', () => {
    expect(calculatePurchaseQuantities(2, 3, 10, 500)).toMatchObject({
      boxesPurchased: 2,
      looseUnitsPurchased: 3,
      totalUnits: 23,
      costPricePerUnit: 50,
      totalCost: 1150,
    });
  });

  it('prevents the same existing batch from being added twice', () => {
    const line: PurchaseInvoiceLineIdentity = {
      medicineId: 'batch-a', medicineName: 'Example', batchMode: 'existing', batchNo: 'A-1',
    };
    expect(hasDuplicatePurchaseInvoiceLine([line], { ...line, batchNo: 'ignored' })).toBe(true);
  });

  it('allows different new batches but rejects the same normalized batch and supplier', () => {
    const line: PurchaseInvoiceLineIdentity = {
      medicineId: 'source', medicineName: 'Example  10mg', batchMode: 'new', batchNo: ' B-2 ', supplierId: 'supplier-a',
    };
    expect(hasDuplicatePurchaseInvoiceLine([line], { ...line, medicineName: 'example 10MG', batchNo: 'b-2' })).toBe(true);
    expect(hasDuplicatePurchaseInvoiceLine([line], { ...line, batchNo: 'B-3' })).toBe(false);
  });
});
