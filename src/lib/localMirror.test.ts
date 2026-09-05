import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getLocalRecord,
  getLocalSyncStatus,
  queryLocalRecords,
  replaceLocalCollection,
  resetLocalMirrorForTests,
  setLocalSyncMetadata,
  softDeleteLocalRecord,
  subscribeLocalCollection,
  subscribeLocalSyncStatus,
  upsertLocalRecords,
} from './localMirror';

const waitFor = async (assertion: () => void) => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      if (attempt === 19) throw error;
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
};

beforeEach(resetLocalMirrorForTests);
afterEach(resetLocalMirrorForTests);

describe('local IndexedDB mirror', () => {
  it('stores records under collection and document identity without cross-collection collisions', async () => {
    await upsertLocalRecords('sales', [{ id: 'same-id', data: { total: 500 } }]);
    await upsertLocalRecords('purchases', [{ id: 'same-id', data: { total: 300 } }]);

    expect((await queryLocalRecords<{ total: number }>('sales')).map(record => record.data.total)).toEqual([500]);
    expect((await queryLocalRecords<{ total: number }>('purchases')).map(record => record.data.total)).toEqual([300]);
  });

  it('persists a page and advances its checkpoint and seed state atomically', async () => {
    const checkpoint = {
      syncUpdatedAt: { seconds: 1_788_000_000, nanoseconds: 123_000_000 },
      documentId: 'sale-b',
    };
    await upsertLocalRecords('sales', [
      { id: 'sale-a', data: { total: 100 } },
      { id: 'sale-b', data: { total: 200 } },
    ], {
      checkpoint,
      seedComplete: true,
      generation: 'generation-2',
    });

    await expect(getLocalSyncStatus('sales')).resolves.toMatchObject({
      ready: true,
      totalRecords: 2,
      activeRecords: 2,
      checkpoint,
      generation: 'generation-2',
    });
  });

  it('rolls back both documents and checkpoint when any record cannot be cloned', async () => {
    const firstCheckpoint = { syncUpdatedAt: '2026-09-01T10:00:00.000Z', documentId: 'sale-a' };
    await upsertLocalRecords('sales', [{ id: 'sale-a', data: { total: 100 } }], {
      checkpoint: firstCheckpoint,
      seedComplete: true,
    });

    await expect(upsertLocalRecords('sales', [
      { id: 'sale-b', data: { total: 200 } },
      { id: 'sale-bad', data: { unsupported: () => 'not cloneable' } },
    ], {
      checkpoint: { syncUpdatedAt: '2026-09-01T11:00:00.000Z', documentId: 'sale-bad' },
    })).rejects.toBeTruthy();

    expect((await queryLocalRecords('sales')).map(record => record.id)).toEqual(['sale-a']);
    expect((await getLocalSyncStatus('sales')).checkpoint).toEqual(firstCheckpoint);
  });

  it('replaces only the selected collection in one operation', async () => {
    await upsertLocalRecords('sales', [
      { id: 'stale', data: { total: 10 } },
      { id: 'keep-no-longer', data: { total: 20 } },
    ]);
    await upsertLocalRecords('purchases', [{ id: 'unrelated', data: { total: 30 } }]);

    await replaceLocalCollection('sales', [{ id: 'fresh', data: { total: 40 } }], {
      seedComplete: true,
      checkpoint: { syncUpdatedAt: '2026-09-02T00:00:00.000Z', documentId: 'fresh' },
    });

    expect((await queryLocalRecords('sales')).map(record => record.id)).toEqual(['fresh']);
    expect((await queryLocalRecords('purchases')).map(record => record.id)).toEqual(['unrelated']);
  });

  it('retains tombstones while excluding them from ordinary reads', async () => {
    await upsertLocalRecords('medicines', [
      { id: 'active', data: { name: 'Active medicine' } },
      { id: 'already-deleted', data: { name: 'Archived medicine', deleted: true } },
    ]);
    await softDeleteLocalRecord('medicines', 'active', {
      deletedAt: '2026-09-03T10:00:00.000Z',
      deletedBy: 'admin-1',
    });

    expect(await queryLocalRecords('medicines')).toEqual([]);
    const all = await queryLocalRecords<any>('medicines', { includeDeleted: true });
    expect(all.map(record => record.id).sort()).toEqual(['active', 'already-deleted']);
    expect(all.find(record => record.id === 'active')).toMatchObject({
      deleted: true,
      data: { deleted: true, deletedBy: 'admin-1' },
    });
    await expect(getLocalRecord('medicines', 'active')).resolves.toBeNull();
    await expect(getLocalRecord('medicines', 'active', { includeDeleted: true })).resolves.toMatchObject({ id: 'active' });
  });

  it('filters, sorts, and limits a complete local collection without cloud reads', async () => {
    await upsertLocalRecords('sales', [
      { id: 'c', data: { total: 300, status: 'paid' } },
      { id: 'a', data: { total: 100, status: 'cancelled' } },
      { id: 'b', data: { total: 200, status: 'paid' } },
    ]);

    const records = await queryLocalRecords<{ total: number; status: string }>('sales', {
      filter: record => record.data.status === 'paid',
      sort: (left, right) => right.data.total - left.data.total,
      limit: 1,
    });
    expect(records.map(record => record.id)).toEqual(['c']);
  });

  it('durably merges pending-write metadata and exposes status subscriptions', async () => {
    const statuses: Array<{ count: number; pending: boolean }> = [];
    const unsubscribe = subscribeLocalSyncStatus('sales', status => statuses.push({
      count: status.totalRecords,
      pending: status.pending.hasPendingWrites,
    }));

    await setLocalSyncMetadata('sales', {
      pending: {
        hasPendingWrites: true,
        count: 2,
        operationIds: ['one', 'two'],
        lastQueuedAt: '2026-09-03T11:00:00.000Z',
      },
    });
    await setLocalSyncMetadata('sales', {
      pending: { count: 1, operationIds: ['two'] },
    });

    await waitFor(() => expect(statuses.at(-1)).toEqual({ count: 0, pending: true }));
    await expect(getLocalSyncStatus('sales')).resolves.toMatchObject({
      pending: {
        hasPendingWrites: true,
        count: 1,
        operationIds: ['two'],
        lastQueuedAt: '2026-09-03T11:00:00.000Z',
      },
    });
    unsubscribe();
  });

  it('notifies collection subscribers after committed changes and hides deleted records by default', async () => {
    const listener = vi.fn();
    const includeDeletedListener = vi.fn();
    const unsubscribe = subscribeLocalCollection('medicines', listener);
    const unsubscribeDeleted = subscribeLocalCollection('medicines', includeDeletedListener, { includeDeleted: true });

    await upsertLocalRecords('medicines', [{ id: 'med-1', data: { name: 'Paracetamol' } }]);
    await waitFor(() => expect(listener).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'med-1', deleted: false }),
    ]));

    await softDeleteLocalRecord('medicines', 'med-1', { deletedBy: 'admin-1' });
    await waitFor(() => expect(listener).toHaveBeenLastCalledWith([]));
    await waitFor(() => expect(includeDeletedListener).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'med-1', deleted: true }),
    ]));
    unsubscribe();
    unsubscribeDeleted();
  });
});
