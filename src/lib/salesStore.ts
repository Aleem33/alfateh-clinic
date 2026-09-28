import type { Unsubscribe } from 'firebase/firestore';
import { subscribeToLocalCollection } from './collectionRepository';
import { listPendingPosSales } from '../pos/lib/offlineSalesOutbox';
import { listPendingSaleReturns } from '../pos/lib/offlineSaleReturnsOutbox';

export type SalesRecord = Record<string, any> & {
  id: string;
  date?: string | number | Date;
  businessDate?: string;
};

type Subscriber = {
  onData: (records: SalesRecord[]) => void;
  onError?: (error: unknown) => void;
};

type Resource = {
  collectionName: 'sales' | 'saleReturns';
  subscribers: Set<Subscriber>;
  records: SalesRecord[];
  hasPublished: boolean;
  listener: Unsubscribe | null;
};

function resource(collectionName: Resource['collectionName']): Resource {
  return { collectionName, subscribers: new Set(), records: [], hasPublished: false, listener: null };
}

const salesResource = resource('sales');
const returnsResource = resource('saleReturns');

function startListener(target: Resource) {
  if (target.listener) return;
  let stopped = false;
  let mirrorReady = false;
  let queueReady = false;
  let revision = 0;
  let mirrorRecords: SalesRecord[] = [];
  let queuedRecords: SalesRecord[] = [];
  const publish = () => {
    if (stopped || !mirrorReady || !queueReady) return;
    const merged = new Map(mirrorRecords.map(record => [record.id, record]));
    for (const queued of queuedRecords) {
      const mirrored = merged.get(queued.id);
      // A cloud tombstone must not be resurrected by a stale recovery copy.
      if (mirrored?.deleted === true) continue;
      merged.set(queued.id, { ...(mirrored || queued), _pendingUpload: true });
    }
    target.records = [...merged.values()].filter(record => record.deleted !== true);
    target.hasPublished = true;
    target.subscribers.forEach(subscriber => subscriber.onData(target.records));
  };
  const refreshQueue = async () => {
    const current = ++revision;
    try {
      const records = target.collectionName === 'sales'
        ? (await listPendingPosSales()).map(record => ({ ...record.saleData, id: record.saleId }))
        : (await listPendingSaleReturns()).map(record => ({ ...record.returnData, id: record.returnId }));
      if (stopped || current !== revision) return;
      queuedRecords = records;
      queueReady = true;
      publish();
    } catch (error) {
      if (!stopped) target.subscribers.forEach(subscriber => subscriber.onError?.(error));
    }
  };
  const eventName = target.collectionName === 'sales' ? 'alfateh:pos-outbox-changed' : 'alfateh:return-outbox-changed';
  const onQueueChanged = () => { void refreshQueue(); };
  if (typeof window !== 'undefined') window.addEventListener(eventName, onQueueChanged);
  void refreshQueue();
  const stopMirror = subscribeToLocalCollection(
    target.collectionName,
    records => {
      mirrorRecords = records;
      mirrorReady = true;
      publish();
    },
    error => target.subscribers.forEach(subscriber => subscriber.onError?.(error)),
    { includeDeleted: true },
  );
  target.listener = () => {
    stopped = true;
    stopMirror();
    if (typeof window !== 'undefined') window.removeEventListener(eventName, onQueueChanged);
  };
}

function subscribe(target: Resource, onData: Subscriber['onData'], onError?: Subscriber['onError']): Unsubscribe {
  const subscriber = { onData, onError };
  target.subscribers.add(subscriber);
  if (target.hasPublished) onData(target.records);
  startListener(target);
  return () => {
    target.subscribers.delete(subscriber);
    if (target.subscribers.size > 0) return;
    target.listener?.();
    target.listener = null;
    target.records = [];
    target.hasPublished = false;
  };
}

export function subscribeToSales(onData: Subscriber['onData'], onError?: Subscriber['onError']): Unsubscribe {
  return subscribe(salesResource, onData, onError);
}

export function subscribeToSaleReturns(onData: Subscriber['onData'], onError?: Subscriber['onError']): Unsubscribe {
  return subscribe(returnsResource, onData, onError);
}
