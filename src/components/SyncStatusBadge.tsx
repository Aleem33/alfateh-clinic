import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, CloudOff, RefreshCw } from 'lucide-react';
import { subscribeSyncStatus, type SyncSnapshot } from '../lib/offlineSync';

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

export function SyncStatusBadge({ compact = false }: { compact?: boolean }) {
  const status = useSyncStatus();

  const hasIssue = Boolean(status.lastError) || status.issueCount > 0;
  const label = !status.online
    ? 'Offline'
    : status.syncing
      ? 'Syncing'
      : hasIssue
        ? 'Sync issue'
        : status.pendingCount > 0
          ? 'Pending changes'
          : 'Online';

  const Icon = !status.online ? CloudOff : status.syncing ? RefreshCw : hasIssue ? AlertTriangle : CheckCircle2;
  const color = !status.online
    ? 'bg-amber-50 text-amber-700 border-amber-200'
    : hasIssue
      ? 'bg-red-50 text-red-700 border-red-200'
      : status.pendingCount > 0 || status.syncing
        ? 'bg-blue-50 text-blue-700 border-blue-200'
        : 'bg-green-50 text-green-700 border-green-200';

  return (
    <div
      title={`Device ${status.devicePrefix || 'local'}${status.lastError ? ` - ${status.lastError}` : ''}`}
      className={`inline-flex items-center gap-1.5 border rounded-full px-2.5 py-1 text-xs font-medium ${color}`}
    >
      <Icon className={`w-3.5 h-3.5 ${status.syncing ? 'animate-spin' : ''}`} />
      {!compact && <span>{label}</span>}
      {status.pendingCount > 0 && <span className="font-mono">{status.pendingCount}</span>}
      {!compact && status.devicePrefix && <span className="font-mono opacity-70">{status.devicePrefix}</span>}
    </div>
  );
}
