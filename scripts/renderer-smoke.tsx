import React from 'react';
import { createRoot } from 'react-dom/client';
import { POSApp } from '../src/pos/POSApp';
import { db } from '../src/firebase';
import { collection, doc, getDocFromServer, getDocsFromServer, disableNetwork, enableNetwork, waitForPendingWrites } from 'firebase/firestore';
import { getOfflineCacheStatus, startFullOfflineCache } from '../src/lib/offlineCache';
import { setActiveAuthSession } from '../src/lib/offlineAuth';
import { getLocalCollectionOnce } from '../src/lib/collectionRepository';
import { listPendingPosSales, replayPendingPosSaleRecords, removePendingPosSale } from '../src/pos/lib/offlineSalesOutbox';
import { getFirestoreReadDiagnostics } from '../src/lib/readDiagnostics';
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
createRoot(document.getElementById('root')!).render(<POSApp userRole="admin" onSwitchApp={() => {}} onLoginSuccess={() => {}} />);

const ready = async () => {
  await waitFor(() => { const status = getOfflineCacheStatus(); return status.totalCollections > 0 && status.readyCollections === status.totalCollections; }, 'complete mirror');
  await waitFor(() => document.body.innerText.includes('Smoke Medicine'), 'billing medicine');
};
const checkout = async (expectedCount: number) => {
  click('Add -');
  await waitFor(() => [...document.querySelectorAll('button')].some(node => node.textContent?.includes('Checkout & Print') && !node.disabled), 'cart ready');
  click('Checkout & Print');
  await waitFor(async () => (await getLocalCollectionOnce('sales')).length === expectedCount, 'sale mirrored');
};
(window as any).smoke = {
  ready,
  async primary() {
    await ready();
    await checkout(1);
    await waitForPendingWrites(db);
    await disableNetwork(db);
    online = false; window.dispatchEvent(new Event('offline'));
    await checkout(2);
    if ((await listPendingPosSales()).length !== 1) throw new Error('Offline sale not durably queued');
    location.hash = '/suppliers';
    await waitFor(() => document.body.innerText.includes('Smoke Supplier'), 'supplier mirror offline');
    location.hash = '/billing';
    await waitFor(() => document.body.innerText.includes('Smoke Medicine'), 'billing reopen offline');
    window.dispatchEvent(new Event('focus'));
    return { offlineSales: (await getLocalCollectionOnce('sales')).length, outbox: (await listPendingPosSales()).length };
  },
  async reconnectAfterOfflineRestart() {
    await ready();
    if (online) throw new Error('Restart must begin offline');
    if ((await getLocalCollectionOnce('sales')).length !== 2) throw new Error('Offline history lost after restart');
    if ((await listPendingPosSales()).length !== 1) throw new Error('Offline outbox lost after restart');
    online = true; window.dispatchEvent(new Event('online'));
    await enableNetwork(db);
    await waitForPendingWrites(db);
    await replayPendingPosSaleRecords(await listPendingPosSales(), {
      saleExists: async id => (await getDocFromServer(doc(db, 'sales', id))).exists(),
      replay: async () => { throw new Error('An acknowledged offline sale must not deduct stock twice'); },
      remove: removePendingPosSale,
    });
    const sales = await getDocsFromServer(collection(db, 'sales'));
    const stock = (await getDocFromServer(doc(db, 'medicines', 'smoke-med'))).data()?.stock;
    if (sales.size !== 2 || stock !== 18) throw new Error(`Reconciliation mismatch: ${sales.size} sales, ${stock} stock`);
    await waitFor(async () => (await getLocalCollectionOnce('medicines'))[0]?.stock === 18, 'confirmed stock persisted');
    await new Promise(resolve => setTimeout(resolve, 200));
    const beforeFocus = getFirestoreReadDiagnostics().total.operations;
    window.dispatchEvent(new Event('focus'));
    await new Promise(resolve => setTimeout(resolve, 300));
    if (getFirestoreReadDiagnostics().total.operations !== beforeFocus) throw new Error('Focus started additional Firestore reads');
    return { sales: sales.size, stock, outbox: (await listPendingPosSales()).length };
  },
  async verifyReplica() {
    await ready();
    await waitFor(async () => (await getLocalCollectionOnce('sales')).length === 2, 'second PC sees both sales');
    const medicines = await getLocalCollectionOnce('medicines');
    if (medicines[0]?.stock !== 18) throw new Error('Replica stock differs');
    return { mirroredSales: 2, stock: medicines[0].stock };
  },
};
