import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, CloudOff, RefreshCw, Wifi, X } from 'lucide-react';
import { subscribeSyncStatus, type SyncSnapshot } from '../lib/offlineSync';
import { getLanStatus, subscribeLanStatus } from '../lib/lanCoordinator';
import type { LanStatus } from '../types/electron';
import { subscribeOfflineCache, type OfflineCacheStatus } from '../lib/offlineCache';
import {
  getFirestoreReadDiagnostics,
  resetFirestoreReadDiagnostics,
  subscribeToFirestoreReadDiagnostics,
  type FirestoreReadDiagnostics,
} from '../lib/readDiagnostics';

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
  mode: 'legacy',
  readyCollections: 0,
  totalCollections: 0,
  fromCacheCollections: 0,
  pendingCollections: [],
  incompleteCollections: [],
  lastError: '',
};

function useOfflineCacheStatus() {
  const [cache, setCache] = useState(initialCacheStatus);
  useEffect(() => subscribeOfflineCache(setCache), []);
  return cache;
}

function useFirestoreReadDiagnostics() {
  const [diagnostics, setDiagnostics] = useState<FirestoreReadDiagnostics>(getFirestoreReadDiagnostics());
  useEffect(() => subscribeToFirestoreReadDiagnostics(setDiagnostics), []);
  return diagnostics;
}

