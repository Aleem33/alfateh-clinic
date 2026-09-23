import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetLocalMirrorForTests, upsertLocalRecords } from '../../lib/localMirror';
import {
  listPendingSaleReturns,
  queuePendingSaleReturn,
  recoverPendingSaleReturnsFromMirror,
  removePendingSaleReturn,
  replayPendingSaleReturnRecords,
  saleReturnStockAdjustments,
  type PendingSaleReturn,
} from './offlineSaleReturnsOutbox';

function sample(returnId = 'return-offline-1'): PendingSaleReturn {
  return {
    returnId,
    returnData: {
      returnNo: 'SR-R001-1',
      date: '2026-09-18T10:00:00.000Z',
      items: [{
        medicineId: 'batch-a',
        name: 'Medicine',
        returnQty: 2,
        sellType: 'unit',
        paidUnitsRestored: 1,
        bonusUnitsRestored: 1,
      }],
    },
    movements: [{ id: 'movement-1', data: { type: 'sale-return', quantity: 2 } }],
    stockAdjustments: [{ medicineId: 'batch-a', units: 2, bonusUnits: 1 }],
    createdAt: '2026-09-18T10:00:00.000Z',
  };
}

beforeEach(async () => {
  for (const record of await listPendingSaleReturns()) await removePendingSaleReturn(record.returnId);
  await resetLocalMirrorForTests();
});

afterEach(async () => {
  for (const record of await listPendingSaleReturns()) await removePendingSaleReturn(record.returnId);
  await resetLocalMirrorForTests();
});

describe('offline sales-return outbox', () => {
  it('persists a complete return independently from the Firestore SDK queue', async () => {
    await queuePendingSaleReturn(sample());
    await expect(listPendingSaleReturns()).resolves.toEqual([sample()]);
  });

  it('aggregates paid and bonus restored stock by medicine batch', () => {
    expect(saleReturnStockAdjustments([
      { medicineId: 'batch-a', sellType: 'unit', returnQty: 2, paidUnitsRestored: 1, bonusUnitsRestored: 1 },
      { medicineId: 'batch-a', sellType: 'box', returnQty: 1, unitsPerBox: 10, paidUnitsRestored: 10 },
    ])).toEqual([{ medicineId: 'batch-a', units: 12, bonusUnits: 1 }]);
  });

  it('replays once and removes only after the exact return ID is confirmed', async () => {
    const record = sample();
    await queuePendingSaleReturn(record);
    let exists = false;
    const replay = vi.fn(async () => { exists = true; });
    await replayPendingSaleReturnRecords(await listPendingSaleReturns(), {
      returnExists: async () => exists,
      replay,
      remove: removePendingSaleReturn,
    });
    expect(replay).toHaveBeenCalledOnce();
    await expect(listPendingSaleReturns()).resolves.toEqual([]);
  });

  it('converts legacy pending mirror returns into durable recovery records', async () => {
    const record = sample('legacy-return');
    await upsertLocalRecords('saleReturns', [{
      id: record.returnId,
      data: record.returnData,
      pending: true,
    }], { seedComplete: true, generation: 1, pending: { hasPendingWrites: true, count: 1 } });

    await expect(recoverPendingSaleReturnsFromMirror()).resolves.toBe(1);
    await expect(listPendingSaleReturns()).resolves.toEqual([
      expect.objectContaining({
        returnId: 'legacy-return',
        recovered: true,
        stockAdjustments: [{ medicineId: 'batch-a', units: 2, bonusUnits: 1 }],
      }),
    ]);
    await expect(recoverPendingSaleReturnsFromMirror()).resolves.toBe(0);
  });
});
