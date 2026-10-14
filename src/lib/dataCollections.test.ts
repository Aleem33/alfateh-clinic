import { describe, expect, it } from 'vitest';
import { GLOBAL_DATA_COLLECTIONS } from './dataCollections';
import { RESET_COLLECTIONS } from './dataSync';

describe('backup collection coverage', () => {
  it('backs up every current and legacy pharmacy business collection', () => {
    const pharmacyCollections = [
      'counters', 'medicines', 'suppliers', 'purchases', 'posPurchases',
      'purchaseReturns', 'sales', 'posSales', 'heldBills', 'saleReturns',
      'stockMovements', 'syncIssues', 'customers', 'customerPayments',
      'expenses', 'posExpenses', 'pharmacyOrders',
    ];
    expect(GLOBAL_DATA_COLLECTIONS).toEqual(expect.arrayContaining(pharmacyCollections));
    expect(RESET_COLLECTIONS.pharmacy).toEqual(expect.arrayContaining(pharmacyCollections));
  });

  it('includes suite configuration and payment records in full backups', () => {
    expect(GLOBAL_DATA_COLLECTIONS).toEqual(expect.arrayContaining([
      'settings', 'plans', 'bills', 'payments', 'users',
    ]));
  });
});
