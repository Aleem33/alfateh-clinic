import type { Unsubscribe } from 'firebase/firestore';
import { subscribeToLocalCollection } from './collectionRepository';
import { indexMedicine, partitionMedicines, type MedicineRecord } from './medicineIndex';

type Subscriber = {
  onData: (medicines: MedicineRecord[]) => void;
  onError?: (error: unknown) => void;
  select: 'active' | 'archived' | 'all';
};

export type MedicineStoreSnapshot = {
  all: MedicineRecord[];
  active: MedicineRecord[];
  archived: MedicineRecord[];
  hasLoaded: boolean;
  fromCache: boolean;
};

const subscribers = new Set<Subscriber>();
let cachedAllMedicines: MedicineRecord[] = [];
let hasLoaded = false;
let fromCache = true;
let localUnsubscribe: Unsubscribe | null = null;

function currentSnapshot(): MedicineStoreSnapshot {
  const { active, archived } = partitionMedicines(cachedAllMedicines);
  return { all: cachedAllMedicines, active, archived, hasLoaded, fromCache };
}

function notifySubscribers() {
  const snapshot = currentSnapshot();
  for (const subscriber of subscribers) subscriber.onData(snapshot[subscriber.select]);
}

function startListener() {
  if (localUnsubscribe) return;
  // The complete mirror is the operational source in both rollout stages.
  // Firestore's own cache can evict documents and is not a complete inventory.
  localUnsubscribe = subscribeToLocalCollection(
    'medicines',
    records => {
      cachedAllMedicines = records.map(item => indexMedicine(item));
      hasLoaded = true;
      fromCache = true;
      notifySubscribers();
    },
    error => {
      for (const subscriber of subscribers) subscriber.onError?.(error);
    },
    { includeDeleted: false },
  );
}

function stopListenerWhenIdle() {
  if (subscribers.size > 0) return;
  localUnsubscribe?.();
  localUnsubscribe = null;
  cachedAllMedicines = [];
  hasLoaded = false;
  fromCache = true;
}

export function subscribeToMedicines(
  onData: (medicines: MedicineRecord[]) => void,
  onError?: (error: unknown) => void,
): Unsubscribe {
  const subscriber: Subscriber = { onData, onError, select: 'active' };
  subscribers.add(subscriber);
  if (hasLoaded) onData(currentSnapshot().active);
  startListener();

  return () => {
    subscribers.delete(subscriber);
    if (subscribers.size === 0) stopListenerWhenIdle();
  };
}

export function subscribeToArchivedMedicines(
  onData: (medicines: MedicineRecord[]) => void,
  onError?: (error: unknown) => void,
): Unsubscribe {
  const subscriber: Subscriber = { onData, onError, select: 'archived' };
  subscribers.add(subscriber);
  if (hasLoaded) onData(currentSnapshot().archived);
  startListener();

  return () => {
    subscribers.delete(subscriber);
    if (subscribers.size === 0) stopListenerWhenIdle();
  };
}

export function getMedicineStoreSnapshot(): MedicineStoreSnapshot {
  return currentSnapshot();
}

export function getMedicinesOnce(): Promise<MedicineRecord[]> {
  return new Promise((resolve, reject) => {
    let unsubscribe: Unsubscribe | undefined;
    unsubscribe = subscribeToMedicines(
      medicines => {
        resolve(medicines);
        queueMicrotask(() => unsubscribe?.());
      },
      error => {
        reject(error);
        queueMicrotask(() => unsubscribe?.());
      },
    );
  });
}
