import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, orderBy, limit } from 'firebase/firestore';
import { db } from '../../firebase';
import { formatCurrency, today } from '../lib/utils';
import { Users, CalendarDays, BedDouble, FlaskConical, DollarSign, AlertTriangle, Clock, TrendingUp, Plus, UserPlus, ArrowRight } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Area, AreaChart } from 'recharts';
import { format, subDays } from 'date-fns';
import { useNavigate } from 'react-router-dom';

export function Dashboard() {
  const navigate = useNavigate();
  const [stats, setStats] = useState({ todayAppointments: 0, newPatientsToday: 0, ipdCount: 0, pendingLab: 0, todayRevenue: 0, lowStock: 0, totalPatients: 0 });
  const [chartData, setChartData] = useState<any[]>([]);
  const [recentActivity, setRecentActivity] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const todayStr = today();

    const u1 = onSnapshot(collection(db, 'appointments'), snap => {
      const count = snap.docs.filter(d => d.data().date === todayStr).length;
      setStats(p => ({ ...p, todayAppointments: count }));
    });
    const u2 = onSnapshot(collection(db, 'patients'), snap => {
      const newToday = snap.docs.filter(d => (d.data().createdAt || '').startsWith(todayStr)).length;
      setStats(p => ({ ...p, newPatientsToday: newToday, totalPatients: snap.size }));
    });
    const u3 = onSnapshot(collection(db, 'admissions'), snap => {
      setStats(p => ({ ...p, ipdCount: snap.docs.filter(d => d.data().status === 'admitted').length }));
    });
    const u4 = onSnapshot(collection(db, 'labOrders'), snap => {
      setStats(p => ({ ...p, pendingLab: snap.docs.filter(d => d.data().status === 'pending').length }));
    });
    const u5 = onSnapshot(collection(db, 'medicines'), snap => {
      setStats(p => ({ ...p, lowStock: snap.docs.filter(d => { const m = d.data(); return m.stock <= (m.unitsPerBox || 1) * 2; }).length }));
    });
    const u6 = onSnapshot(collection(db, 'bills'), snap => {
      const bills = snap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];
      const todayRev = bills.filter(b => (b.date || '').startsWith(todayStr)).reduce((s, b) => s + (b.paid || 0), 0);
      setStats(p => ({ ...p, todayRevenue: todayRev }));
      const days = Array.from({ length: 7 }, (_, i) => {
        const d = subDays(new Date(), 6 - i);
        return { date: format(d, 'EEE'), fullDate: format(d, 'yyyy-MM-dd'), total: 0 };
      });
      bills.forEach(b => {
        const bd = (b.date || '').split('T')[0];
        const day = days.find(d => d.fullDate === bd);
        if (day) day.total += b.total || 0;
      });
      setChartData(days);
      setLoading(false);
    });

    // Recent activity from audit logs
    const u7 = onSnapshot(query(collection(db, 'auditLogs'), orderBy('createdAt', 'desc'), limit(8)),
      snap => setRecentActivity(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );

    return () => { u1(); u2(); u3(); u4(); u5(); u6(); u7(); };
  }, []);

  const statCards = [
    { label: "Today's Appointments", value: stats.todayAppointments, icon: CalendarDays, color: 'blue',   path: '/appointments' },
    { label: 'Total Patients',        value: stats.totalPatients,     icon: Users,        color: 'violet', path: '/patients'     },
    { label: 'Active IPD',            value: stats.ipdCount,          icon: BedDouble,    color: 'emerald',path: '/ipd'          },
    { label: "Today's Revenue",       value: formatCurrency(stats.todayRevenue), icon: DollarSign, color: 'green', path: '/billing' },
    { label: 'Pending Lab Tests',     value: stats.pendingLab,        icon: FlaskConical, color: 'orange', path: '/lab'          },
    { label: 'Low Stock Medicines',   value: stats.lowStock,          icon: AlertTriangle,color: 'red',    path: '/pharmacy'     },
  ];

  const colorMap: Record<string, string> = {
    blue: 'bg-blue-100 text-blue-600', violet: 'bg-violet-100 text-violet-600',
    emerald: 'bg-emerald-100 text-emerald-600', green: 'bg-green-100 text-green-600',
    orange: 'bg-orange-100 text-orange-600', red: 'bg-red-100 text-red-600',
  };

  const actionColors: Record<string, string> = {
    create: 'bg-green-100 text-green-700', update: 'bg-blue-100 text-blue-700',
    delete: 'bg-red-100 text-red-700', print: 'bg-purple-100 text-purple-700',
    login: 'bg-gray-100 text-gray-600',
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500">{format(new Date(), 'EEEE, MMMM d, yyyy')}</p>
        </div>
        {/* Quick Actions */}
        <div className="flex items-center gap-2">
          <button onClick={() => navigate('/patients')}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors shadow-sm">
            <UserPlus className="w-4 h-4 text-blue-600" /> New Patient
          </button>
          <button onClick={() => navigate('/appointments')}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors shadow-sm">
            <Plus className="w-4 h-4" /> New Appointment
          </button>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {statCards.map(card => (
          <button key={card.label} onClick={() => navigate(card.path)}
            className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm hover:shadow-md transition-all text-left group">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-3 ${colorMap[card.color]}`}>
              <card.icon className="w-4 h-4" />
            </div>
            <div className="text-xl font-bold text-gray-900 dark:text-gray-100">{loading ? '—' : card.value}</div>
            <div className="text-xs text-gray-500 mt-0.5 leading-tight">{card.label}</div>
            <div className="flex items-center gap-1 mt-2 text-xs text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity">
              View <ArrowRight className="w-3 h-3" />
            </div>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Revenue Chart */}
        <div className="lg:col-span-2 bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-5">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="font-semibold text-gray-900 dark:text-gray-100">Revenue — Last 7 Days</h2>
              <p className="text-xs text-gray-400 mt-0.5">Today: <strong className="text-green-600">{formatCurrency(stats.todayRevenue)}</strong></p>
            </div>
            <TrendingUp className="w-5 h-5 text-blue-400" />
          </div>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.15}/>
                    <stop offset="95%" stopColor="#3B82F6" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
                <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: '#9CA3AF', fontSize: 11 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#9CA3AF', fontSize: 11 }} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                <Tooltip contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                  formatter={(v: number) => [formatCurrency(v), 'Revenue']} cursor={{ stroke: '#3B82F6', strokeWidth: 1 }} />
                <Area type="monotone" dataKey="total" stroke="#3B82F6" strokeWidth={2.5} fill="url(#revGrad)" dot={{ fill: '#3B82F6', r: 3 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Activity Feed */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">Recent Activity</h2>
            <button onClick={() => navigate('/audit')} className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1">
              View all <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          {recentActivity.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">No activity yet</p>
          ) : (
            <div className="space-y-3">
              {recentActivity.map(a => (
                <div key={a.id} className="flex items-start gap-2.5">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold capitalize shrink-0 mt-0.5 ${actionColors[a.action] || 'bg-gray-100 text-gray-600'}`}>
                    {a.action}
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-gray-700 dark:text-gray-300 capitalize truncate">{a.entity} {a.detail ? `— ${a.detail}` : ''}</p>
                    <p className="text-[10px] text-gray-400 truncate">{a.userEmail}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
