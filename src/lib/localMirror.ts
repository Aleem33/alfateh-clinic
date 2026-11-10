export type LocalMirrorCheckpointValue =
  | string
  | number
  | Date
  | { seconds: number; nanoseconds: number };

export type LocalMirrorCheckpoint = {
  syncUpdatedAt: LocalMirrorCheckpointValue;
  documentId: string;
};

export type LocalMirrorPendingMetadata = {
  hasPendingWrites: boolean;
  count: number;
  operationIds?: string[];
  lastQueuedAt?: string;
  lastConfirmedAt?: string;
  lastError?: string;
  [key: string]: unknown;
};

export type LocalMirrorDocument<T = Record<string, unknown>> = {
  collection: string;
  id: string;
  data: T;
  deleted: boolean;
  syncUpdatedAt?: LocalMirrorCheckpointValue;
  pending: boolean;
  storedAt: number;
};

export type LocalMirrorRecordInput<T = Record<string, unknown>> = {
  id: string;
  data: T;
  deleted?: boolean;
  syncUpdatedAt?: LocalMirrorCheckpointValue;
  pending?: boolean;
};

export type LocalMirrorCommitOptions = {
  checkpoint?: LocalMirrorCheckpoint | null;
  seedComplete?: boolean;
  generation?: string | number | null;
  pending?: Partial<LocalMirrorPendingMetadata> | null;
};

export type LocalMirrorCollectionMetadata = {
  collection: string;
  seedComplete: boolean;
  checkpoint: LocalMirrorCheckpoint | null;
  generation: string | number | null;
  pending: LocalMirrorPendingMetadata;
  updatedAt: number;
};

export type LocalMirrorCollectionStatus = LocalMirrorCollectionMetadata & {
  ready: boolean;
  totalRecords: number;
  activeRecords: number;
  deletedRecords: number;
};

export type LocalMirrorQueryOptions<T = Record<string, unknown>> = {
  includeDeleted?: boolean;
  filter?: (document: LocalMirrorDocument<T>) => boolean;
  sort?: (left: LocalMirrorDocument<T>, right: LocalMirrorDocument<T>) => number;
  limit?: number;
};

export type LocalMirrorUnsubscribe = () => void;

const DB_NAME = 'alfateh-local-mirror';
const DB_VERSION = 1;
const RECORD_STORE = 'records';
const META_STORE = 'collectionMeta';
const COLLECTION_INDEX = 'byCollection';

type StoredLocalMirrorDocument = LocalMirrorDocument<any>;
type CollectionListener = {
  options: LocalMirrorQueryOptions<any>;
  listener: (documents: LocalMirrorDocument<any>[]) => void;
  error?: (error: Error) => void;
  lastRevision: number;
  active: boolean;
};
type StatusListener = {
  listener: (status: LocalMirrorCollectionStatus) => void;
  error?: (error: Error) => void;
  lastRevision: number;
  active: boolean;
};
type SnapshotListener = {
  listener: (snapshot: { status: LocalMirrorCollectionStatus; records: LocalMirrorDocument<any>[] }) => void;
  options: LocalMirrorQueryOptions<any>;
  error?: (error: Error) => void;
  lastRevision: number;
  active: boolean;
};

const collectionListeners = new Map<string, Set<CollectionListener>>();
const statusListeners = new Map<string, Set<StatusListener>>();
const snapshotListeners = new Map<string, Set<SnapshotListener>>();
const collectionRevisions = new Map<string, number>();
const activeConnections = new Set<IDBDatabase>();
// Only concurrent reads are shared; records are not retained after delivery.
// Each successful record commit invalidates lightweight cached counts.
const recordRevisions = new Map<string, number>();
const recordCounts = new Map<string, { revision: number; total: number; deleted: number }>();
const snapshotReads = new Map<string, { revision: number; promise: Promise<{ status: LocalMirrorCollectionStatus; records: StoredLocalMirrorDocument[] }> }>();

function assertCollectionName(collectionName: string) {
  if (!collectionName || !collectionName.trim()) {
    throw new Error('A non-empty collection name is required.');
  }
}

function assertRecordId(id: string) {
  if (!id || !id.trim()) throw new Error('A non-empty document ID is required.');
}

function normalizeError(error: unknown, fallback: string) {
  if (error instanceof Error) return error;
  return new Error(typeof error === 'string' ? error : fallback);
}

