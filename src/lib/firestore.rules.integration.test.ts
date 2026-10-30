import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
  getDocsFromServer,
  collection,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  runTransaction,
  increment,
} from 'firebase/firestore';
import { GLOBAL_DATA_COLLECTIONS } from './dataCollections';
import { recoverSaleTransaction } from '../pos/lib/saleRecovery';
import type { PendingPosSale } from '../pos/lib/offlineSalesOutbox';
import { SUPPORTED_ROLES } from './roleAccess';
import { getOfflineCollectionsForRole } from './offlineDataPolicy';

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
  }, 30000);

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

  it('recovers a completed sale with a stock shortfall atomically and concurrent retries never charge twice', async () => {
    const admin = environment.authenticatedContext('admin-1').firestore();
    await updateDoc(doc(admin, 'medicines', 'batch-a'), { stock: 4, bonusStockUnits: 0 });
    await setDoc(doc(admin, 'syncControl', 'current'), activatedControl());
    const database = environment.authenticatedContext('cashier-1').firestore();
    const record: PendingPosSale = {
      saleId: 'recovery-483', createdAt: '2026-09-28T04:51:00Z',
      saleData: { receiptNo: 'SALE-R1W4-002483', businessDate: '2026-09-28', total: 500,
        items: [{ medicineId: 'batch-a', name: 'Medicine', quantity: 5, sellType: 'unit', paidUnitsSold: 5, bonusUnitsSold: 0, costTotal: 250 }] },
      movements: [{ id: 'recovery-movement', data: { medicineId: 'batch-a', quantity: -5 } }],
      stockAdjustments: [{ medicineId: 'batch-a', units: 5 }],
      customerAdjustment: { customerId: 'customer-1', pendingAmount: 50 },
    };
    const tracked = (data: any) => ({ ...data, syncUpdatedAt: serverTimestamp(), syncProtocolVersion: 2 });
    const recover = () => runTransaction(database, transaction => recoverSaleTransaction({
      get: reference => transaction.get(reference),
      set: (reference, data) => transaction.set(reference, tracked(data)),
      update: (reference, data) => transaction.update(reference, tracked(data)),
    }, record, (collection, id) => doc(database, collection, id), increment, '2026-09-29T06:00:00Z'));
    const attempts = await Promise.allSettled([recover(), recover()]);
    expect(attempts.map(result => result.status)).toContain('fulfilled');
    await assertSucceeds(recover());
    expect((await getDocFromServer(doc(admin, 'sales', record.saleId))).data()).toMatchObject(record.saleData);
    expect((await getDocFromServer(doc(admin, 'medicines', 'batch-a'))).data()?.stock).toBe(0);
    expect((await getDocFromServer(doc(admin, 'customers', 'customer-1'))).data()?.creditBalance).toBe(50);
    expect((await getDocFromServer(doc(admin, 'stockMovements', 'recovery-movement'))).data()).toMatchObject({
      quantity: -5, appliedQuantity: -4, unappliedUnits: 1,
    });
    expect((await getDocFromServer(doc(admin, 'syncIssues', 'sale-stock-recovery-483-recovery-movement'))).data()).toMatchObject({
      status: 'open', unappliedUnits: 1,
    });
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
    await assertFails(updateDoc(doc(database, 'medicines', 'batch-a'), { stock: -1, bonusStockUnits: 0 }));
    await assertFails(updateDoc(doc(database, 'medicines', 'batch-a'), { bonusStockUnits: -1 }));
    await assertFails(updateDoc(doc(database, 'medicines', 'batch-a'), { stock: 5, bonusStockUnits: 6 }));
  });

  it('blocks every role from storing negative medicine stock', async () => {
    const adminDatabase = environment.authenticatedContext('admin-1').firestore();
    const pharmacistDatabase = environment.authenticatedContext('pharmacist-1').firestore();
    await assertFails(updateDoc(doc(adminDatabase, 'medicines', 'batch-a'), { stock: -1, bonusStockUnits: 0 }));
    await assertFails(updateDoc(doc(pharmacistDatabase, 'medicines', 'batch-a'), { stock: -1, bonusStockUnits: 0 }));
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

  it('allows lossless purchase-return recovery with a non-negative partial stock adjustment', async () => {
    const database = environment.authenticatedContext('pharmacist-1').firestore();
    const batch = writeBatch(database);
    batch.set(doc(database, 'purchaseReturns', 'purchase-return-shortage'), {
      returnNo: 'PR-R0N2-000033', medicineId: 'batch-a', totalUnitsReturned: 119,
      stockAppliedUnits: 100, stockUnappliedUnits: 19,
      stockReconciliation: [{ medicineId: 'batch-a', requestedUnits: 119, appliedUnits: 100, unappliedUnits: 19 }],
    });
    batch.update(doc(database, 'medicines', 'batch-a'), { stock: 0, bonusStockUnits: 0 });
    batch.set(doc(database, 'syncIssues', 'purchase-return-stock-purchase-return-shortage'), {
      type: 'purchase-return-stock-reconciliation', status: 'open', medicineId: 'batch-a', unappliedUnits: 19,
    });
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

  const revision = () => ({ syncUpdatedAt: serverTimestamp(), syncProtocolVersion: 2 });

  it.each(SUPPORTED_ROLES)('bootstraps exactly the permitted collections and registers a shared PC for %s', async role => {
    await enforce();
    await environment.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'users', `${role}-matrix`), { role, active: true }));
    const database = environment.authenticatedContext(`${role}-matrix`).firestore();
    const permitted = new Set(getOfflineCollectionsForRole(role));
    for (const name of GLOBAL_DATA_COLLECTIONS) {
      const read = getDocsFromServer(collection(database, name));
      if (permitted.has(name)) await assertSucceeds(read);
      else await assertFails(read);
    }
    await assertSucceeds(getDocFromServer(doc(database, 'users', `${role}-matrix`)));
    // The PC was previously used by an administrator; a different staff account
    // must be able to update its heartbeat without requiring the previous UID.
    await environment.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'syncClients', 'shared-pc'), {
      deviceId: 'shared-pc', uid: 'admin-1', role: 'admin',
    }));
    await assertSucceeds(setDoc(doc(database, 'syncClients', 'shared-pc'), {
      deviceId: 'shared-pc', uid: `${role}-matrix`, role, mirrorReady: true, ...revision(),
    }, { merge: true }));
  }, 30000);

  it.each(['cashier', 'pharmacist'])('commits dispensing, customer credit, hold/resume and customer return for %s', async role => {
    await enforce();
    const database = environment.authenticatedContext(`${role}-1`).firestore();
    const batch = writeBatch(database);
    batch.set(doc(database, 'customers', 'new-customer'), { name: 'New Customer', creditBalance: 10, ...revision() });
    batch.set(doc(database, 'sales', 'role-sale'), { total: 100, amountPaid: 90, customerId: 'new-customer', ...revision() });
    batch.set(doc(database, 'stockMovements', 'role-sale-stock'), { quantity: -2, ...revision() });
    batch.update(doc(database, 'medicines', 'batch-a'), { stock: 98, bonusStockUnits: 10, ...revision() });
    await assertSucceeds(batch.commit());
    const held = doc(database, 'heldBills', 'role-hold');
    await assertSucceeds(setDoc(held, { items: [{ medicineId: 'batch-a', quantity: 1 }], ...revision() }));
    await assertSucceeds(updateDoc(held, { deleted: true, deletedBy: `${role}-1`, deletedAt: serverTimestamp(), ...revision() }));
    const returned = writeBatch(database);
    returned.set(doc(database, 'saleReturns', 'role-return'), { saleId: 'role-sale', refundAmount: 100, ...revision() });
    returned.set(doc(database, 'stockMovements', 'role-return-stock'), { quantity: 2, ...revision() });
    returned.update(doc(database, 'medicines', 'batch-a'), { stock: 100, bonusStockUnits: 10, ...revision() });
    returned.update(doc(database, 'customers', 'new-customer'), { creditBalance: 0, ...revision() });
    await assertSucceeds(returned.commit());
    expect((await getDocFromServer(doc(database, 'medicines', 'batch-a'))).data()?.stock).toBe(100);
    await assertFails(updateDoc(doc(database, 'medicines', 'batch-a'), { archived: true, ...revision() }));
    await assertFails(updateDoc(doc(database, 'medicines', 'batch-a'), { retailPrice: 1, ...revision() }));
  });

  it('allows cashier dispensing of a hospital order without changing its prescription', async () => {
    await enforce();
    await environment.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'pharmacyOrders', 'rx'), { status: 'pending', prescriptions: [] }));
    const database = environment.authenticatedContext('cashier-1').firestore();
    await assertSucceeds(updateDoc(doc(database, 'pharmacyOrders', 'rx'), { status: 'dispensed', dispensedBy: 'cashier-1', dispensedAt: 'now', ...revision() }));
    await assertFails(updateDoc(doc(database, 'pharmacyOrders', 'rx'), { prescriptions: [{ medicineId: 'forged' }], ...revision() }));
  });

  it.each(['doctor', 'nurse', 'receptionist'])('supports a complete clinical entry and discharge billing for %s', async role => {
    await enforce();
    await environment.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'users', `${role}-1`), { role, active: true }));
    const database = environment.authenticatedContext(`${role}-1`).firestore();
    const batch = writeBatch(database);
    for (const name of ['patients', 'appointments', 'consultations', 'admissions', 'bedTreatments', 'pharmacyOrders', 'labOrders', 'bills']) {
      batch.set(doc(database, name, 'clinical-entry'), { patientId: 'patient-1', status: 'pending', ...revision() });
    }
    await assertSucceeds(batch.commit());
    await assertSucceeds(updateDoc(doc(database, 'bills', 'clinical-entry'), { total: 100, ...revision() }));
    await assertFails(updateDoc(doc(database, 'patients', 'clinical-entry'), { deleted: true, ...revision() }));
    const template = setDoc(doc(database, 'prescriptionTemplates', 'role-template'), { name: 'Template', ...revision() });
    if (role === 'doctor') await assertSucceeds(template); else await assertFails(template);
  });

  it.each(['lab', 'lab_technician'])('allows %s results/catalog but not clinical prescribing or billing', async role => {
    await enforce();
    await environment.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), 'users', `${role}-1`), { role, active: true });
      await setDoc(doc(context.firestore(), 'labOrders', 'pending-lab'), { status: 'pending' });
    });
    const database = environment.authenticatedContext(`${role}-1`).firestore();
    await assertSucceeds(updateDoc(doc(database, 'labOrders', 'pending-lab'), { status: 'completed', results: [], ...revision() }));
    await assertSucceeds(setDoc(doc(database, 'labTests', 'catalog-test'), { name: 'Test', price: 500, ...revision() }));
    for (const name of ['consultations', 'bills', 'labOrders', 'sales']) {
      await assertFails(setDoc(doc(database, name, 'unauthorized'), { total: 100, ...revision() }));
    }
  });

  it('lets accountants bill and edit expenses, but not hide history or alter medicine stock', async () => {
    await enforce();
    await environment.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'users', 'accountant-1'), { role: 'accountant', active: true }));
    const database = environment.authenticatedContext('accountant-1').firestore();
    for (const name of ['bills', 'payments', 'expenses']) {
      await assertSucceeds(setDoc(doc(database, name, 'finance'), { total: 100, ...revision() }));
      await assertSucceeds(updateDoc(doc(database, name, 'finance'), { total: 200, ...revision() }));
      await assertFails(updateDoc(doc(database, name, 'finance'), { deleted: true, ...revision() }));
    }
    await assertFails(updateDoc(doc(database, 'medicines', 'batch-a'), { stock: 50, ...revision() }));
  });

  it.each([{ active: false }, { disabled: true }, { deleted: true }])('revokes cached administrator authority for %j without removing records', async flags => {
    await environment.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'users', 'revoked-admin'), { role: 'admin', ...flags }));
    const database = environment.authenticatedContext('revoked-admin').firestore();
    await assertSucceeds(getDocFromServer(doc(database, 'users', 'revoked-admin')));
    await assertFails(getDocsFromServer(collection(database, 'medicines')));
    await assertFails(setDoc(doc(database, 'sales', 'revoked'), { total: 100 }));
    const admin = environment.authenticatedContext('admin-1').firestore();
    expect((await getDocFromServer(doc(admin, 'medicines', 'batch-a'))).data()?.stock).toBe(100);
  });
  const activatedControl = () => ({
    protocolVersion: 2, minimumProtocolVersion: 2, rulesEnforcementVersion: 2,
    datasetGeneration: 2, trackedWritesRequired: true, incrementalEnabled: true,
    rollbackToLegacy: false, activationVerifiedAt: serverTimestamp(), confirmedDeviceIds: ['device-1'],
  });
  async function enforce() {
    await environment.withSecurityRulesDisabled(context => setDoc(
      doc(context.firestore(), 'syncControl', 'current'), activatedControl(),
    ));
  }

  it.each([...GLOBAL_DATA_COLLECTIONS, 'unlistedAdminCollection'])(
    'requires fresh tracked revisions on %s including the admin catch-all', async name => {
      await enforce();
      const database = environment.authenticatedContext('admin-1').firestore();
      const reference = doc(database, name, 'tracked-check');
      const invariantFields = name === 'medicines' ? { stock: 0, bonusStockUnits: 0 } : {};
      await assertFails(setDoc(reference, { value: 1, ...invariantFields }));
      await assertSucceeds(setDoc(reference, { value: 1, ...invariantFields, ...revision() }));
      // REQUEST_TIME has millisecond precision. Move past the creation tick:
      // two legitimate writes in one tick must not be rejected merely because
      // their timestamps match (the mirror deliberately overlaps that boundary).
      await new Promise(resolve => setTimeout(resolve, 5));
      await assertFails(updateDoc(reference, { value: 2 }));
      await assertFails(updateDoc(reference, { value: 2, syncUpdatedAt: 'forged', syncProtocolVersion: 2 }));
      await assertSucceeds(updateDoc(reference, { value: 2, ...revision() }));
      await assertFails(deleteDoc(reference));
    },
  );

  it('allows a full tracked cashier batch but rejects its untracked equivalent', async () => {
    await enforce();
    const database = environment.authenticatedContext('cashier-1').firestore();
    const batch = writeBatch(database);
    batch.set(doc(database, 'sales', 'tracked-sale'), { total: 500, ...revision() });
    batch.set(doc(database, 'stockMovements', 'tracked-movement'), { quantity: -1, ...revision() });
    batch.update(doc(database, 'medicines', 'batch-a'), { stock: 99, ...revision() });
    batch.update(doc(database, 'customers', 'customer-1'), { creditBalance: 500, ...revision() });
    await assertSucceeds(batch.commit());
    await assertFails(setDoc(doc(database, 'sales', 'old-client-sale'), { total: 500 }));
    await assertFails(updateDoc(doc(database, 'medicines', 'batch-a'), { stock: 98 }));
    await assertFails(updateDoc(doc(database, 'medicines', 'batch-a'), { retailPrice: 1, ...revision() }));
  });

  it('allows a user to refresh their own device registration after Stage 2 activation', async () => {
    await enforce();
    const database = environment.authenticatedContext('cashier-1').firestore();
    const reference = doc(database, 'syncClients', 'device-stage-2');
    const identity = { deviceId: 'device-stage-2', uid: 'cashier-1', role: 'cashier', protocolVersion: 2 };
    await assertSucceeds(setDoc(reference, { ...identity, mirrorReady: false, ...revision() }));
    await new Promise(resolve => setTimeout(resolve, 5));
    await assertSucceeds(setDoc(reference, { ...identity, mirrorReady: true, ...revision() }, { merge: true }));
  });

  it('shares rule lookups across bulk tracked writes', async () => {
    await enforce();
    const database = environment.authenticatedContext('admin-1').firestore();
    const batch = writeBatch(database);
    for (let index = 0; index < 40; index++) batch.set(doc(database, 'purchases', `bulk-${index}`), { ...revision(), total: index });
    await assertSucceeds(batch.commit());
  });

  it('keeps tracked tombstones recoverable and preserves cashier permissions', async () => {
    await enforce();
    const admin = environment.authenticatedContext('admin-1').firestore();
    await assertSucceeds(updateDoc(doc(admin, 'medicines', 'batch-a'), { deleted: true, deletedBy: 'admin-1', ...revision() }));
    await assertSucceeds(updateDoc(doc(admin, 'medicines', 'batch-a'), { deleted: false, ...revision() }));
    const cashier = environment.authenticatedContext('cashier-1').firestore();
    await assertFails(updateDoc(doc(cashier, 'medicines', 'batch-a'), { deleted: true, ...revision() }));
    const held = doc(cashier, 'heldBills', 'held');
    await assertSucceeds(setDoc(held, { items: [], ...revision() }));
    await assertSucceeds(updateDoc(held, { deleted: true, ...revision() }));
    await assertFails(deleteDoc(held));
  });

  it('permits permanent deletion only inside the admin-owned reset scope', async () => {
    await enforce();
    const admin = environment.authenticatedContext('admin-1').firestore();
    const controlRef = doc(admin, 'syncControl', 'current');
    await assertFails(deleteDoc(doc(admin, 'medicines', 'batch-a')));
    await assertSucceeds(updateDoc(controlRef, {
      datasetGeneration: 3, incrementalEnabled: false, rollbackToLegacy: true,
      resetInProgress: true, resetOperationId: 'test-reset', lastResetBy: 'admin-1', lastResetScope: 'pharmacy',
    }));
    await assertSucceeds(deleteDoc(doc(admin, 'medicines', 'batch-a')));
    await assertFails(deleteDoc(doc(admin, 'users', 'cashier-1')));
    await assertFails(deleteDoc(doc(environment.authenticatedContext('cashier-1').firestore(), 'customers', 'customer-1')));
    await assertSucceeds(updateDoc(controlRef, { datasetGeneration: 4, resetInProgress: false }));
    await assertFails(deleteDoc(doc(admin, 'customers', 'customer-1')));
  });

  it('requires compatibility proof and a fresh generation for activation and reactivation', async () => {
    const database = environment.authenticatedContext('admin-1').firestore();
    const reference = doc(database, 'syncControl', 'current');
    await assertSucceeds(setDoc(reference, { datasetGeneration: 1, incrementalEnabled: false, trackedWritesRequired: false }));
    await assertFails(updateDoc(reference, { incrementalEnabled: true }));
    await assertFails(setDoc(reference, { ...activatedControl(), datasetGeneration: 1 }));
    await assertFails(setDoc(reference, { ...activatedControl(), confirmedDeviceIds: [] }));
    await assertFails(setDoc(reference, { ...activatedControl(), rulesEnforcementVersion: 0 }));
    await assertSucceeds(setDoc(reference, activatedControl()));
    await assertFails(deleteDoc(reference));
    await assertFails(updateDoc(reference, { datasetGeneration: 1 }));
    await assertSucceeds(updateDoc(reference, { incrementalEnabled: false, rollbackToLegacy: true }));
    await assertFails(updateDoc(reference, { incrementalEnabled: true, rollbackToLegacy: false }));
    await assertSucceeds(updateDoc(reference, { ...activatedControl(), datasetGeneration: 3 }));
  });

  it('prevents activating and writing untracked documents in the same batch', async () => {
    const database = environment.authenticatedContext('admin-1').firestore();
    const batch = writeBatch(database);
    batch.set(doc(database, 'syncControl', 'current'), activatedControl());
    batch.set(doc(database, 'sales', 'untracked-in-activation'), { total: 100 });
    await assertFails(batch.commit());
  });

  it('rejects an unauthenticated sale write', async () => {
    const database = environment.unauthenticatedContext().firestore();
    await assertFails(setDoc(doc(database, 'sales', 'forbidden'), { total: 1 }));
  });
});
