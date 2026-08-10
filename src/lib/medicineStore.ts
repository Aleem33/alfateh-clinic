import { collection, onSnapshot, type Unsubscribe } from 'firebase/firestore';
import { db } from '../firebase';
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
let firestoreUnsubscribe: Unsubscribe | null = null;
let stopTimer: ReturnType<typeof setTimeout> | null = null;

function currentSnapshot(): MedicineStoreSnapshot {
  const { active, archived } = partitionMedicines(cachedAllMedicines);
  return { all: cachedAllMedicines, active, archived, hasLoaded, fromCache };
}

function notifySubscribers() {
  const snapshot = currentSnapshot();
  for (const subscriber of subscribers) subscriber.onData(snapshot[subscriber.select]);
}

function startListener() {
  if (firestoreUnsubscribe) return;
  firestoreUnsubscribe = onSnapshot(
    collection(db, 'medicines'),
    snapshot => {
      // The Firestore document ID is authoritative. Some legacy documents have
      // an `id` field in their payload, which must not overwrite the real ID.
      cachedAllMedicines = snapshot.docs.map(item => indexMedicine({ ...item.data(), id: item.id }));
      hasLoaded = true;
      fromCache = snapshot.metadata.fromCache;
      notifySubscribers();
    },
    error => {
      for (const subscriber of subscribers) subscriber.onError?.(error);
    },
  );
}

function stopListenerWhenIdle() {
  if (stopTimer) clearTimeout(stopTimer);
  stopTimer = setTimeout(() => {
    if (subscribers.size > 0) return;
    firestoreUnsubscribe?.();
    firestoreUnsubscribe = null;
    cachedAllMedicines = [];
    hasLoaded = false;
    fromCache = true;
    stopTimer = null;
  }, 30_000);
}

export function subscribeToMedicines(
  onData: (medicines: MedicineRecord[]) => void,
  onError?: (error: unknown) => void,
): Unsubscribe {
  if (stopTimer) {
    clearTimeout(stopTimer);
    stopTimer = null;
  }

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
  if (stopTimer) {
    clearTimeout(stopTimer);
    stopTimer = null;
  }

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