function closeDatabase(database: IDBDatabase) {
  activeConnections.delete(database);
  database.close();
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB is not available in this environment.'));
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(RECORD_STORE)) {
        const records = database.createObjectStore(RECORD_STORE, { keyPath: ['collection', 'id'] });
        records.createIndex(COLLECTION_INDEX, 'collection', { unique: false });
      }
      if (!database.objectStoreNames.contains(META_STORE)) {
        database.createObjectStore(META_STORE, { keyPath: 'collection' });
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      activeConnections.add(database);
      database.onversionchange = () => closeDatabase(database);
      resolve(database);
    };
    request.onerror = () => reject(request.error || new Error('Could not open the local data mirror.'));
    request.onblocked = () => reject(new Error('Opening the local data mirror was blocked.'));
  });
}

function defaultPendingMetadata(): LocalMirrorPendingMetadata {
  return { hasPendingWrites: false, count: 0 };
}

function defaultCollectionMetadata(collectionName: string): LocalMirrorCollectionMetadata {
  return {
    collection: collectionName,
    seedComplete: false,
    checkpoint: null,
    generation: null,
    pending: defaultPendingMetadata(),
    updatedAt: 0,
  };
}

function mergeMetadata(
  current: LocalMirrorCollectionMetadata | undefined,
  collectionName: string,
  options: LocalMirrorCommitOptions,
): LocalMirrorCollectionMetadata {
  const base = current || defaultCollectionMetadata(collectionName);
  const pending = options.pending === null
    ? defaultPendingMetadata()
    : options.pending === undefined
      ? base.pending
      : { ...base.pending, ...options.pending };

  return {
    ...base,
    collection: collectionName,
    ...(options.seedComplete === undefined ? {} : { seedComplete: options.seedComplete }),
    ...(options.checkpoint === undefined ? {} : { checkpoint: options.checkpoint }),
    ...(options.generation === undefined ? {} : { generation: options.generation }),
    pending: {
      ...pending,
      hasPendingWrites: Boolean(pending.hasPendingWrites),
      count: Math.max(0, Number(pending.count) || 0),
    },
    updatedAt: Date.now(),
  };
}

function normalizeRecord<T>(
  collectionName: string,
  record: LocalMirrorRecordInput<T>,
): LocalMirrorDocument<T> {
  assertRecordId(record.id);
  const data = record.data as any;
  return {
    collection: collectionName,
    id: record.id,
    data: record.data,
    deleted: record.deleted ?? Boolean(data && typeof data === 'object' && data.deleted === true),
    ...(record.syncUpdatedAt === undefined ? {} : { syncUpdatedAt: record.syncUpdatedAt }),
    pending: Boolean(record.pending),
    storedAt: Date.now(),
  };
}

async function writeCollectionTransaction<T>(
  collectionName: string,
  records: LocalMirrorRecordInput<T>[],
  options: LocalMirrorCommitOptions,
  replace: boolean,
) {
  assertCollectionName(collectionName);
  const normalized = records.map(record => normalizeRecord(collectionName, record));
  const database = await openDatabase();

  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction([RECORD_STORE, META_STORE], 'readwrite', { durability: 'strict' });
    const recordStore = transaction.objectStore(RECORD_STORE);
    const metadataStore = transaction.objectStore(META_STORE);
    let failure: Error | null = null;

    const abort = (error: unknown) => {
      failure = normalizeError(error, `Could not update the local ${collectionName} mirror.`);
      try {
        transaction.abort();
      } catch {
        closeDatabase(database);
        reject(failure);
      }
    };

    const putRecords = () => {
      try {
        normalized.forEach(record => recordStore.put(record));
      } catch (error) {
        abort(error);
      }
    };

    try {
      const metadataRequest = metadataStore.get(collectionName);
      metadataRequest.onsuccess = () => {
        try {
          metadataStore.put(mergeMetadata(metadataRequest.result, collectionName, options));
        } catch (error) {
          abort(error);
        }
      };

      if (replace) {
        const cursorRequest = recordStore.index(COLLECTION_INDEX).openCursor(IDBKeyRange.only(collectionName));
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
            return;
          }
          putRecords();
        };
      } else {
        putRecords();
      }
    } catch (error) {
      abort(error);
    }

    transaction.oncomplete = () => {
      closeDatabase(database);
      if (replace || normalized.length > 0) {
        recordRevisions.set(collectionName, (recordRevisions.get(collectionName) || 0) + 1);
        recordCounts.delete(collectionName);
      }
      notifyCollectionChanged(collectionName);
      resolve();
    };
    transaction.onabort = () => {
      closeDatabase(database);
      reject(failure || transaction.error || new Error(`Could not update the local ${collectionName} mirror.`));
    };
    transaction.onerror = () => {
      failure ||= transaction.error || new Error(`Could not update the local ${collectionName} mirror.`);
    };
  });
}

