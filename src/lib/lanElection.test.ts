import { createRequire } from 'module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { selectLanPrimaryCandidate } = require('../../lanCoordinator.js');

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
