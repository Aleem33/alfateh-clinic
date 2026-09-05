import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  deleteDoc,
  deleteField,
  disableNetwork,
  doc,
  enableNetwork,
  getDoc,
  getDocFromServer,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';

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
      await setDoc(doc(database, 'users', 'admin-1'), { role: 'admin', active: true });
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

  it('accepts validated protocol-v2 metadata on permitted medicine stock and cost writes', async () => {
    const cashierDatabase = environment.authenticatedContext('cashier-1').firestore();
    await assertSucceeds(updateDoc(doc(cashierDatabase, 'medicines', 'batch-a'), {
      stock: 99,
      bonusStockUnits: 9,
      syncUpdatedAt: serverTimestamp(),
      syncProtocolVersion: 2,
    }));

    const pharmacistDatabase = environment.authenticatedContext('pharmacist-1').firestore();
    await assertSucceeds(updateDoc(doc(pharmacistDatabase, 'medicines', 'batch-a'), {
      stock: 119,
      costPrice: 320,
      syncUpdatedAt: serverTimestamp(),
      syncProtocolVersion: 2,
    }));
  });

  it('rejects forged sync metadata and still blocks unauthorized medicine fields', async () => {
    const cashierDatabase = environment.authenticatedContext('cashier-1').firestore();
    await assertFails(updateDoc(doc(cashierDatabase, 'medicines', 'batch-a'), {
      stock: 99,
      syncUpdatedAt: 'not-a-server-timestamp',
      syncProtocolVersion: 2,
    }));
    await assertFails(updateDoc(doc(cashierDatabase, 'medicines', 'batch-a'), {
      stock: 99,
      syncUpdatedAt: serverTimestamp(),
      syncProtocolVersion: 99,
    }));

    const pharmacistDatabase = environment.authenticatedContext('pharmacist-1').firestore();
    await assertFails(updateDoc(doc(pharmacistDatabase, 'medicines', 'batch-a'), {
      retailPrice: 1,
      syncUpdatedAt: serverTimestamp(),
      syncProtocolVersion: 2,
    }));
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

  it('blocks a pharmacist from editing medicine identity, batch, expiry, or selling price', async () => {
    const database = environment.authenticatedContext('pharmacist-1').firestore();
    await assertFails(updateDoc(doc(database, 'medicines', 'batch-a'), { name: 'Changed Medicine' }));
    await assertFails(updateDoc(doc(database, 'medicines', 'batch-a'), { batchNo: 'B-2' }));
    await assertFails(updateDoc(doc(database, 'medicines', 'batch-a'), { expiryDate: '2030-01-01' }));
    await assertFails(updateDoc(doc(database, 'medicines', 'batch-a'), { retailPrice: 1 }));
  });

  it('allows an administrator to edit a medicine record', async () => {
    const database = environment.authenticatedContext('admin-1').firestore();
    await assertSucceeds(updateDoc(doc(database, 'medicines', 'batch-a'), {
      name: 'Corrected Medicine',
      batchNo: 'B-2',
      expiryDate: '2030-01-01',
      retailPrice: 550,
    }));
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

  it('allows authenticated sync-control reads but only administrators can write control', async () => {
    const adminDatabase = environment.authenticatedContext('admin-1').firestore();
    await assertSucceeds(setDoc(doc(adminDatabase, 'syncControl', 'current'), {
      incrementalEnabled: false,
      rollbackToLegacy: false,
      minimumProtocolVersion: 2,
      datasetGeneration: 1,
    }));

    const cashierDatabase = environment.authenticatedContext('cashier-1').firestore();
    await assertSucceeds(getDoc(doc(cashierDatabase, 'syncControl', 'current')));
    await assertFails(updateDoc(doc(cashierDatabase, 'syncControl', 'current'), {
      incrementalEnabled: true,
    }));

    const publicDatabase = environment.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(publicDatabase, 'syncControl', 'current')));
  });

  it('allows users to register their own sync client while reserving administration to admins', async () => {
    const cashierDatabase = environment.authenticatedContext('cashier-1').firestore();
    const clientRef = doc(cashierDatabase, 'syncClients', 'device-r001');
    await assertSucceeds(setDoc(clientRef, {
      deviceId: 'device-r001',
      uid: 'cashier-1',
      role: 'cashier',
      protocolVersion: 2,
      mirrorReady: false,
    }));
    await assertSucceeds(getDoc(clientRef));
    await assertSucceeds(updateDoc(clientRef, {
      uid: 'cashier-1',
      deviceId: 'device-r001',
      mirrorReady: true,
    }));

    await assertFails(setDoc(doc(cashierDatabase, 'syncClients', 'device-spoofed'), {
      deviceId: 'device-spoofed',
      uid: 'pharmacist-1',
      protocolVersion: 2,
    }));
    await assertFails(setDoc(doc(cashierDatabase, 'syncClients', 'wrong-path'), {
      deviceId: 'different-device',
      uid: 'cashier-1',
      protocolVersion: 2,
    }));
    await assertFails(deleteDoc(clientRef));

    const pharmacistDatabase = environment.authenticatedContext('pharmacist-1').firestore();
    await assertFails(getDoc(doc(pharmacistDatabase, 'syncClients', 'device-r001')));

    const adminDatabase = environment.authenticatedContext('admin-1').firestore();
    await assertSucceeds(getDoc(doc(adminDatabase, 'syncClients', 'device-r001')));
    await assertSucceeds(deleteDoc(doc(adminDatabase, 'syncClients', 'device-r001')));
  });

  it('revokes a tombstoned user role immediately', async () => {
    const adminDatabase = environment.authenticatedContext('admin-1').firestore();
    await assertSucceeds(updateDoc(doc(adminDatabase, 'users', 'cashier-1'), {
      deleted: true,
      deletedBy: 'admin-1',
    }));

    const cashierDatabase = environment.authenticatedContext('cashier-1').firestore();
    await assertFails(setDoc(doc(cashierDatabase, 'sales', 'sale-after-revocation'), {
      receiptNo: 'REVOKED-1',
      total: 100,
    }));
  });

  it('keeps soft deletion and restoration admin-only where non-admins may edit records', async () => {
    const cases = [
      ['cashier', 'sales'], ['cashier', 'saleReturns'], ['cashier', 'customers'],
      ['cashier', 'customerPayments'], ['cashier', 'bills'], ['cashier', 'payments'],
      ['pharmacist', 'posSales'], ['pharmacist', 'purchaseReturns'],
      ['pharmacist', 'posExpenses'], ['pharmacist', 'pharmacyOrders'],
      ['receptionist', 'patients'], ['doctor', 'consultations'],
      ['doctor', 'admissions'], ['nurse', 'bedTreatments'], ['lab', 'labOrders'],
      ['accountant', 'expenses'], ['cashier', 'syncIssues'], ['cashier', 'notifications'],
    ];
    await environment.withSecurityRulesDisabled(async context => {
      const database = context.firestore();
      for (const [role, collectionName] of cases) {
        await setDoc(doc(database, 'users', `${role}-1`), { role, active: true });
        await setDoc(doc(database, collectionName, 'editable'), {
          value: 1, userId: `${role}-1`, deleted: false,
        });
        await setDoc(doc(database, collectionName, 'deleted'), {
          value: 1, userId: `${role}-1`, deleted: true, deletedBy: 'admin-1',
        });
      }
    });
    for (const [role, collectionName] of cases) {
      const database = environment.authenticatedContext(`${role}-1`).firestore();
      await assertSucceeds(updateDoc(doc(database, collectionName, 'editable'), { value: 2 }));
      await assertFails(updateDoc(doc(database, collectionName, 'editable'), {
        deleted: true, deletedAt: serverTimestamp(), deletedBy: `${role}-1`,
      }));
      await assertFails(updateDoc(doc(database, collectionName, 'deleted'), { deleted: false }));
      await assertFails(updateDoc(doc(database, collectionName, 'deleted'), {
        deleted: deleteField(), deletedBy: deleteField(),
      }));
    }
  });

  it('blocks creating already-hidden operational records without deletion authority', async () => {
    const cases = [
      ['cashier', 'sales'], ['cashier', 'saleReturns'], ['cashier', 'customers'],
      ['cashier', 'customerPayments'], ['cashier', 'stockMovements'],
      ['pharmacist', 'purchases'], ['pharmacist', 'posPurchases'],
      ['pharmacist', 'purchaseReturns'], ['pharmacist', 'medicines'],
      ['cashier', 'auditLogs'], ['cashier', 'notifications'], ['cashier', 'syncIssues'],
    ];
    for (const [role, collectionName] of cases) {
      const database = environment.authenticatedContext(`${role}-1`).firestore();
      await assertFails(setDoc(doc(database, collectionName, 'hidden-on-create'), {
        archived: false, deleted: true, deletedBy: `${role}-1`,
      }));
    }
  });

  it('retains recoverable deletion for roles that already had deletion permission', async () => {
    const cases = [
      ['cashier', 'heldBills'], ['cashier', 'counters'],
      ['receptionist', 'appointments'], ['receptionist', 'schedules'],
      ['doctor', 'prescriptionTemplates'], ['doctor', 'wards'], ['doctor', 'rooms'], ['doctor', 'beds'],
      ['pharmacist', 'suppliers'], ['lab', 'labTests'],
    ];
    await environment.withSecurityRulesDisabled(async context => {
      for (const [role, collectionName] of cases) {
        await setDoc(doc(context.firestore(), 'users', `${role}-1`), { role });
        await setDoc(doc(context.firestore(), collectionName, 'recoverable'), { value: 1 });
      }
    });
    for (const [role, collectionName] of cases) {
      const database = environment.authenticatedContext(`${role}-1`).firestore();
      await assertSucceeds(updateDoc(doc(database, collectionName, 'recoverable'), {
        deleted: true, deletedAt: serverTimestamp(), deletedBy: `${role}-1`,
      }));
      await assertSucceeds(updateDoc(doc(database, collectionName, 'recoverable'), { deleted: false }));
    }
  });

  it('keeps admin tombstone, restore and intentional permanent reset authority', async () => {
    const database = environment.authenticatedContext('admin-1').firestore();
    const reference = doc(database, 'medicines', 'batch-a');
    await assertSucceeds(updateDoc(reference, { deleted: true, deletedAt: serverTimestamp(), deletedBy: 'admin-1' }));
    await assertSucceeds(updateDoc(reference, { deleted: false }));
    await assertSucceeds(deleteDoc(reference));
  });

  it('rejects an unauthenticated sale write', async () => {
    const database = environment.unauthenticatedContext().firestore();
    await assertFails(setDoc(doc(database, 'sales', 'forbidden'), { total: 1 }));
  });
});
