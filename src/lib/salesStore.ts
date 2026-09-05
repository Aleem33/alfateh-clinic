import type { Unsubscribe } from 'firebase/firestore';
import { subscribeToLocalCollection } from './collectionRepository';

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
  // Only the complete local repository supplies operational history. The
  // central cache service reconciles server snapshots and pending local writes.
  target.listener = subscribeToLocalCollection(
    target.collectionName,
    records => {
      target.records = records;
      target.hasPublished = true;
      target.subscribers.forEach(subscriber => subscriber.onData(records));
    },
    error => target.subscribers.forEach(subscriber => subscriber.onError?.(error)),
  );
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
