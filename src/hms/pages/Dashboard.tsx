import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, orderBy, limit } from 'firebase/firestore';
import { db } from '../../firebase';
import { formatCurrency, today } from '../lib/utils';
import { Users, CalendarDays, BedDouble, FlaskConical, DollarSign, AlertTriangle, Clock, TrendingUp, Plus, UserPlus, ArrowRight, ShoppingCart, Package } from 'lucide-react';
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';
import { format, subDays } from 'date-fns';
import { useNavigate } from 'react-router-dom';

export function Dashboard() {
  const navigate = useNavigate();
  const [stats, setStats] = useState({
    todayAppointments: 0, newPatientsToday: 0, ipdCount: 0, pendingLab: 0,
    todayRevenue: 0, todayPosRevenue: 0, lowStock: 0, expiringMeds: 0, totalPatients: 0,
  });
  const [chartData, setChartData]       = useState<any[]>([]);
  const [recentActivity, setRecentActivity] = useState<any[]>([]);
  const [lowStockItems, setLowStockItems]   = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const todayStr = today();
    const u1 = onSnapshot(collection(db, 'appointments'), snap =>
      setStats(p => ({ ...p, todayAppointments: snap.docs.filter(d => d.data().date === todayStr).length }))
    );
    const u2 = onSnapshot(collection(db, 'patients'), snap =>
      setStats(p => ({ ...p, newPatientsToday: snap.docs.filter(d => (d.data().createdAt || '').startsWith(todayStr)).length, totalPatients: snap.size }))
    );
    const u3 = onSnapshot(collection(db, 'admissions'), snap =>
      setStats(p => ({ ...p, ipdCount: snap.docs.filter(d => d.data().status === 'admitted').length }))
    );
    const u4 = onSnapshot(collection(db, 'labOrders'), snap =>
      setStats(p => ({ ...p, pendingLab: snap.docs.filter(d => d.data().status === 'pending').length }))
    );
    const u5 = onSnapshot(collection(db, 'medicines'), snap => {
      const meds = snap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];
      const lowStock = meds.filter(m => (m.stock || 0) <= (m.reorderLevel || (m.unitsPerBox || 1) * 2));
      const expiring = meds.filter(m => {
        if (!m.expiryDate) return false;
        const days = Math.ceil((new Date(m.expiryDate).getTime() - Date.now()) / 86400000);
        return days <= 30 && days >= 0;
      });
      setLowStockItems(lowStock.slice(0, 5));
      setStats(p => ({ ...p, lowStock: lowStock.length, expiringMeds: expiring.length }));
    });
    const u6 = onSnapshot(collection(db, 'bills'), snap => {
      const bills = snap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];
      const todayRev = bills.filter(b => (b.date || '').startsWith(todayStr)).reduce((s, b) => s + (b.paid || 0), 0);
      setStats(p => ({ ...p, todayRevenue: todayRev }));
      const days = Array.from({ length: 7 }, (_, i) => {
        const d = subDays(new Date(), 6 - i);
        return { date: format(d, 'EEE'), fullDate: format(d, 'yyyy-MM-dd'), opd: 0, pos: 0 };
      });
      bills.forEach(b => {
        const bd = (b.date || '').split('T')[0];
        const day = days.find(d => d.fullDate === bd);
        if (day) day.opd += b.total || 0;
      });
      setChartData(days);
      setLoading(false);
    });
    const u7 = onSnapshot(collection(db, 'sales'), snap => {
      const sales = snap.docs.map(d => d.data()) as any[];
      const todayPos = sales.filter(s => (s.date || '').startsWith(todayStr)).reduce((s, p) => s + (p.total || 0), 0);
      setStats(p => ({ ...p, todayPosRevenue: todayPos }));
      setChartData(prev => {
        const updated = [...prev];
        sales.forEach(s => {
          const sd = (s.date || '').split('T')[0];
          const day = updated.find(d => d.fullDate === sd);
          if (day) day.pos += s.total || 0;
        });
        return updated;
      });
    });
    const u8 = onSnapshot(query(collection(db, 'auditLogs'), orderBy('createdAt', 'desc'), limit(8)),
      snap => setRecentActivity(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );
    return () => { u1(); u2(); u3(); u4(); u5(); u6(); u7(); u8(); };
  }, []);

  const statCards = [
    { label: "Today's Appointments",  value: stats.todayAppointments,                    icon: CalendarDays, color: 'blue',   path: '/appointments' },
    { label: 'Total Patients',        value: stats.totalPatients,                         icon: Users,        color: 'violet', path: '/patients' },
    { label: 'Active IPD',            value: stats.ipdCount,                              icon: BedDouble,    color: 'emerald',path: '/ipd' },
    { label: "OPD Revenue Today",     value: formatCurrency(stats.todayRevenue),          icon: DollarSign,   color: 'green',  path: '/billing' },
    { label: "POS Revenue Today",     value: formatCurrency(stats.todayPosRevenue),       icon: ShoppingCart, color: 'teal',   path: '/billing' },
    { label: 'Pending Lab Tests',     value: stats.pendingLab,                            icon: FlaskConical, color: 'orange', path: '/lab' },
    { label: 'Low Stock Medicines',   value: stats.lowStock,                              icon: AlertTriangle,color: 'red',    path: '/pharmacy' },
    { label: 'Expiring (30 days)',    value: stats.expiringMeds,                          icon: Package,      color: 'pink',   path: '/reports' },
  ];

  const colorMap: Record<string, string> = {
    blue: 'bg-blue-100 text-blue-600', violet: 'bg-violet-100 text-violet-600',
    emerald: 'bg-emerald-100 text-emerald-600', green: 'bg-green-100 text-green-600',
    teal: 'bg-teal-100 text-teal-600', orange: 'bg-orange-100 text-orange-600',
    red: 'bg-red-100 text-red-600', pink: 'bg-pink-100 text-pink-600',
  };

  const actionColors: Record<string, string> = {
    create: 'bg-green-100 text-green-700', update: 'bg-blue-100 text-blue-700',
    delete: 'bg-red-100 text-red-700', print: 'bg-purple-100 text-purple-700',
    login: 'bg-gray-100 text-gray-600',
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500">{format(new Date(), 'EEEE, MMMM d, yyyy')}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => navigate('/token')}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors shadow-sm">
            <Clock className="w-4 h-4 text-indigo-600" /> Token Queue
          </button>
          <button onClick={() => navigate('/patients')}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors shadow-sm">
            <UserPlus className="w-4 h-4 text-blue-600" /> New Patient
          </button>
          <button onClick={() => navigate('/opd')}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors shadow-sm">
            <Plus className="w-4 h-4" /> New Consultation
          </button>
        </div>
      </div>

      {/* Alerts */}
      {(stats.lowStock > 0 || stats.expiringMeds > 0) && (
        <div className="flex flex-wrap gap-3">
          {stats.lowStock > 0 && (
            <button onClick={() => navigate('/pharmacy')}
              className="flex items-center gap-2 px-4 py-2.5 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm font-medium hover:bg-red-100 transition-colors">
              <AlertTriangle className="w-4 h-4" />
              {stats.lowStock} medicine{stats.lowStock !== 1 ? 's' : ''} low on stock - click to view
            </button>
          )}
          {stats.expiringMeds > 0 && (
            <button onClick={() => navigate('/reports')}
              className="flex items-center gap-2 px-4 py-2.5 bg-orange-50 border border-orange-200 text-orange-700 rounded-xl text-sm font-medium hover:bg-orange-100 transition-colors">
              <Package className="w-4 h-4" />
              {stats.expiringMeds} medicine{stats.expiringMeds !== 1 ? 's' : ''} expiring within 30 days
            </button>
          )}
        </div>
      )}

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map(card => (
          <button key={card.label} onClick={() => navigate(card.path)}
            className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm hover:shadow-md hover:border-blue-100 transition-all text-left group">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-2xl font-bold text-gray-900">{loading ? '-' : card.value}</div>
                <div className="text-xs text-gray-500 mt-1 leading-tight">{card.label}</div>
              </div>
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${colorMap[card.color]}`}>
                <card.icon className="w-4 h-4" />
              </div>
            </div>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Revenue Chart - OPD + POS */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="font-semibold text-gray-900">Revenue - Last 7 Days (OPD + POS)</h2>
              <p className="text-xs text-gray-400 mt-0.5">
                OPD: <strong className="text-blue-600">{formatCurrency(stats.todayRevenue)}</strong>
                &nbsp;/&nbsp; POS: <strong className="text-teal-600">{formatCurrency(stats.todayPosRevenue)}</strong>
              </p>
            </div>
            <TrendingUp className="w-5 h-5 text-blue-400" />
          </div>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
                <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: '#9CA3AF', fontSize: 11 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#9CA3AF', fontSize: 11 }} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                <Tooltip contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                  formatter={(v: number) => [formatCurrency(v)]} cursor={{ fill: '#F8FAFC' }} />
                <Bar dataKey="opd" fill="#3B82F6" radius={[4,4,0,0]} name="OPD" stackId="a" />
                <Bar dataKey="pos" fill="#0D9488" radius={[4,4,0,0]} name="Pharmacy" stackId="a" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Right column: Activity + Low Stock */}
        <div className="space-y-5">
          {/* Activity Feed */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-gray-900 text-sm">Recent Activity</h2>
              <button onClick={() => navigate('/audit')} className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1">
                View all <ArrowRight className="w-3 h-3" />
              </button>
            </div>
            {recentActivity.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">No activity yet</p>
            ) : (
              <div className="space-y-2.5">
                {recentActivity.slice(0, 5).map(a => (
                  <div key={a.id} className="flex items-start gap-2">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold capitalize shrink-0 mt-0.5 ${actionColors[a.action] || 'bg-gray-100 text-gray-600'}`}>
                      {a.action}
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-gray-700 capitalize truncate">{a.entity} {a.detail ? `- ${a.detail}` : ''}</p>
                      <p className="text-[10px] text-gray-400 truncate">{a.userEmail}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Low Stock Alert */}
          {lowStockItems.length > 0 && (
            <div className="bg-red-50 rounded-xl border border-red-100 p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 text-red-700 font-semibold text-sm">
                  <AlertTriangle className="w-4 h-4" /> Low Stock
                </div>
                <button onClick={() => navigate('/pharmacy')} className="text-xs text-red-600 hover:text-red-700 font-medium flex items-center gap-1">
                  View <ArrowRight className="w-3 h-3" />
                </button>
              </div>
              <div className="space-y-1.5">
                {lowStockItems.map(m => (
                  <div key={m.id} className="flex items-center justify-between text-xs">
                    <span className="text-red-800 font-medium truncate">{m.name}</span>
                    <span className="text-red-600 font-bold ml-2 shrink-0">{m.stock || 0} left</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
