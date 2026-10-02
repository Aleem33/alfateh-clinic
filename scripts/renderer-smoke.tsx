import React from 'react';
import { createRoot } from 'react-dom/client';
import { POSApp } from '../src/pos/POSApp';
import { Reports as HMSReports } from '../src/hms/pages/Reports';
import { db } from '../src/firebase';
import { collection, doc, getDocFromServer, getDocsFromServer, disableNetwork, enableNetwork, waitForPendingWrites } from 'firebase/firestore';
import { getOfflineCacheStatus, startFullOfflineCache } from '../src/lib/offlineCache';
import { setActiveAuthSession } from '../src/lib/offlineAuth';
import { getLocalCollectionOnce } from '../src/lib/collectionRepository';
import { listPendingPosSales, replayPendingPosSaleRecords, removePendingPosSale, queuePendingPosSale, confirmPendingPosSale } from '../src/pos/lib/offlineSalesOutbox';
import { recoverPosSaleToCloud } from '../src/pos/lib/cloudSaleRecovery';
import { reconcileRecoveredSaleStock } from '../src/pos/lib/stockReconciliation';
import {
  listPendingSaleReturns,
  removePendingSaleReturn,
  replayPendingSaleReturnRecords,
} from '../src/pos/lib/offlineSaleReturnsOutbox';
import { getFirestoreReadDiagnostics } from '../src/lib/readDiagnostics';
import { setDoc as trackedSetDoc, updateDoc as trackedUpdateDoc, serverTimestamp } from '../src/lib/firestore';
import '../src/index.css';

