import { useState, useEffect } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase';
import { formatCurrency, formatDate } from '../lib/utils';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell, Legend } from 'recharts';
import { format, subDays, subMonths, startOfMonth, endOfMonth } from 'date-fns';
import { Download } from 'lucide-react';

function exportCSV(filename: string, rows: string[][], headers: string[]) {
  const lines = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','));
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];

function StatCard({ label, value, sub, color }: { label: string; value: any; sub?: string; color?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
      <div className="text-xs font-medium text-gray-400 mb-1 uppercase tracking-wider">{label}</div>
      <div className={`text-2xl font-bold ${color || 'text-gray-900'}`}>{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

export function Reports() {
  const [bills, setBills] = useState<any[]>([]);
  const [patients, setPatients] = useState<any[]>([]);
  const [consultations, setConsultations] = useState<any[]>([]);
  const [admissions, setAdmissions] = useState<any[]>([]);
  const [labOrders, setLabOrders] = useState<any[]>([]);
  const [period, setPeriod] = useState<'7d' | '30d' | '3m'>('30d');

  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'bills'), s => setBills(s.docs.map(d => ({ id: d.id, ...d.data() }))));
    const u2 = onSnapshot(collection(db, 'patients'), s => setPatients(s.docs.map(d => ({ id: d.id, ...d.data() }))));
    const u3 = onSnapshot(collection(db, 'consultations'), s => setConsultations(s.docs.map(d => ({ id: d.id, ...d.data() }))));
    const u4 = onSnapshot(collection(db, 'admissions'), s => setAdmissions(s.docs.map(d => ({ id: d.id, ...d.data() }))));
    const u5 = onSnapshot(collection(db, 'labOrders'), s => setLabOrders(s.docs.map(d => ({ id: d.id, ...d.data() }))));
    return () => { u1(); u2(); u3(); u4(); u5(); };
  }, []);

  // Revenue by day (last 7 or 30 days)
  const days = period === '7d' ? 7 : period === '30d' ? 30 : 90;
  const revenueChart = Array.from({ length: Math.min(days, 30) }).map((_, i) => {
    const d = subDays(new Date(), (Math.min(days, 30) - 1) - i);
    const dateStr = format(d, 'yyyy-MM-dd');
    const revenue = bills.filter(b => (b.date || '').startsWith(dateStr)).reduce((s, b) => s + (b.total || 0), 0);
    const collected = bills.filter(b => (b.date || '').startsWith(dateStr)).reduce((s, b) => s + (b.paid || 0), 0);
    return { date: format(d, 'MMM dd'), revenue, collected };
  });

  // Totals
  const totalRevenue = bills.reduce((s, b) => s + (b.total || 0), 0);
  const totalCollected = bills.reduce((s, b) => s + (b.paid || 0), 0);
  const totalPending = totalRevenue - totalCollected;
  const totalPatients = patients.length;
  const currentIPD = admissions.filter(a => a.status === 'admitted').length;
  const completedLab = labOrders.filter(l => l.status === 'completed').length;

  // Department wise consultations
  const deptData: Record<string, number> = {};
  consultations.forEach(c => { deptData[c.department || 'Unknown'] = (deptData[c.department || 'Unknown'] || 0) + 1; });
  const deptChart = Object.entries(deptData).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, value]) => ({ name, value }));

  // Bill payment status pie
  const paidCount = bills.filter(b => b.paymentStatus === 'paid').length;
  const partialCount = bills.filter(b => b.paymentStatus === 'partial').length;
  const pendingCount = bills.filter(b => b.paymentStatus === 'pending').length;
  const paymentPie = [
    { name: 'Paid', value: paidCount },
    { name: 'Partial', value: partialCount },
    { name: 'Pending', value: pendingCount },
  ].filter(d => d.value > 0);

  // Monthly revenue (last 3 months)
  const monthlyData = Array.from({ length: 3 }).map((_, i) => {
    const d = subMonths(new Date(), 2 - i);
    const start = format(startOfMonth(d), 'yyyy-MM-dd');
    const end = format(endOfMonth(d), 'yyyy-MM-dd');
    const rev = bills.filter(b => b.date >= start && b.date <= end).reduce((s, b) => s + (b.total || 0), 0);
    return { month: format(d, 'MMM yyyy'), revenue: rev };
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reports & Analytics</h1>
          <p className="text-sm text-gray-500">{bills.length} bills · {patients.length} patients · {completedLab} lab tests</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => exportCSV(`bills-${format(new Date(),'yyyy-MM-dd')}.csv`,
              bills.map(b => [b.billNo, b.patientName, b.patientMRN, b.date?.split('T')[0], b.total, b.paid, b.balance, b.paymentStatus]),
              ['Bill No','Patient','MRN','Date','Total','Paid','Balance','Status']
            )}
            className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 bg-white rounded-lg text-sm text-gray-600 hover:bg-gray-50"
          >
            <Download className="w-4 h-4" /> Export Bills
          </button>
          <button
            onClick={() => exportCSV(`patients-${format(new Date(),'yyyy-MM-dd')}.csv`,
              patients.map(p => [p.mrn, p.name, p.age, p.gender, p.phone, p.address, p.bloodGroup, p.createdAt?.split('T')[0]]),
              ['MRN','Name','Age','Gender','Phone','Address','Blood Group','Registered']
            )}
            className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 bg-white rounded-lg text-sm text-gray-600 hover:bg-gray-50"
          >
            <Download className="w-4 h-4" /> Export Patients
          </button>
          <div className="flex bg-white border border-gray-200 rounded-lg p-1 gap-1">
            {(['7d', '30d', '3m'] as const).map(p => (
              <button key={p} onClick={() => setPeriod(p)} className={`px-3 py-1.5 rounded-md text-xs font-medium ${period === p ? 'bg-blue-600 text-white' : 'text-gray-500 hover:text-gray-700'}`}>
                {p === '7d' ? 'Last 7 Days' : p === '30d' ? 'Last 30 Days' : 'Last 3 Months'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatCard label="Total Revenue" value={formatCurrency(totalRevenue)} color="text-blue-700" />
        <StatCard label="Total Collected" value={formatCurrency(totalCollected)} color="text-green-700" />
        <StatCard label="Outstanding" value={formatCurrency(totalPending)} color="text-red-500" />
        <StatCard label="Total Patients" value={totalPatients} />
        <StatCard label="Current IPD" value={currentIPD} sub="patients admitted" />
        <StatCard label="Lab Tests Done" value={completedLab} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Revenue Chart */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h2 className="font-semibold text-gray-900 mb-4">Revenue vs Collected ({period})</h2>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={revenueChart}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F3F4F6" />
                <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: '#9CA3AF', fontSize: 10 }} dy={8}
                  interval={period === '30d' ? 6 : 0} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#9CA3AF', fontSize: 10 }} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
                <Tooltip contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} formatter={(v: number) => [formatCurrency(v)]} />
                <Bar dataKey="revenue" fill="#BFDBFE" radius={[4, 4, 0, 0]} name="Billed" />
                <Bar dataKey="collected" fill="#3B82F6" radius={[4, 4, 0, 0]} name="Collected" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Monthly Revenue */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h2 className="font-semibold text-gray-900 mb-4">Monthly Revenue (3 Months)</h2>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F3F4F6" />
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: '#9CA3AF', fontSize: 11 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#9CA3AF', fontSize: 11 }} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
                <Tooltip contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} formatter={(v: number) => [formatCurrency(v), 'Revenue']} />
                <Line type="monotone" dataKey="revenue" stroke="#3B82F6" strokeWidth={2.5} dot={{ fill: '#3B82F6', r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Department Chart */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h2 className="font-semibold text-gray-900 mb-4">OPD by Department</h2>
          {deptChart.length === 0 ? (
            <div className="h-56 flex items-center justify-center text-gray-400 text-sm">No consultations yet</div>
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={deptChart} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#F3F4F6" />
                  <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: '#9CA3AF', fontSize: 10 }} />
                  <YAxis type="category" dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#6B7280', fontSize: 10 }} width={90} />
                  <Tooltip contentStyle={{ borderRadius: 8, border: 'none' }} />
                  <Bar dataKey="value" fill="#6366F1" radius={[0, 4, 4, 0]} name="Consultations" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Payment Status Pie */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h2 className="font-semibold text-gray-900 mb-4">Bill Payment Status</h2>
          {paymentPie.length === 0 ? (
            <div className="h-56 flex items-center justify-center text-gray-400 text-sm">No bills yet</div>
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={paymentPie} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={3} dataKey="value">
                    {paymentPie.map((_, i) => <Cell key={i} fill={['#10B981', '#F59E0B', '#EF4444'][i]} />)}
                  </Pie>
                  <Legend />
                  <Tooltip contentStyle={{ borderRadius: 8, border: 'none' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
