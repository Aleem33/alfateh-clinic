import { SYNC_PROTOCOL_VERSION, doc, onSnapshot, runTransaction, serverTimestamp, setDoc, type Unsubscribe } from '@/lib/firestore';
import { auth, db } from '../firebase';
import { getOfflineDevice } from './offlineIdentity';

export { SYNC_PROTOCOL_VERSION };
// Release 2 capability. Production still requires server-confirmed opt-in,
// matching enforcement version, a complete baseline, and no active reset.
export const INCREMENTAL_ROLLOUT_READY = true;

export type SyncControl = {
  protocolVersion: number;
  incrementalEnabled: boolean;
  rollbackToLegacy: boolean;
  trackedWritesRequired: boolean;
  minimumProtocolVersion: number;
  datasetGeneration: number;
  rulesEnforcementVersion?: number;
  resetInProgress?: boolean;
};

const CONTROL_CACHE_KEY = 'alfateh.sync.control.v2';
const DEFAULT_CONTROL: SyncControl = {
  protocolVersion: SYNC_PROTOCOL_VERSION,
  incrementalEnabled: false,
  rollbackToLegacy: false,
  trackedWritesRequired: false,
  minimumProtocolVersion: SYNC_PROTOCOL_VERSION,
  datasetGeneration: 1,
  rulesEnforcementVersion: 0,
  resetInProgress: false,
};

const listeners = new Set<(control: SyncControl) => void>();
let controlInitialized = false;
let control = readCachedControl();
let unsubscribe: Unsubscribe | null = null;
let controlCreationStarted = false;
let clientRegistrationQueue: Promise<void> = Promise.resolve();

export function normalizeSyncControl(value: unknown): SyncControl {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    protocolVersion: Math.max(1, Number(source.protocolVersion) || SYNC_PROTOCOL_VERSION),
    incrementalEnabled: source.incrementalEnabled === true,
    rollbackToLegacy: source.rollbackToLegacy === true,
    trackedWritesRequired: source.trackedWritesRequired === true,
    minimumProtocolVersion: Math.max(1, Number(source.minimumProtocolVersion) || SYNC_PROTOCOL_VERSION),
    datasetGeneration: Math.max(1, Number(source.datasetGeneration) || 1),
    rulesEnforcementVersion: Math.max(0, Number(source.rulesEnforcementVersion) || 0),
    resetInProgress: source.resetInProgress === true,
  };
}

function readCachedControl() {
  if (typeof localStorage === 'undefined') return DEFAULT_CONTROL;
  try {
    const raw = localStorage.getItem(CONTROL_CACHE_KEY);
    if (!raw) return DEFAULT_CONTROL;
    const cached = normalizeSyncControl(JSON.parse(raw));
    controlInitialized = true;
    return cached;
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
    && left.datasetGeneration === right.datasetGeneration
    && left.rulesEnforcementVersion === right.rulesEnforcementVersion
    && left.resetInProgress === right.resetInProgress;
}

function publish(next: SyncControl) {
  if (controlInitialized && controlsEqual(control, next)) return;
  controlInitialized = true;
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
    && value.protocolVersion === SYNC_PROTOCOL_VERSION
    && value.minimumProtocolVersion === SYNC_PROTOCOL_VERSION
    && value.rulesEnforcementVersion === SYNC_PROTOCOL_VERSION
    && value.resetInProgress !== true;
}

export function startSyncControlListener(onError?: (error: unknown) => void, role?: string) {
  if (unsubscribe) return;
  unsubscribe = onSnapshot(
    doc(db, 'syncControl', 'current'),
    { includeMetadataChanges: true },
    snapshot => {
      if (snapshot.metadata.hasPendingWrites) return;
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
      // A connection/permission error is not a rollback instruction. Preserve
      // the last known mode; do not start lifetime-history listeners on errors.
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
  // A fresh PC waits for the small control document before choosing listeners,
  // avoiding a full legacy download immediately followed by a new bootstrap.
  if (controlInitialized) listener(control);
  return () => { listeners.delete(listener); };
}

export function registerSyncClient(role: string, mirrorReady: boolean) {
  const uid = auth.currentUser?.uid;
  const generation = control.datasetGeneration;
  if (!uid) return Promise.resolve();
  // Serialize readiness reports: a slow app-version IPC response for an older
  // "not ready" report must not overwrite a newer "ready" report.
  clientRegistrationQueue = clientRegistrationQueue.catch(() => undefined).then(async () => {
    if (auth.currentUser?.uid !== uid || control.datasetGeneration !== generation) return;
    const device = getOfflineDevice();
    const appVersion = typeof window !== 'undefined'
      ? await window.electronAPI?.getAppVersion().catch(() => '') || 'web'
      : 'web';
    if (auth.currentUser?.uid !== uid || control.datasetGeneration !== generation) return;
    await setDoc(doc(db, 'syncClients', device.id), {
      deviceId: device.id, devicePrefix: device.prefix, uid, role, appVersion,
      protocolVersion: SYNC_PROTOCOL_VERSION, mirrorReady, datasetGeneration: generation,
      lastSeenAt: serverTimestamp(),
    }, { merge: true });
  });
  return clientRegistrationQueue;
}
