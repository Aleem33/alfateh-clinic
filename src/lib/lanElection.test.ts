import { createRequire } from 'module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { selectLanPrimaryCandidate, shouldExpireSyncBarrier } = require('../../lanCoordinator.js');

describe('LAN primary election', () => {
  it('selects the same device regardless of claim arrival order', () => {
    const claims = ['device-z', 'device-a', 'device-m'];
    expect(selectLanPrimaryCandidate(claims)).toBe('device-a');
    expect(selectLanPrimaryCandidate([...claims].reverse())).toBe('device-a');
  });

  it('ignores duplicate claims from the same device', () => {
    expect(selectLanPrimaryCandidate(['device-b', 'device-b', 'device-c'])).toBe('device-b');
  });

  it('returns no primary when no device has requested write access', () => {
    expect(selectLanPrimaryCandidate([])).toBeNull();
  });
});

describe('LAN cloud-sync barrier', () => {
  it('expires a missed primary completion announcement after its safety window', () => {
    expect(shouldExpireSyncBarrier('sync-wait', 10_000, 10_000)).toBe(true);
    expect(shouldExpireSyncBarrier('syncing-primary', 10_000, 10_001)).toBe(true);
  });

  it('does not expire normal online state or an active barrier', () => {
    expect(shouldExpireSyncBarrier('online', 10_000, 20_000)).toBe(false);
    expect(shouldExpireSyncBarrier('sync-wait', 20_000, 10_000)).toBe(false);
  });
});
