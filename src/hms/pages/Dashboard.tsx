import { useEffect, useMemo, useState } from 'react';
import { formatCurrency } from '../lib/utils';
import { Users, CalendarDays, BedDouble, FlaskConical, DollarSign, AlertTriangle, Clock, TrendingUp, Plus, UserPlus, ArrowRight, ShoppingCart, Package } from 'lucide-react';
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';
import { differenceInCalendarDays, format, parseISO, subDays } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { subscribeToMedicines } from '../../lib/medicineStore';
import { clinicDateKey, recordClinicDateKey } from '../../lib/clinicDate';
import { useClinicTodayKey } from '../../lib/useClinicTodayKey';
import { subscribeToSaleReturns, subscribeToSales } from '../../lib/salesStore';
import { netSalesByDate, sumFinancialValues, summarizeSalesFinancials } from '../../pos/lib/salesFinancials';
import { subscribeToLocalCollection } from '../../lib/collectionRepository';

export function Dashboard() {
  const navigate = useNavigate();
  const todayStr = useClinicTodayKey();
  const [stats, setStats] = useState({
    todayAppointments: 0, newPatientsToday: 0, ipdCount: 0, pendingLab: 0,
    lowStock: 0, expiringMeds: 0, totalPatients: 0,
  });
  const [bills, setBills] = useState<any[]>([]);
  const [posSales, setPosSales] = useState<any[]>([]);
  const [posReturns, setPosReturns] = useState<any[]>([]);
  const [recentActivity, setRecentActivity] = useState<any[]>([]);
  const [lowStockItems, setLowStockItems]   = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const u1 = subscribeToLocalCollection('appointments', records =>
      setStats(p => ({ ...p, todayAppointments: records.filter(record => record.date === todayStr).length }))
    );
    const u2 = subscribeToLocalCollection('patients', records =>
      setStats(p => ({ ...p, newPatientsToday: records.filter(record => clinicDateKey(record.createdAt) === todayStr).length, totalPatients: records.length }))
    );
    const u3 = subscribeToLocalCollection('admissions', records =>
      setStats(p => ({ ...p, ipdCount: records.filter(record => record.status === 'admitted').length }))
    );
    const u4 = subscribeToLocalCollection('labOrders', records =>
      setStats(p => ({ ...p, pendingLab: records.filter(record => record.status === 'pending').length }))
    );
    const u5 = subscribeToMedicines(meds => {
      const lowStock = meds.filter(m => (m.stock || 0) <= (m.reorderLevel || (m.unitsPerBox || 1) * 2));
      const expiring = meds.filter(m => {
        if (!m.expiryDate) return false;
        const days = differenceInCalendarDays(parseISO(String(m.expiryDate).slice(0, 10)), parseISO(todayStr));
        return days <= 30 && days >= 0;
      });
      setLowStockItems(lowStock.slice(0, 5));
      setStats(p => ({ ...p, lowStock: lowStock.length, expiringMeds: expiring.length }));
    });
    const u6 = subscribeToLocalCollection('bills', records => {
      setBills(records as any[]);
      setLoading(false);
    });
    const u7 = subscribeToSales(setPosSales);
    const u8 = subscribeToLocalCollection('auditLogs', records => setRecentActivity(
      records
        .sort((left, right) => String(right.createdAt || right.timestamp || '').localeCompare(String(left.createdAt || left.timestamp || '')))
        .slice(0, 8),
    ));
    const u9 = subscribeToSaleReturns(setPosReturns);
    return () => { u1(); u2(); u3(); u4(); u5(); u6(); u7(); u8(); u9(); };
  }, [todayStr]);

  const activeBills = bills.filter(bill => bill.paymentStatus !== 'cancelled' && bill.paymentStatus !== 'no-show');
  const todayRevenue = sumFinancialValues(
    activeBills.filter(bill => clinicDateKey(bill.date) === todayStr),
    bill => bill.total,
  );
  const todayPosRevenue = summarizeSalesFinancials(
    posSales.filter(sale => recordClinicDateKey(sale) === todayStr),
    posReturns.filter(entry => recordClinicDateKey(entry) === todayStr),
  ).netRevenue;
  const chartData = useMemo(() => {
    const dailyPosRevenue = netSalesByDate(posSales, posReturns, recordClinicDateKey);
    return Array.from({ length: 7 }, (_, i) => {
      const date = subDays(parseISO(todayStr), 6 - i);
      const fullDate = clinicDateKey(date);
      const opd = sumFinancialValues(
        activeBills.filter(bill => clinicDateKey(bill.date) === fullDate),
        bill => bill.total,
      );
      return { date: format(date, 'EEE'), fullDate, opd, pos: dailyPosRevenue.get(fullDate) || 0 };
    });
  }, [activeBills, posReturns, posSales, todayStr]);

  const statCards = [
    { label: "Today's Appointments",  value: stats.todayAppointments,                    icon: CalendarDays, color: 'blue',   path: '/appointments' },
    { label: 'Total Patients',        value: stats.totalPatients,                         icon: Users,        color: 'violet', path: '/patients' },
    { label: 'Active IPD',            value: stats.ipdCount,                              icon: BedDouble,    color: 'emerald',path: '/ipd' },
    { label: "OPD Revenue Today",     value: formatCurrency(todayRevenue),                icon: DollarSign,   color: 'green',  path: '/billing' },
    { label: "POS Revenue Today",     value: formatCurrency(todayPosRevenue),             icon: ShoppingCart, color: 'teal',   path: '/billing' },
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
          <p className="text-sm text-gray-500">{format(parseISO(todayStr), 'EEEE, MMMM d, yyyy')}</p>
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
                OPD: <strong className="text-blue-600">{formatCurrency(todayRevenue)}</strong>
                &nbsp;/&nbsp; POS: <strong className="text-teal-600">{formatCurrency(todayPosRevenue)}</strong>
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
