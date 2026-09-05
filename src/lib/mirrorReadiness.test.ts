import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isOfflineMirrorReady, setOfflineMirrorReadiness } from './mirrorReadiness';

describe('offline mirror readiness gate', () => {
  const values = new Map<string, string>();

  beforeEach(() => {
    values.clear();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) || null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('defaults to blocked and records readiness separately for each role', () => {
    expect(isOfflineMirrorReady('cashier')).toBe(false);
    setOfflineMirrorReadiness('cashier', true, 4);
    expect(isOfflineMirrorReady('cashier')).toBe(true);
    expect(isOfflineMirrorReady('doctor')).toBe(false);
    setOfflineMirrorReadiness('cashier', false, 5);
    expect(isOfflineMirrorReady('cashier')).toBe(false);
  });
});
