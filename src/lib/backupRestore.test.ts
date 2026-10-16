import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  records: new Map<string, any>(), transactions: 0,
}));
vi.mock('../firebase', () => ({ db: {}, auth: {} }));
vi.mock('./lanCoordinator', () => ({ isCloudOnline: () => true }));
vi.mock('./offlineAuth', () => ({ getActiveAuthSession: () => ({ profile: { role: 'admin' } }) }));
vi.mock('./localMirror', () => ({
  getLocalSyncStatus: async () => ({ pending: {}, seedComplete: true, generation: 1 }),
  queryLocalRecords: vi.fn(),
}));
vi.mock('../pos/lib/offlineSalesOutbox', () => ({ countPendingPosSales: async () => 0 }));
vi.mock('../pos/lib/offlineSaleReturnsOutbox', () => ({ countPendingSaleReturns: async () => 0 }));
vi.mock('../pos/lib/offlinePurchaseReturnsOutbox', () => ({ countPendingPurchaseReturns: async () => 0 }));
vi.mock('./syncProtocol', () => ({ getSyncControl: () => ({ datasetGeneration: 1 }) }));
vi.mock('./firestore', () => ({
  doc: (_db: unknown, name: string, id: string) => `${name}/${id}`,
  runTransaction: async (_db: unknown, callback: any) => {
    state.transactions++;
    return callback({
      get: async (path: string) => ({ exists: () => state.records.has(path) }),
      set: (path: string, value: any) => state.records.set(path, value),
    });
  },
}));
import { restoreAllAppData } from './dataSync';

describe('backup restore without overwriting current records', () => {
  beforeEach(() => { state.records.clear(); state.transactions = 0; });
  const backup = (collections: any) => ({ exportedAt: '2026-10-16', version: '2.0', scope: 'alfateh-clinic-suite' as const, collections });

  it('adds missing IDs while retaining newer stock and deletion state', async () => {
    state.records.set('medicines/existing', { stock: 33, bonusStockUnits: 2 });
    state.records.set('medicines/deleted', { stock: 0, deleted: true });
    await expect(restoreAllAppData(backup({ medicines: [
      { _id: 'existing', stock: 100 }, { _id: 'missing', stock: 7 }, { _id: 'deleted', stock: 15 },
    ] }))).resolves.toBe(1);
    expect(state.records.get('medicines/existing')).toEqual({ stock: 33, bonusStockUnits: 2 });
    expect(state.records.get('medicines/deleted')).toEqual({ stock: 0, deleted: true });
    expect(state.records.get('medicines/missing')).toEqual({ stock: 7 });
  });

  it('validates the entire input before restoring any collection', async () => {
    await expect(restoreAllAppData(backup({
      medicines: [{ _id: 'valid', stock: 1 }], sales: [{ _id: 'same' }, { _id: 'same' }],
    }))).rejects.toThrow('repeated document ID');
    expect(state.transactions).toBe(0);
    expect(state.records.size).toBe(0);
  });

  it('does not allow an imported backup to replace live synchronization controls', async () => {
    await expect(restoreAllAppData(backup({ syncControl: [{ _id: 'current', datasetGeneration: 1 }] })))
      .rejects.toThrow('Unsupported backup collection');
    expect(state.transactions).toBe(0);
  });
});
