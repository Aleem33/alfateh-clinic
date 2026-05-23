import { collection, doc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { db, storage } from '../firebase';
import { getOfflineDevice } from './offlineIdentity';

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
};

const DB_NAME = 'alfateh-offline-sync';
const DB_VERSION = 1;
const LAB_STORE = 'pendingLabReports';
const listeners = new Set<(snapshot: SyncSnapshot) => void>();
const device = getOfflineDevice();
let online = typeof navigator === 'undefined' ? true : navigator.onLine;
let syncing = false;
let pendingCount = 0;
let issueCount = 0;
let lastError = '';
let started = false;

function currentSnapshot(): SyncSnapshot {
  return { online, syncing, pendingCount, issueCount, lastError, devicePrefix: device.prefix };
}

function notify() {
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
    pendingCount = records.length;
  } catch {
    pendingCount = 0;
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

async function processLabReportQueue() {
  const records = await withStore<PendingLabReport[]>('readonly', store => store.getAll());
  pendingCount = records.length;
  notify();

  for (const record of records) {
    const storageRef = ref(storage, record.storagePath);
    await uploadBytes(storageRef, record.blob, { contentType: record.fileType || 'application/pdf' });
    const url = await getDownloadURL(storageRef);
    await updateDoc(doc(db, 'labOrders', record.orderId), {
      reportPdf: {
        name: record.fileName,
        size: record.fileSize,
        type: record.fileType || 'application/pdf',
        storagePath: record.storagePath,
        url,
        uploadedAt: new Date().toISOString(),
        pendingUpload: false,
      },
      updatedAt: new Date().toISOString(),
    });
    await deleteQueuedLabReport(record.id);
  }

  await refreshPendingCount();
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
  syncing = true;
  lastError = '';
  notify();
  try {
    await processLabReportQueue();
    await checkStockConflicts();
  } catch (error: any) {
    lastError = error?.message || 'Offline sync failed.';
  } finally {
    syncing = false;
    await refreshPendingCount();
    notify();
  }
}

export function startOfflineSyncService() {
  if (started || typeof window === 'undefined') return;
  started = true;

  const updateOnline = () => {
    online = navigator.onLine;
    notify();
    if (online) void runOfflineSyncNow();
  };

  window.addEventListener('online', updateOnline);
  window.addEventListener('offline', updateOnline);
  void refreshPendingCount();
  if (online) void runOfflineSyncNow();
}

export function subscribeSyncStatus(listener: (snapshot: SyncSnapshot) => void) {
  listeners.add(listener);
  listener(currentSnapshot());
  return () => {
    listeners.delete(listener);
  };
}
