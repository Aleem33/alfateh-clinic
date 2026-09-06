import {
  Timestamp,
  collection,
  doc,
  documentId,
  getDocFromServer,
  getDocsFromServer,
  limit,
  onSnapshot,
  orderBy,
  query,
  startAfter,
  startAt,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from '@/lib/firestore';
import { auth, db } from '../firebase';
import { getActiveAuthSession } from './offlineAuth';
import { subscribeLanStatus } from './lanCoordinator';
import { getOfflineCollectionsForRole } from './offlineDataPolicy';
import {
  getLocalSyncStatus,
  queryLocalRecords,
  replaceLocalCollection,
  setLocalSyncMetadata,
  upsertLocalRecords,
  type LocalMirrorCheckpoint,
  type LocalMirrorCheckpointValue,
  type LocalMirrorRecordInput,
} from './localMirror';
import { recordFirestoreRead } from './readDiagnostics';
import { setOfflineMirrorReadiness } from './mirrorReadiness';
import {
  getSyncControl,
  registerSyncClient,
  shouldUseIncrementalMirror,
  startSyncControlListener,
  stopSyncControlListener,
  subscribeSyncControl,
  type SyncControl,
} from './syncProtocol';

export type OfflineCacheMode = 'legacy' | 'incremental';

export type OfflineCacheStatus = {
  active: boolean;
  mode: OfflineCacheMode;
  readyCollections: number;
  totalCollections: number;
  fromCacheCollections: number;
  pendingCollections: string[];
  incompleteCollections: string[];
  lastError: string;
};

const listeners = new Set<(status: OfflineCacheStatus) => void>();
const ready = new Set<string>();
const cached = new Set<string>();
const pending = new Set<string>();
const rejected = new Set<string>();
const activeUnsubscribers = new Map<string, Unsubscribe>();
const persistenceQueues = new Map<string, Promise<void>>();
const incrementalEpochs = new Map<string, number>();
const incrementalRestarts = new Map<string, ReturnType<typeof setTimeout>>();
let controlUnsubscribe: (() => void) | null = null;
let lanUnsubscribe: (() => void) | null = null;
let lastOnline: boolean | null = null;
let activeRole = '';
let activeAuthUid = '';
let activeCollections: string[] = [];
let mode: OfflineCacheMode = 'legacy';
let lastError = '';
let lifecycle = 0;
let registeredReadyState: boolean | null = null;
let readinessAuditRun: number | null = null;
let rejectionListener: ((event: Event) => void) | null = null;
const serverDelivered = new Set<string>();
const reconnectPending = new Set<string>();
const BOOTSTRAP_PAGE_SIZE = 250;

function snapshot(): OfflineCacheStatus {
  return {
    active: activeUnsubscribers.size > 0 || activeCollections.length > 0,
    mode,
    readyCollections: ready.size,
    totalCollections: activeCollections.length,
    fromCacheCollections: cached.size,
    pendingCollections: [...new Set([...pending, ...rejected])],
    incompleteCollections: activeCollections.filter(name => !ready.has(name)),
    lastError,
  };
}

function notify() {
  const current = snapshot();
  listeners.forEach(listener => listener(current));
  const mirrorReady = current.totalCollections > 0 && current.readyCollections === current.totalCollections;
  if (activeRole) setOfflineMirrorReadiness(activeRole, mirrorReady, getSyncControl().datasetGeneration);
  if (auth.currentUser && readinessAuditRun === null && mirrorReady !== registeredReadyState) {
    registeredReadyState = mirrorReady;
    void registerSyncClient(activeRole, mirrorReady).catch(error => {
      lastError = error instanceof Error ? error.message : 'Could not register this sync client.';
      listeners.forEach(listener => listener(snapshot()));
    });
  }
}

function stopCollectionListeners() {
  incrementalRestarts.forEach(timer => clearTimeout(timer));
  incrementalRestarts.clear();
  incrementalEpochs.clear();
  activeUnsubscribers.forEach(unsubscribe => unsubscribe());
  activeUnsubscribers.clear();
  cached.clear();
  pending.clear();
  serverDelivered.clear();
  reconnectPending.clear();
}

function queuePersistence(collectionName: string, run: number, operation: () => Promise<void>) {
  const previous = persistenceQueues.get(collectionName) || Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      if (run !== lifecycle) return;
      await operation();
    });
  persistenceQueues.set(collectionName, next);
  void next.finally(() => {
    if (persistenceQueues.get(collectionName) === next) persistenceQueues.delete(collectionName);
  }).catch(() => undefined);
  return next;
}

