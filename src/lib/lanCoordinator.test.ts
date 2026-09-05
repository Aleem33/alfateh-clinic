import { beforeEach, describe, expect, it, vi } from 'vitest';

const mirror = vi.hoisted(() => ({ ready: true }));

vi.mock('./mirrorReadiness', () => ({ isOfflineMirrorReady: () => mirror.ready }));
vi.mock('./offlineAuth', () => ({
  getActiveAuthSession: () => ({ profile: { role: 'cashier' } }),
}));

import { ensureLanWriteAccess, OfflineViewerWriteError, publishLanActivity } from './lanCoordinator';

describe('LAN offline write coordination', () => {
  const acquireLanWriteAccess = vi.fn();
  const publishActivity = vi.fn();

  beforeEach(() => {
    acquireLanWriteAccess.mockReset();
    publishActivity.mockReset();
    mirror.ready = true;
    vi.stubGlobal('navigator', { onLine: false });
    vi.stubGlobal('window', {
      electronAPI: {
        acquireLanWriteAccess,
        publishLanActivity: publishActivity,
      },
    });
  });

  it('allows the device that wins the offline-primary lease to write', async () => {
    acquireLanWriteAccess.mockResolvedValue({ allowed: true });
    await expect(ensureLanWriteAccess()).resolves.toBeUndefined();
  });

  it('blocks an offline viewer before any database write is queued', async () => {
    acquireLanWriteAccess.mockResolvedValue({ allowed: false, reason: 'Pharmacy-PC-2 is the active offline device.' });
    await expect(ensureLanWriteAccess()).rejects.toEqual(expect.objectContaining({
      name: OfflineViewerWriteError.name,
      message: 'Pharmacy-PC-2 is the active offline device.',
    }));
  });

  it('blocks all offline writes until the local dataset is completely synchronized', async () => {
    mirror.ready = false;
    acquireLanWriteAccess.mockResolvedValue({ allowed: true });

    await expect(ensureLanWriteAccess()).rejects.toEqual(expect.objectContaining({
      name: OfflineViewerWriteError.name,
      message: expect.stringContaining('Initial synchronization is required'),
    }));
    expect(acquireLanWriteAccess).not.toHaveBeenCalled();
  });

  it('broadcasts primary activity with a unique event identity', async () => {
    publishActivity.mockResolvedValue(true);
    await publishLanActivity({ collection: 'sales', action: 'created', label: 'SALE-R4U6-0001' });
    expect(publishActivity).toHaveBeenCalledWith(expect.objectContaining({
      id: expect.any(String),
      createdAt: expect.any(String),
      collection: 'sales',
    }));
  });
});