export function SyncStatusBadge({ compact = false }: { compact?: boolean }) {
  const status = useSyncStatus();
  const lan = useLanStatus();
  const cache = useOfflineCacheStatus();
  const readDiagnostics = useFirestoreReadDiagnostics();
  const [showDetails, setShowDetails] = useState(false);
  const initialSyncRequired = cache.active
    && cache.totalCollections > 0
    && cache.readyCollections < cache.totalCollections;
  const topReadCollections = Object.entries(readDiagnostics.byCollection)
    .sort(([, left], [, right]) => right.documents - left.documents)
    .slice(0, 5);
  const topReadRoutes = Object.entries(readDiagnostics.byRoute)
    .sort(([, left], [, right]) => right.documents - left.documents)
    .slice(0, 3);
  const sourceSummary = Object.entries(readDiagnostics.bySource)
    .sort(([, left], [, right]) => right.documents - left.documents);
  const reasonSummary = Object.entries(readDiagnostics.byReason)
    .sort(([, left], [, right]) => right.documents - left.documents);

  const hasIssue = Boolean(status.lastError || cache.lastError) || status.issueCount > 0;
  const lanSyncBarrier = lan.role === 'syncing-primary' || lan.role === 'sync-wait';
  const label = lan.role === 'syncing-primary'
    ? 'Uploading offline entries'
    : lan.role === 'sync-wait'
      ? `Waiting for ${lan.primary?.deviceName || 'primary'}`
      : initialSyncRequired
        ? 'Initial sync required'
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

  const Icon = lanSyncBarrier ? RefreshCw : initialSyncRequired ? AlertTriangle : !status.online ? (lan.role === 'viewer' ? Wifi : CloudOff) : status.syncing ? RefreshCw : hasIssue ? AlertTriangle : CheckCircle2;
  const color = initialSyncRequired
    ? 'bg-amber-50 text-amber-700 border-amber-200'
    : !status.online
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
      title={`Device ${status.devicePrefix || 'local'}${status.lastError || cache.lastError ? ` - ${status.lastError || cache.lastError}` : ''}`}
      className={`inline-flex items-center gap-1.5 border rounded-full px-2.5 py-1 text-xs font-medium ${color}`}
    >
      <Icon className={`w-3.5 h-3.5 ${status.syncing || lanSyncBarrier ? 'animate-spin' : ''}`} />
      {!compact && <span>{label}</span>}
      {status.pendingCount > 0 && <span className="font-mono">{status.pendingCount}</span>}
      {!compact && status.devicePrefix && <span className="font-mono opacity-70">{status.devicePrefix}</span>}
    </button>

    {showDetails && (
      <div className="fixed inset-0 z-[100] bg-black/30 flex items-start justify-end p-4 md:p-6" onClick={() => setShowDetails(false)}>
        <div className="w-full max-w-md max-h-[calc(100vh-3rem)] bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden flex flex-col" onClick={event => event.stopPropagation()}>
          <div className="p-4 border-b border-gray-100 flex items-start justify-between gap-3">
            <div>
              <h2 className="font-bold text-gray-900">Online & LAN Status</h2>
              <p className="text-xs text-gray-500 mt-1">{lan.deviceName} · {status.devicePrefix || 'local'}</p>
            </div>
            <button type="button" onClick={() => setShowDetails(false)} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700"><X className="w-4 h-4" /></button>
          </div>

          <div className="p-4 space-y-3 overflow-y-auto">
            <div className={`rounded-lg border p-3 ${status.online ? 'bg-green-50 border-green-200' : lan.role === 'primary' ? 'bg-blue-50 border-blue-200' : 'bg-amber-50 border-amber-200'}`}>
              <p className="text-sm font-semibold text-gray-900">{label}</p>
              <p className="text-xs text-gray-600 mt-1">
                {lan.role === 'syncing-primary'
                  ? 'This device is uploading every queued offline entry. Other devices remain read-only until confirmation.'
                  : lan.role === 'sync-wait'
                    ? 'The offline primary is synchronizing. Write access will reopen automatically after confirmation.'
                    : initialSyncRequired
                      ? 'This device must finish its first complete data synchronization before offline entries can be created.'
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
              <div className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg p-2.5">
                <p className="font-semibold">Initial synchronization required</p>
                <p className="mt-1">Keep this device online until all offline collections are ready. Incomplete data is never presented as an empty result.</p>
                {cache.incompleteCollections.length > 0 && (
                  <p className="mt-1 break-words">Waiting for: {cache.incompleteCollections.join(', ')}</p>
                )}
              </div>
            )}
            {cache.lastError && (
              <p className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg p-2.5">{cache.lastError}</p>
            )}

            <div className="border border-gray-100 rounded-lg p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500">Local read diagnostics</h3>
                  <p className="text-[11px] text-gray-500 mt-1">Estimated document deliveries on this PC only. Nothing is written back to Firestore.</p>
                </div>
                <button
                  type="button"
                  onClick={() => resetFirestoreReadDiagnostics()}
                  className="text-[11px] font-medium text-blue-600 hover:text-blue-800 shrink-0"
                >
                  Reset
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-3 text-xs">
                <div className="rounded-lg bg-gray-50 p-2.5"><p className="text-gray-500">Mirror mode</p><p className="font-bold text-gray-900 mt-1 capitalize">{cache.mode}</p></div>
                <div className="rounded-lg bg-gray-50 p-2.5"><p className="text-gray-500">Read events</p><p className="font-bold text-gray-900 mt-1">{readDiagnostics.total.operations.toLocaleString()}</p></div>
                <div className="rounded-lg bg-gray-50 p-2.5"><p className="text-gray-500">Documents</p><p className="font-bold text-gray-900 mt-1">{readDiagnostics.total.documents.toLocaleString()}</p></div>
              </div>
              {topReadCollections.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  {topReadCollections.map(([collectionName, counter]) => (
                    <div key={collectionName} className="flex items-center justify-between gap-3 text-xs">
                      <span className="text-gray-600 truncate">{collectionName}</span>
                      <span className="font-mono text-gray-500 shrink-0">{counter.documents.toLocaleString()} docs · {counter.operations.toLocaleString()} events</span>
                    </div>
                  ))}
                </div>
              )}
              {(sourceSummary.length > 0 || reasonSummary.length > 0) && (
                <div className="grid grid-cols-2 gap-3 mt-3 pt-3 border-t border-gray-100 text-[11px]">
                  <div>
                    <p className="font-semibold text-gray-600 mb-1">By source</p>
                    {sourceSummary.map(([name, counter]) => (
                      <div key={name} className="flex justify-between gap-2"><span className="capitalize text-gray-500">{name}</span><span className="font-mono text-gray-600">{counter.documents.toLocaleString()}</span></div>
                    ))}
                  </div>
                  <div>
                    <p className="font-semibold text-gray-600 mb-1">By reason</p>
                    {reasonSummary.map(([name, counter]) => (
                      <div key={name} className="flex justify-between gap-2"><span className="capitalize text-gray-500">{name}</span><span className="font-mono text-gray-600">{counter.documents.toLocaleString()}</span></div>
                    ))}
                  </div>
                </div>
              )}
              {topReadRoutes.length > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-100 text-[11px]">
                  <p className="font-semibold text-gray-600 mb-1">Top routes</p>
                  {topReadRoutes.map(([route, counter]) => (
                    <div key={route} className="flex justify-between gap-3"><span className="text-gray-500 truncate">{route}</span><span className="font-mono text-gray-600 shrink-0">{counter.documents.toLocaleString()}</span></div>
                  ))}
                </div>
              )}
            </div>

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
