import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => {
  class Timestamp {
    seconds: number;
    nanoseconds: number;

    constructor(seconds: number, nanoseconds: number) {
      this.seconds = seconds;
      this.nanoseconds = nanoseconds;
    }
  }

  return {
    Timestamp,
    getDocsFromServer: vi.fn(),
    getDocFromServer: vi.fn(),
    doc: vi.fn((_database: unknown, name: string, id: string) => ({ name, id })),
    onSnapshot: vi.fn(() => vi.fn()),
    collection: vi.fn((_database: unknown, name: string) => ({ name })),
    documentId: vi.fn(() => '__name__'),
    orderBy: vi.fn((field: string, direction: string) => ({ type: 'orderBy', field, direction })),
    limit: vi.fn((count: number) => ({ type: 'limit', count })),
    startAfter: vi.fn((...values: unknown[]) => ({ type: 'startAfter', values })),
    startAt: vi.fn((...values: unknown[]) => ({ type: 'startAt', values })),
    query: vi.fn((reference: unknown, ...constraints: unknown[]) => ({ reference, constraints })),
  };
});

const diagnostics = vi.hoisted(() => ({ record: vi.fn() }));

vi.mock('@/lib/firestore', () => firestore);
vi.mock('../firebase', () => ({ auth: { currentUser: null }, db: {} }));
vi.mock('./offlineAuth', () => ({ getActiveAuthSession: () => null }));
vi.mock('./offlineDataPolicy', () => ({ getOfflineCollectionsForRole: () => ['sales'] }));
vi.mock('./readDiagnostics', () => ({ recordFirestoreRead: diagnostics.record }));
vi.mock('./syncProtocol', () => ({
  getSyncControl: () => ({
    protocolVersion: 2,
    incrementalEnabled: false,
    rollbackToLegacy: false,
    trackedWritesRequired: false,
    minimumProtocolVersion: 2,
    datasetGeneration: 1,
  }),
  registerSyncClient: vi.fn(),
  shouldUseIncrementalMirror: () => false,
  startSyncControlListener: vi.fn(),
  stopSyncControlListener: vi.fn(),
  subscribeSyncControl: vi.fn(() => vi.fn()),
}));

import { __offlineCacheInternals, stopFullOfflineCache } from './offlineCache';
import { getLocalSyncStatus, queryLocalRecords, resetLocalMirrorForTests, upsertLocalRecords } from './localMirror';
import * as mirror from './localMirror';

const control = {
  protocolVersion: 2,
  incrementalEnabled: true,
  rollbackToLegacy: false,
  trackedWritesRequired: true,
  minimumProtocolVersion: 2,
  datasetGeneration: 7,
};

function document(id: string, data: Record<string, unknown> = {}) {
  return {
    id,
    data: () => data,
    metadata: { hasPendingWrites: false },
  };
}

function result(documents: ReturnType<typeof document>[]) {
  return { docs: documents, size: documents.length };
}

beforeEach(async () => {
  await resetLocalMirrorForTests();
  vi.clearAllMocks();
});

afterEach(async () => {
  stopFullOfflineCache();
  await __offlineCacheInternals.waitForPersistence('sales');
  vi.useRealTimers();
  vi.restoreAllMocks();
  await resetLocalMirrorForTests();
});

