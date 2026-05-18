import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, onSnapshot, updateDoc, doc, writeBatch, query, orderBy, limit } from 'firebase/firestore';
import { db } from '../../firebase';
import { Bell, Search, Users, Pill, Briefcase, X, CheckCheck } from 'lucide-react';
import { useGlobalSearch } from '../lib/search';
import { cn } from '../lib/utils';
import { formatDate } from '../lib/utils';

const TYPE_ICONS: Record<string, any> = {
  patient: Users, staff: Briefcase, medicine: Pill,
};

const NOTIF_COLORS: Record<string, string> = {
  info: 'bg-blue-100 text-blue-600',
  warning: 'bg-yellow-100 text-yellow-600',
  success: 'bg-green-100 text-green-600',
  error: 'bg-red-100 text-red-600',
};

// Extract display name from internal email: "dr.ahmed@alfateh-clinic.internal" → "dr.ahmed"
function getDisplayName(email: string): string {
  if (!email) return 'User';
  return email.split('@')[0].replace(/\./g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function getInitial(email: string): string {
  return email ? email[0].toUpperCase() : 'U';
}

export function TopNavbar({ userEmail, userRole }: { userEmail: string; userRole: string }) {
  const navigate = useNavigate();

  // Search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const results = useGlobalSearch(searchQuery);

  // Notifications
  const [notifs, setNotifs] = useState<any[]>([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const unread = notifs.filter(n => !n.read).length;

  useEffect(() => {
    const q = query(collection(db, 'notifications'), orderBy('createdAt', 'desc'), limit(20));
    const unsub = onSnapshot(q, snap =>
      setNotifs(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false); setSearchQuery('');
      }
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const markAllRead = async () => {
    const unreadOnes = notifs.filter(n => !n.read);
    if (!unreadOnes.length) return;
    const batch = writeBatch(db);
    unreadOnes.forEach(n => batch.update(doc(db, 'notifications', n.id), { read: true }));
    await batch.commit();
  };

  const markRead = async (id: string) => {
    await updateDoc(doc(db, 'notifications', id), { read: true });
  };

  const handleResultClick = (path: string) => {
    navigate(path);
    setSearchOpen(false);
    setSearchQuery('');
  };

  const roleColors: Record<string, string> = {
    admin: 'bg-blue-100 text-blue-700',
    doctor: 'bg-green-100 text-green-700',
    receptionist: 'bg-purple-100 text-purple-700',
    pharmacist: 'bg-orange-100 text-orange-700',
    lab_technician: 'bg-cyan-100 text-cyan-700',
    cashier: 'bg-yellow-100 text-yellow-700',
  };

  const displayName = getDisplayName(userEmail);

  return (
    <header className="h-14 bg-white border-b border-gray-100 flex items-center px-6 gap-4 shrink-0 z-20">

      {/* Global Search */}
      <div ref={searchRef} className="relative flex-1 max-w-sm">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={searchQuery}
            onChange={e => { setSearchQuery(e.target.value); setSearchOpen(true); }}
            onFocus={() => setSearchOpen(true)}
            placeholder="Search patients, staff, medicines..."
            className="w-full pl-9 pr-4 py-2 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
          />
          {searchQuery && (
            <button onClick={() => { setSearchQuery(''); setSearchOpen(false); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {searchOpen && searchQuery.length >= 2 && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-50 overflow-hidden">
            {results.length === 0 ? (
              <div className="px-4 py-3 text-sm text-gray-400 text-center">No results found</div>
            ) : (
              <>
                <div className="px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider border-b border-gray-100">
                  {results.length} result{results.length !== 1 ? 's' : ''}
                </div>
                {results.map(r => {
                  const Icon = TYPE_ICONS[r.type] || Users;
                  return (
                    <button key={r.id} onClick={() => handleResultClick(r.path)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 text-left border-b border-gray-50 last:border-0">
                      <div className="w-7 h-7 bg-blue-50 rounded-lg flex items-center justify-center shrink-0">
                        <Icon className="w-3.5 h-3.5 text-blue-600" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-gray-900 truncate">{r.title}</div>
                        <div className="text-xs text-gray-400 truncate">{r.subtitle}</div>
                      </div>
                      <span className="ml-auto text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full capitalize shrink-0">{r.type}</span>
                    </button>
                  );
                })}
              </>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 ml-auto">
        {/* Notifications */}
        <div ref={notifRef} className="relative">
          <button onClick={() => setNotifOpen(o => !o)}
            className="relative p-2 rounded-xl text-gray-500 hover:bg-gray-100 transition-colors">
            <Bell className="w-5 h-5" />
            {unread > 0 && (
              <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </button>

          {notifOpen && (
            <div className="absolute right-0 top-full mt-1 w-80 bg-white border border-gray-200 rounded-xl shadow-lg z-50">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                <span className="font-semibold text-sm text-gray-900">Notifications</span>
                {unread > 0 && (
                  <button onClick={markAllRead} className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium">
                    <CheckCheck className="w-3.5 h-3.5" /> Mark all read
                  </button>
                )}
              </div>
              <div className="max-h-80 overflow-y-auto">
                {notifs.length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-gray-400">No notifications</div>
                ) : notifs.map(n => (
                  <button key={n.id} onClick={() => markRead(n.id)}
                    className={cn('w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-gray-50 border-b border-gray-50 last:border-0 transition-colors',
                      !n.read && 'bg-blue-50/50')}>
                    <div className={cn('w-7 h-7 rounded-lg flex items-center justify-center shrink-0 text-xs font-bold mt-0.5', NOTIF_COLORS[n.type] || NOTIF_COLORS.info)}>
                      {n.type === 'warning' ? '!' : n.type === 'error' ? '✕' : n.type === 'success' ? '✓' : 'i'}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className={cn('text-sm font-medium', !n.read ? 'text-gray-900' : 'text-gray-600')}>{n.title}</div>
                      <div className="text-xs text-gray-400 mt-0.5 line-clamp-2">{n.body}</div>
                      <div className="text-xs text-gray-300 mt-1">{formatDate(n.createdAt)}</div>
                    </div>
                    {!n.read && <div className="w-2 h-2 bg-blue-500 rounded-full mt-2 shrink-0" />}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* User Profile */}
        <div className="flex items-center gap-2.5 pl-2 border-l border-gray-200 ml-1">
          <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center shrink-0">
            <span className="text-white text-sm font-semibold">{getInitial(userEmail)}</span>
          </div>
          <div className="hidden sm:block">
            <div className="text-xs font-semibold text-gray-900 leading-tight truncate max-w-[120px]">
              {displayName}
            </div>
            <span className={cn('text-[10px] px-1.5 py-0.5 rounded font-medium capitalize', roleColors[userRole] || 'bg-gray-100 text-gray-600')}>
              {userRole?.replace('_', ' ')}
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}
