import { getLocalSyncStatus, queryLocalRecords, setLocalSyncMetadata } from '../../lib/localMirror';

export type PendingSaleReturn = {
  returnId: string;
  returnData: Record<string, any>;
  movements: Array<{ id: string; data: Record<string, any> }>;
  stockAdjustments: Array<{ medicineId: string; units: number; bonusUnits: number }>;
  createdAt: string;
  recovered?: boolean;
};

export type PendingSaleReturnReplayAdapter = {
  returnExists: (returnId: string) => Promise<boolean>;
  replay: (record: PendingSaleReturn) => Promise<void>;
  remove: (returnId: string) => Promise<void>;
};

const DB_NAME = 'alfateh-sale-return-outbox';
const DB_VERSION = 1;
const STORE_NAME = 'pendingReturns';

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
    request.onerror = () => reject(request.error || new Error('Could not open the sales-return recovery store.'));
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
      reject(transaction.error || new DOMException('Sales-return recovery storage was aborted.', 'AbortError'));
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
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('alfateh:return-outbox-changed'));
}

export async function queuePendingSaleReturn(record: PendingSaleReturn) {
  await useStore('readwrite', store => store.put(record));
  notifyChanged();
}

export async function removePendingSaleReturn(returnId: string) {
  await useStore('readwrite', store => store.delete(returnId));
  try {
    const status = await getLocalSyncStatus('saleReturns');
    const recoveryRecords = Array.isArray(status.pending.recoveryRecords)
      ? status.pending.recoveryRecords.filter(value => recoveryCandidate(value)?.id !== returnId)
      : [];
    const rejectedRecordIds = Array.isArray(status.pending.rejectedRecordIds)
      ? status.pending.rejectedRecordIds.map(String).filter(id => id !== returnId)
      : [];
    await setLocalSyncMetadata('saleReturns', {
      pending: { recoveryRecords, rejectedRecordIds },
    });
  } catch {
    // Cloud confirmation is authoritative. Metadata cleanup can safely retry
    // later and must never resurrect or duplicate the confirmed return.
  }
  notifyChanged();
}

export function listPendingSaleReturns() {
  return useStore<PendingSaleReturn[]>('readonly', store => store.getAll());
}

export function countPendingSaleReturns() {
  return useStore<number>('readonly', store => store.count());
}

export function saleReturnStockAdjustments(items: any[]) {
  const totals = new Map<string, { units: number; bonusUnits: number }>();
  for (const item of items || []) {
    const medicineId = String(item?.medicineId || '').trim();
    if (!medicineId) continue;
    const unitsPerBox = item.sellType === 'box' ? Math.max(1, Number(item.unitsPerBox) || 1) : 1;
    const fallbackUnits = Math.max(0, Number(item.returnQty) || 0) * unitsPerBox;
    const paidUnits = Math.max(0, Number(item.paidUnitsRestored) || 0);
    const bonusUnits = Math.max(0, Number(item.bonusUnitsRestored) || 0);
    const units = Math.max(fallbackUnits, paidUnits + bonusUnits);
    const current = totals.get(medicineId) || { units: 0, bonusUnits: 0 };
    current.units += units;
    current.bonusUnits += Math.min(units, bonusUnits);
    totals.set(medicineId, current);
  }
  return [...totals].map(([medicineId, value]) => ({ medicineId, ...value }));
}

function recoveredMovement(returnId: string, returnData: Record<string, any>, item: any, index: number) {
  const unitsPerBox = item.sellType === 'box' ? Math.max(1, Number(item.unitsPerBox) || 1) : 1;
  const fallbackUnits = Math.max(0, Number(item.returnQty) || 0) * unitsPerBox;
  const hasPaidAllocation = item.paidUnitsRestored !== undefined && item.paidUnitsRestored !== null;
  const paidUnits = hasPaidAllocation ? Math.max(0, Number(item.paidUnitsRestored) || 0) : fallbackUnits;
  const bonusUnits = Math.max(0, Number(item.bonusUnitsRestored) || 0);
  const units = Math.max(fallbackUnits, paidUnits + bonusUnits);
  return {
    id: `recovered-${returnId}-${index}`,
    data: {
      type: returnData.withoutReceipt ? 'sale-return-without-receipt' : 'sale-return',
      returnId,
      returnNo: returnData.returnNo || '',
      originalSaleId: returnData.originalSaleId || '',
      originalReceiptNo: returnData.originalReceiptNo || '',
      medicineId: item.medicineId || '',
      medicineName: item.name || item.medicineName || 'Medicine',
      batchNo: item.batchNo || '',
      quantity: units,
      paidUnits,
      bonusUnits,
      createdAt: returnData.date || returnData.trustedDate || new Date().toISOString(),
      processedBy: returnData.processedBy || '',
    },
  };
}

function recoveryCandidate(value: any): { id: string; data: Record<string, any> } | null {
  if (!value || typeof value !== 'object') return null;
  const id = String(value.id || value.returnId || '').trim();
  const data = value.data && typeof value.data === 'object' ? value.data : value;
  if (!id || !Array.isArray(data.items) || !data.returnNo) return null;
  return { id, data };
}

/**
 * Older releases used only Firestore's internal offline queue. Preserve any
 * still-pending or rejected mirror copies in the durable outbox before a
 * server snapshot can hide them from operational screens.
 */
export async function recoverPendingSaleReturnsFromMirror() {
  const [records, status, queued] = await Promise.all([
    queryLocalRecords('saleReturns', { includeDeleted: true }),
    getLocalSyncStatus('saleReturns'),
    listPendingSaleReturns(),
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
    const items = candidate.data.items as any[];
    await queuePendingSaleReturn({
      returnId: candidate.id,
      returnData: candidate.data,
      movements: items.map((item, index) => recoveredMovement(candidate.id, candidate.data, item, index)),
      stockAdjustments: saleReturnStockAdjustments(items),
      createdAt: String(candidate.data.date || candidate.data.trustedDate || new Date().toISOString()),
      recovered: true,
    });
    existing.add(candidate.id);
    recovered += 1;
  }
  return recovered;
}

export async function replayPendingSaleReturnRecords(
  records: PendingSaleReturn[],
  adapter: PendingSaleReturnReplayAdapter,
) {
  for (const record of records) {
    if (await adapter.returnExists(record.returnId)) {
      await adapter.remove(record.returnId);
      continue;
    }
    await adapter.replay(record);
    if (!(await adapter.returnExists(record.returnId))) {
      throw new Error(`Sales return ${record.returnData.returnNo || record.returnId} could not be confirmed after replay.`);
    }
    await adapter.remove(record.returnId);
  }
}
