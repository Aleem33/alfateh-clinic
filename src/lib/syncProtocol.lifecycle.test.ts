import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  currentUser: { uid: 'admin-1' } as { uid: string } | null,
  onSnapshot: vi.fn(() => vi.fn()), setDoc: vi.fn().mockResolvedValue(undefined),
  getAppVersion: vi.fn().mockResolvedValue('3.1.91'),
}));
vi.mock('../firebase', () => ({ db: {}, auth: { get currentUser() { return mocks.currentUser; } } }));
vi.mock('./offlineIdentity', () => ({ getOfflineDevice: () => ({ id: 'device-1', prefix: 'R001' }) }));
vi.mock('@/lib/firestore', () => ({ SYNC_PROTOCOL_VERSION: 2,
  doc: (_db: unknown, collection: string, id: string) => ({ collection, id }),
  onSnapshot: mocks.onSnapshot, setDoc: mocks.setDoc, serverTimestamp: () => 'server-time', runTransaction: vi.fn(),
}));
let storage: Map<string, string>;
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); mocks.currentUser = { uid: 'admin-1' };
  storage = new Map();
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) || null,
    setItem: (key: string, value: string) => storage.set(key, value) });
  vi.stubGlobal('window', { electronAPI: { getAppVersion: mocks.getAppVersion } });
});
afterEach(() => vi.unstubAllGlobals());

describe('sync-control lifecycle', () => {
  it('waits for the control document on a new PC rather than first starting full listeners', async () => {
    const sync = await import('./syncProtocol');
    const changed = vi.fn();
    sync.subscribeSyncControl(changed);
    expect(changed).not.toHaveBeenCalled();
    sync.startSyncControlListener();
    const deliver = (mocks.onSnapshot.mock.calls as any)[0][2];
    deliver({ metadata: { fromCache: true }, exists: () => false });
    expect(changed).not.toHaveBeenCalled();
    deliver({ metadata: { fromCache: false, hasPendingWrites: true }, exists: () => true,
      data: () => ({ incrementalEnabled: true, trackedWritesRequired: true, rulesEnforcementVersion: 2 }) });
    expect(changed).not.toHaveBeenCalled();
    deliver({ metadata: { fromCache: false }, exists: () => false });
    expect(changed).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalledWith(expect.objectContaining({ incrementalEnabled: false }));
  });

  it('uses a cached control offline and never interprets a connection error as rollback', async () => {
    storage.set('alfateh.sync.control.v2', JSON.stringify({ protocolVersion: 2, minimumProtocolVersion: 2,
      incrementalEnabled: true, trackedWritesRequired: true, rulesEnforcementVersion: 2, datasetGeneration: 3 }));
    const sync = await import('./syncProtocol');
    const changed = vi.fn();
    sync.subscribeSyncControl(changed);
    expect(changed).toHaveBeenCalledTimes(1);
    const error = vi.fn();
    sync.startSyncControlListener(error);
    (mocks.onSnapshot.mock.calls as any)[0][3](new Error('unavailable'));
    expect(error).toHaveBeenCalled();
    expect(changed).toHaveBeenCalledTimes(1);
    expect(sync.getSyncControl().incrementalEnabled).toBe(true);
  });

  it('serializes client reports so slow not-ready metadata cannot overwrite ready', async () => {
    let resolveVersion!: (value: string) => void;
    mocks.getAppVersion.mockImplementationOnce(() => new Promise(resolve => { resolveVersion = resolve; }));
    const sync = await import('./syncProtocol');
    const first = sync.registerSyncClient('admin', false);
    const second = sync.registerSyncClient('admin', true);
    await vi.waitFor(() => expect(mocks.getAppVersion).toHaveBeenCalledTimes(1));
    expect(mocks.setDoc).not.toHaveBeenCalled();
    resolveVersion('3.1.91');
    await Promise.all([first, second]);
    expect(mocks.setDoc.mock.calls.map(call => call[1].mirrorReady)).toEqual([false, true]);
  });

  it('does not send a former account report after an asynchronous account switch', async () => {
    let resolveVersion!: (value: string) => void;
    mocks.getAppVersion.mockImplementationOnce(() => new Promise(resolve => { resolveVersion = resolve; }));
    const sync = await import('./syncProtocol');
    const pending = sync.registerSyncClient('admin', true);
    await vi.waitFor(() => expect(mocks.getAppVersion).toHaveBeenCalledTimes(1));
    mocks.currentUser = { uid: 'cashier-2' };
    resolveVersion('3.1.91');
    await pending;
    expect(mocks.setDoc).not.toHaveBeenCalled();
  });
});
