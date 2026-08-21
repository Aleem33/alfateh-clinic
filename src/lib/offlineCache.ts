import { collection, onSnapshot, type Unsubscribe } from '@/lib/firestore';
import { db } from '../firebase';
import { GLOBAL_DATA_COLLECTIONS } from './dataSync';

export type OfflineCacheStatus = {
  active: boolean;
  readyCollections: number;
  totalCollections: number;
  fromCacheCollections: number;
  pendingCollections: string[];
  lastError: string;
};

const listeners = new Set<(status: OfflineCacheStatus) => void>();
const ready = new Set<string>();
const cached = new Set<string>();
const pending = new Set<string>();
let unsubscribers: Unsubscribe[] = [];
let lastError = '';

function snapshot(): OfflineCacheStatus {
  return {
    active: unsubscribers.length > 0,
    readyCollections: ready.size,
    totalCollections: GLOBAL_DATA_COLLECTIONS.length,
    fromCacheCollections: cached.size,
    pendingCollections: [...pending],
    lastError,
  };
}

function notify() {
  const current = snapshot();
  listeners.forEach(listener => listener(current));
}

export function startFullOfflineCache() {
  if (unsubscribers.length > 0) return;
  ready.clear();
  cached.clear();
  lastError = '';
  unsubscribers = GLOBAL_DATA_COLLECTIONS.map(collectionName => onSnapshot(
    collection(db, collectionName),
    { includeMetadataChanges: true },
    result => {
      ready.add(collectionName);
      if (result.metadata.fromCache) cached.add(collectionName);
      else cached.delete(collectionName);
      if (result.docs.some(document => document.metadata.hasPendingWrites)) pending.add(collectionName);
      else pending.delete(collectionName);
      notify();
    },
    error => {
      lastError = error instanceof Error ? error.message : `Could not cache ${collectionName}.`;
      notify();
    },
  ));
  notify();
}

export function stopFullOfflineCache() {
  unsubscribers.forEach(unsubscribe => unsubscribe());
  unsubscribers = [];
  ready.clear();
  cached.clear();
  pending.clear();
  notify();
}

export function subscribeOfflineCache(listener: (status: OfflineCacheStatus) => void) {
  listeners.add(listener);
  listener(snapshot());
  return () => { listeners.delete(listener); };
}
