import { useState, useEffect } from 'react';
import { collection, onSnapshot, query, orderBy, limit } from 'firebase/firestore';
import { db } from '../../firebase';
import { formatDate } from '../lib/utils';
import { Shield, Search, User, FileText, Trash2, Edit2, Plus, Printer, LogIn, Download } from 'lucide-react';
import { format } from 'date-fns';

const ACTION_CONFIG: Record<string, { icon: any; color: string; label: string }> = {
  create:  { icon: Plus,      color: 'bg-green-100 text-green-700',  label: 'Created'  },
  update:  { icon: Edit2,     color: 'bg-blue-100 text-blue-700',    label: 'Updated'  },
  delete:  { icon: Trash2,    color: 'bg-red-100 text-red-700',      label: 'Deleted'  },
  print:   { icon: Printer,   color: 'bg-purple-100 text-purple-700', label: 'Printed' },
  login:   { icon: LogIn,     color: 'bg-gray-100 text-gray-600',    label: 'Login'    },
  view:    { icon: FileText,  color: 'bg-yellow-100 text-yellow-700', label: 'Viewed'  },
};

function exportCSV(logs: any[]) {
  const headers = ['Timestamp', 'User', 'Action', 'Entity', 'Detail'];
  const rows = logs.map(l => [l.timestamp || l.createdAt || '', l.userEmail || 'system', l.action, l.entity, l.detail || '']);
  const lines = [headers, ...rows].map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','));
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `audit-${format(new Date(), 'yyyy-MM-dd')}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
}

export function AuditLogs() {
  const [logs, setLogs]             = useState<any[]>([]);
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState('');
  const [actionFilter, setActionFilter] = useState('all');
  const [userFilter, setUserFilter] = useState('all');
  const [dateFrom, setDateFrom]     = useState('');
  const [dateTo, setDateTo]         = useState('');

  useEffect(() => {
    const q = query(collection(db, 'auditLogs'), orderBy('createdAt', 'desc'), limit(500));
    const unsub = onSnapshot(q, snap => {
      setLogs(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });
    return () => unsub();
  }, []);

  // Unique users for filter dropdown
  const uniqueUsers = Array.from(new Set(logs.map(l => l.userEmail).filter(Boolean)));

  const filtered = logs.filter(l => {
    const matchSearch = !search ||
      l.userEmail?.toLowerCase().includes(search.toLowerCase()) ||
      l.entity?.toLowerCase().includes(search.toLowerCase()) ||
      l.detail?.toLowerCase().includes(search.toLowerCase());
    const matchAction = actionFilter === 'all' || l.action === actionFilter;
    const matchUser   = userFilter === 'all'   || l.userEmail === userFilter;
    const logDate     = (l.timestamp || l.createdAt || '').split('T')[0];
    const matchFrom   = !dateFrom || logDate >= dateFrom;
    const matchTo     = !dateTo   || logDate <= dateTo;
    return matchSearch && matchAction && matchUser && matchFrom && matchTo;
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
            <Shield className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Audit Logs</h1>
            <p className="text-sm text-gray-500">{logs.length} events recorded · showing {filtered.length}</p>
          </div>
        </div>
        <button onClick={() => exportCSV(filtered)}
          className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 bg-white rounded-lg text-sm text-gray-600 hover:bg-gray-50">
          <Download className="w-4 h-4" /> Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <select value={actionFilter} onChange={e => setActionFilter(e.target.value)}
          className="border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="all">All Actions</option>
          {Object.entries(ACTION_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>

        <select value={userFilter} onChange={e => setUserFilter(e.target.value)}
          className="border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 max-w-[200px]">
          <option value="all">All Users</option>
          {uniqueUsers.map(u => <option key={u} value={u}>{u}</option>)}
        </select>

        <div className="flex items-center gap-2">
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="From" />
          <span className="text-gray-400 text-sm">to</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="To" />
        </div>

        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by user, entity, or detail..."
            className="w-full pl-9 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>

        {(search || actionFilter !== 'all' || userFilter !== 'all' || dateFrom || dateTo) && (
          <button onClick={() => { setSearch(''); setActionFilter('all'); setUserFilter('all'); setDateFrom(''); setDateTo(''); }}
            className="text-xs text-blue-600 hover:text-blue-800 font-medium px-2 py-1">
            Clear filters
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              {['Timestamp', 'User', 'Action', 'Entity', 'Detail'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i}>{Array.from({ length: 5 }).map((_, j) => (
                  <td key={j} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td>
                ))}</tr>
              ))
            ) : filtered.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-12 text-gray-400 text-sm">No audit logs match your filters</td></tr>
            ) : filtered.map(l => {
              const cfg = ACTION_CONFIG[l.action] || ACTION_CONFIG.view;
              const Icon = cfg.icon;
              return (
                <tr key={l.id} className="hover:bg-gray-50/50">
                  <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{formatDate(l.timestamp || l.createdAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center shrink-0">
                        <User className="w-3 h-3 text-blue-600" />
                      </div>
                      <span className="text-xs text-gray-700 truncate max-w-[140px]">{l.userEmail || 'system'}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full font-medium ${cfg.color}`}>
                      <Icon className="w-3 h-3" />{cfg.label}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded font-medium capitalize">{l.entity}</span>
                    {l.entityId && <span className="text-xs text-gray-400 ml-1.5 font-mono">{String(l.entityId).slice(0, 8)}...</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500 max-w-xs truncate">{l.detail || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
