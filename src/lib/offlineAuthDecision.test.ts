import { describe, expect, it } from 'vitest';
import { needsCloudSessionRestore, shouldAnnounceCloudReady } from './offlineAuthDecision';
import type { AuthSession } from './offlineAuth';

function session(mode: AuthSession['mode'], uid = 'user-1'): AuthSession {
  return {
    mode,
    profile: {
      uid,
      username: 'cashier',
      email: 'cashier@alfateh-clinic.internal',
      name: 'Cashier',
      role: 'cashier',
      app: 'pos',
      permissions: [],
      active: true,
      profileUpdatedAt: '2026-08-27T00:00:00.000Z',
    },
  };
}

describe('offline authentication reconnect decision', () => {
  it('does not reauthenticate an already-online matching Firebase user', () => {
    expect(needsCloudSessionRestore(session('online'), 'user-1')).toBe(false);
  });

  it('restores an offline session when cloud connectivity returns', () => {
    expect(needsCloudSessionRestore(session('offline'), null)).toBe(true);
  });

  it('repairs an online session whose Firebase user is missing or different', () => {
    expect(needsCloudSessionRestore(session('online'), null)).toBe(true);
    expect(needsCloudSessionRestore(session('online'), 'user-2')).toBe(true);
  });
});

describe('cloud-ready announcements', () => {
  it('does not announce readiness again for every online LAN heartbeat', () => {
    expect(shouldAnnounceCloudReady(false, true)).toBe(false);
  });

  it('announces readiness after Firestore was disabled or auth was not ready', () => {
    expect(shouldAnnounceCloudReady(true, true)).toBe(true);
    expect(shouldAnnounceCloudReady(false, false)).toBe(true);
  });
});