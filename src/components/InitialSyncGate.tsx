import { useEffect, useRef, useState, type ReactNode } from 'react';
import { getOfflineCacheStatus, subscribeOfflineCache } from '../lib/offlineCache';
import { getActiveAuthSession, subscribeActiveAuthSession } from '../lib/offlineAuth';
import { getLanStatus, subscribeLanStatus } from '../lib/lanCoordinator';
import { SyncStatusBadge } from './SyncStatusBadge';

export function keepInitialSyncGateOpen(opened: boolean, ready: boolean) {
  return opened || ready;
}

export function InitialSyncGate({ children, onLogout }: { children: ReactNode; onLogout: () => void }) {
  const [cache, setCache] = useState(getOfflineCacheStatus);
  const [session, setSession] = useState(getActiveAuthSession);
  const [lan, setLan] = useState(getLanStatus);
  const localReady = cache.active && cache.totalCollections > 0 && cache.readyCollections === cache.totalCollections;
  const requiresServerConfirmation = session?.mode !== 'offline' && lan.online;
  const serverReady = cache.totalCollections > 0 && cache.serverConfirmedCollections === cache.totalCollections;
  const ready = localReady && (!requiresServerConfirmation || serverReady);
  const completedCollections = requiresServerConfirmation
    ? cache.serverConfirmedCollections
    : cache.readyCollections;
  const progress = cache.totalCollections > 0
    ? Math.round((completedCollections / cache.totalCollections) * 100)
    : 0;
  // This is a one-time login gate. Incremental listeners can briefly restart
  // after a normal write or control refresh; once this session has seen a
  // complete authoritative snapshot, never cover the working app again.
  const openedRef = useRef(ready);
  openedRef.current = keepInitialSyncGateOpen(openedRef.current, ready);
  const opened = openedRef.current;
  useEffect(() => subscribeOfflineCache(setCache), []);
  useEffect(() => subscribeActiveAuthSession(setSession), []);
  useEffect(() => subscribeLanStatus(setLan), []);

  return <div className="relative h-full">
    {/* Retain mounted forms and carts during a listener restart. Hidden content
        cannot be focused or mistaken for a complete inventory or report. */}
    {opened && <div>{children}</div>}
    {!opened && <div className="absolute inset-0 z-[90] min-h-screen bg-slate-100 p-4 md:p-6" role="status" aria-live="polite">
      <div className="mx-auto flex h-full max-w-6xl gap-5 overflow-hidden">
        <div className="hidden w-56 shrink-0 rounded-2xl border border-slate-200 bg-white p-5 md:block" aria-hidden="true">
          <div className="h-9 w-36 animate-pulse rounded-lg bg-slate-200" />
          <div className="mt-8 space-y-4">{Array.from({ length: 8 }, (_, index) => <div key={index} className="h-9 animate-pulse rounded-lg bg-slate-100" />)}</div>
        </div>
        <div className="min-w-0 flex-1 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Synchronizing current data</h1>
              <p className="mt-2 max-w-2xl text-slate-600">
                {requiresServerConfirmation
                  ? 'Checking every record against the cloud before the app opens. This prevents old cached totals and entries from appearing.'
                  : 'Preparing the complete offline records stored on this computer.'}
              </p>
            </div>
            <SyncStatusBadge />
          </div>
          <div className="mt-6">
            <div className="flex justify-between text-sm font-semibold text-slate-700">
              <span>{requiresServerConfirmation ? 'Cloud data confirmed' : 'Offline data ready'}</span>
              <span>{completedCollections}/{cache.totalCollections || '…'} · {progress}%</span>
            </div>
            <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-200">
              <div className="h-full rounded-full bg-blue-600 transition-all duration-300" style={{ width: `${progress}%` }} />
            </div>
          </div>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
            {Array.from({ length: 6 }, (_, index) => <div key={index} className="rounded-xl border border-slate-100 p-4">
              <div className="h-4 w-24 animate-pulse rounded bg-slate-200" />
              <div className="mt-4 h-8 w-36 animate-pulse rounded bg-slate-100" />
              <div className="mt-4 h-3 w-full animate-pulse rounded bg-slate-100" />
            </div>)}
          </div>
          {cache.lastError && <p className="mt-6 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{cache.lastError}</p>}
          <div className="mt-6 flex items-center justify-between gap-3 border-t border-slate-100 pt-5">
            <p className="text-sm text-slate-500">The app will open automatically when all permitted data is ready.</p>
            <button type="button" className="shrink-0 rounded-lg border border-slate-300 px-4 py-2 font-medium text-slate-700 hover:bg-slate-50" onClick={onLogout}>Sign out</button>
          </div>
        </div>
      </div>
    </div>}
  </div>;
}
