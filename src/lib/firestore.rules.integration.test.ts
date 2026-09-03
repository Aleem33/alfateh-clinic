import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { disableNetwork, doc, enableNetwork, getDocFromServer, setDoc, updateDoc, writeBatch } from 'firebase/firestore';

const emulatorAddress = process.env.FIRESTORE_EMULATOR_HOST || '';
const integrationDescribe = emulatorAddress ? describe : describe.skip;

integrationDescribe('Firestore offline operational rules', () => {
  let environment: RulesTestEnvironment;

  beforeAll(async () => {
    const [host, rawPort] = emulatorAddress.split(':');
    environment = await initializeTestEnvironment({
      projectId: 'demo-alfateh-clinic',
      firestore: {
        host: host || '127.0.0.1',
        port: Number(rawPort || 8080),
        rules: readFileSync('firestore.rules', 'utf8'),
      },
    });
  });

  beforeEach(async () => {
    await environment.clearFirestore();
    await environment.withSecurityRulesDisabled(async context => {
      const database = context.firestore();
      await setDoc(doc(database, 'users', 'cashier-1'), { role: 'cashier', active: true });
      await setDoc(doc(database, 'users', 'pharmacist-1'), { role: 'pharmacist', active: true });
      await setDoc(doc(database, 'medicines', 'batch-a'), {
        name: 'Test Medicine',
        stock: 100,
        retailPrice: 500,
        costPrice: 300,
        bonusStockUnits: 10,
        archived: false,
      });
      await setDoc(doc(database, 'customers', 'customer-1'), {
        name: 'Test Customer',
        creditBalance: 0,
      });
    });
  });

  afterAll(async () => {
    await environment?.cleanup();
  });

  it('allows a complete cashier sale batch containing sale, movement, stock, and customer credit', async () => {
    const database = environment.authenticatedContext('cashier-1').firestore();
    const batch = writeBatch(database);
    batch.set(doc(database, 'sales', 'sale-1'), { receiptNo: 'SALE-R001-1', total: 500 });
    batch.set(doc(database, 'stockMovements', 'movement-1'), {
      type: 'sale',
      medicineId: 'batch-a',
      quantity: -10,
    });
    batch.update(doc(database, 'medicines', 'batch-a'), { stock: 90, bonusStockUnits: 5 });
    batch.update(doc(database, 'customers', 'customer-1'), { creditBalance: 100 });
    await assertSucceeds(batch.commit());
  });

  it('blocks a cashier from making the bonus bucket negative or larger than stock', async () => {
    const database = environment.authenticatedContext('cashier-1').firestore();
    await assertFails(updateDoc(doc(database, 'medicines', 'batch-a'), { bonusStockUnits: -1 }));
    await assertFails(updateDoc(doc(database, 'medicines', 'batch-a'), { stock: 5, bonusStockUnits: 6 }));
  });

  it('allows a cashier return batch to restore stock', async () => {
    const database = environment.authenticatedContext('cashier-1').firestore();
    const batch = writeBatch(database);
    batch.set(doc(database, 'saleReturns', 'return-1'), { returnNo: 'SR-R001-1', totalRefund: 50 });
    batch.set(doc(database, 'stockMovements', 'movement-return-1'), {
      type: 'sale-return',
      medicineId: 'batch-a',
      quantity: 1,
    });
    batch.update(doc(database, 'medicines', 'batch-a'), { stock: 101 });
    await assertSucceeds(batch.commit());
  });

  it('blocks a cashier from changing medicine price or archival fields', async () => {
    const database = environment.authenticatedContext('cashier-1').firestore();
    await assertFails(updateDoc(doc(database, 'medicines', 'batch-a'), { retailPrice: 1 }));
    await assertFails(updateDoc(doc(database, 'medicines', 'batch-a'), { archived: true }));
  });

  it('allows a pharmacist purchase batch to add stock and update batch cost', async () => {
    const database = environment.authenticatedContext('pharmacist-1').firestore();
    const batch = writeBatch(database);
    batch.set(doc(database, 'purchases', 'purchase-1'), {
      medicineId: 'batch-a',
      totalUnitsAdded: 20,
      costPrice: 320,
    });
    batch.set(doc(database, 'stockMovements', 'movement-purchase-1'), {
      type: 'purchase',
      medicineId: 'batch-a',
      quantity: 20,
    });
    batch.update(doc(database, 'medicines', 'batch-a'), { stock: 120, costPrice: 320 });
    await assertSucceeds(batch.commit());
  });

  it('allows a pharmacist purchase return batch to remove stock', async () => {
    const database = environment.authenticatedContext('pharmacist-1').firestore();
    const batch = writeBatch(database);
    batch.set(doc(database, 'purchaseReturns', 'purchase-return-1'), {
      returnNo: 'PR-R001-1',
      supplierId: 'supplier-1',
      totalRefund: 300,
    });
    batch.set(doc(database, 'stockMovements', 'movement-purchase-return-1'), {
      type: 'purchase-return',
      medicineId: 'batch-a',
      quantity: -1,
    });
    batch.update(doc(database, 'medicines', 'batch-a'), { stock: 99 });
    await assertSucceeds(batch.commit());
  });

  it('applies a customer payment record, balance, and due-sale update atomically', async () => {
    await environment.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), 'sales', 'sale-due'), {
        customerId: 'customer-1',
        total: 500,
        amountPaid: 200,
        pendingAmount: 300,
      });
    });
    const database = environment.authenticatedContext('cashier-1').firestore();
    const batch = writeBatch(database);
    batch.set(doc(database, 'customerPayments', 'payment-1'), {
      customerId: 'customer-1',
      amount: 100,
    });
    batch.update(doc(database, 'customers', 'customer-1'), { creditBalance: 200 });
    batch.update(doc(database, 'sales', 'sale-due'), { amountPaid: 300, pendingAmount: 200 });
    await assertSucceeds(batch.commit());
  });

  it('queues a complete sale while offline and confirms it after reconnect', async () => {
    const database = environment.authenticatedContext('cashier-1').firestore();
    await disableNetwork(database);
    const batch = writeBatch(database);
    batch.set(doc(database, 'sales', 'sale-offline'), { receiptNo: 'SALE-OFFLINE-1', total: 500 });
    batch.set(doc(database, 'stockMovements', 'movement-offline'), {
      type: 'sale',
      medicineId: 'batch-a',
      quantity: -10,
    });
    batch.update(doc(database, 'medicines', 'batch-a'), { stock: 90 });
    const pendingCommit = batch.commit();
    await new Promise(resolve => setTimeout(resolve, 50));
    await enableNetwork(database);
    await assertSucceeds(pendingCommit);
    const confirmed = await getDocFromServer(doc(database, 'sales', 'sale-offline'));
    if (!confirmed.exists()) throw new Error('Queued offline sale did not reach the server after reconnect.');
  });

  it('rejects an unauthenticated sale write', async () => {
    const database = environment.unauthenticatedContext().firestore();
    await assertFails(setDoc(doc(database, 'sales', 'forbidden'), { total: 1 }));
  });
});
