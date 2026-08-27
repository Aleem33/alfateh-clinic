import { afterEach, describe, expect, it, vi } from 'vitest';
import { SyncTimeoutError, waitForSyncStep } from './syncTiming';

afterEach(() => vi.useRealTimers());

describe('bounded sync steps', () => {
  it('returns a completed sync result and clears its timer', async () => {
    await expect(waitForSyncStep(Promise.resolve('done'), 1000, 'Cloud sync')).resolves.toBe('done');
  });

  it('surfaces the original synchronization error', async () => {
    await expect(waitForSyncStep(Promise.reject(new Error('permission denied')), 1000, 'Cloud sync'))
      .rejects.toThrow('permission denied');
  });

  it('stops the UI waiting forever when Firestore does not settle', async () => {
    vi.useFakeTimers();
    const result = waitForSyncStep(new Promise(() => undefined), 15_000, 'Queued cloud writes');
    const assertion = expect(result).rejects.toBeInstanceOf(SyncTimeoutError);
    await vi.advanceTimersByTimeAsync(15_000);
    await assertion;
  });
});