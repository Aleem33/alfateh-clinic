import { describe, expect, it } from 'vitest';
import {
  calculatePurchaseQuantities,
  hasDuplicatePurchaseInvoiceLine,
  getEditedBatchSellingPriceUpdate,
  validateExistingBatchPurchase,
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

  it('allows cost price changes on an existing batch while protecting pack size and retail price', () => {
    const existing = { unitsPerBox: 10, costPrice: 0, retailPrice: 500 };
    expect(validateExistingBatchPurchase({ unitsPerBox: 10, retailPrice: 500 }, existing)).toBe('');
    expect(validateExistingBatchPurchase({ unitsPerBox: 12, retailPrice: 500 }, existing)).toContain('Pack size');
    expect(validateExistingBatchPurchase({ unitsPerBox: 10, retailPrice: 550 }, existing)).toContain('retail price');
  });

  it('updates billing prices only when an admin changes the edited purchase price', () => {
    const original = { retailPrice: 500, unitPrice: 50 };
    expect(getEditedBatchSellingPriceUpdate({ retailPrice: 500, unitPrice: 50 }, original)).toEqual({});
    expect(getEditedBatchSellingPriceUpdate({ retailPrice: 600, unitPrice: 60 }, original)).toEqual({
      retailPrice: 600, price: 600, unitPrice: 60,
    });
  });
});
