import { upsertLocalRecords } from '../../lib/localMirror';

export type PendingPosSale = {
  saleId: string;
  saleData: Record<string, any>;
  movements: Array<{ id: string; data: Record<string, any> }>;
  stockAdjustments: Array<{ medicineId: string; units: number; bonusUnits?: number }>;
  customerAdjustment?: { customerId: string; pendingAmount: number };
  createdAt: string;
};

const DB_NAME = 'alfateh-pos-outbox';
const DB_VERSION = 1;
const STORE_NAME = 'pendingSales';
const activeCheckouts = new Set<string>();

export function beginPendingSaleCheckout(saleId: string) { activeCheckouts.add(saleId); }
export function endPendingSaleCheckout(saleId: string) {
  activeCheckouts.delete(saleId);
  notifyChanged();
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'saleId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function useStore<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode, { durability: 'strict' });
    let result: T;
    transaction.oncomplete = () => {
      database.close();
      resolve(result);
    };
    transaction.onerror = transaction.onabort = () => {
      database.close();
      reject(transaction.error || new DOMException('Offline sale storage transaction was aborted.', 'AbortError'));
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
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('alfateh:pos-outbox-changed'));
}

export async function queuePendingPosSale(record: PendingPosSale) {
  await useStore('readwrite', store => store.put(record));
  notifyChanged();
}

export async function removePendingPosSale(saleId: string) {
  await useStore('readwrite', store => store.delete(saleId));
  notifyChanged();
}

export async function confirmPendingPosSale(saleId: string, data: Record<string, any>) {
  // Persist the confirmed copy before removing its durable recovery copy.
  await upsertLocalRecords('sales', [{ id: saleId, data, pending: false }]);
  await removePendingPosSale(saleId);
}

export async function listPendingPosSales() {
  return useStore<PendingPosSale[]>('readonly', store => store.getAll());
}

export async function countPendingPosSales() {
  return useStore<number>('readonly', store => store.count());
}

export function aggregateSaleStockAdjustments(items: Array<{ medicineId?: string; quantity?: number; sellType?: string; unitsPerBox?: number; bonusUnitsSold?: number }>) {
  const totals = new Map<string, { units: number; bonusUnits: number }>();
  for (const item of items) {
    if (!item.medicineId) continue;
    const quantity = Math.max(0, Number(item.quantity) || 0);
    const unitsPerBox = item.sellType === 'box' ? Math.max(1, Number(item.unitsPerBox) || 1) : 1;
    const current = totals.get(item.medicineId) || { units: 0, bonusUnits: 0 };
    current.units += quantity * unitsPerBox;
    current.bonusUnits += Math.max(0, Number(item.bonusUnitsSold) || 0);
    totals.set(item.medicineId, current);
  }
  return [...totals].map(([medicineId, value]) => ({
    medicineId,
    units: value.units,
    ...(value.bonusUnits > 0 ? { bonusUnits: value.bonusUnits } : {}),
  }));
}

export type PendingPosSaleReplayAdapter = {
  saleExists: (saleId: string) => Promise<boolean>;
  replay: (record: PendingPosSale) => Promise<void>;
  remove: (saleId: string) => Promise<void>;
};

export async function replayPendingPosSaleRecords(
  records: PendingPosSale[],
  adapter: PendingPosSaleReplayAdapter,
) {
  const ordered = [...records].sort((left, right) => (
    String(left.createdAt || '').localeCompare(String(right.createdAt || ''))
    || left.saleId.localeCompare(right.saleId)
  ));
  const missing: PendingPosSale[] = [];
  const errors: string[] = [];
  // First remove every durable recovery copy whose exact ID already reached
  // Firestore. One genuinely blocked sale must not make all later confirmed
  // entries continue appearing as pending.
  for (const record of ordered) {
    if (activeCheckouts.has(record.saleId)) continue;
    if (await adapter.saleExists(record.saleId)) {
      await adapter.remove(record.saleId);
      continue;
    }
    missing.push(record);
  }
  for (const record of missing) {
    if (activeCheckouts.has(record.saleId)) continue;
    try {
      await adapter.replay(record);
      if (!(await adapter.saleExists(record.saleId))) {
        throw new Error(`Offline sale ${record.saleId} could not be confirmed after replay.`);
      }
      await adapter.remove(record.saleId);
    } catch (error) {
      errors.push(`${record.saleData.receiptNo || record.saleId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (errors.length) throw new Error(`${errors.length} sale(s) still saved locally and awaiting upload. ${errors[0]}`);
}
