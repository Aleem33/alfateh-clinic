import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, CloudOff, RefreshCw, Wifi, X } from 'lucide-react';
import { subscribeSyncStatus, type SyncSnapshot } from '../lib/offlineSync';
import { getLanStatus, subscribeLanStatus } from '../lib/lanCoordinator';
import type { LanStatus } from '../types/electron';
import { subscribeOfflineCache, type OfflineCacheStatus } from '../lib/offlineCache';

const initial: SyncSnapshot = {
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  syncing: false,
  pendingCount: 0,
  issueCount: 0,
  lastError: '',
  devicePrefix: '',
};

export function useSyncStatus() {
  const [status, setStatus] = useState<SyncSnapshot>(initial);
  useEffect(() => subscribeSyncStatus(setStatus), []);
  return status;
}

function useLanStatus() {
  const [status, setStatus] = useState<LanStatus>(getLanStatus());
  useEffect(() => subscribeLanStatus(setStatus), []);
  return status;
}

const initialCacheStatus: OfflineCacheStatus = {
  active: false,
  readyCollections: 0,
  totalCollections: 0,
  fromCacheCollections: 0,
  pendingCollections: [],
  lastError: '',
};

function useOfflineCacheStatus() {
  const [cache, setCache] = useState(initialCacheStatus);
  useEffect(() => subscribeOfflineCache(setCache), []);
  return cache;
}

export function SyncStatusBadge({ compact = false }: { compact?: boolean }) {
  const status = useSyncStatus();
  const lan = useLanStatus();
  const cache = useOfflineCacheStatus();
  const [showDetails, setShowDetails] = useState(false);

  const hasIssue = Boolean(status.lastError) || status.issueCount > 0;
  const lanSyncBarrier = lan.role === 'syncing-primary' || lan.role === 'sync-wait';
  const label = lan.role === 'syncing-primary'
    ? 'Uploading offline entries'
    : lan.role === 'sync-wait'
      ? `Waiting for ${lan.primary?.deviceName || 'primary'}`
      : !status.online
    ? lan.role === 'primary'
      ? 'Offline primary'
      : lan.role === 'viewer'
        ? `Viewing ${lan.primary?.deviceName || 'primary'}`
        : lan.role === 'candidate'
          ? 'Selecting primary'
          : 'Offline ready'
    : status.syncing
      ? 'Syncing'
      : hasIssue
        ? 'Sync issue'
        : status.pendingCount > 0
          ? 'Pending changes'
          : 'Online';

  const Icon = lanSyncBarrier ? RefreshCw : !status.online ? (lan.role === 'viewer' ? Wifi : CloudOff) : status.syncing ? RefreshCw : hasIssue ? AlertTriangle : CheckCircle2;
  const color = !status.online
    ? 'bg-amber-50 text-amber-700 border-amber-200'
    : hasIssue
      ? 'bg-red-50 text-red-700 border-red-200'
      : status.pendingCount > 0 || status.syncing || lanSyncBarrier
        ? 'bg-blue-50 text-blue-700 border-blue-200'
        : 'bg-green-50 text-green-700 border-green-200';

  return <>
    <button
      type="button"
      onClick={() => setShowDetails(true)}
      title={`Device ${status.devicePrefix || 'local'}${status.lastError ? ` - ${status.lastError}` : ''}`}
      className={`inline-flex items-center gap-1.5 border rounded-full px-2.5 py-1 text-xs font-medium ${color}`}
    >
      <Icon className={`w-3.5 h-3.5 ${status.syncing || lanSyncBarrier ? 'animate-spin' : ''}`} />
      {!compact && <span>{label}</span>}
      {status.pendingCount > 0 && <span className="font-mono">{status.pendingCount}</span>}
      {!compact && status.devicePrefix && <span className="font-mono opacity-70">{status.devicePrefix}</span>}
    </button>

    {showDetails && (
      <div className="fixed inset-0 z-[100] bg-black/30 flex items-start justify-end p-4 md:p-6" onClick={() => setShowDetails(false)}>
        <div className="w-full max-w-md bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden" onClick={event => event.stopPropagation()}>
          <div className="p-4 border-b border-gray-100 flex items-start justify-between gap-3">
            <div>
              <h2 className="font-bold text-gray-900">Online & LAN Status</h2>
              <p className="text-xs text-gray-500 mt-1">{lan.deviceName} · {status.devicePrefix || 'local'}</p>
            </div>
            <button type="button" onClick={() => setShowDetails(false)} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700"><X className="w-4 h-4" /></button>
          </div>

          <div className="p-4 space-y-3">
            <div className={`rounded-lg border p-3 ${status.online ? 'bg-green-50 border-green-200' : lan.role === 'primary' ? 'bg-blue-50 border-blue-200' : 'bg-amber-50 border-amber-200'}`}>
              <p className="text-sm font-semibold text-gray-900">{label}</p>
              <p className="text-xs text-gray-600 mt-1">
                {lan.role === 'syncing-primary'
                  ? 'This device is uploading every queued offline entry. Other devices remain read-only until confirmation.'
                  : lan.role === 'sync-wait'
                    ? 'The offline primary is synchronizing. Write access will reopen automatically after confirmation.'
                    : status.online
                  ? 'Cloud synchronization is available on all devices.'
                  : lan.role === 'primary'
                    ? 'This device has write access. Entries are queued for cloud synchronization and broadcast over Wi-Fi.'
                    : lan.role === 'viewer'
                      ? 'This device is read-only and is receiving live activity from the offline primary.'
                      : 'The first device that saves an entry will automatically become the offline primary.'}
              </p>
            </div>

            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="rounded-lg bg-gray-50 p-3"><p className="text-gray-500">Connected devices</p><p className="font-bold text-gray-900 mt-1">{lan.peers.length + 1}</p></div>
              <div className="rounded-lg bg-gray-50 p-3"><p className="text-gray-500">Pending cloud changes</p><p className="font-bold text-gray-900 mt-1">{status.pendingCount}</p></div>
              <div className="rounded-lg bg-gray-50 p-3"><p className="text-gray-500">Offline data ready</p><p className="font-bold text-gray-900 mt-1">{cache.readyCollections}/{cache.totalCollections}</p></div>
            </div>
            {cache.active && cache.readyCollections < cache.totalCollections && status.online && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg p-2.5">Keep this device online until all offline collections are ready.</p>
            )}

            <div>
              <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">Live LAN activity</h3>
              <div className="border border-gray-100 rounded-lg max-h-72 overflow-auto divide-y divide-gray-100">
                {lan.activities.length === 0 ? (
                  <p className="p-5 text-center text-xs text-gray-400">No offline LAN activity yet.</p>
                ) : lan.activities.map(activity => (
                  <div key={activity.id} className="p-3">
                    <div className="flex justify-between gap-3">
                      <p className="text-sm font-medium text-gray-900 truncate">{activity.label || activity.collection}</p>
                      <span className="text-[10px] text-gray-400 shrink-0">{new Date(activity.createdAt).toLocaleTimeString()}</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">{activity.action} · {activity.collection}{activity.summary ? ` · ${activity.summary}` : ''}</p>
                    {activity.deviceName && <p className="text-[10px] text-blue-500 mt-1">{activity.deviceName}</p>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    )}
  </>;
}
