import { collection, getDocsFromServer, onSnapshot, type Unsubscribe } from '@/lib/firestore';
import { db } from '../firebase';
import { isCloudOnline, subscribeLanStatus } from './lanCoordinator';
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
  refreshPromise: Promise<void> | null;
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
    refreshPromise: null,
    stopTimer: null,
  };
}

const salesResource = resource('sales');
const returnsResource = resource('saleReturns');
const resources = [salesResource, returnsResource];
let lifecycleStarted = false;
let lastFocusRefreshAt = 0;

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

async function refreshFromServer(target: Resource) {
  if (!isCloudOnline() || target.subscribers.size === 0) return;
  if (target.refreshPromise) return target.refreshPromise;
  target.refreshPromise = getDocsFromServer(collection(db, target.collectionName))
    .then(snapshot => publish(target, documents(snapshot)))
    .catch(error => reportError(target, error))
    .finally(() => { target.refreshPromise = null; });
  return target.refreshPromise;
}

function startListener(target: Resource) {
  if (target.listener) return;
  target.listener = onSnapshot(
    collection(db, target.collectionName),
    { includeMetadataChanges: true },
    snapshot => {
      const nextRecords = documents(snapshot);
      target.cachedRecords = nextRecords;
      // While cloud-online, only a server-confirmed snapshot may replace the
      // shared data. This prevents one laptop's stale cache from reporting a
      // different daily total. Offline devices still receive cached changes.
      if (shouldPublishSalesSnapshot(snapshot.metadata.fromCache, isCloudOnline())) publish(target, nextRecords);
    },
    error => reportError(target, error),
  );
  if (isCloudOnline()) void refreshFromServer(target);
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
    target.stopTimer = null;
  }, 30_000);
}

function startLifecycle() {
  if (lifecycleStarted || typeof window === 'undefined') return;
  lifecycleStarted = true;
  subscribeLanStatus(status => {
    for (const target of resources) {
      if (target.subscribers.size === 0) continue;
      if (status.online) void refreshFromServer(target);
      else if (target.cachedRecords.length > 0 || !target.hasPublished) publish(target, target.cachedRecords);
    }
  });
  const refreshActive = () => {
    if (!isCloudOnline()) return;
    const now = Date.now();
    if (now - lastFocusRefreshAt < 30_000) return;
    lastFocusRefreshAt = now;
    resources.forEach(target => { if (target.subscribers.size > 0) void refreshFromServer(target); });
  };
  window.addEventListener('focus', refreshActive);
  window.addEventListener('alfateh:auth-sync-ready', refreshActive);
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
