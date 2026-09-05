import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ role: 'admin' }));
const control = vi.hoisted(() => ({ datasetGeneration: 2 }));
vi.mock('./syncProtocol', () => ({
  getSyncControl: () => control,
  subscribeSyncControl: () => () => undefined,
}));

vi.mock('./offlineAuth', () => ({
  getActiveAuthSession: () => ({ profile: { role: auth.role } }),
}));
import { getLocalCollectionOnce, subscribeToLocalCollection } from './collectionRepository';
import { resetLocalMirrorForTests, setLocalSyncMetadata, upsertLocalRecords } from './localMirror';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

beforeEach(async () => {
  auth.role = 'admin';
  control.datasetGeneration = 2;
  await resetLocalMirrorForTests();
});
afterEach(resetLocalMirrorForTests);

describe('local collection repository completeness guard', () => {
  it('does not publish a partial or empty mirror until its bootstrap is complete', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToLocalCollection('sales', listener);

    await upsertLocalRecords('sales', [{ id: 'partial-sale', data: { total: 100 } }], {
      seedComplete: false,
      generation: 2,
    });
    await flush();
    expect(listener).not.toHaveBeenCalled();

    await setLocalSyncMetadata('sales', { seedComplete: true });
    await vi.waitFor(() => expect(listener).toHaveBeenLastCalledWith([
      { id: 'partial-sale', total: 100 },
    ]));
    unsubscribe();
  });

  it('rejects one-time reads while initial synchronization is incomplete', async () => {
    await upsertLocalRecords('medicines', [{ id: 'partial', data: { name: 'Incomplete' } }]);

    await expect(getLocalCollectionOnce('medicines')).rejects.toThrow('Initial synchronization is required');

    await setLocalSyncMetadata('medicines', { seedComplete: true, generation: 2 });
    await expect(getLocalCollectionOnce('medicines')).resolves.toEqual([
      { id: 'partial', name: 'Incomplete' },
    ]);
  });

  it('does not expose an admin-cached collection to a later non-admin session', async () => {
    await upsertLocalRecords('auditLogs', [{ id: 'admin-only', data: { detail: 'Private audit detail' } }], {
      seedComplete: true,
    });
    auth.role = 'cashier';
    const listener = vi.fn();
    const onError = vi.fn();

    const unsubscribe = subscribeToLocalCollection('auditLogs', listener, onError);
    await expect(getLocalCollectionOnce('auditLogs')).rejects.toThrow('not permitted');
    expect(listener).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('not permitted') }));
    unsubscribe();
  });

  it('rejects a complete mirror from a previous reset generation', async () => {
    await upsertLocalRecords('sales', [{ id: 'old', data: { total: 100 } }], { seedComplete: true, generation: 1 });
    await expect(getLocalCollectionOnce('sales')).rejects.toThrow('Initial synchronization');
    const listener = vi.fn();
    const stop = subscribeToLocalCollection('sales', listener);
    await flush();
    expect(listener).not.toHaveBeenCalled();
    stop();
  });
});