describe('incremental mirror bootstrap', () => {
  it('uses document ID as the deterministic tie-breaker for identical timestamps', () => {
    const timestamp = { seconds: 1_788_000_000, nanoseconds: 123 };
    expect(__offlineCacheInternals.compareCheckpoint(
      { syncUpdatedAt: timestamp, documentId: 'sale-a' },
      { syncUpdatedAt: timestamp, documentId: 'sale-b' },
    )).toBeLessThan(0);
    expect(__offlineCacheInternals.compareCheckpoint(
      { syncUpdatedAt: timestamp, documentId: 'Z' },
      { syncUpdatedAt: timestamp, documentId: 'a' },
    )).toBeLessThan(0);
  });

  it('never checkpoints local timestamp estimates while writes are pending', () => {
    const pending = document('pending', { syncUpdatedAt: new firestore.Timestamp(9999, 0) });
    pending.metadata.hasPendingWrites = true;
    expect(__offlineCacheInternals.checkpointFromDocuments([pending] as any)).toBeNull();
  });

  it('retains a rejected edit for recovery without freezing authoritative totals', async () => {
    await upsertLocalRecords('sales', [{ id: 'sale-1', data: { total: 900 }, pending: true }], {
      seedComplete: true, generation: 7,
      pending: { rejectedRecordIds: ['sale-1'], lastError: 'permission denied' },
    });
    __offlineCacheInternals.startLegacyListener('sales', control);
    const onData = (firestore.onSnapshot.mock.calls as any).at(-1)[2];
    const serverRecord = document('sale-1', { total: 100 });
    onData({ ...result([serverRecord]), metadata: { fromCache: false }, docChanges: () => [{ type: 'modified', doc: serverRecord }] });
    await vi.waitFor(async () => {
      expect((await queryLocalRecords('sales'))[0].data.total).toBe(100);
      expect((await getLocalSyncStatus('sales')).pending.recoveryRecords).toEqual([
        expect.objectContaining({ id: 'sale-1', data: { total: 900 } }),
      ]);
    });
  });

  it('does not replace complete history with a partial or stale SDK cache while offline', async () => {
    await upsertLocalRecords('sales', [
      { id: 'sale-1', data: { total: 100 } },
      { id: 'sale-2', data: { total: 200 } },
    ], { seedComplete: true, generation: 7 });
    __offlineCacheInternals.startLegacyListener('sales', control);
    const onData = (firestore.onSnapshot.mock.calls as any).at(-1)[2];
    onData({ ...result([document('sale-1', { total: 1 })]), metadata: { fromCache: true } });
    await vi.waitFor(async () => expect((await getLocalSyncStatus('sales')).pending.hasPendingWrites).toBe(false));
    await new Promise(resolve => setTimeout(resolve, 50));
    expect((await queryLocalRecords('sales')).map(record => record.data.total)).toEqual([100, 200]);
  });

  it('resumes after the last transactionally persisted page without clearing or skipping records', async () => {
    const revision = new firestore.Timestamp(1_788_000_000, 900);
    const firstPage = Array.from(
      { length: __offlineCacheInternals.bootstrapPageSize },
      (_, index) => document(`sale-${String(index).padStart(3, '0')}`, { total: index }),
    );
    firestore.getDocsFromServer
      .mockResolvedValueOnce(result([document('revision-z', { syncUpdatedAt: revision })]))
      .mockResolvedValueOnce(result(firstPage))
      .mockRejectedValueOnce(new Error('connection interrupted'));

    await expect(__offlineCacheInternals.bootstrapCollection('sales', control)).rejects.toThrow('connection interrupted');
    await expect(getLocalSyncStatus('sales')).resolves.toMatchObject({
      seedComplete: false,
      generation: 7,
      totalRecords: 250,
      checkpoint: {
        syncUpdatedAt: { seconds: 1_788_000_000, nanoseconds: 900 },
        documentId: 'revision-z',
      },
      pending: {
        bootstrapInProgress: true,
        bootstrapCursor: 'sale-249',
      },
    });

    firestore.getDocsFromServer.mockResolvedValueOnce(result([
      document('sale-250', { total: 250 }),
      document('sale-251', { total: 251, deleted: true }),
    ]));
    await expect(__offlineCacheInternals.bootstrapCollection('sales', control)).resolves.toMatchObject({
      seedComplete: false,
      pending: { bootstrapInProgress: true, bootstrapPagesComplete: true },
      totalRecords: 252,
      activeRecords: 251,
      deletedRecords: 1,
    });

    const lastQuery = firestore.getDocsFromServer.mock.calls.at(-1)?.[0] as { constraints: Array<{ type: string; values?: unknown[] }> };
    expect(lastQuery.constraints).toContainEqual({ type: 'startAfter', values: ['sale-249'] });
    expect(firestore.getDocsFromServer).toHaveBeenCalledTimes(4);
    expect((await queryLocalRecords('sales', { includeDeleted: true })).map(record => record.id)).toHaveLength(252);
    expect(diagnostics.record).toHaveBeenCalledWith(expect.objectContaining({
      collection: 'sales',
      source: 'bootstrap',
    }));
  });
});