const waitFor = async (check: () => any, label: string) => {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out: ${label}. UI: ${document.body.innerText.slice(-1800)}`);
};
const click = (label: string) => {
  const button = [...document.querySelectorAll('button')].find(node => node.textContent?.includes(label));
  if (!button || button.disabled) throw new Error(`Button unavailable: ${label}`);
  button.click();
};
const setInputValue = (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
};
let online = !new URLSearchParams(location.search).has('offline');
Object.defineProperty(navigator, 'onLine', { get: () => online });
if (!online) await disableNetwork(db);
window.print = () => undefined;
window.alert = message => { throw new Error(String(message)); };
setActiveAuthSession({ mode: 'online', profile: {
  uid: 'smoke-admin', username: 'smoke', email: 'smoke@example.invalid', name: 'Smoke Admin',
  role: 'admin', app: 'pos', permissions: [], active: true, profileUpdatedAt: new Date().toISOString(),
} });
startFullOfflineCache('admin');
location.hash = '/billing';
const smokeRoot = createRoot(document.getElementById('root')!);
smokeRoot.render(<POSApp userRole="admin" onSwitchApp={() => {}} onLoginSuccess={() => {}} />);

const ready = async () => {
  await waitFor(() => { const status = getOfflineCacheStatus(); return status.totalCollections > 0 && status.readyCollections === status.totalCollections; }, 'complete mirror');
  const expectedMode = new URLSearchParams(location.search).get('mode') || 'legacy';
  if (getOfflineCacheStatus().mode !== expectedMode) throw new Error(`Expected ${expectedMode} sync mode`);
  await waitFor(() => document.body.innerText.includes('Smoke Medicine'), 'billing medicine');
};
const checkout = async (expectedCount: number, rapidPresses = 1) => {
  click('Add -');
  await waitFor(() => [...document.querySelectorAll('button')].some(node => node.textContent?.includes('Checkout & Print') && !node.disabled), 'cart ready');
  const checkoutButton = [...document.querySelectorAll('button')].find(node => node.textContent?.includes('Checkout & Print')) as HTMLButtonElement;
  for (let press = 0; press < rapidPresses; press += 1) checkoutButton.click();
  await waitFor(async () => (await getLocalCollectionOnce('sales')).length === expectedCount, 'sale mirrored');
};
(window as any).smoke = {
  ready,
  async verifyMonthReporting() {
    const fixtures = [
      { id: 'report-jan', date: '2001-01-31T18:59:59Z', medicineName: 'January Report Medicine', supplierName: 'Report Supplier', supplierId: 'report-supplier', medicineId: 'report-batch-jan', totalCost: 100, paidUnits: 10, bonusUnits: 2, totalUnitsAdded: 12, invoiceId: 'report-invoice-jan' },
      { id: 'report-feb', date: '2001-01-31T19:00:00Z', medicineName: 'February Report Medicine', supplierName: 'Report Supplier', supplierId: 'report-supplier', medicineId: 'report-batch-feb', totalCost: 200, paidUnits: 20, bonusUnits: 0, totalUnitsAdded: 20, invoiceId: 'report-invoice-feb' },
    ];
    for (const fixture of fixtures) {
      await trackedSetDoc(doc(db, 'purchases', fixture.id), fixture);
      await trackedSetDoc(doc(db, 'sales', fixture.id), {
        receiptNo: fixture.id, date: fixture.date, total: fixture.totalCost, amountPaid: fixture.totalCost,
        items: [{ medicineId: fixture.medicineId, name: fixture.medicineName, quantity: 1, price: fixture.totalCost, total: fixture.totalCost }],
      });
      await trackedSetDoc(doc(db, 'bills', fixture.id), { billNo: fixture.id, patientName: fixture.medicineName, date: fixture.date, total: fixture.totalCost, paid: fixture.totalCost, paymentStatus: 'paid' });
    }
    const before = (await getDocsFromServer(collection(db, 'sales'))).docs.map(record => ({ id: record.id, data: record.data() }));
    const selectMonth = async (month: string) => {
      const input = document.querySelector('input[type="month"]') as HTMLInputElement;
      if (!input) throw new Error('Month selector unavailable');
      setInputValue(input, month);
      await waitFor(() => input.value === month, 'month selected');
    };
    location.hash = '/purchases';
    await waitFor(() => document.body.innerText.includes('January Report Medicine') && document.body.innerText.includes('February Report Medicine'), 'purchase fixtures');
    await selectMonth('2001-01');
    await waitFor(() => [...document.querySelectorAll('tbody')].some(body => body.innerText.includes('January Report Medicine') && !body.innerText.includes('February Report Medicine')), 'January purchases');
    click('By supplier');
    await waitFor(() => [...document.querySelectorAll('tbody')].some(body => body.innerText.includes('Report Supplier') && body.innerText.includes('100')), 'supplier report totals');
    click('By medicine');
    await waitFor(() => document.body.innerText.includes('By medicine'), 'medicine report');
    click('By invoice');
    await waitFor(() => document.body.innerText.includes('report-invoice-jan'), 'invoice report');
    click('Clear all filters');
    await waitFor(() => document.body.innerText.includes('February Report Medicine'), 'purchase month cleared');
    location.hash = '/sales';
    await waitFor(() => document.body.innerText.includes('report-jan') && document.body.innerText.includes('report-feb'), 'sales fixtures');
    await selectMonth('2001-02');
    await waitFor(() => document.body.innerText.includes('report-feb') && !document.body.innerText.includes('report-jan'), 'Pakistan February sales');
    click('Export');
    await waitFor(() => document.querySelector('input[type="date"]')?.getAttribute('value') === '2001-02-01', 'export month range inherited');
    click('Cancel');
    location.hash = '/reports';
    await waitFor(() => document.body.innerText.includes('Revenue Trend'), 'POS analytics');
    await selectMonth('2001-02');
    await waitFor(() => document.body.innerText.includes('1 transactions'), 'POS monthly analytics');
    smokeRoot.render(<HMSReports />);
    await waitFor(() => document.body.innerText.includes('OPD REVENUE') && document.body.innerText.includes('Reports & Analytics'), 'HMS analytics');
    await selectMonth('2001-02');
    await waitFor(() => document.body.innerText.includes('1 bills') && document.body.innerText.includes('2001-02'), 'HMS monthly totals');
    click('Advanced Generator');
    await waitFor(() => document.body.innerText.includes('report-feb') && !document.body.innerText.includes('report-jan'), 'HMS advanced monthly report');
    const after = (await getDocsFromServer(collection(db, 'sales'))).docs.map(record => ({ id: record.id, data: record.data() }));
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Report filters changed sale documents');
    return { purchaseBreakdowns: 3, pakistanMonthBoundary: true, exportRange: '2001-02-01 to 2001-02-28', posAndHmsAnalytics: true, recordsUnchanged: true };
  },
  async primary() {
    await ready();
    await checkout(1, 5);
    await waitForPendingWrites(db);
    await disableNetwork(db);
    online = false; window.dispatchEvent(new Event('offline'));
    await checkout(2);
    if ((await listPendingPosSales()).length !== 1) throw new Error('Offline sale not durably queued');
    location.hash = '/sale-returns';
    await waitFor(() => document.body.innerText.includes('Return History'), 'sales return page offline');
    const returnButton = [...document.querySelectorAll('button')]
      .find(node => node.textContent?.trim() === 'Return') as HTMLButtonElement | undefined;
    if (!returnButton) throw new Error('Offline sale return action unavailable');
    returnButton.click();
    await waitFor(() => document.body.innerText.includes('Process Sale Return'), 'return dialog');
    const quantityInput = [...document.querySelectorAll('input[type="number"]')]
      .find(node => (node as HTMLInputElement).max !== '') as HTMLInputElement | undefined;
    if (!quantityInput) throw new Error('Return quantity input unavailable');
    setInputValue(quantityInput, '1');
    await waitFor(() => [...document.querySelectorAll('button')]
      .some(node => node.textContent?.includes('Confirm Return & Print Slip') && !node.disabled), 'return ready');
    click('Confirm Return & Print Slip');
    await waitFor(async () => (await getLocalCollectionOnce('saleReturns')).length === 1, 'return mirrored offline');
    if ((await listPendingSaleReturns()).length !== 1) throw new Error('Offline sales return not durably queued');
    location.hash = '/suppliers';
    await waitFor(() => document.body.innerText.includes('Smoke Supplier'), 'supplier mirror offline');
    location.hash = '/billing';
    await waitFor(() => document.body.innerText.includes('Smoke Medicine'), 'billing reopen offline');
    window.dispatchEvent(new Event('focus'));
    return {
      offlineSales: (await getLocalCollectionOnce('sales')).length,
      saleReturns: (await getLocalCollectionOnce('saleReturns')).length,
      outbox: (await listPendingPosSales()).length,
      returnOutbox: (await listPendingSaleReturns()).length,
    };
  },
  async reconnectAfterOfflineRestart() {
    await ready();
    if (online) throw new Error('Restart must begin offline');
    if ((await getLocalCollectionOnce('sales')).length !== 2) throw new Error('Offline history lost after restart');
    if ((await listPendingPosSales()).length !== 1) throw new Error('Offline outbox lost after restart');
    if ((await getLocalCollectionOnce('saleReturns')).length !== 1) throw new Error('Offline sales-return history lost after restart');
    if ((await listPendingSaleReturns()).length !== 1) throw new Error('Offline sales-return outbox lost after restart');
    online = true; window.dispatchEvent(new Event('online'));
    await enableNetwork(db);
    await waitForPendingWrites(db);
    await replayPendingPosSaleRecords(await listPendingPosSales(), {
      saleExists: async id => (await getDocFromServer(doc(db, 'sales', id))).exists(),
      replay: async () => { throw new Error('An acknowledged offline sale must not deduct stock twice'); },
      remove: removePendingPosSale,
    });
    await replayPendingSaleReturnRecords(await listPendingSaleReturns(), {
      returnExists: async id => (await getDocFromServer(doc(db, 'saleReturns', id))).exists(),
      replay: async () => { throw new Error('An acknowledged offline return must not restore stock twice'); },
      remove: removePendingSaleReturn,
    });
    const sales = await getDocsFromServer(collection(db, 'sales'));
    const returns = await getDocsFromServer(collection(db, 'saleReturns'));
    const stock = (await getDocFromServer(doc(db, 'medicines', 'smoke-med'))).data()?.stock;
    await waitFor(async () => (await listPendingSaleReturns()).length === 0, 'sales-return outbox confirmed');
    if (sales.size !== 2 || returns.size !== 1 || stock !== 19) {
      throw new Error(`Reconciliation mismatch: ${sales.size} sales, ${returns.size} returns, ${stock} stock`);
    }
    await waitFor(async () => (await getLocalCollectionOnce('medicines'))[0]?.stock === 19, 'confirmed stock persisted');
    await new Promise(resolve => setTimeout(resolve, 200));
    const beforeFocus = getFirestoreReadDiagnostics().total.operations;
    window.dispatchEvent(new Event('focus'));
    await new Promise(resolve => setTimeout(resolve, 300));
    if (getFirestoreReadDiagnostics().total.operations !== beforeFocus) throw new Error('Focus started additional Firestore reads');
    return { sales: sales.size, returns: returns.size, stock, outbox: (await listPendingPosSales()).length,
      returnOutbox: (await listPendingSaleReturns()).length };
  },
  async verifyReplica() {
    await ready();
    await waitFor(async () => (await getLocalCollectionOnce('sales')).length === 2, 'second PC sees both sales');
    await waitFor(async () => (await getLocalCollectionOnce('saleReturns')).length === 1, 'second PC sees sales return');
    const medicines = await getLocalCollectionOnce('medicines');
    if (medicines[0]?.stock !== 19) throw new Error('Replica stock differs');
    return { mirroredSales: 2, mirroredReturns: 1, stock: medicines[0].stock };
  },
  async verifyTransitions() {
    if (getOfflineCacheStatus().mode !== 'incremental') return { mode: 'legacy' };
    const temporary = doc(db, 'suppliers', 'smoke-transient');
    await trackedSetDoc(temporary, { name: 'Temporary supplier' });
    await waitFor(async () => (await getLocalCollectionOnce('suppliers')).some(item => item.id === 'smoke-transient'), 'new delta record');
    await trackedUpdateDoc(temporary, { deleted: true, deletedBy: 'smoke-admin' });
    await waitFor(async () => !(await getLocalCollectionOnce('suppliers')).some(item => item.id === 'smoke-transient'), 'tombstone hidden');
    await trackedUpdateDoc(temporary, { deleted: false });
    await waitFor(async () => (await getLocalCollectionOnce('suppliers')).some(item => item.id === 'smoke-transient'), 'tombstone restored');
    const reference = doc(db, 'syncControl', 'current');
    await trackedUpdateDoc(reference, { incrementalEnabled: false, rollbackToLegacy: true });
    await waitFor(() => {
      const status = getOfflineCacheStatus();
      return status.mode === 'legacy' && status.readyCollections === status.totalCollections;
    }, 'rollback without clearing local data');
    const previous = (await getDocFromServer(reference)).data()!;
    await trackedUpdateDoc(reference, { incrementalEnabled: true, rollbackToLegacy: false,
      datasetGeneration: previous.datasetGeneration + 1, activationVerifiedAt: serverTimestamp(),
      confirmedDeviceIds: ['smoke-primary', 'smoke-replica'] });
    await waitFor(() => {
      const status = getOfflineCacheStatus();
      return status.mode === 'incremental' && status.readyCollections === status.totalCollections;
    }, 'fresh baseline after generation change');
    if ((await getLocalCollectionOnce('sales')).length !== 2 ||
      (await getLocalCollectionOnce('saleReturns')).length !== 1 ||
      (await getLocalCollectionOnce('medicines'))[0]?.stock !== 19) {
      throw new Error('Generation/rollback changed sales or stock');
    }
    return { tombstoneRestored: true, generation: previous.datasetGeneration + 1, sales: 2, returns: 1, stock: 19 };
  },
  async verifyShortageRecovery() {
    online = true; window.dispatchEvent(new Event('online'));
    await enableNetwork(db);
    await waitForPendingWrites(db);
    // A completed receipt may survive only in its outbox after a rejected SDK
    // batch. It must stay visible and upload even when current stock is lower.
    await trackedUpdateDoc(doc(db, 'medicines', 'smoke-med'), { stock: 4, bonusStockUnits: 0 });
    const record = {
      saleId: 'shortage-sale', createdAt: '2026-09-28T04:51:00Z',
      saleData: { receiptNo: 'SALE-R1W4-002483', date: '2026-09-28T04:51:00Z', businessDate: '2026-09-28', total: 500,
        items: [{ medicineId: 'smoke-med', name: 'Smoke Medicine', quantity: 5, sellType: 'unit', unitsPerBox: 1,
          price: 100, total: 500, costPrice: 60, paidUnitsSold: 5, bonusUnitsSold: 0, costTotal: 300 }] },
      stockAdjustments: [{ medicineId: 'smoke-med', units: 5 }],
      movements: [{ id: 'shortage-movement', data: { medicineId: 'smoke-med', quantity: -5, type: 'sale', saleId: 'shortage-sale' } }],
    };
    await queuePendingPosSale(record);
    location.hash = '/sales';
    await waitFor(() => document.body.innerText.includes('SALE-R1W4-002483')
      && document.body.innerText.includes('Saved on this PC'), 'queued receipt visible in Sales History');
    await Promise.all([recoverPosSaleToCloud(record), recoverPosSaleToCloud(record)]);
    const sale = await getDocFromServer(doc(db, 'sales', record.saleId));
    const medicine = await getDocFromServer(doc(db, 'medicines', 'smoke-med'));
    if (medicine.data()?.stock !== 0 || sale.data()?.total !== 500 || sale.data()?.businessDate !== '2026-09-28'
      || sale.data()?.items[0].costTotal !== 300 || sale.data()?.stockReconciliation[0].unappliedUnits !== 1) {
      throw new Error('Shortage recovery changed the original bill or lost the stock discrepancy');
    }
    await confirmPendingPosSale(record.saleId, sale.data()!);
    await waitFor(() => document.body.innerText.includes('Sale saved · stock review required')
      && !document.body.innerText.includes('Saved on this PC'), 'confirmed sale remains visible after outbox removal');
    const issueId = 'sale-stock-shortage-sale-shortage-movement';
    await reconcileRecoveredSaleStock(issueId, 0, 0, 'Smoke test physical count verified');
    await recoverPosSaleToCloud(record);
    if ((await getDocFromServer(doc(db, 'syncIssues', issueId))).data()?.status !== 'resolved'
      || (await getDocFromServer(doc(db, 'medicines', 'smoke-med'))).data()?.stock !== 0) {
      throw new Error('Retry changed reconciled stock or reopened the same issue');
    }
    return { preservedReceipt: record.saleData.receiptNo, cloudSales: (await getDocsFromServer(collection(db, 'sales'))).size,
      preservedCost: sale.data()?.items[0].costTotal, stock: 0, auditedShortfall: 1, reconciliation: 'resolved' };
  },
};
