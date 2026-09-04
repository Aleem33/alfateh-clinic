import { collection, onSnapshot, type Unsubscribe } from '@/lib/firestore';
import { db } from '../firebase';
import { isCloudOnline, subscribeLanStatus } from './lanCoordinator';
import { recordFirestoreRead, type FirestoreReadReason } from './readDiagnostics';
import { shouldPublishSalesSnapshot } from './salesStorePolicy';

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
  cachedRecords: SalesRecord[];
  hasPublished: boolean;
  listener: Unsubscribe | null;
  nextServerSnapshotReason: FirestoreReadReason;
  stopTimer: ReturnType<typeof setTimeout> | null;
};

function resource(collectionName: Resource['collectionName']): Resource {
  return {
    collectionName,
    subscribers: new Set(),
    records: [],
    cachedRecords: [],
    hasPublished: false,
    listener: null,
    nextServerSnapshotReason: 'initial',
    stopTimer: null,
  };
}

const salesResource = resource('sales');
const returnsResource = resource('saleReturns');
const resources = [salesResource, returnsResource];
let lifecycleStarted = false;
let lastLifecycleOnline: boolean | null = null;

function documents(snapshot: any): SalesRecord[] {
  return snapshot.docs.map((item: any) => ({ ...item.data(), id: item.id }));
}

function notify(target: Resource) {
  target.subscribers.forEach(subscriber => subscriber.onData(target.records));
}

function reportError(target: Resource, error: unknown) {
  target.subscribers.forEach(subscriber => subscriber.onError?.(error));
}

function publish(target: Resource, records: SalesRecord[]) {
  target.records = records;
  target.hasPublished = true;
  notify(target);
}

function changedDocumentCount(snapshot: any, reason: FirestoreReadReason) {
  // The first server snapshot represents the listener's initial result set.
  // Later snapshots normally read only changed documents, which Firestore
  // exposes through docChanges. Fall back to the full result for compatible
  // test doubles or SDK shapes that do not expose docChanges.
  if (reason === 'initial' || typeof snapshot.docChanges !== 'function') return snapshot.docs.length;
  try {
    return snapshot.docChanges({ includeMetadataChanges: false }).length;
  } catch {
    return snapshot.docChanges().length;
  }
}

function startListener(target: Resource) {
  if (target.listener) return;
  target.listener = onSnapshot(
    collection(db, target.collectionName),
    { includeMetadataChanges: true },
    snapshot => {
      const nextRecords = documents(snapshot);
      target.cachedRecords = nextRecords;
      if (!snapshot.metadata.fromCache) {
        const reason = target.nextServerSnapshotReason;
        recordFirestoreRead({
          collection: target.collectionName,
          source: 'listener',
          reason,
          documents: changedDocumentCount(snapshot, reason),
        });
        target.nextServerSnapshotReason = 'incremental';
      }
      // While cloud-online, only a server-confirmed snapshot may replace the
      // shared data. This prevents one laptop's stale cache from reporting a
      // different daily total. Offline devices still receive cached changes.
      if (shouldPublishSalesSnapshot(snapshot.metadata.fromCache, isCloudOnline())) publish(target, nextRecords);
    },
    error => reportError(target, error),
  );
}

function stopWhenIdle(target: Resource) {
  if (target.stopTimer) clearTimeout(target.stopTimer);
  target.stopTimer = setTimeout(() => {
    if (target.subscribers.size > 0) return;
    target.listener?.();
    target.listener = null;
    target.records = [];
    target.cachedRecords = [];
    target.hasPublished = false;
    target.nextServerSnapshotReason = 'initial';
    target.stopTimer = null;
  }, 30_000);
}

function startLifecycle() {
  if (lifecycleStarted || typeof window === 'undefined') return;
  lifecycleStarted = true;
  subscribeLanStatus(status => {
    const reconnected = lastLifecycleOnline === false && status.online;
    lastLifecycleOnline = status.online;
    for (const target of resources) {
      if (target.subscribers.size === 0) continue;
      if (reconnected) target.nextServerSnapshotReason = 'reconnect';
      if (!status.online && (target.cachedRecords.length > 0 || !target.hasPublished)) {
        publish(target, target.cachedRecords);
      }
    }
  });
}

function subscribe(target: Resource, onData: Subscriber['onData'], onError?: Subscriber['onError']): Unsubscribe {
  startLifecycle();
  if (target.stopTimer) {
    clearTimeout(target.stopTimer);
    target.stopTimer = null;
  }
  const subscriber = { onData, onError };
  target.subscribers.add(subscriber);
  if (target.hasPublished) onData(target.records);
  startListener(target);
  return () => {
    target.subscribers.delete(subscriber);
    if (target.subscribers.size === 0) stopWhenIdle(target);
  };
}

export function subscribeToSales(onData: Subscriber['onData'], onError?: Subscriber['onError']): Unsubscribe {
  return subscribe(salesResource, onData, onError);
}

export function subscribeToSaleReturns(onData: Subscriber['onData'], onError?: Subscriber['onError']): Unsubscribe {
  return subscribe(returnsResource, onData, onError);
}
