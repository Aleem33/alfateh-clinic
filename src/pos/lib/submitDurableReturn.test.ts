import { afterEach, describe, expect, it, vi } from 'vitest';
import { isDurableSubmissionActive } from '../../lib/durableReplay';

const state = vi.hoisted(() => ({
  online: true,
  read: vi.fn(),
  upsert: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/firestore', () => ({ doc: vi.fn(), getDocFromServer: state.read, confirmRecoveredDocument: vi.fn() }));
vi.mock('../../firebase', () => ({ db: {} }));
vi.mock('../../lib/lanCoordinator', () => ({ isCloudOnline: () => state.online }));
vi.mock('../../lib/localMirror', () => ({ upsertLocalRecords: state.upsert }));
import { submitDurableReturn } from './submitDurableReturn';

afterEach(() => { state.online = true; vi.useRealTimers(); vi.clearAllMocks(); });

describe('return submission acknowledgement', () => {
  function input() {
    return {
      collection: 'purchaseReturns' as const, id: 'return-1',
      queue: vi.fn(async () => undefined), commit: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined), onError: vi.fn(),
    };
  }

  it('does not delete recovery when a server read still includes pending local writes', async () => {
    const options = input();
    state.read.mockResolvedValue({ exists: () => true, metadata: { hasPendingWrites: true } });
    await expect(submitDurableReturn(options)).resolves.toBe(false);
    expect(options.remove).not.toHaveBeenCalled();
  });

  it('persists cloud confirmation before removing the recovery record', async () => {
    const options = input();
    state.read.mockResolvedValue({ exists: () => true, metadata: { hasPendingWrites: false }, data: () => ({ total: 15 }) });
    await expect(submitDurableReturn(options)).resolves.toBe(true);
    expect(options.queue.mock.invocationCallOrder[0]).toBeLessThan(options.commit.mock.invocationCallOrder[0]);
    expect(state.upsert.mock.invocationCallOrder[0]).toBeLessThan(options.remove.mock.invocationCallOrder[0]);
    expect(isDurableSubmissionActive('purchaseReturns', 'return-1')).toBe(false);
  });

  it('retains the queued operation after rejection and releases its submission lock', async () => {
    const options = input();
    options.commit.mockRejectedValueOnce(new Error('permission denied'));
    await expect(submitDurableReturn(options)).resolves.toBe(false);
    expect(options.remove).not.toHaveBeenCalled();
    expect(options.onError).toHaveBeenCalled();
    expect(isDurableSubmissionActive('purchaseReturns', 'return-1')).toBe(false);
  });

  it('does not submit anything when local persistence fails', async () => {
    const options = input();
    options.queue.mockRejectedValueOnce(new Error('disk full'));
    await expect(submitDurableReturn(options)).rejects.toThrow('disk full');
    expect(options.commit).not.toHaveBeenCalled();
    expect(options.remove).not.toHaveBeenCalled();
  });

  it('keeps an in-flight operation excluded from replay after the UI times out', async () => {
    vi.useFakeTimers();
    const options = input();
    let finish!: () => void;
    options.commit.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    state.read.mockResolvedValue({ exists: () => true, metadata: { hasPendingWrites: false }, data: () => ({ total: 15 }) });
    const submitted = submitDurableReturn(options);
    await vi.advanceTimersByTimeAsync(8_001);
    await expect(submitted).resolves.toBe(false);
    expect(isDurableSubmissionActive('purchaseReturns', 'return-1')).toBe(true);
    expect(options.remove).not.toHaveBeenCalled();
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(options.remove).toHaveBeenCalledOnce();
    expect(isDurableSubmissionActive('purchaseReturns', 'return-1')).toBe(false);
  });
});