async function waitForPersistence(collectionName: string) {
  await persistenceQueues.get(collectionName)?.catch(() => undefined);
}

function timestampParts(value: unknown): { seconds: number; nanoseconds: number } | null {
  if (value instanceof Timestamp) return { seconds: value.seconds, nanoseconds: value.nanoseconds };
  if (value && typeof value === 'object') {
    const candidate = value as Record<string, unknown>;
    const seconds = Number(candidate.seconds);
    const nanoseconds = Number(candidate.nanoseconds || 0);
    if (Number.isFinite(seconds) && Number.isFinite(nanoseconds)) return { seconds, nanoseconds };
  }
  return null;
}

function compareCheckpoint(left: LocalMirrorCheckpoint, right: LocalMirrorCheckpoint) {
  const compareIds = () => {
    const a = new TextEncoder().encode(left.documentId);
    const b = new TextEncoder().encode(right.documentId);
    for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
      if (a[index] !== b[index]) return a[index] - b[index];
    }
    return a.length - b.length;
  };
  const leftParts = timestampParts(left.syncUpdatedAt);
  const rightParts = timestampParts(right.syncUpdatedAt);
  if (!leftParts || !rightParts) return compareIds();
  if (leftParts.seconds !== rightParts.seconds) return leftParts.seconds - rightParts.seconds;
  if (leftParts.nanoseconds !== rightParts.nanoseconds) return leftParts.nanoseconds - rightParts.nanoseconds;
  return compareIds();
}

function checkpointFromDocuments(documents: QueryDocumentSnapshot[]): LocalMirrorCheckpoint | null {
  // A local serverTimestamp estimate must never become a durable cloud cursor.
  if (documents.some(document => document.metadata.hasPendingWrites)) return null;
  let checkpoint: LocalMirrorCheckpoint | null = null;
  for (const document of documents) {
    const parts = timestampParts(document.data().syncUpdatedAt);
    if (!parts) continue;
    const candidate: LocalMirrorCheckpoint = { syncUpdatedAt: parts, documentId: document.id };
    if (!checkpoint || compareCheckpoint(candidate, checkpoint) > 0) checkpoint = candidate;
  }
  return checkpoint;
}

function mirrorInputs(documents: QueryDocumentSnapshot[]): LocalMirrorRecordInput[] {
  return documents.map(document => {
    const data = document.data();
    return {
      id: document.id,
      data,
      deleted: data.deleted === true,
      syncUpdatedAt: timestampParts(data.syncUpdatedAt) || undefined,
      pending: document.metadata.hasPendingWrites,
    };
  });
}

async function markReadyFromLocal(collectionName: string, generation: number, run = lifecycle) {
  await waitForPersistence(collectionName);
  const status = await getLocalSyncStatus(collectionName);
  if (run !== lifecycle) return status;
  if (status.pending.lastError) {
    rejected.add(collectionName);
    lastError ||= String(status.pending.lastError);
  }
  if (status.seedComplete && String(status.generation) === String(generation)) ready.add(collectionName);
  return status;
}

function startRejectedWriteListener() {
  if (rejectionListener || typeof window === 'undefined') return;
  rejectionListener = event => {
    const detail = (event as CustomEvent<{ message?: string; activities?: Array<Record<string, unknown>> }>).detail;
    const message = detail?.message || 'A queued write was rejected. Review the affected entry before retrying.';
    const activities = Array.isArray(detail?.activities) ? detail.activities : [];
    const affected = new Map<string, string[]>();
    for (const activity of activities) {
      const collectionName = String(activity.collection || '');
      if (!collectionName || !activeCollections.includes(collectionName)) continue;
      const ids = affected.get(collectionName) || [];
      const recordId = String(activity.recordId || '');
      if (recordId) ids.push(recordId);
      affected.set(collectionName, ids);
    }
    lastError = `A cloud write needs attention: ${message}`;
    affected.forEach((recordIds, collectionName) => {
      rejected.add(collectionName);
      void queuePersistence(collectionName, lifecycle, async () => {
        const status = await getLocalSyncStatus(collectionName);
        const previousIds = Array.isArray(status.pending.rejectedRecordIds) ? status.pending.rejectedRecordIds.map(String) : [];
        const recoveryRecords = await queryLocalRecords(collectionName, {
          includeDeleted: true, filter: record => recordIds.includes(record.id),
        });
        await setLocalSyncMetadata(collectionName, {
        pending: {
          hasPendingWrites: true,
          lastError: message,
          rejectedRecordIds: [...new Set([...previousIds, ...recordIds])],
          recoveryRecords: [
            ...(Array.isArray(status.pending.recoveryRecords) ? status.pending.recoveryRecords : []),
            ...recoveryRecords,
          ],
          lastQueuedAt: new Date().toISOString(),
        },
        });
      }).catch(handleError);
    });
    notify();
  };
  window.addEventListener('alfateh:firestore-write-rejected', rejectionListener);
}