/**
 * Atomically persists a page of documents and its new cloud checkpoint.
 * A failed record write also rolls back the checkpoint.
 */
export function upsertLocalRecords<T = Record<string, unknown>>(
  collectionName: string,
  records: LocalMirrorRecordInput<T>[],
  options: LocalMirrorCommitOptions = {},
) {
  return writeCollectionTransaction(collectionName, records, options, false);
}

/** Atomically replaces one locally mirrored collection and its synchronization metadata. */
export function replaceLocalCollection<T = Record<string, unknown>>(
  collectionName: string,
  records: LocalMirrorRecordInput<T>[],
  options: LocalMirrorCommitOptions = {},
) {
  return writeCollectionTransaction(collectionName, records, options, true);
}

export function setLocalSyncMetadata(
  collectionName: string,
  options: LocalMirrorCommitOptions,
) {
  return writeCollectionTransaction(collectionName, [], options, false);
}

function applyQueryOptions<T>(
  records: LocalMirrorDocument<T>[],
  options: LocalMirrorQueryOptions<T>,
) {
  let result = options.includeDeleted ? records : records.filter(record => !record.deleted);
  if (options.filter) result = result.filter(options.filter);
  if (options.sort) result = [...result].sort(options.sort);
  if (options.limit !== undefined) result = result.slice(0, Math.max(0, options.limit));
  return result;
}

export async function queryLocalRecords<T = Record<string, unknown>>(
  collectionName: string,
  options: LocalMirrorQueryOptions<T> = {},
): Promise<LocalMirrorDocument<T>[]> {
  return (await readLocalCollectionSnapshot<T>(collectionName, options)).records;
}

export async function getLocalRecord<T = Record<string, unknown>>(
  collectionName: string,
  id: string,
  options: { includeDeleted?: boolean } = {},
): Promise<LocalMirrorDocument<T> | null> {
  assertCollectionName(collectionName);
  assertRecordId(id);
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(RECORD_STORE, 'readonly');
    const request = transaction.objectStore(RECORD_STORE).get([collectionName, id]);
    let result: LocalMirrorDocument<T> | undefined;
    request.onsuccess = () => { result = request.result; };
    transaction.oncomplete = () => {
      closeDatabase(database);
      resolve(result && (options.includeDeleted || !result.deleted) ? result : null);
    };
    transaction.onerror = () => {
      const error = transaction.error || request.error || new Error(`Could not read local document ${id}.`);
      closeDatabase(database);
      reject(error);
    };
    transaction.onabort = transaction.onerror;
  });
}

export async function softDeleteLocalRecord(
  collectionName: string,
  id: string,
  tombstone: Record<string, unknown>,
  options: LocalMirrorCommitOptions = {},
) {
  const current = await getLocalRecord<Record<string, unknown>>(collectionName, id, { includeDeleted: true });
  if (!current) throw new Error(`Cannot archive missing local document ${collectionName}/${id}.`);
  await upsertLocalRecords(collectionName, [{
    id,
    data: { ...current.data, ...tombstone, deleted: true },
    deleted: true,
    syncUpdatedAt: current.syncUpdatedAt,
    pending: current.pending,
  }], options);
}

export async function readLocalCollectionSnapshot<T = Record<string, unknown>>(
  collectionName: string,
  options: LocalMirrorQueryOptions<T> = {},
): Promise<{ status: LocalMirrorCollectionStatus; records: LocalMirrorDocument<T>[] }> {
  assertCollectionName(collectionName);
  const revision = collectionRevisions.get(collectionName) || 0;
  let read = snapshotReads.get(collectionName);
  if (!read || read.revision !== revision) {
    read = { revision, promise: readRawCollectionSnapshot(collectionName) };
    snapshotReads.set(collectionName, read);
    const current = read;
    const clear = () => { if (snapshotReads.get(collectionName) === current) snapshotReads.delete(collectionName); };
    void read.promise.then(clear, clear);
  }
  const result = await read.promise;
  // A separate array prevents a consumer's in-place sort from corrupting
  // another subscriber. Repository consumers materialize their own records.
  return { status: result.status, records: [...applyQueryOptions(result.records, options)] };
}

