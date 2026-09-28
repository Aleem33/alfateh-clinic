import { useEffect, useState } from 'react';
import { doc, updateDoc } from '@/lib/firestore';
import { AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import { db } from '../firebase';
import { runOfflineSyncNow } from '../lib/offlineSync';
import { isCloudOnline } from '../lib/lanCoordinator';
import { trustedNowISO } from '../lib/trustedClock';
import { subscribeToLocalCollection } from '../lib/collectionRepository';
import { reconcileRecoveredSaleStock } from '../pos/lib/stockReconciliation';

export function SyncIssuesPage() {
  const [issues, setIssues] = useState<any[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [reconciling, setReconciling] = useState<any>(null);
  const [countedStock, setCountedStock] = useState('');
  const [countedBonus, setCountedBonus] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    return subscribeToLocalCollection('syncIssues', records => setIssues(
      records.sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || ''))),
    ));
  }, []);

  const openIssues = issues.filter(i => i.status !== 'resolved');

  const resolveIssue = async (issue: any) => {
    if (issue.type === 'sale-stock-reconciliation') {
      setReconciling(issue); setCountedStock(''); setCountedBonus(''); setNote(''); setError('');
      return;
    }
    await updateDoc(doc(db, 'syncIssues', issue.id), {
      status: 'resolved',
      resolvedAt: trustedNowISO(),
    });
  };

  const saveCount = async () => {
    if (!reconciling || saving) return;
    setSaving(true); setError('');
    try {
      if (countedStock === '' || countedBonus === '') throw new Error('Enter both physical counts, including zero where appropriate.');
      await reconcileRecoveredSaleStock(reconciling.id, Number(countedStock), Number(countedBonus), note);
      setReconciling(null);
      await runOfflineSyncNow();
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setSaving(false); }
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
          disabled={syncing || !isCloudOnline()}
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
                  {issue.type === 'sale-stock-reconciliation' ? 'Reconcile stock' : 'Mark Resolved'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      {reconciling && <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl p-6 max-w-lg w-full space-y-4">
          <h2 className="text-xl font-bold">Reconcile {reconciling.medicineName}</h2>
          <p className="text-sm text-gray-600">Receipt {reconciling.receiptNo} is saved. Count the stock physically remaining in this exact batch ({reconciling.batchNo || 'no batch number'}), after all sales and returns. This saves an audited stock correction.</p>
          <label className="block text-sm">Total units counted<input type="number" min="0" step="1" value={countedStock} onChange={event => setCountedStock(event.target.value)} className="mt-1 w-full border rounded-lg p-2" /></label>
          <label className="block text-sm">Bonus units within that total<input type="number" min="0" step="1" value={countedBonus} onChange={event => setCountedBonus(event.target.value)} className="mt-1 w-full border rounded-lg p-2" /></label>
          <label className="block text-sm">Reconciliation note<textarea value={note} onChange={event => setNote(event.target.value)} className="mt-1 w-full border rounded-lg p-2" /></label>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <div className="flex justify-end gap-2">
            <button disabled={saving} onClick={() => setReconciling(null)} className="border rounded-lg px-4 py-2">Cancel</button>
            <button disabled={saving || !isCloudOnline()} onClick={() => void saveCount()} className="bg-blue-600 text-white rounded-lg px-4 py-2 disabled:opacity-50">{saving ? 'Saving…' : 'Save verified count'}</button>
          </div>
        </div>
      </div>}
    </div>
  );
}