function startLegacyListener(collectionName: string, control: SyncControl, run: number) {
  const unsubscribe = onSnapshot(
    collection(db, collectionName),
    { includeMetadataChanges: true },
    result => {
      if (run !== lifecycle) return;
      const inputs = mirrorInputs(result.docs);
      const hasPendingWrites = result.docs.some(document => document.metadata.hasPendingWrites);
      if (hasPendingWrites) pending.add(collectionName);
      else pending.delete(collectionName);
      if (result.metadata.fromCache) {
        cached.add(collectionName);
        void queuePersistence(collectionName, run, async () => {
          const existingStatus = await getLocalSyncStatus(collectionName);
          const completeMirror = existingStatus.seedComplete && String(existingStatus.generation) === String(control.datasetGeneration);
          // Firestore's evictable cache is not a complete data source. Once the
          // mirror is seeded, cached deliveries contribute only local edits;
          // server-confirmed snapshots reconcile the authoritative records.
          const cachedInputs = completeMirror ? inputs.filter(input => input.pending) : inputs;
          await upsertLocalRecords(collectionName, cachedInputs, {
            pending: { hasPendingWrites, count: hasPendingWrites ? 1 : 0 },
          });
          const localStatus = await getLocalSyncStatus(collectionName);
          if (localStatus.seedComplete && String(localStatus.generation) === String(control.datasetGeneration)) {
            ready.add(collectionName);
          }
          notify();
        }).catch(handleError);
        notify();
        return;
      }

      cached.delete(collectionName);
      const firstServerDelivery = !serverDelivered.has(collectionName);
      const readReason = reconnectPending.delete(collectionName)
        ? 'reconnect'
        : firstServerDelivery ? 'initial' : 'incremental';
      recordFirestoreRead({
        collection: collectionName,
        source: firstServerDelivery ? 'bootstrap' : 'listener',
        reason: readReason,
        documents: readReason === 'initial' ? result.docs.length : result.docChanges().filter(change => change.type !== 'removed').length,
      });
      serverDelivered.add(collectionName);
      const checkpoint = checkpointFromDocuments(result.docs);
      void queuePersistence(collectionName, run, async () => {
        const localStatus = await getLocalSyncStatus(collectionName);
        const rejectedIds = new Set(
          Array.isArray(localStatus.pending.rejectedRecordIds)
            ? localStatus.pending.rejectedRecordIds.map(String)
            : [],
        );
        let recoveryRecords: unknown[] = [];
        if (rejectedIds.size > 0) {
          const protectedRecords = await queryLocalRecords(collectionName, {
            includeDeleted: true,
            filter: record => rejectedIds.has(record.id),
          });
          // Preserve rejected edits for recovery separately; operational totals
          // must keep following the authoritative server after a rejection.
          recoveryRecords = protectedRecords.filter(record => record.pending);
        }
        await replaceLocalCollection(collectionName, inputs, {
          seedComplete: true,
          generation: control.datasetGeneration,
          checkpoint: checkpoint || undefined,
          pending: {
            hasPendingWrites, count: hasPendingWrites ? 1 : 0, lastConfirmedAt: new Date().toISOString(),
            ...(recoveryRecords.length ? { recoveryRecords: [
              ...(Array.isArray(localStatus.pending.recoveryRecords) ? localStatus.pending.recoveryRecords : []),
              ...recoveryRecords,
            ] } : {}),
          },
        });
        if (run !== lifecycle) return;
        ready.add(collectionName);
        notify();
      }).catch(handleError);
    },
    handleError,
  );
  activeUnsubscribers.set(collectionName, unsubscribe);
}

function firestoreCursor(value: LocalMirrorCheckpointValue) {
  const parts = timestampParts(value);
  return parts ? new Timestamp(parts.seconds, parts.nanoseconds) : new Timestamp(0, 0);
}

