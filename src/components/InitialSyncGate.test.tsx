import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OfflineCacheStatus } from '../lib/offlineCache';

const mocks = vi.hoisted(() => ({ status: {} as OfflineCacheStatus }));
vi.mock('../lib/offlineCache', () => ({
  getOfflineCacheStatus: () => mocks.status,
  subscribeOfflineCache: vi.fn(() => () => undefined),
}));
vi.mock('./SyncStatusBadge', () => ({ SyncStatusBadge: () => <button>Sync details</button> }));
import { InitialSyncGate } from './InitialSyncGate';

beforeEach(() => {
  mocks.status = { active: true, mode: 'legacy', readyCollections: 10, totalCollections: 33, fromCacheCollections: 0, pendingCollections: [], incompleteCollections: [], lastError: '' };
});

const render = () => renderToStaticMarkup(<InitialSyncGate onLogout={() => undefined}><div>Operational inventory</div></InitialSyncGate>);

describe('initial data synchronization gate', () => {
  it('does not present incomplete records as an empty operational screen', () => {
    const html = render();
    expect(html).toContain('Initial synchronization required');
    expect(html).toContain('Data ready: 10/33');
    expect(html).toContain('Sign out');
    expect(html).toContain('Sync details');
    expect(html).not.toContain('Operational inventory');
  });

  it('opens operational pages when every required collection is complete', () => {
    mocks.status.readyCollections = 33;
    expect(render()).toContain('Operational inventory');
    expect(render()).not.toContain('Initial synchronization required');
  });

  it('keeps the gate visible if cache startup fails or has not started', () => {
    mocks.status.active = false;
    mocks.status.readyCollections = mocks.status.totalCollections = 0;
    mocks.status.lastError = 'Local storage is unavailable';
    expect(render()).toContain('Local storage is unavailable');
    expect(render()).not.toContain('Operational inventory');
  });
});
