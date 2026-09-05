import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => ({ onSnapshot: vi.fn(), getDocsFromServer: vi.fn() }));
vi.mock('@/lib/firestore', () => firestore);
vi.mock('./offlineAuth', () => ({ getActiveAuthSession: () => ({ profile: { uid: 'admin', role: 'admin' } }) }));
vi.mock('./syncProtocol', () => ({
  getSyncControl: () => ({ datasetGeneration: 1, incrementalEnabled: false }),
  subscribeSyncControl: (listener: () => void) => { listener(); return () => undefined; },
}));
import { resetLocalMirrorForTests, upsertLocalRecords } from './localMirror';
import { getMedicinesOnce, getMedicineStoreSnapshot, subscribeToArchivedMedicines, subscribeToMedicines } from './medicineStore';

const unsubscribers: Array<() => void> = [];
const complete = { seedComplete: true, generation: 1 };
beforeEach(async () => { vi.clearAllMocks(); await resetLocalMirrorForTests(); });
afterEach(async () => {
  unsubscribers.splice(0).forEach(unsubscribe => unsubscribe());
  await resetLocalMirrorForTests();
});

describe('complete medicine mirror', () => {
  it('keeps every batch visible after a partial offline SDK cache update', async () => {
    await upsertLocalRecords('medicines', [
      { id: 'batch-a', data: { name: 'Medicine', batchNo: 'A', stock: 10 } },
      { id: 'batch-b', data: { name: 'Medicine', batchNo: 'B', stock: 20 } },
    ], complete);
    const onData = vi.fn();
    unsubscribers.push(subscribeToMedicines(onData));
    await vi.waitFor(() => expect(onData).toHaveBeenCalled());
    await upsertLocalRecords('medicines', [
      { id: 'batch-a', data: { name: 'Medicine', batchNo: 'A', stock: 9 }, pending: true },
    ]);
    await vi.waitFor(() => expect(onData).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'batch-a', stock: 9 }),
      expect.objectContaining({ id: 'batch-b', stock: 20 }),
    ]));
    expect(getMedicineStoreSnapshot()).toMatchObject({ hasLoaded: true, fromCache: true });
    expect(firestore.onSnapshot).not.toHaveBeenCalled();
  });

  it('preserves active/archive partitions and excludes tombstones', async () => {
    await upsertLocalRecords('medicines', [
      { id: 'active', data: { name: 'Medicine', id: 'wrong-payload-id' } },
      { id: 'archived', data: { name: 'Medicine', archived: true } },
      { id: 'deleted', data: { name: 'Medicine', deleted: true } },
    ], complete);
    const active = vi.fn();
    const archived = vi.fn();
    unsubscribers.push(subscribeToMedicines(active), subscribeToArchivedMedicines(archived));
    await vi.waitFor(() => {
      expect(active).toHaveBeenLastCalledWith([expect.objectContaining({ id: 'active' })]);
      expect(archived).toHaveBeenLastCalledWith([expect.objectContaining({ id: 'archived' })]);
    });
    expect(getMedicineStoreSnapshot().all).toHaveLength(2);
  });

  it('reads one-time medicine selectors entirely from the complete local mirror', async () => {
    await upsertLocalRecords('medicines', [{ id: 'batch-a', data: { name: 'Medicine', stock: 5 } }], complete);
    await expect(getMedicinesOnce()).resolves.toEqual([expect.objectContaining({ id: 'batch-a', stock: 5 })]);
    expect(firestore.getDocsFromServer).not.toHaveBeenCalled();
    expect(firestore.onSnapshot).not.toHaveBeenCalled();
  });
});