describe('bounded incremental delivery', () => {
  const revision = { seconds: 100, nanoseconds: 2 };
  async function seeded() {
    await upsertLocalRecords('sales', [
      { id: 'historical', data: { total: 50 } },
      { id: 'z', data: { total: 100, syncUpdatedAt: revision } },
    ], { seedComplete: true, generation: 7, checkpoint: { syncUpdatedAt: revision, documentId: 'z' } });
    await __offlineCacheInternals.startIncrementalListener('sales', control);
    return (firestore.onSnapshot.mock.calls as any).at(-1)[2] as (value: unknown) => void;
  }
  function snapshot(docs: ReturnType<typeof document>[], fromCache = false,
    changes = docs.map(doc => ({ type: 'added', doc }))) {
    return { ...result(docs), metadata: { fromCache, hasPendingWrites: docs.some(doc => doc.metadata.hasPendingWrites) },
      docChanges: () => changes };
  }
  async function flush() {
    await __offlineCacheInternals.waitForPersistence('sales');
  }

  it('overlaps equal timestamps and preserves history outside the delta query', async () => {
    const deliver = await seeded();
    const target = (firestore.onSnapshot.mock.calls as any).at(-1)[0];
    expect(target.constraints).toContainEqual({ type: 'startAt', values: [new firestore.Timestamp(100, 2)] });
    expect(target.constraints.some((constraint: any) => constraint.type === 'limit')).toBe(false);
    deliver(snapshot([document('a', { total: 20, syncUpdatedAt: revision })]));
    await flush();
    expect((await queryLocalRecords('sales')).map(record => record.id)).toEqual(['a', 'historical', 'z']);
    expect((await getLocalSyncStatus('sales')).checkpoint?.documentId).toBe('z');
    expect(firestore.getDocsFromServer).not.toHaveBeenCalled();
  });

  it('ignores stale cache data but persists first server docs even without data changes', async () => {
    const deliver = await seeded();
    deliver(snapshot([document('z', { total: 1 })], true));
    await flush();
    expect((await queryLocalRecords('sales')).find(record => record.id === 'z')?.data.total).toBe(100);
    deliver(snapshot([document('z', { total: 200, syncUpdatedAt: revision })], false, []));
    await flush();
    expect((await queryLocalRecords('sales')).find(record => record.id === 'z')?.data.total).toBe(200);
  });

  it('resumes completed paging and only exposes readiness after server catch-up', async () => {
    firestore.getDocsFromServer
      .mockResolvedValueOnce(result([document('z', { syncUpdatedAt: revision })]))
      .mockResolvedValueOnce(result([document('legacy', { total: 20 })]));
    await __offlineCacheInternals.bootstrapCollection('sales', control);
    expect((await getLocalSyncStatus('sales')).seedComplete).toBe(false);
    await __offlineCacheInternals.startIncrementalListener('sales', control);
    expect(firestore.getDocsFromServer).toHaveBeenCalledTimes(2);
    const deliver = (firestore.onSnapshot.mock.calls as any).at(-1)[2];
    deliver(snapshot([], true));
    await flush();
    expect((await getLocalSyncStatus('sales')).seedComplete).toBe(false);
    deliver(snapshot([document('legacy', { total: 30, syncUpdatedAt: { seconds: 101, nanoseconds: 0 } })]));
    await flush();
    expect((await getLocalSyncStatus('sales')).seedComplete).toBe(true);
    expect((await queryLocalRecords('sales'))[0].data.total).toBe(30);
  });

  it('does not advance the checkpoint for pending writes', async () => {
    const deliver = await seeded();
    const pending = document('new', { total: 30, syncUpdatedAt: { seconds: 999, nanoseconds: 0 } });
    pending.metadata.hasPendingWrites = true;
    deliver(snapshot([pending]));
    await flush();
    expect((await getLocalSyncStatus('sales')).checkpoint?.syncUpdatedAt).toEqual(revision);
    expect((await queryLocalRecords('sales')).find(record => record.id === 'new')?.pending).toBe(true);
  });

  it('restores a rejected update that fell before the cursor and retains the attempted edit', async () => {
    const deliver = await seeded();
    await upsertLocalRecords('sales', [{ id: 'z', data: { total: 900 }, pending: true }]);
    firestore.getDocFromServer.mockResolvedValueOnce({ exists: () => true, metadata: { hasPendingWrites: false }, data: () => ({ total: 100 }) });
    deliver(snapshot([], false, [{ type: 'removed', doc: document('z') }]));
    await flush();
    expect((await queryLocalRecords('sales')).find(record => record.id === 'z')?.data.total).toBe(100);
    expect((await getLocalSyncStatus('sales')).pending.recoveryRecords).toEqual([
      expect.objectContaining({ id: 'z', data: { total: 900 } }),
    ]);
    expect(firestore.getDocFromServer).toHaveBeenCalledWith({ name: 'sales', id: 'z' });
  });

  it('retains a rejected create for recovery without counting it as a real sale', async () => {
    const deliver = await seeded();
    await upsertLocalRecords('sales', [{ id: 'rejected', data: { total: 900 }, pending: true }]);
    firestore.getDocFromServer.mockResolvedValueOnce({ exists: () => false, metadata: { hasPendingWrites: false } });
    deliver(snapshot([], false, [{ type: 'removed', doc: document('rejected') }]));
    await flush();
    expect((await queryLocalRecords('sales')).some(record => record.id === 'rejected')).toBe(false);
    expect((await getLocalSyncStatus('sales')).pending.recoveryRecords).toEqual([
      expect.objectContaining({ id: 'rejected', data: { total: 900 } }),
    ]);
  });

  it('does not advance past a failed removal reconciliation or open a full listener', async () => {
    const deliver = await seeded();
    firestore.getDocFromServer.mockRejectedValueOnce(new Error('offline'));
    deliver(snapshot([document('new', { syncUpdatedAt: { seconds: 200, nanoseconds: 0 } })], false,
      [{ type: 'removed', doc: document('z') }]));
    await flush();
    expect((await getLocalSyncStatus('sales')).checkpoint?.syncUpdatedAt).toEqual(revision);
    expect((await getLocalSyncStatus('sales')).pending.reconcileRecordIds).toEqual(['z']);
    expect(firestore.onSnapshot).toHaveBeenCalledTimes(1);
    expect(firestore.getDocsFromServer).not.toHaveBeenCalled();
  });

  it('rebases reconnects from the persisted cursor and ignores retired callbacks', async () => {
    const deliver = await seeded();
    const newer = { seconds: 200, nanoseconds: 0 };
    deliver(snapshot([document('new', { total: 300, syncUpdatedAt: newer })]));
    await flush();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    deliver(snapshot([], true));
    await flush();
    await vi.advanceTimersByTimeAsync(1_000);
    vi.useRealTimers();
    await vi.waitFor(() => expect(firestore.onSnapshot).toHaveBeenCalledTimes(2));
    const target = (firestore.onSnapshot.mock.calls as any).at(-1)[0];
    expect(target.constraints).toContainEqual({ type: 'startAt', values: [new firestore.Timestamp(200, 0)] });
    deliver(snapshot([document('new', { total: 1 })]));
    await flush();
    expect((await queryLocalRecords('sales')).find(record => record.id === 'new')?.data.total).toBe(300);
    expect(firestore.getDocsFromServer).not.toHaveBeenCalled();
  });

  it('retries a removed record after restart even if it is absent from later query changes', async () => {
    const deliver = await seeded();
    firestore.getDocFromServer.mockRejectedValueOnce(new Error('offline'));
    deliver(snapshot([], false, [{ type: 'removed', doc: document('z') }]));
    await flush();
    stopFullOfflineCache();
    await __offlineCacheInternals.startIncrementalListener('sales', control);
    firestore.getDocFromServer.mockResolvedValueOnce({ exists: () => true,
      metadata: { hasPendingWrites: false }, data: () => ({ total: 10 }) });
    const afterRestart = (firestore.onSnapshot.mock.calls as any).at(-1)[2];
    afterRestart(snapshot([], false, []));
    await flush();
    expect((await queryLocalRecords('sales')).find(record => record.id === 'z')?.data.total).toBe(10);
    expect((await getLocalSyncStatus('sales')).pending.reconcileRecordIds).toEqual([]);
    expect(firestore.getDocsFromServer).not.toHaveBeenCalled();
  });

  it('does not treat a pending server-source read as an authoritative rejection', async () => {
    const deliver = await seeded();
    firestore.getDocFromServer.mockResolvedValueOnce({ exists: () => true,
      metadata: { hasPendingWrites: true }, data: () => ({ total: 999 }) });
    deliver(snapshot([], false, [{ type: 'removed', doc: document('z') }]));
    await flush();
    expect((await queryLocalRecords('sales')).find(record => record.id === 'z')?.data.total).toBe(100);
    expect((await getLocalSyncStatus('sales')).pending.reconcileRecordIds).toEqual(['z']);
  });

  it('rotates a busy listener without limiting results or repeating the equal-time boundary forever', async () => {
    const deliver = await seeded();
    const nextRevision = { seconds: 300, nanoseconds: 0 };
    const docs = Array.from({ length: 250 }, (_, index) => document(`new-${index}`, { syncUpdatedAt: nextRevision }));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    deliver(snapshot(docs));
    await flush();
    await vi.advanceTimersByTimeAsync(1_000);
    vi.useRealTimers();
    await vi.waitFor(() => expect(firestore.onSnapshot).toHaveBeenCalledTimes(2));
    const afterRotation = (firestore.onSnapshot.mock.calls as any).at(-1)[2];
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    afterRotation(snapshot(docs));
    await flush();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(firestore.onSnapshot).toHaveBeenCalledTimes(2);
    expect((await queryLocalRecords('sales')).length).toBe(252);
  });

  it('never advances a later queued snapshot past a failed local commit', async () => {
    const deliver = await seeded();
    vi.spyOn(mirror, 'upsertLocalRecords').mockRejectedValueOnce(new Error('disk full'));
    const first = document('first', { syncUpdatedAt: { seconds: 400, nanoseconds: 0 } });
    const second = document('second', { syncUpdatedAt: { seconds: 500, nanoseconds: 0 } });
    deliver(snapshot([first]));
    deliver(snapshot([first, second], false, [{ type: 'added', doc: second }]));
    await flush();
    expect((await getLocalSyncStatus('sales')).checkpoint?.syncUpdatedAt).toEqual(revision);
    expect((await queryLocalRecords('sales')).map(record => record.id)).toEqual(['historical', 'z']);
    expect(firestore.onSnapshot).toHaveBeenCalledTimes(1);
    expect(firestore.getDocsFromServer).not.toHaveBeenCalled();
  });
});
