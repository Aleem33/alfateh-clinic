import { getLocalSyncStatus, queryLocalRecords, setLocalSyncMetadata } from '../../lib/localMirror';
import { isDurableSubmissionActive, replayDurableRecords } from '../../lib/durableReplay';

export type PendingPurchaseReturn = {
  returnId: string;
  returnData: Record<string, any>;
  medicineId: string;
  totalUnits: number;
  bonusUnits: number;
  createdAt: string;
  recovered?: boolean;
};

export type PendingPurchaseReturnReplayAdapter = {
  returnExists: (returnId: string) => Promise<boolean>;
  replay: (record: PendingPurchaseReturn) => Promise<void>;
  remove: (returnId: string) => Promise<void>;
};

const DB_NAME = 'alfateh-purchase-return-outbox';
const DB_VERSION = 1;
const STORE_NAME = 'pendingPurchaseReturns';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'returnId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open the purchase-return recovery store.'));
  });
}

async function useStore<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode, {
      durability: mode === 'readwrite' ? 'strict' : 'default',
    });
    let result: T;
    transaction.oncomplete = () => {
      database.close();
      resolve(result);
    };
    transaction.onerror = transaction.onabort = () => {
      database.close();
      reject(transaction.error || new DOMException('Purchase-return recovery storage was aborted.', 'AbortError'));
    };
    try {
      const request = operation(transaction.objectStore(STORE_NAME));
      request.onsuccess = () => { result = request.result; };
    } catch (error) {
      transaction.abort();
      database.close();
      reject(error);
    }
  });
}

function notifyChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('alfateh:purchase-return-outbox-changed'));
}

export async function queuePendingPurchaseReturn(record: PendingPurchaseReturn) {
  await useStore('readwrite', store => store.put(record));
  notifyChanged();
}

function recoveryCandidate(value: any): { id: string; data: Record<string, any> } | null {
  if (!value || typeof value !== 'object') return null;
  const id = String(value.id || value.returnId || '').trim();
  const data = value.data && typeof value.data === 'object' ? value.data : value;
  if (!id || !data.returnNo || !data.medicineId || !(Number(data.totalUnitsReturned) > 0)) return null;
  return { id, data };
}

export async function removePendingPurchaseReturn(returnId: string) {
  await useStore('readwrite', store => store.delete(returnId));
  try {
    const status = await getLocalSyncStatus('purchaseReturns');
    const recoveryRecords = Array.isArray(status.pending.recoveryRecords)
      ? status.pending.recoveryRecords.filter(value => recoveryCandidate(value)?.id !== returnId)
      : [];
    const rejectedRecordIds = Array.isArray(status.pending.rejectedRecordIds)
      ? status.pending.rejectedRecordIds.map(String).filter(id => id !== returnId)
      : [];
    await setLocalSyncMetadata('purchaseReturns', {
      pending: {
        recoveryRecords,
        rejectedRecordIds,
        hasPendingWrites: rejectedRecordIds.length > 0,
        count: rejectedRecordIds.length > 0 ? 1 : 0,
        lastError: rejectedRecordIds.length > 0 ? String(status.pending.lastError || '') : '',
      },
    });
  } catch {
    // Cloud confirmation is authoritative; metadata cleanup can retry later.
  }
  notifyChanged();
}

export function listPendingPurchaseReturns() {
  return useStore<PendingPurchaseReturn[]>('readonly', store => store.getAll());
}

export function countPendingPurchaseReturns() {
  return useStore<number>('readonly', store => store.count());
}

export function createPendingPurchaseReturn(
  returnId: string,
  returnData: Record<string, any>,
  recovered = false,
): PendingPurchaseReturn {
  const totalUnits = Math.max(0, Number(returnData.totalUnitsReturned) || 0);
  const bonusUnits = Math.min(totalUnits, Math.max(0, Number(returnData.bonusUnitsReturned) || 0));
  return {
    returnId,
    returnData,
    medicineId: String(returnData.medicineId || ''),
    totalUnits,
    bonusUnits,
    createdAt: String(returnData.date || new Date().toISOString()),
    ...(recovered ? { recovered: true } : {}),
  };
}

/** Recover rejected returns made before the durable purchase-return outbox existed. */
export async function recoverPendingPurchaseReturnsFromMirror() {
  const [records, status, queued] = await Promise.all([
    queryLocalRecords('purchaseReturns', { includeDeleted: true }),
    getLocalSyncStatus('purchaseReturns'),
    listPendingPurchaseReturns(),
  ]);
  const existing = new Set(queued.map(record => record.returnId));
  const candidates = [
    ...records.filter(record => record.pending),
    ...(Array.isArray(status.pending.recoveryRecords) ? status.pending.recoveryRecords : []),
  ];
  let recovered = 0;
  for (const value of candidates) {
    const candidate = recoveryCandidate(value);
    if (!candidate || existing.has(candidate.id)) continue;
    await queuePendingPurchaseReturn(createPendingPurchaseReturn(candidate.id, candidate.data, true));
    existing.add(candidate.id);
    recovered += 1;
  }
  return recovered;
}

export async function replayPendingPurchaseReturnRecords(
  records: PendingPurchaseReturn[],
  adapter: PendingPurchaseReturnReplayAdapter,
) {
  const ordered = [...records].sort((left, right) => (
    String(left.createdAt || '').localeCompare(String(right.createdAt || ''))
    || left.returnId.localeCompare(right.returnId)
  ));
  await replayDurableRecords(ordered, {
    id: record => record.returnId,
    label: record => String(record.returnData.returnNo || record.returnId),
    isActive: id => isDurableSubmissionActive('purchaseReturns', id),
    exists: adapter.returnExists,
    replay: adapter.replay,
    remove: adapter.remove,
  });
}
