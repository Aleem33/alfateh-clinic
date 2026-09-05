import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  control: { datasetGeneration: 7, incrementalEnabled: true } as Record<string, any>,
  profile: { role: 'admin' } as Record<string, any>,
  user: { uid: 'admin-1', email: 'admin@example.com' },
  records: {} as Record<string, any[]>,
  batchCalls: 0,
  failBatch: 0,
  transactionCalls: 0,
  failTransaction: 0,
  transactionTail: Promise.resolve(),
  deleteObservations: [] as Record<string, any>[],
  getDocsFromServer: vi.fn(),
  hardDeleteBatch: vi.fn(),
}));

vi.mock('../firebase', () => ({ db: {}, auth: { get currentUser() { return state.user; } } }));
vi.mock('./lanCoordinator', () => ({ isCloudOnline: () => true }));
vi.mock('./localMirror', () => ({ getLocalSyncStatus: vi.fn(), queryLocalRecords: vi.fn() }));
vi.mock('./readDiagnostics', () => ({ recordFirestoreRead: vi.fn() }));
vi.mock('./syncProtocol', () => ({ getSyncControl: () => ({ datasetGeneration: 7 }) }));
vi.mock('./offlineAuth', () => ({ getActiveAuthSession: () => ({ profile: state.profile }) }));
vi.mock('./trustedClock', () => ({ trustedNowISO: () => '2026-09-05T00:00:00.000Z' }));
vi.mock('./firestore', () => ({
  collection: (_db: unknown, name: string) => ({ path: name }),
  doc: (_db: unknown, name: string, id: string) => ({ path: `${name}/${id}` }),
  getDocFromServer: async () => ({ exists: () => true, data: () => state.profile }),
  getDocsFromServer: state.getDocsFromServer,
  serverTimestamp: () => ({ serverTimestamp: true }),
  setDoc: vi.fn(),
  writeBatch: vi.fn(),
  writeHardDeleteBatch: state.hardDeleteBatch,
  runTransaction: (_db: unknown, operation: (transaction: any) => Promise<unknown>) => {
    const run = state.transactionTail.then(async () => {
      state.transactionCalls += 1;
      if (state.transactionCalls === state.failTransaction) throw new Error('Transaction unavailable');
      const changes: Record<string, any>[] = [];
      const result = await operation({
        get: async () => ({ data: () => ({ ...state.control }) }),
        set: (_ref: unknown, data: Record<string, any>) => { changes.push(data); },
      });
      changes.forEach(data => { state.control = { ...state.control, ...data }; });
      return result;
    });
    state.transactionTail = run.then(() => undefined, () => undefined);
    return run;
  },
}));

import { deleteAppDataScope } from './dataSync';

function documents(collection: string, count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: String(index),
    ref: { path: `${collection}/${index}` },
    data: () => ({ name: `Record ${index}` }),
  }));
}

describe('Admin Reset mirror generation safety', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.control = { datasetGeneration: 7, incrementalEnabled: true };
    state.profile = { role: 'admin' };
    state.records = { labOrders: documents('labOrders', 2), labTests: documents('labTests', 1) };
    state.batchCalls = 0;
    state.failBatch = 0;
    state.transactionCalls = 0;
    state.failTransaction = 0;
    state.transactionTail = Promise.resolve();
    state.deleteObservations = [];
    state.getDocsFromServer.mockImplementation(async (reference: { path: string }) => {
      const docs = state.records[reference.path] || [];
      return { docs, size: docs.length };
    });
    state.hardDeleteBatch.mockImplementation(() => ({
      delete: vi.fn(),
      commit: async () => {
        state.batchCalls += 1;
        state.deleteObservations.push({ ...state.control });
        if (state.batchCalls === state.failBatch) throw new Error('Rejected delete batch');
      },
    }));
  });

  it('invalidates before deletion and again after completion, keeping legacy reconciliation selected', async () => {
    await expect(deleteAppDataScope('lab')).resolves.toBe(3);
    expect(state.deleteObservations).toHaveLength(2);
    expect(state.deleteObservations.every(control => control.datasetGeneration === 8 &&
      control.resetInProgress === true && control.rollbackToLegacy === true && control.incrementalEnabled === false)).toBe(true);
    expect(state.control).toMatchObject({
      datasetGeneration: 9, resetInProgress: false, resetStatus: 'completed', resetDeletedRecords: 3,
      incrementalEnabled: false, rollbackToLegacy: true,
    });
  });

  it('invalidates after a partially committed collection and reports the committed count', async () => {
    state.records = { labOrders: documents('labOrders', 401) };
    state.failBatch = 2;
    await expect(deleteAppDataScope('lab')).rejects.toThrow('Failed deleting labOrders');
    expect(state.control).toMatchObject({
      datasetGeneration: 9, resetInProgress: false, resetStatus: 'failed', resetDeletedRecords: 400,
      incrementalEnabled: false, rollbackToLegacy: true,
    });
  });

  it('blocks a second reset before scanning or deleting records when recovery is required', async () => {
    state.control.resetInProgress = true;
    await expect(deleteAppDataScope('lab')).rejects.toThrow('Another reset is already in progress');
    expect(state.getDocsFromServer).not.toHaveBeenCalled();
    expect(state.hardDeleteBatch).not.toHaveBeenCalled();
    expect(state.control.datasetGeneration).toBe(7);
  });

  it('serializes concurrent reset claims so only one request deletes records', async () => {
    const outcomes = await Promise.allSettled([deleteAppDataScope('lab'), deleteAppDataScope('lab')]);
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(outcome => outcome.status === 'rejected')).toHaveLength(1);
    expect(state.batchCalls).toBe(2);
    expect(state.control.datasetGeneration).toBe(9);
  });

  it('keeps the recovery marker and legacy selection when finalization is unavailable', async () => {
    state.failTransaction = 2;
    await expect(deleteAppDataScope('lab')).rejects.toThrow('Reset synchronization could not be finalized');
    expect(state.control).toMatchObject({ datasetGeneration: 8, resetInProgress: true, rollbackToLegacy: true, incrementalEnabled: false });
  });

  it('rejects a revoked administrator before claiming a reset', async () => {
    state.profile.deleted = true;
    await expect(deleteAppDataScope('lab')).rejects.toThrow('Only an admin account');
    expect(state.transactionCalls).toBe(0);
    expect(state.hardDeleteBatch).not.toHaveBeenCalled();
  });
});
