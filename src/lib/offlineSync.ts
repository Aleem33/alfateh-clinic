import { onAuthStateChanged } from 'firebase/auth';
import { collection, doc, getDocs, onSnapshot, query, setDoc, updateDoc, where, type Unsubscribe } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { auth, db, storage } from '../firebase';
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
  uploadedUrl?: string;
  uploadedAt?: string;
  lastError?: string;
};

const DB_NAME = 'alfateh-offline-sync';
const DB_VERSION = 1;
const LAB_STORE = 'pendingLabReports';
const PENDING_WRITE_COLLECTIONS = [
  'patients',
  'appointments',
  'consultations',
  'pharmacyOrders',
  'labOrders',
  'bills',
  'medicines',
  'sales',
  'saleReturns',
  'stockMovements',
  'customers',
];
const listeners = new Set<(snapshot: SyncSnapshot) => void>();
const pendingWriteCollections = new Set<string>();
const device = getOfflineDevice();
let online = typeof navigator === 'undefined' ? true : navigator.onLine;
let syncing = false;
let labPendingCount = 0;
let pendingCount = 0;
let issueCount = 0;
let lastError = '';
let started = false;
let pendingUnsubs: Unsubscribe[] = [];

function currentSnapshot(): SyncSnapshot {
  return { online, syncing, pendingCount, issueCount, lastError, devicePrefix: device.prefix };
}

function recomputePendingCount() {
  pendingCount = labPendingCount + pendingWriteCollections.size;
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
  } catch {
    labPendingCount = 0;
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
  if (!auth.currentUser) {
    lastError = '';
    notify();
    return;
  }
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

function stopPendingWriteWatchers() {
  pendingUnsubs.forEach(unsub => unsub());
  pendingUnsubs = [];
  pendingWriteCollections.clear();
  notify();
}

function startPendingWriteWatchers() {
  if (pendingUnsubs.length > 0 || !auth.currentUser) return;
  pendingUnsubs = PENDING_WRITE_COLLECTIONS.map(collectionName =>
    onSnapshot(
      collection(db, collectionName),
      { includeMetadataChanges: true },
      snap => {
        const hasPendingWrites = snap.docs.some(document => document.metadata.hasPendingWrites);
        if (hasPendingWrites) pendingWriteCollections.add(collectionName);
        else pendingWriteCollections.delete(collectionName);
        notify();
      },
      () => {
        pendingWriteCollections.delete(collectionName);
        notify();
      },
    )
  );
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
