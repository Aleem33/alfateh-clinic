import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, orderBy, query, updateDoc } from 'firebase/firestore';
import { AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import { db } from '../firebase';
import { runOfflineSyncNow } from '../lib/offlineSync';

export function SyncIssuesPage() {
  const [issues, setIssues] = useState<any[]>([]);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    const q = query(collection(db, 'syncIssues'), orderBy('updatedAt', 'desc'));
    return onSnapshot(q, snap => setIssues(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
  }, []);

  const openIssues = issues.filter(i => i.status !== 'resolved');

  const resolveIssue = async (issue: any) => {
    await updateDoc(doc(db, 'syncIssues', issue.id), {
      status: 'resolved',
      resolvedAt: new Date().toISOString(),
    });
  };

  const runSync = async () => {
    setSyncing(true);
    try {
      await runOfflineSyncNow();
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Sync Issues</h1>
          <p className="text-sm text-gray-500">{openIssues.length} open issue(s) from offline/online sync</p>
        </div>
        <button
          onClick={runSync}
          disabled={syncing || !navigator.onLine}
          className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60"
        >
          <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
          Check Now
        </button>
      </div>

      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
        {openIssues.length === 0 ? (
          <div className="py-12 text-center">
            <CheckCircle2 className="w-10 h-10 text-green-500 mx-auto mb-3" />
            <p className="font-semibold text-gray-900">No open sync issues</p>
            <p className="text-sm text-gray-500">Offline changes are either synced or waiting normally.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {openIssues.map(issue => (
              <div key={issue.id} className="p-4 flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-gray-900">{issue.medicineName || issue.type || 'Sync issue'}</div>
                  <div className="text-sm text-gray-600 mt-0.5">{issue.message || 'Review this offline sync issue.'}</div>
                  <div className="text-xs text-gray-400 mt-1">
                    Stock: {issue.stock ?? '-'} · Device: {issue.devicePrefix || '-'} · {issue.updatedAt ? new Date(issue.updatedAt).toLocaleString() : ''}
                  </div>
                </div>
                <button
                  onClick={() => resolveIssue(issue)}
                  className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Mark Resolved
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
