import { describe, expect, it, vi } from 'vitest';
import { beginDurableSubmission, endDurableSubmission, isDurableSubmissionActive, replayDurableRecords } from './durableReplay';

describe('durable queue isolation', () => {
  it('uploads later records and clears confirmed records even when an earlier record is rejected', async () => {
    const confirmed = new Set(['already-saved']);
    const remove = vi.fn(async (_id: string) => undefined);
    const replay = vi.fn(async (id: string) => {
      if (id === 'blocked') throw new Error('permission denied');
      confirmed.add(id);
    });
    await expect(replayDurableRecords(['blocked', 'later', 'already-saved'], {
      id: id => id, label: id => id,
      exists: async id => confirmed.has(id), replay, remove,
    })).rejects.toThrow('blocked: permission denied');
    expect(remove.mock.calls.map(call => call[0])).toEqual(['later', 'already-saved']);
    expect(replay).toHaveBeenCalledWith('later');
  });

  it('isolates server-check failures and skips an original submission that is still running', async () => {
    beginDurableSubmission('saleReturns', 'active');
    const replay = vi.fn(async () => undefined);
    const remove = vi.fn(async (_id: string) => undefined);
    try {
      await expect(replayDurableRecords(['active', 'unreachable', 'confirmed'], {
        id: id => id, label: id => id,
        isActive: id => isDurableSubmissionActive('saleReturns', id),
        exists: async id => { if (id === 'unreachable') throw new Error('network'); return true; },
        replay, remove,
      })).rejects.toThrow('unreachable');
      expect(remove).toHaveBeenCalledExactlyOnceWith('confirmed');
      expect(replay).not.toHaveBeenCalled();
    } finally { endDurableSubmission('saleReturns', 'active'); }
  });
});