const EMPTY_CHECKPOINT: LocalMirrorCheckpoint = {
  syncUpdatedAt: { seconds: 0, nanoseconds: 0 },
  documentId: '',
};

async function getBootstrapHighWater(collectionName: string) {
  const result = await getDocsFromServer(query(
    collection(db, collectionName),
    orderBy('syncUpdatedAt', 'desc'),
    orderBy(documentId(), 'desc'),
    limit(1),
  ));
  recordFirestoreRead({
    collection: collectionName,
    source: 'bootstrap',
    reason: 'initial',
    documents: result.size,
  });
  return checkpointFromDocuments(result.docs) || EMPTY_CHECKPOINT;
}

async function bootstrapCollection(collectionName: string, control: SyncControl, run: number) {
  let status = await getLocalSyncStatus(collectionName);
  const unsettledRecords = await queryLocalRecords(collectionName, {
    includeDeleted: true, filter: record => record.pending,
  });
  if (status.pending.lastError || status.pending.hasPendingWrites || unsettledRecords.length > 0) {
    throw new Error(`Pending ${collectionName} changes must synchronize before rebuilding its local mirror.`);
  }
  const sameGeneration = String(status.generation) === String(control.datasetGeneration);
  const resuming = sameGeneration && !status.seedComplete && status.pending.bootstrapInProgress === true;
  // Paging is not a consistent snapshot. The delta listener must catch up from
  // the pre-bootstrap watermark before consumers can treat the seed as ready.
  if (resuming && status.pending.bootstrapPagesComplete === true) return status;
  let cursor = resuming && typeof status.pending.bootstrapCursor === 'string'
    ? status.pending.bootstrapCursor
    : '';
  let highWater = resuming && status.checkpoint ? status.checkpoint : null;
  const bootstrapStartedAt = resuming && typeof status.pending.bootstrapStartedAt === 'string'
    ? status.pending.bootstrapStartedAt
    : new Date().toISOString();

  if (!highWater) highWater = await getBootstrapHighWater(collectionName);
  if (run !== lifecycle) return status;

  if (!resuming) {
    await queuePersistence(collectionName, run, () => setLocalSyncMetadata(collectionName, {
      seedComplete: false,
      generation: control.datasetGeneration,
      checkpoint: highWater,
      pending: {
        bootstrapInProgress: true,
        bootstrapPagesComplete: false,
        bootstrapCursor: null,
        bootstrapStartedAt,
      },
    }));
    cursor = '';
  }

  while (run === lifecycle) {
    const pageQuery = cursor
      ? query(collection(db, collectionName), orderBy(documentId(), 'asc'), startAfter(cursor), limit(BOOTSTRAP_PAGE_SIZE))
      : query(collection(db, collectionName), orderBy(documentId(), 'asc'), limit(BOOTSTRAP_PAGE_SIZE));
    const page = await getDocsFromServer(pageQuery);
    if (run !== lifecycle) return getLocalSyncStatus(collectionName);
    if (page.docs.some(document => document.metadata.hasPendingWrites)) {
      throw new Error(`Pending ${collectionName} changes must synchronize before bootstrap can continue.`);
    }
    recordFirestoreRead({
      collection: collectionName,
      source: 'bootstrap',
      reason: 'initial',
      documents: page.size,
    });

    const complete = page.size < BOOTSTRAP_PAGE_SIZE;
    const nextCursor = page.docs.at(-1)?.id || cursor;
    const commitOptions = {
      seedComplete: false,
      generation: control.datasetGeneration,
      checkpoint: highWater,
      pending: {
        bootstrapInProgress: true,
        bootstrapPagesComplete: complete,
        bootstrapCursor: nextCursor,
        bootstrapStartedAt,
      },
    };

    await queuePersistence(collectionName, run, async () => {
      if (!cursor) await replaceLocalCollection(collectionName, mirrorInputs(page.docs), commitOptions);
      else await upsertLocalRecords(collectionName, mirrorInputs(page.docs), commitOptions);
    });

    if (complete) {
      status = await getLocalSyncStatus(collectionName);
      notify();
      return status;
    }
    cursor = nextCursor;
  }

  return getLocalSyncStatus(collectionName);
}

