import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetLocalMirrorForTests, setLocalSyncMetadata, upsertLocalRecords } from '../../lib/localMirror';
import {
  createPendingPurchaseReturn,
  listPendingPurchaseReturns,
  queuePendingPurchaseReturn,
  recoverPendingPurchaseReturnsFromMirror,
  removePendingPurchaseReturn,
  replayPendingPurchaseReturnRecords,
} from './offlinePurchaseReturnsOutbox';

const returnData = {
  returnNo: 'PR-R0N2-000001',
  medicineId: 'batch-a',
  medicineName: 'Medicine',
  totalUnitsReturned: 12,
  paidUnitsReturned: 10,
  bonusUnitsReturned: 2,
  date: '2026-10-14T09:00:00.000Z',
};

async function clearOutbox() {
  for (const record of await listPendingPurchaseReturns()) {
    await removePendingPurchaseReturn(record.returnId);
  }
}

beforeEach(async () => {
  await clearOutbox();
  await resetLocalMirrorForTests();
});

afterEach(async () => {
  await clearOutbox();
  await resetLocalMirrorForTests();
});

describe('offline purchase-return outbox', () => {
  it('stores the complete stock allocation before Firestore confirmation', async () => {
    const record = createPendingPurchaseReturn('return-1', returnData);
    await queuePendingPurchaseReturn(record);
    await expect(listPendingPurchaseReturns()).resolves.toEqual([expect.objectContaining({
      returnId: 'return-1', medicineId: 'batch-a', totalUnits: 12, bonusUnits: 2,
    })]);
  });

  it('recovers a rejected return preserved by the local mirror', async () => {
    await upsertLocalRecords('purchaseReturns', [{ id: 'return-rejected', data: returnData, pending: false }], {
      seedComplete: true,
      generation: 1,
    });
    await setLocalSyncMetadata('purchaseReturns', {
      pending: {
        hasPendingWrites: true,
        rejectedRecordIds: ['return-rejected'],
        recoveryRecords: [{ id: 'return-rejected', data: returnData, pending: true }],
      },
    });

    await expect(recoverPendingPurchaseReturnsFromMirror()).resolves.toBe(1);
    await expect(listPendingPurchaseReturns()).resolves.toEqual([
      expect.objectContaining({ returnId: 'return-rejected', recovered: true }),
    ]);
    await expect(recoverPendingPurchaseReturnsFromMirror()).resolves.toBe(0);
  });

  it('replays by exact ID once and removes only after cloud confirmation', async () => {
    const record = createPendingPurchaseReturn('return-1', returnData);
    let exists = false;
    const replay = vi.fn(async () => { exists = true; });
    const remove = vi.fn(async () => undefined);
    await replayPendingPurchaseReturnRecords([record], {
      returnExists: async () => exists,
      replay,
      remove,
    });
    expect(replay).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith('return-1');
  });

  it('does not replay a return that already exists in Firestore', async () => {
    const replay = vi.fn();
    const remove = vi.fn(async () => undefined);
    await replayPendingPurchaseReturnRecords([createPendingPurchaseReturn('return-1', returnData)], {
      returnExists: async () => true,
      replay,
      remove,
    });
    expect(replay).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith('return-1');
  });
});
