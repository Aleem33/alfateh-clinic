import { collection, onSnapshot, type Unsubscribe } from 'firebase/firestore';
import { db } from '../firebase';
import { indexMedicine, type MedicineRecord } from './medicineIndex';

type Subscriber = {
  onData: (medicines: MedicineRecord[]) => void;
  onError?: (error: unknown) => void;
};

const subscribers = new Set<Subscriber>();
let cachedMedicines: MedicineRecord[] = [];
let hasLoaded = false;
let firestoreUnsubscribe: Unsubscribe | null = null;
let stopTimer: ReturnType<typeof setTimeout> | null = null;

function startListener() {
  if (firestoreUnsubscribe) return;
  firestoreUnsubscribe = onSnapshot(
    collection(db, 'medicines'),
    snapshot => {
      // The Firestore document ID is authoritative. Some legacy documents have
      // an `id` field in their payload, which must not overwrite the real ID.
      cachedMedicines = snapshot.docs.map(item => indexMedicine({ ...item.data(), id: item.id }));
      hasLoaded = true;
      for (const subscriber of subscribers) subscriber.onData(cachedMedicines);
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
    cachedMedicines = [];
    hasLoaded = false;
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

  const subscriber = { onData, onError };
  subscribers.add(subscriber);
  if (hasLoaded) onData(cachedMedicines);
  startListener();

  return () => {
    subscribers.delete(subscriber);
    if (subscribers.size === 0) stopListenerWhenIdle();
  };
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