/** Focused test seam for lossless checkpoint and interrupted-bootstrap behavior. */
export const __offlineCacheInternals = {
  compareCheckpoint,
  checkpointFromDocuments,
  startLegacyListener: (collectionName: string, control: SyncControl) => startLegacyListener(collectionName, control, lifecycle),
  bootstrapCollection: (collectionName: string, control: SyncControl) => (
    bootstrapCollection(collectionName, control, lifecycle)
  ),
  bootstrapPageSize: BOOTSTRAP_PAGE_SIZE,
  startIncrementalListener: (collectionName: string, control: SyncControl) => (
    startIncrementalListener(collectionName, control, lifecycle)
  ),
  waitForPersistence,
};

async function startIncrementalListener(collectionName: string, control: SyncControl, run: number) {
  const epoch = (incrementalEpochs.get(collectionName) || 0) + 1;
  incrementalEpochs.set(collectionName, epoch);
  const isCurrent = () => run === lifecycle && incrementalEpochs.get(collectionName) === epoch;
  let status = await markReadyFromLocal(collectionName, control.datasetGeneration);
  if (!isCurrent()) return;
  if (!status.seedComplete || String(status.generation) !== String(control.datasetGeneration)) {
    status = await bootstrapCollection(collectionName, control, run);
    if (!isCurrent()) return;
    if ((!status.seedComplete && status.pending.bootstrapPagesComplete !== true)
      || String(status.generation) !== String(control.datasetGeneration)) {
      throw new Error(`Initial synchronization for ${collectionName} did not complete.`);
    }
  }

  const checkpoint = status.checkpoint || EMPTY_CHECKPOINT;
  const deltaQuery = query(
    collection(db, collectionName),
    orderBy('syncUpdatedAt', 'asc'),
    orderBy(documentId(), 'asc'),
    // Overlap the timestamp boundary: a later delivery with the same timestamp
    // and a lower ID must not fall behind a strict (timestamp, ID) cursor.
    startAt(firestoreCursor(checkpoint.syncUpdatedAt)),
  );
  let confirmed = false;
  let deliveryFailed = false;
  let reconnectScheduled = false;
  const retry = (error: unknown) => {
    if (!isCurrent()) return;
    deliveryFailed = true;
    activeUnsubscribers.get(collectionName)?.();
    activeUnsubscribers.delete(collectionName);
    lastError = `Incremental sync for ${collectionName} needs retry: ${error instanceof Error ? error.message : error}`;
    scheduleIncrementalRestart(collectionName, control, run, 30_000);
    notify();
  };
  const unsubscribe = onSnapshot(
    deltaQuery,
    { includeMetadataChanges: true },
    result => {
      if (!isCurrent() || deliveryFailed) return;
      const changes = result.docChanges({ includeMetadataChanges: true });
      const firstConfirmation = !confirmed && !result.metadata.fromCache;
      // A cached record may have no data change when confirmed by the server.
      // Persist the whole bounded result on the first authoritative delivery.
      let changedDocuments = firstConfirmation ? result.docs : changes
        .filter(change => change.type !== 'removed')
        .map(change => change.doc);
      if (result.metadata.fromCache) {
        changedDocuments = changedDocuments.filter(document => document.metadata.hasPendingWrites);
      }
      const removedIds = changes.filter(change => change.type === 'removed').map(change => change.doc.id);
      const hasPendingWrites = result.metadata.hasPendingWrites || result.docs.some(document => document.metadata.hasPendingWrites);
      if (hasPendingWrites) pending.add(collectionName);
      else pending.delete(collectionName);
      if (result.metadata.fromCache) {
        cached.add(collectionName);
        if (confirmed && !reconnectScheduled) {
          reconnectScheduled = true;
          scheduleIncrementalRestart(collectionName, control, run);
        }
      }
      else {
        cached.delete(collectionName);
        const firstServerDelivery = !serverDelivered.has(collectionName);
        const readReason = reconnectPending.delete(collectionName)
          ? 'reconnect'
          : firstServerDelivery ? 'initial' : 'incremental';
        recordFirestoreRead({
          collection: collectionName,
          source: 'listener',
          reason: readReason,
          documents: readReason === 'initial' ? result.docs.length : changedDocuments.length,
        });
        serverDelivered.add(collectionName);
        confirmed = true;
      }

      const nextCheckpoint = result.metadata.fromCache || hasPendingWrites
        ? undefined
        : checkpointFromDocuments(result.docs) || undefined;
      void queuePersistence(collectionName, run, async () => {
        // After any failed commit, later snapshots from this attachment cannot
        // advance past the missing records. Reattach and replay from disk.
        if (deliveryFailed) return;
        try {
        const currentStatus = await getLocalSyncStatus(collectionName);
        const unresolvedIds = new Set<string>([
          ...(Array.isArray(currentStatus.pending.reconcileRecordIds)
            ? currentStatus.pending.reconcileRecordIds.map(String) : []),
          ...removedIds,
        ]);
        const inputs = mirrorInputs(changedDocuments);
        const recoveryRecords: unknown[] = [];
        // Remember removals before a network read; interruption must not forget
        // a rejected edit that has reverted to a revision before our cursor.
        if (unresolvedIds.size) {
          await setLocalSyncMetadata(collectionName, {
            pending: { reconcileRecordIds: [...unresolvedIds] },
          });
        }
        if (!result.metadata.fromCache) {
          for (const id of unresolvedIds) {
            const authoritative = await getDocFromServer(doc(db, collectionName, id));
            if (run !== lifecycle) return;
            if (authoritative.metadata.hasPendingWrites) {
              throw new Error(`Pending ${collectionName}/${id} must be acknowledged before reconciliation.`);
            }
            recordFirestoreRead({ collection: collectionName, source: 'listener', reason: 'incremental', documents: 1 });
            const local = await queryLocalRecords(collectionName, { includeDeleted: true, filter: record => record.id === id });
            if (local[0]?.pending || !authoritative.exists()) recoveryRecords.push(...local);
            if (authoritative.exists()) {
              const data = authoritative.data();
              inputs.push({ id, data, pending: false, deleted: data.deleted === true,
                syncUpdatedAt: timestampParts(data.syncUpdatedAt) || undefined });
            } else if (local[0]) {
              // Preserve the rejected entry for recovery, but never count a
              // server-confirmed nonexistent sale in operational totals.
              inputs.push({ id, data: local[0].data, deleted: true, pending: false });
            }
          }
        }
        const safeCheckpoint = nextCheckpoint && currentStatus.checkpoint
          && compareCheckpoint(nextCheckpoint, currentStatus.checkpoint) < 0
          ? currentStatus.checkpoint
          : nextCheckpoint;
        const caughtUp = !result.metadata.fromCache && !hasPendingWrites;
        await upsertLocalRecords(collectionName, inputs, {
          checkpoint: safeCheckpoint,
          ...(caughtUp ? { seedComplete: true, generation: control.datasetGeneration } : {}),
          pending: {
            hasPendingWrites,
            count: hasPendingWrites ? 1 : 0,
            ...(result.metadata.fromCache ? {} : { lastConfirmedAt: new Date().toISOString() }),
            ...(caughtUp ? { bootstrapInProgress: false, bootstrapPagesComplete: false,
              bootstrapCursor: null, bootstrapCompletedAt: new Date().toISOString() } : {}),
            ...(!result.metadata.fromCache ? { reconcileRecordIds: [] } : {}),
            ...(recoveryRecords.length ? { recoveryRecords: [
              ...(Array.isArray(currentStatus.pending.recoveryRecords) ? currentStatus.pending.recoveryRecords : []),
              ...recoveryRecords,
            ] } : {}),
          },
        });
        if (run !== lifecycle) return;
        if (caughtUp) ready.add(collectionName);
        if (caughtUp && lastError.startsWith(`Incremental sync for ${collectionName} needs retry:`)) lastError = '';
        notify();
        // Bound the lifetime of an incremental query, not its results. Never
        // limit the query itself: that could silently omit changed documents.
        if (isCurrent() && caughtUp && result.size >= BOOTSTRAP_PAGE_SIZE
          && safeCheckpoint && compareCheckpoint(safeCheckpoint, checkpoint) > 0) {
          scheduleIncrementalRestart(collectionName, control, run);
        }
        } catch (error) {
          deliveryFailed = true;
          throw error;
        }
      }).catch(retry);
    },
    retry,
  );
  activeUnsubscribers.set(collectionName, unsubscribe);
  notify();
}

