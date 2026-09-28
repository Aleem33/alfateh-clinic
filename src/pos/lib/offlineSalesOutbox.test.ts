import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  aggregateSaleStockAdjustments,
  listPendingPosSales,
  queuePendingPosSale,
  replayPendingPosSaleRecords,
  type PendingPosSale,
  beginPendingSaleCheckout,
  endPendingSaleCheckout,
} from './offlineSalesOutbox';

const sampleSale = (saleId = 'sale-offline-1'): PendingPosSale => ({
  saleId,
  saleData: {
    receiptNo: 'SALE-R001-1',
    total: 250,
    date: '2026-08-26T18:30:00.000Z',
    trustedDate: '2026-08-26T18:30:00.000Z',
    businessDate: '2026-08-26',
  },
  movements: [{ id: 'move-1', data: { medicineId: 'batch-a', quantity: -2 } }],
  stockAdjustments: [{ medicineId: 'batch-a', units: 2 }],
  createdAt: '2026-08-25T10:00:00.000Z',
});

function deleteOutboxDatabase() {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('alfateh-pos-outbox');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Outbox database deletion was blocked.'));
  });
}

afterEach(async () => {
  vi.restoreAllMocks();
  await deleteOutboxDatabase();
});

describe('offline sales outbox', () => {
  it('continues later missing receipts while retaining a failed earlier sale for retry', async () => {
    const records = Array.from({ length: 20 }, (_, index) => sampleSale(`sale-${String(index).padStart(3, '0')}`));
    const cloud = new Set<string>();
    for (const record of records) await queuePendingPosSale(record);
    const remove = async (id: string) => {
      const { removePendingPosSale } = await import('./offlineSalesOutbox');
      await removePendingPosSale(id);
    };
    const adapter = {
      saleExists: async (id: string) => cloud.has(id),
      replay: async (record: PendingPosSale) => {
        if (record.saleId === 'sale-000') throw new Error('Needs review');
        cloud.add(record.saleId);
      }, remove,
    };
    await expect(replayPendingPosSaleRecords(await listPendingPosSales(), adapter)).rejects.toThrow('1 sale(s) still saved locally');
    expect(cloud.size).toBe(19);
    expect((await listPendingPosSales()).map(record => record.saleId)).toEqual(['sale-000']);
    adapter.replay = async record => { cloud.add(record.saleId); };
    await replayPendingPosSaleRecords(await listPendingPosSales(), adapter);
    expect(cloud.size).toBe(20);
    expect(await listPendingPosSales()).toEqual([]);
  });

  it('does not race a checkout still waiting for its original transaction', async () => {
    const record = sampleSale();
    const adapter = { saleExists: vi.fn(), replay: vi.fn(), remove: vi.fn() };
    beginPendingSaleCheckout(record.saleId);
    try {
      await replayPendingPosSaleRecords([record], adapter);
      expect(adapter.saleExists).not.toHaveBeenCalled();
      expect(adapter.replay).not.toHaveBeenCalled();
      expect(adapter.remove).not.toHaveBeenCalled();
    } finally { endPendingSaleCheckout(record.saleId); }
  });
  it('aggregates box and loose-unit deductions for the same medicine batch', () => {
    expect(aggregateSaleStockAdjustments([
      { medicineId: 'batch-a', quantity: 2, sellType: 'box', unitsPerBox: 10 },
      { medicineId: 'batch-a', quantity: 3, sellType: 'unit', unitsPerBox: 10 },
      { medicineId: 'batch-b', quantity: 1, sellType: 'unit', unitsPerBox: 1 },
    ])).toEqual([
      { medicineId: 'batch-a', units: 23 },
      { medicineId: 'batch-b', units: 1 },
    ]);
  });

  it('persists bonus bucket deductions for idempotent offline replay', () => {
    expect(aggregateSaleStockAdjustments([
      { medicineId: 'batch-a', quantity: 2, sellType: 'unit', unitsPerBox: 10, bonusUnitsSold: 2 },
    ])).toEqual([{ medicineId: 'batch-a', units: 2, bonusUnits: 2 }]);
  });

  it('persists a complete pending sale across fresh IndexedDB connections', async () => {
    const record = sampleSale();
    await queuePendingPosSale(record);
    await expect(listPendingPosSales()).resolves.toEqual([record]);
  });

  it('does not confirm a saved sale if its transaction aborts after the request succeeds', async () => {
    const originalPut = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
      const request = originalPut.call(this, value, key);
      request.addEventListener('success', () => this.transaction.abort());
      return request;
    });
    await expect(queuePendingPosSale(sampleSale())).rejects.toMatchObject({ name: 'AbortError' });
    vi.restoreAllMocks();
    await expect(listPendingPosSales()).resolves.toEqual([]);
  });

  it('does not replay a sale that already reached the cloud', async () => {
    const record = sampleSale();
    const replay = vi.fn();
    const remove = vi.fn();
    await replayPendingPosSaleRecords([record], {
      saleExists: vi.fn().mockResolvedValue(true),
      replay,
      remove,
    });
    expect(replay).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith(record.saleId);
  });

  it('replays a missing sale once and removes it only after confirmation', async () => {
    const record = sampleSale();
    const replay = vi.fn().mockResolvedValue(undefined);
    const remove = vi.fn().mockResolvedValue(undefined);
    const saleExists = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await replayPendingPosSaleRecords([record], { saleExists, replay, remove });
    expect(replay).toHaveBeenCalledTimes(1);
    expect(replay).toHaveBeenCalledWith(expect.objectContaining({
      saleData: expect.objectContaining({
        date: '2026-08-26T18:30:00.000Z',
        trustedDate: '2026-08-26T18:30:00.000Z',
        businessDate: '2026-08-26',
      }),
    }));
    expect(remove).toHaveBeenCalledWith(record.saleId);
  });

  it('keeps an unconfirmed sale recoverable instead of deleting it', async () => {
    const record = sampleSale();
    const remove = vi.fn();
    await expect(replayPendingPosSaleRecords([record], {
      saleExists: vi.fn().mockResolvedValue(false),
      replay: vi.fn().mockResolvedValue(undefined),
      remove,
    })).rejects.toThrow('could not be confirmed');
    expect(remove).not.toHaveBeenCalled();
  });

  it('removes all cloud-confirmed records before replaying missing sales in creation order', async () => {
    const laterConfirmed = { ...sampleSale('confirmed'), createdAt: '2026-08-25T12:00:00.000Z' };
    const firstMissing = { ...sampleSale('first'), createdAt: '2026-08-25T09:00:00.000Z' };
    const secondMissing = { ...sampleSale('second'), createdAt: '2026-08-25T10:00:00.000Z' };
    const confirmed = new Set(['confirmed']);
    const replayed: string[] = [];
    await replayPendingPosSaleRecords([laterConfirmed, secondMissing, firstMissing], {
      saleExists: async id => confirmed.has(id),
      replay: async record => { replayed.push(record.saleId); confirmed.add(record.saleId); },
      remove: vi.fn().mockResolvedValue(undefined),
    });
    expect(replayed).toEqual(['first', 'second']);
  });
});
