import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => ({ getDocsFromServer: vi.fn(), onSnapshot: vi.fn() }));
vi.mock('@/lib/firestore', () => firestore);
vi.mock('./offlineAuth', () => ({ getActiveAuthSession: () => ({ profile: { uid: 'admin', role: 'admin' } }) }));
vi.mock('./syncProtocol', () => ({
  getSyncControl: () => ({ datasetGeneration: 1, incrementalEnabled: false }),
  subscribeSyncControl: (listener: () => void) => { listener(); return () => undefined; },
}));

import { resetLocalMirrorForTests, setLocalSyncMetadata, upsertLocalRecords } from './localMirror';
import { subscribeToSales, subscribeToSaleReturns } from './salesStore';

const unsubscribers: Array<() => void> = [];
const complete = { seedComplete: true, generation: 1 };

beforeEach(async () => {
  vi.clearAllMocks();
  await resetLocalMirrorForTests();
  vi.stubGlobal('window', new EventTarget());
});
afterEach(async () => {
  unsubscribers.splice(0).forEach(unsubscribe => unsubscribe());
  await resetLocalMirrorForTests();
  vi.unstubAllGlobals();
});

describe('shared complete sales mirror', () => {
  it('keeps complete offline history when the Firestore cache delivers only one changed sale', async () => {
    await upsertLocalRecords('sales', [
      { id: 'sale-a', data: { total: 100 } },
      { id: 'sale-b', data: { total: 250 } },
    ], complete);
    const onData = vi.fn();
    unsubscribers.push(subscribeToSales(onData));
    await vi.waitFor(() => expect(onData).toHaveBeenCalled());

    // A cached SDK snapshot may contain a subset; the central cache upserts it.
    await upsertLocalRecords('sales', [{ id: 'sale-a', data: { total: 125 }, pending: true }]);
    await vi.waitFor(() => expect(onData).toHaveBeenLastCalledWith([
      { id: 'sale-a', total: 125 }, { id: 'sale-b', total: 250 },
    ]));
    expect(firestore.onSnapshot).not.toHaveBeenCalled();
    expect(firestore.getDocsFromServer).not.toHaveBeenCalled();
  });

  it('does not publish a partially bootstrapped history as zero sales', async () => {
    await upsertLocalRecords('sales', [{ id: 'sale-a', data: { total: 100 } }], { generation: 1 });
    const onData = vi.fn();
    unsubscribers.push(subscribeToSales(onData));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(onData).not.toHaveBeenCalled();
    await setLocalSyncMetadata('sales', complete);
    await vi.waitFor(() => expect(onData).toHaveBeenLastCalledWith([{ id: 'sale-a', total: 100 }]));
  });

  it('reopens return history and handles focus/reconnect without any cloud history download', async () => {
    await upsertLocalRecords('saleReturns', [{ id: 'return-a', data: { total: 45 } }], complete);
    const first = vi.fn();
    const stop = subscribeToSaleReturns(first);
    await vi.waitFor(() => expect(first).toHaveBeenCalled());
    stop();
    const second = vi.fn();
    unsubscribers.push(subscribeToSaleReturns(second));
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('alfateh:auth-sync-ready'));
    await vi.waitFor(() => expect(second).toHaveBeenLastCalledWith([{ id: 'return-a', total: 45 }]));
    expect(firestore.getDocsFromServer).not.toHaveBeenCalled();
    expect(firestore.onSnapshot).not.toHaveBeenCalled();
  });

  it('keeps Firestore IDs authoritative and excludes recovered tombstones from totals', async () => {
    await upsertLocalRecords('sales', [
      { id: 'real-id', data: { id: 'legacy-payload-id', total: 75 } },
      { id: 'deleted-id', data: { deleted: true, total: 999 } },
    ], complete);
    const onData = vi.fn();
    unsubscribers.push(subscribeToSales(onData));
    await vi.waitFor(() => expect(onData).toHaveBeenLastCalledWith([{ id: 'real-id', total: 75 }]));
  });
});