function scheduleIncrementalRestart(collectionName: string, control: SyncControl, run: number, delay = 1_000) {
  if (run !== lifecycle || incrementalRestarts.has(collectionName)) return;
  incrementalRestarts.set(collectionName, setTimeout(() => {
    incrementalRestarts.delete(collectionName);
    if (run !== lifecycle) return;
    activeUnsubscribers.get(collectionName)?.();
    activeUnsubscribers.delete(collectionName);
    incrementalEpochs.set(collectionName, (incrementalEpochs.get(collectionName) || 0) + 1);
    reconnectPending.add(collectionName);
    // startIncrementalListener waits for already queued transactions before
    // reading the checkpoint. Late callbacks from the old listener are ignored.
    void startIncrementalListener(collectionName, control, run).catch(error => {
      if (run !== lifecycle) return;
      handleError(error);
      scheduleIncrementalRestart(collectionName, control, run, 30_000);
    });
  }, delay));
}

function handleError(error: unknown) {
  lastError = error instanceof Error ? error.message : 'Could not synchronize offline data.';
  notify();
}

async function restartForControl(control: SyncControl) {
  const run = ++lifecycle;
  readinessAuditRun = run;
  stopCollectionListeners();
  ready.clear();
  lastError = '';
  mode = shouldUseIncrementalMirror(control) ? 'incremental' : 'legacy';
  notify();

  for (const collectionName of activeCollections) {
    if (run !== lifecycle) return;
    try {
      if (mode === 'incremental') await startIncrementalListener(collectionName, control, run);
      else {
        await markReadyFromLocal(collectionName, control.datasetGeneration);
        if (run !== lifecycle) return;
        startLegacyListener(collectionName, control, run);
      }
    } catch (error) {
      handleError(error);
      if (run === lifecycle && mode === 'incremental') scheduleIncrementalRestart(collectionName, control, run, 30_000);
    }
  }
  if (run === lifecycle) readinessAuditRun = null;
  notify();
}

