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
    onSnapshot: vi.fn(() => vi.fn()),
    collection: vi.fn((_database: unknown, name: string) => ({ name })),
    documentId: vi.fn(() => '__name__'),
    orderBy: vi.fn((field: string, direction: string) => ({ type: 'orderBy', field, direction })),
    limit: vi.fn((count: number) => ({ type: 'limit', count })),
    startAfter: vi.fn((...values: unknown[]) => ({ type: 'startAfter', values })),
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

import { __offlineCacheInternals } from './offlineCache';
import { getLocalSyncStatus, queryLocalRecords, resetLocalMirrorForTests, upsertLocalRecords } from './localMirror';

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

afterEach(resetLocalMirrorForTests);

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
      seedComplete: true,
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
