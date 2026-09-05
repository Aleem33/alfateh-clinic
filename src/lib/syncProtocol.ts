import { SYNC_PROTOCOL_VERSION, doc, onSnapshot, runTransaction, serverTimestamp, setDoc, type Unsubscribe } from '@/lib/firestore';
import { auth, db } from '../firebase';
import { getOfflineDevice } from './offlineIdentity';

export { SYNC_PROTOCOL_VERSION };
// Release 1 only builds/verifies the mirror. Release 2 must deploy and test
// server enforcement of tracked writes before changing this build gate.
export const INCREMENTAL_ROLLOUT_READY = false;

export type SyncControl = {
  protocolVersion: number;
  incrementalEnabled: boolean;
  rollbackToLegacy: boolean;
  trackedWritesRequired: boolean;
  minimumProtocolVersion: number;
  datasetGeneration: number;
};

const CONTROL_CACHE_KEY = 'alfateh.sync.control.v2';
const DEFAULT_CONTROL: SyncControl = {
  protocolVersion: SYNC_PROTOCOL_VERSION,
  incrementalEnabled: false,
  rollbackToLegacy: false,
  trackedWritesRequired: false,
  minimumProtocolVersion: SYNC_PROTOCOL_VERSION,
  datasetGeneration: 1,
};

const listeners = new Set<(control: SyncControl) => void>();
let control = readCachedControl();
let unsubscribe: Unsubscribe | null = null;
let controlCreationStarted = false;

export function normalizeSyncControl(value: unknown): SyncControl {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    protocolVersion: Math.max(1, Number(source.protocolVersion) || SYNC_PROTOCOL_VERSION),
    incrementalEnabled: source.incrementalEnabled === true,
    rollbackToLegacy: source.rollbackToLegacy === true,
    trackedWritesRequired: source.trackedWritesRequired === true,
    minimumProtocolVersion: Math.max(1, Number(source.minimumProtocolVersion) || SYNC_PROTOCOL_VERSION),
    datasetGeneration: Math.max(1, Number(source.datasetGeneration) || 1),
  };
}

function readCachedControl() {
  if (typeof localStorage === 'undefined') return DEFAULT_CONTROL;
  try {
    const raw = localStorage.getItem(CONTROL_CACHE_KEY);
    return raw ? normalizeSyncControl(JSON.parse(raw)) : DEFAULT_CONTROL;
  } catch {
    return DEFAULT_CONTROL;
  }
}

function controlsEqual(left: SyncControl, right: SyncControl) {
  return left.protocolVersion === right.protocolVersion
    && left.incrementalEnabled === right.incrementalEnabled
    && left.rollbackToLegacy === right.rollbackToLegacy
    && left.trackedWritesRequired === right.trackedWritesRequired
    && left.minimumProtocolVersion === right.minimumProtocolVersion
    && left.datasetGeneration === right.datasetGeneration;
}

function publish(next: SyncControl) {
  if (controlsEqual(control, next)) return;
  control = next;
  try {
    localStorage.setItem(CONTROL_CACHE_KEY, JSON.stringify(next));
  } catch {
    // The in-memory control still provides a safe legacy fallback.
  }
  listeners.forEach(listener => listener(next));
}

export function getSyncControl() {
  return control;
}

export function shouldUseIncrementalMirror(value: SyncControl = control) {
  return INCREMENTAL_ROLLOUT_READY && isIncrementalControlCompatible(value);
}

export function isIncrementalControlCompatible(value: SyncControl) {
  return value.incrementalEnabled
    && !value.rollbackToLegacy
    && value.trackedWritesRequired
    && value.minimumProtocolVersion <= SYNC_PROTOCOL_VERSION;
}

export function startSyncControlListener(onError?: (error: unknown) => void, role?: string) {
  if (unsubscribe) return;
  unsubscribe = onSnapshot(
    doc(db, 'syncControl', 'current'),
    { includeMetadataChanges: true },
    snapshot => {
      const fromCache = snapshot.metadata.fromCache;
      if (snapshot.exists()) {
        publish(normalizeSyncControl(snapshot.data()));
        return;
      }
      if (fromCache) return;
      publish(DEFAULT_CONTROL);
      if (role === 'admin' && auth.currentUser && !controlCreationStarted) {
        controlCreationStarted = true;
        const uid = auth.currentUser.uid;
        void runTransaction(db, async transaction => {
          const reference = doc(db, 'syncControl', 'current');
          const existing = await transaction.get(reference);
          if (existing.exists()) return;
          transaction.set(reference, {
            ...DEFAULT_CONTROL,
            createdAt: serverTimestamp(),
            createdBy: uid,
          });
        }).catch(error => {
          controlCreationStarted = false;
          onError?.(error);
        });
      }
    },
    error => {
      publish({ ...control, incrementalEnabled: false });
      onError?.(error);
    },
  );
}

export function stopSyncControlListener() {
  unsubscribe?.();
  unsubscribe = null;
  controlCreationStarted = false;
}

export function subscribeSyncControl(listener: (value: SyncControl) => void) {
  listeners.add(listener);
  listener(control);
  return () => { listeners.delete(listener); };
}

export async function registerSyncClient(role: string, mirrorReady: boolean) {
  if (!auth.currentUser) return;
  const device = getOfflineDevice();
  const appVersion = typeof window !== 'undefined'
    ? await window.electronAPI?.getAppVersion().catch(() => '') || 'web'
    : 'web';
  await setDoc(doc(db, 'syncClients', device.id), {
    deviceId: device.id,
    devicePrefix: device.prefix,
    uid: auth.currentUser.uid,
    role,
    appVersion,
    protocolVersion: SYNC_PROTOCOL_VERSION,
    mirrorReady,
    lastSeenAt: serverTimestamp(),
  }, { merge: true });
}