export function startFullOfflineCache(role?: string | null) {
  const resolvedRole = role || getActiveAuthSession()?.profile.role || localStorage.getItem('alfateh.cachedUserRole') || '';
  if (!resolvedRole) return;
  const authenticatedUid = `${getActiveAuthSession()?.profile.uid || ''}:${auth.currentUser?.uid || ''}`;
  if (activeRole === resolvedRole && activeCollections.length > 0 && activeAuthUid === authenticatedUid) return;
  if (activeCollections.length > 0) {
    lifecycle += 1;
    stopCollectionListeners();
    controlUnsubscribe?.();
    controlUnsubscribe = null;
    stopSyncControlListener();
    ready.clear();
  }
  activeRole = resolvedRole;
  activeAuthUid = authenticatedUid;
  startRejectedWriteListener();
  activeCollections = getOfflineCollectionsForRole(resolvedRole);
  registeredReadyState = null;
  readinessAuditRun = null;
  if (!lanUnsubscribe) {
    lanUnsubscribe = subscribeLanStatus(status => {
      if (lastOnline === false && status.online) activeCollections.forEach(name => {
        reconnectPending.add(name);
        if (mode === 'incremental') scheduleIncrementalRestart(name, getSyncControl(), lifecycle);
      });
      lastOnline = status.online;
    });
  }
  startSyncControlListener(handleError, resolvedRole);
  controlUnsubscribe?.();
  controlUnsubscribe = subscribeSyncControl(value => { void restartForControl(value); });
}

export function stopFullOfflineCache() {
  lifecycle += 1;
  stopCollectionListeners();
  controlUnsubscribe?.();
  controlUnsubscribe = null;
  stopSyncControlListener();
  lanUnsubscribe?.();
  lanUnsubscribe = null;
  lastOnline = null;
  activeRole = '';
  activeAuthUid = '';
  activeCollections = [];
  ready.clear();
  cached.clear();
  pending.clear();
  rejected.clear();
  registeredReadyState = null;
  readinessAuditRun = null;
  mode = 'legacy';
  if (rejectionListener && typeof window !== 'undefined') {
    window.removeEventListener('alfateh:firestore-write-rejected', rejectionListener);
    rejectionListener = null;
  }
  notify();
}

export function subscribeOfflineCache(listener: (status: OfflineCacheStatus) => void) {
  listeners.add(listener);
  listener(snapshot());
  return () => { listeners.delete(listener); };
}

export function getOfflineCacheStatus() {
  return snapshot();
}

export async function markDatasetGeneration(generation: number) {
  if (activeRole) setOfflineMirrorReadiness(activeRole, false, generation);
  await Promise.all(activeCollections.map(collectionName => setLocalSyncMetadata(collectionName, {
    seedComplete: false,
    generation,
    checkpoint: null,
  })));
  await restartForControl({ ...getSyncControl(), datasetGeneration: generation });
}
