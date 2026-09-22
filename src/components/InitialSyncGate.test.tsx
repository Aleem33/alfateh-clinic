import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OfflineCacheStatus } from '../lib/offlineCache';

const mocks = vi.hoisted(() => ({
  status: {} as OfflineCacheStatus,
  session: { mode: 'online', profile: {} } as any,
  lan: { online: true } as any,
}));
vi.mock('../lib/offlineCache', () => ({
  getOfflineCacheStatus: () => mocks.status,
  subscribeOfflineCache: vi.fn(() => () => undefined),
}));
vi.mock('./SyncStatusBadge', () => ({ SyncStatusBadge: () => <button>Sync details</button> }));
vi.mock('../lib/offlineAuth', () => ({
  getActiveAuthSession: () => mocks.session,
  subscribeActiveAuthSession: vi.fn(() => () => undefined),
}));
vi.mock('../lib/lanCoordinator', () => ({
  getLanStatus: () => mocks.lan,
  subscribeLanStatus: vi.fn(() => () => undefined),
}));
import { InitialSyncGate } from './InitialSyncGate';

beforeEach(() => {
  mocks.session = { mode: 'online', profile: {} };
  mocks.lan = { online: true };
  mocks.status = { active: true, mode: 'legacy', readyCollections: 33, serverConfirmedCollections: 10,
    totalCollections: 33, fromCacheCollections: 0, pendingCollections: [], incompleteCollections: [],
    unreconciledCollections: [], lastError: '' };
});

const render = () => renderToStaticMarkup(<InitialSyncGate onLogout={() => undefined}><div>Operational inventory</div></InitialSyncGate>);

describe('initial data synchronization gate', () => {
  it('does not present incomplete records as an empty operational screen', () => {
    const html = render();
    expect(html).toContain('Synchronizing current data');
    expect(html).toContain('Cloud data confirmed');
    expect(html).toContain('10/33');
    expect(html).toContain('Sign out');
    expect(html).toContain('Sync details');
    expect(html).not.toContain('Operational inventory');
  });

  it('opens operational pages when every required collection is complete', () => {
    mocks.status.serverConfirmedCollections = 33;
    expect(render()).toContain('Operational inventory');
    expect(render()).not.toContain('Synchronizing current data');
  });

  it('uses a complete local mirror when the user deliberately logged in offline', () => {
    mocks.session = { mode: 'offline', profile: {} };
    mocks.status.serverConfirmedCollections = 0;
    expect(render()).toContain('Operational inventory');
    expect(render()).not.toContain('Synchronizing current data');
  });

  it('keeps the gate visible if cache startup fails or has not started', () => {
    mocks.status.active = false;
    mocks.status.readyCollections = mocks.status.totalCollections = 0;
    mocks.status.lastError = 'Local storage is unavailable';
    expect(render()).toContain('Local storage is unavailable');
    expect(render()).not.toContain('Operational inventory');
  });
});
