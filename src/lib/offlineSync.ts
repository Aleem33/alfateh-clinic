import { onAuthStateChanged } from 'firebase/auth';
import { collection, doc, getDocFromServer, getDocs, increment, query, setDoc, updateDoc, waitForPendingWrites, where, writeBatch } from '@/lib/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { auth, db, storage } from '../firebase';
import { getOfflineDevice } from './offlineIdentity';
import { completeLanCloudSync, getLanStatus, subscribeLanStatus } from './lanCoordinator';
import { subscribeOfflineCache } from './offlineCache';
import { GLOBAL_DATA_COLLECTIONS } from './dataSync';
import { isCloudAuthReady } from './offlineAuth';
import { countPendingPosSales, listPendingPosSales, removePendingPosSale, replayPendingPosSaleRecords } from '../pos/lib/offlineSalesOutbox';
import { waitForSyncStep } from './syncTiming';

export type SyncSnapshot = {
  online: boolean;
  syncing: boolean;
  pendingCount: number;
  issueCount: number;
  lastError: string;
  devicePrefix: string;
};

type PendingLabReport = {
  id: string;
  orderId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  storagePath: string;
  createdAt: string;
  blob: Blob;
  uploadedUrl?: string;
  uploadedAt?: string;
  lastError?: string;
};

const DB_NAME = 'alfateh-offline-sync';
const DB_VERSION = 1;
const LAB_STORE = 'pendingLabReports';
const PENDING_WRITE_COLLECTIONS = GLOBAL_DATA_COLLECTIONS;
const listeners = new Set<(snapshot: SyncSnapshot) => void>();
const pendingWriteCollections = new Set<string>();
const device = getOfflineDevice();
let online = typeof window === 'undefined' ? true : getLanStatus().online;
let syncing = false;
let labPendingCount = 0;
let posSalePendingCount = 0;
let pendingCount = 0;
let issueCount = 0;
let lastError = '';
let started = false;

function currentSnapshot(): SyncSnapshot {
  return { online, syncing, pendingCount, issueCount, lastError, devicePrefix: device.prefix };
}

function recomputePendingCount() {
  pendingCount = labPendingCount + posSalePendingCount + pendingWriteCollections.size;
}

function notify() {
  recomputePendingCount();
  const snapshot = currentSnapshot();
  listeners.forEach(listener => listener(snapshot));
}

function openOfflineDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(LAB_STORE)) {
        database.createObjectStore(LAB_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(LAB_STORE, mode);
    const request = run(transaction.objectStore(LAB_STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => {
      database.close();
      reject(transaction.error);
    };
  });
}

async function refreshPendingCount() {
  try {
    const records = await withStore<PendingLabReport[]>('readonly', store => store.getAll());
    labPendingCount = records.length;
    posSalePendingCount = await countPendingPosSales();
  } catch {
    labPendingCount = 0;
    posSalePendingCount = 0;
  }
  notify();
}

export async function queueLabReportUpload(input: {
  orderId: string;
  file: File;
  storagePath: string;
}) {
  const record: PendingLabReport = {
    id: `${input.orderId}-${Date.now()}`,
    orderId: input.orderId,
    fileName: input.file.name,
    fileType: input.file.type || 'application/pdf',
    fileSize: input.file.size,
    storagePath: input.storagePath,
    createdAt: new Date().toISOString(),
    blob: input.file,
  };

  await withStore('readwrite', store => store.put(record));
  await refreshPendingCount();
  return record;
}

async function deleteQueuedLabReport(id: string) {
  await withStore('readwrite', store => store.delete(id));
}

async function saveQueuedLabReport(record: PendingLabReport) {
  await withStore('readwrite', store => store.put(record));
}

async function processLabReportQueue() {
  const records = await withStore<PendingLabReport[]>('readonly', store => store.getAll());
  labPendingCount = records.length;
  notify();

  const errors: string[] = [];
  for (const record of records) {
    try {
      let url = record.uploadedUrl || '';
      let uploadedAt = record.uploadedAt || '';
      if (!url) {
        const storageRef = ref(storage, record.storagePath);
        await uploadBytes(storageRef, record.blob, { contentType: record.fileType || 'application/pdf' });
        url = await getDownloadURL(storageRef);
        uploadedAt = new Date().toISOString();
        await saveQueuedLabReport({ ...record, uploadedUrl: url, uploadedAt, lastError: '' });
      }
      await updateDoc(doc(db, 'labOrders', record.orderId), {
        reportPdf: {
          name: record.fileName,
          size: record.fileSize,
          type: record.fileType || 'application/pdf',
          storagePath: record.storagePath,
          url,
          uploadedAt,
          pendingUpload: false,
        },
        updatedAt: new Date().toISOString(),
      });
      await deleteQueuedLabReport(record.id);
    } catch (error: any) {
      const message = error?.message || `Could not sync ${record.fileName}.`;
      errors.push(message);
      await saveQueuedLabReport({ ...record, lastError: message });
    }
  }

  await refreshPendingCount();
  if (errors.length > 0) throw new Error(errors[0]);
}

async function replayPendingPosSales() {
  const records = await listPendingPosSales();
  await replayPendingPosSaleRecords(records, {
    saleExists: async saleId => (await getDocFromServer(doc(db, 'sales', saleId))).exists(),
    replay: async record => {
      const batch = writeBatch(db);
      batch.set(doc(db, 'sales', record.saleId), record.saleData);
      record.movements.forEach(movement => {
        batch.set(doc(db, 'stockMovements', movement.id), movement.data);
      });
      record.stockAdjustments.forEach(adjustment => {
        batch.update(doc(db, 'medicines', adjustment.medicineId), {
          stock: increment(-adjustment.units),
        });
      });
      if (record.customerAdjustment && record.customerAdjustment.pendingAmount > 0) {
        batch.update(doc(db, 'customers', record.customerAdjustment.customerId), {
          creditBalance: increment(record.customerAdjustment.pendingAmount),
        });
      }
      await batch.commit();
    },
    remove: removePendingPosSale,
  });
}

async function checkStockConflicts() {
  const medicines = await getDocs(query(collection(db, 'medicines'), where('stock', '<', 0)));
  issueCount = medicines.size;
  for (const medicine of medicines.docs) {
    const data = medicine.data();
    await setDoc(doc(db, 'syncIssues', `stock-${medicine.id}`), {
      type: 'stock-negative',
      status: 'open',
      medicineId: medicine.id,
      medicineName: data.name || 'Medicine',
      stock: data.stock || 0,
      message: `${data.name || 'Medicine'} stock is negative after offline sync.`,
      devicePrefix: device.prefix,
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    }, { merge: true });
  }
  notify();
}

export async function runOfflineSyncNow() {
  if (!online || syncing) return;
  if (!isCloudAuthReady()) return;
  if (getLanStatus().role === 'sync-wait') return;
  if (!auth.currentUser) {
    lastError = '';
    notify();
    await completeLanCloudSync();
    return;
  }
  syncing = true;
  lastError = '';
  notify();
  try {
    await processLabReportQueue();
    try {
      await waitForSyncStep(waitForPendingWrites(db), 15_000, 'Queued cloud writes');
    } catch (error: any) {
      lastError = error?.message || 'Queued cloud writes could not be confirmed yet.';
      console.warn('A queued Firestore write was rejected or timed out; durable sales will still be verified:', error);
    }
    await replayPendingPosSales();
    await checkStockConflicts();
  } catch (error: any) {
    lastError = error?.message || 'Offline sync failed.';
  } finally {
    syncing = false;
    await refreshPendingCount();
    await completeLanCloudSync();
    notify();
  }
}

function stopPendingWriteWatchers() {
  pendingWriteCollections.clear();
  notify();
}

function startPendingWriteWatchers() {
  // Full-cache listeners provide pending-write metadata for every module.
}

export function startOfflineSyncService() {
  if (started || typeof window === 'undefined') return;
  started = true;

  const updateOnline = (nextOnline = navigator.onLine) => {
    const wasOnline = online;
    online = nextOnline;
    notify();
    if (online && !wasOnline) void runOfflineSyncNow();
  };

  if (!window.electronAPI) {
    window.addEventListener('online', () => updateOnline(true));
    window.addEventListener('offline', () => updateOnline(false));
  }
  window.addEventListener('alfateh:auth-sync-ready', () => void runOfflineSyncNow());
  window.addEventListener('alfateh:pos-outbox-changed', () => void refreshPendingCount());
  subscribeLanStatus(lanStatus => updateOnline(lanStatus.online));
  subscribeOfflineCache(cacheStatus => {
    pendingWriteCollections.clear();
    cacheStatus.pendingCollections
      .filter(collectionName => PENDING_WRITE_COLLECTIONS.includes(collectionName))
      .forEach(collectionName => pendingWriteCollections.add(collectionName));
    notify();
  });
  onAuthStateChanged(auth, user => {
    lastError = '';
    if (user) {
      startPendingWriteWatchers();
      if (online) void runOfflineSyncNow();
    } else {
      stopPendingWriteWatchers();
    }
    notify();
  });
  void refreshPendingCount();
}

export function subscribeSyncStatus(listener: (snapshot: SyncSnapshot) => void) {
  listeners.add(listener);
  listener(currentSnapshot());
  return () => {
    listeners.delete(listener);
  };
}
