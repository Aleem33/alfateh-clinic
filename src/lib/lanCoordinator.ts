import type { LanActivity, LanStatus } from '../types/electron';

const listeners = new Set<(status: LanStatus) => void>();
const activityListeners = new Set<(activity: LanActivity) => void>();
let started = false;
let status: LanStatus = {
  deviceId: 'browser',
  deviceName: 'This device',
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  role: typeof navigator === 'undefined' || navigator.onLine ? 'online' : 'ready',
  primary: null,
  peers: [],
  activities: [],
};

export class OfflineViewerWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OfflineViewerWriteError';
  }
}

function updateStatus(next?: LanStatus) {
  if (!next) return;
  status = next;
  listeners.forEach(listener => listener(status));
}

function receiveActivity(activity: LanActivity) {
  if (!status.activities.some(item => item.id === activity.id)) {
    status = { ...status, activities: [activity, ...status.activities].slice(0, 50) };
  }
  activityListeners.forEach(listener => listener(activity));
  listeners.forEach(listener => listener(status));
}

async function reportConnectivity() {
  const online = navigator.onLine;
  if (window.electronAPI) {
    updateStatus(await window.electronAPI.getLanStatus());
  } else {
    updateStatus({ ...status, online, role: online ? 'online' : 'primary', primary: online ? null : { deviceId: status.deviceId, deviceName: status.deviceName } });
  }
}

export function startLanCoordinator() {
  if (started || typeof window === 'undefined') return;
  started = true;
  if (!window.electronAPI) {
    window.addEventListener('online', reportConnectivity);
    window.addEventListener('offline', reportConnectivity);
  }
  window.electronAPI?.onLanStatus(updateStatus);
  window.electronAPI?.onLanActivity(receiveActivity);
  if (window.electronAPI) {
    void window.electronAPI.getLanStatus().then(updateStatus).then(reportConnectivity);
  } else {
    void reportConnectivity();
  }
}

export function getLanStatus() {
  return status;
}

export function isCloudOnline() {
  if (typeof navigator !== 'undefined' && (typeof window === 'undefined' || !window.electronAPI)) {
    return navigator.onLine !== false;
  }
  return status.online;
}

export function subscribeLanStatus(listener: (snapshot: LanStatus) => void) {
  listeners.add(listener);
  listener(status);
  return () => { listeners.delete(listener); };
}

export function subscribeLanActivity(listener: (activity: LanActivity) => void) {
  activityListeners.add(listener);
  return () => { activityListeners.delete(listener); };
}

export async function ensureLanWriteAccess() {
  if (typeof navigator === 'undefined') return;
  if (isCloudOnline()) {
    if (status.role === 'sync-wait') {
      throw new OfflineViewerWriteError(`${status.primary?.deviceName || 'The offline primary'} is synchronizing queued entries. Please wait until synchronization finishes.`);
    }
    return;
  }
  if (typeof window === 'undefined' || !window.electronAPI) return;
  const result = await window.electronAPI.acquireLanWriteAccess();
  if (result?.status) updateStatus(result.status);
  if (!result?.allowed) {
    throw new OfflineViewerWriteError(result?.reason || 'Another device is currently handling offline entries. This device is view-only.');
  }
}

export async function completeLanCloudSync() {
  if (!window.electronAPI || status.role !== 'syncing-primary') return;
  updateStatus(await window.electronAPI.completeLanCloudSync());
}

export async function publishLanActivity(activity: Partial<LanActivity>) {
  if (typeof navigator === 'undefined' || isCloudOnline() || typeof window === 'undefined' || !window.electronAPI) return;
  await window.electronAPI.publishLanActivity({
    ...activity,
    id: activity.id || crypto.randomUUID(),
    createdAt: activity.createdAt || new Date().toISOString(),
  });
}
