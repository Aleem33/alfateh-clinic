import { useEffect, useState, type ReactNode } from 'react';
import { getOfflineCacheStatus, subscribeOfflineCache } from '../lib/offlineCache';
import { SyncStatusBadge } from './SyncStatusBadge';

export function InitialSyncGate({ children, onLogout }: { children: ReactNode; onLogout: () => void }) {
  const [cache, setCache] = useState(getOfflineCacheStatus);
  const ready = cache.active && cache.totalCollections > 0 && cache.readyCollections === cache.totalCollections;
  const [opened, setOpened] = useState(ready);
  useEffect(() => subscribeOfflineCache(setCache), []);
  useEffect(() => { if (ready) setOpened(true); }, [ready]);

  return <div className="relative h-full">
    {/* Retain mounted forms and carts during a listener restart. Hidden content
        cannot be focused or mistaken for a complete inventory or report. */}
    {(opened || ready) && <div style={{ visibility: ready ? 'visible' : 'hidden' }}>{children}</div>}
    {!ready && <div className="absolute inset-0 z-[90] min-h-screen bg-slate-100 flex items-center justify-center p-6" role="status" aria-live="polite">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-bold text-slate-900">Initial synchronization required</h1>
        <p className="mt-3 text-slate-600">Preparing the complete records for this account. Keep this computer online until synchronization finishes.</p>
        <p className="mt-5 text-lg font-semibold text-blue-700">Data ready: {cache.readyCollections}/{cache.totalCollections || '…'}</p>
        <p className="mt-2 text-sm text-slate-500">Saved records will appear when ready. Any work already open will remain available after synchronization.</p>
        {cache.lastError && <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{cache.lastError}</p>}
        <div className="mt-6 flex items-center justify-between gap-3">
          <SyncStatusBadge />
          <button type="button" className="rounded-lg border border-slate-300 px-4 py-2 font-medium text-slate-700 hover:bg-slate-50" onClick={onLogout}>Sign out</button>
        </div>
      </div>
    </div>}
  </div>;
}