async function readRawCollectionSnapshot(collectionName: string): Promise<{ status: LocalMirrorCollectionStatus; records: StoredLocalMirrorDocument[] }> {
  const recordRevision = recordRevisions.get(collectionName) || 0;
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([RECORD_STORE, META_STORE], 'readonly');
    const recordsRequest = transaction.objectStore(RECORD_STORE)
      .index(COLLECTION_INDEX)
      .getAll(IDBKeyRange.only(collectionName));
    const metadataRequest = transaction.objectStore(META_STORE).get(collectionName);
    let records: StoredLocalMirrorDocument[] = [];
    let metadata: LocalMirrorCollectionMetadata | undefined;
    recordsRequest.onsuccess = () => { records = recordsRequest.result; };
    metadataRequest.onsuccess = () => { metadata = metadataRequest.result; };
    transaction.oncomplete = () => {
      closeDatabase(database);
      const resolved = metadata || defaultCollectionMetadata(collectionName);
      const deletedRecords = records.filter(record => record.deleted).length;
      if ((recordRevisions.get(collectionName) || 0) === recordRevision) {
        recordCounts.set(collectionName, { revision: recordRevision, total: records.length, deleted: deletedRecords });
      }
      resolve({ records, status: {
        ...resolved,
        ready: resolved.seedComplete,
        totalRecords: records.length,
        activeRecords: records.length - deletedRecords,
        deletedRecords,
      } });
    };
    transaction.onerror = () => {
      const error = transaction.error || new Error(`Could not read local sync status for ${collectionName}.`);
      closeDatabase(database);
      reject(error);
    };
    transaction.onabort = transaction.onerror;
  });
}

export async function getLocalSyncStatus(collectionName: string) {
  assertCollectionName(collectionName);
  const counts = recordCounts.get(collectionName);
  if (!counts || counts.revision !== (recordRevisions.get(collectionName) || 0)) {
    return (await readLocalCollectionSnapshot(collectionName)).status;
  }
  const database = await openDatabase();
  return new Promise<LocalMirrorCollectionStatus>((resolve, reject) => {
    const transaction = database.transaction(META_STORE, 'readonly');
    const request = transaction.objectStore(META_STORE).get(collectionName);
    let metadata: LocalMirrorCollectionMetadata | undefined;
    request.onsuccess = () => { metadata = request.result; };
    transaction.oncomplete = () => {
      closeDatabase(database);
      // A concurrent record commit invalidates these counts. Re-read rather
      // than combine old counts with a new readiness/generation checkpoint.
      if (recordCounts.get(collectionName) !== counts) {
        void getLocalSyncStatus(collectionName).then(resolve, reject);
        return;
      }
      const resolved = metadata || defaultCollectionMetadata(collectionName);
      resolve({ ...resolved, ready: resolved.seedComplete, totalRecords: counts.total,
        activeRecords: counts.total - counts.deleted, deletedRecords: counts.deleted });
    };
    transaction.onerror = () => { closeDatabase(database); reject(transaction.error || new Error(`Could not read ${collectionName} status.`)); };
    transaction.onabort = transaction.onerror;
  });
}

function nextRevision(collectionName: string) {
  const revision = (collectionRevisions.get(collectionName) || 0) + 1;
  collectionRevisions.set(collectionName, revision);
  return revision;
}

async function deliverCollectionListener(collectionName: string, subscription: CollectionListener, revision: number) {
  try {
    const documents = await queryLocalRecords(collectionName, subscription.options);
    if (!subscription.active || revision < subscription.lastRevision) return;
    subscription.lastRevision = revision;
    subscription.listener(documents);
  } catch (error) {
    if (subscription.active) subscription.error?.(normalizeError(error, `Could not subscribe to ${collectionName}.`));
  }
}

async function deliverStatusListener(collectionName: string, subscription: StatusListener, revision: number) {
  try {
    const status = await getLocalSyncStatus(collectionName);
    if (!subscription.active || revision < subscription.lastRevision) return;
    subscription.lastRevision = revision;
    subscription.listener(status);
  } catch (error) {
    if (subscription.active) subscription.error?.(normalizeError(error, `Could not subscribe to ${collectionName} status.`));
  }
}

