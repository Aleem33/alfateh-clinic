import { useState, useEffect } from 'react';
import { collection, onSnapshot, query, orderBy, limit } from 'firebase/firestore';
import { db } from '../../firebase';
import { formatDate } from '../lib/utils';
import { Shield, Search, User, FileText, Trash2, Edit2, Plus, Printer, LogIn } from 'lucide-react';

const ACTION_CONFIG: Record<string, { icon: any; color: string; label: string }> = {
  create:  { icon: Plus,      color: 'bg-green-100 text-green-700',  label: 'Created'  },
  update:  { icon: Edit2,     color: 'bg-blue-100 text-blue-700',    label: 'Updated'  },
  delete:  { icon: Trash2,    color: 'bg-red-100 text-red-700',      label: 'Deleted'  },
  print:   { icon: Printer,   color: 'bg-purple-100 text-purple-700', label: 'Printed' },
  login:   { icon: LogIn,     color: 'bg-gray-100 text-gray-600',    label: 'Login'    },
  view:    { icon: FileText,  color: 'bg-yellow-100 text-yellow-700', label: 'Viewed'  },
};

export function AuditLogs() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('all');

  useEffect(() => {
    const q = query(collection(db, 'auditLogs'), orderBy('createdAt', 'desc'), limit(200));
    const unsub = onSnapshot(q, snap => {
      setLogs(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const filtered = logs.filter(l => {
    const matchSearch = !search ||
      l.userEmail?.toLowerCase().includes(search.toLowerCase()) ||
      l.entity?.toLowerCase().includes(search.toLowerCase()) ||
      l.detail?.toLowerCase().includes(search.toLowerCase());
    const matchAction = actionFilter === 'all' || l.action === actionFilter;
    return matchSearch && matchAction;
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
          <Shield className="w-5 h-5 text-blue-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Audit Logs</h1>
          <p className="text-sm text-gray-500">{logs.length} events recorded</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <select value={actionFilter} onChange={e => setActionFilter(e.target.value)}
          className="border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="all">All Actions</option>
          {Object.entries(ACTION_CONFIG).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by user, entity, or detail..."
            className="w-full pl-9 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
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
                <tr key={i}>
                  {Array.from({ length: 5 }).map((_, j) => (
                    <td key={j} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td>
                  ))}
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-12 text-gray-400 text-sm">No audit logs found</td></tr>
            ) : filtered.map(l => {
              const cfg = ACTION_CONFIG[l.action] || ACTION_CONFIG.view;
              const Icon = cfg.icon;
              return (
                <tr key={l.id} className="hover:bg-gray-50/50">
                  <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{formatDate(l.timestamp)}</td>
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
                      <Icon className="w-3 h-3" />
                      {cfg.label}
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