function notifyCollectionChanged(collectionName: string) {
  const revision = nextRevision(collectionName);
  collectionListeners.get(collectionName)?.forEach(subscription => {
    void deliverCollectionListener(collectionName, subscription, revision);
  });
  statusListeners.get(collectionName)?.forEach(subscription => {
    void deliverStatusListener(collectionName, subscription, revision);
  });
  snapshotListeners.get(collectionName)?.forEach(subscription => {
    void deliverSnapshotListener(collectionName, subscription, revision);
  });
}

async function deliverSnapshotListener(collectionName: string, subscription: SnapshotListener, revision: number) {
  try {
    const snapshot = await readLocalCollectionSnapshot(collectionName, subscription.options);
    if (!subscription.active || revision < subscription.lastRevision) return;
    subscription.lastRevision = revision;
    subscription.listener(snapshot);
  } catch (error) {
    if (subscription.active) subscription.error?.(normalizeError(error, `Could not read ${collectionName}.`));
  }
}

/** Data and completeness metadata are read atomically in the same transaction. */
export function subscribeLocalCollectionSnapshot<T = Record<string, unknown>>(
  collectionName: string,
  listener: (snapshot: { status: LocalMirrorCollectionStatus; records: LocalMirrorDocument<T>[] }) => void,
  options: LocalMirrorQueryOptions<T> = {},
  onError?: (error: Error) => void,
): LocalMirrorUnsubscribe {
  assertCollectionName(collectionName);
  const subscription: SnapshotListener = { listener, options, error: onError, lastRevision: -1, active: true };
  const subscriptions = snapshotListeners.get(collectionName) || new Set<SnapshotListener>();
  subscriptions.add(subscription);
  snapshotListeners.set(collectionName, subscriptions);
  void deliverSnapshotListener(collectionName, subscription, collectionRevisions.get(collectionName) || 0);
  return () => {
    subscription.active = false;
    subscriptions.delete(subscription);
    if (!subscriptions.size) snapshotListeners.delete(collectionName);
  };
}

export function subscribeLocalCollection<T = Record<string, unknown>>(
  collectionName: string,
  listener: (documents: LocalMirrorDocument<T>[]) => void,
  options: LocalMirrorQueryOptions<T> = {},
  onError?: (error: Error) => void,
): LocalMirrorUnsubscribe {
  assertCollectionName(collectionName);
  const subscription: CollectionListener = {
    options,
    listener,
    error: onError,
    lastRevision: -1,
    active: true,
  };
  const subscriptions = collectionListeners.get(collectionName) || new Set<CollectionListener>();
  subscriptions.add(subscription);
  collectionListeners.set(collectionName, subscriptions);
  void deliverCollectionListener(collectionName, subscription, collectionRevisions.get(collectionName) || 0);

  return () => {
    subscription.active = false;
    subscriptions.delete(subscription);
    if (subscriptions.size === 0) collectionListeners.delete(collectionName);
  };
}

export function subscribeLocalSyncStatus(
  collectionName: string,
  listener: (status: LocalMirrorCollectionStatus) => void,
  onError?: (error: Error) => void,
): LocalMirrorUnsubscribe {
  assertCollectionName(collectionName);
  const subscription: StatusListener = {
    listener,
    error: onError,
    lastRevision: -1,
    active: true,
  };
  const subscriptions = statusListeners.get(collectionName) || new Set<StatusListener>();
  subscriptions.add(subscription);
  statusListeners.set(collectionName, subscriptions);
  void deliverStatusListener(collectionName, subscription, collectionRevisions.get(collectionName) || 0);

  return () => {
    subscription.active = false;
    subscriptions.delete(subscription);
    if (subscriptions.size === 0) statusListeners.delete(collectionName);
  };
}

/** Test-only reset. Application code must use generation changes instead of clearing the mirror. */
export async function resetLocalMirrorForTests() {
  collectionListeners.forEach(subscriptions => subscriptions.forEach(subscription => { subscription.active = false; }));
  statusListeners.forEach(subscriptions => subscriptions.forEach(subscription => { subscription.active = false; }));
  snapshotListeners.forEach(subscriptions => subscriptions.forEach(subscription => { subscription.active = false; }));
  collectionListeners.clear();
  statusListeners.clear();
  snapshotListeners.clear();
  collectionRevisions.clear();
  recordRevisions.clear();
  recordCounts.clear();
  snapshotReads.clear();
  [...activeConnections].forEach(closeDatabase);

  if (typeof indexedDB === 'undefined') return;
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error('Could not reset the local data mirror.'));
    request.onblocked = () => reject(new Error('Resetting the local data mirror was blocked.'));
  });
}
