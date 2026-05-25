import { useState, useEffect } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase';
import { formatCurrency, formatDate } from '../lib/utils';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell, Legend, AreaChart, Area } from 'recharts';
import { format, subDays, subMonths, startOfMonth, endOfMonth, differenceInDays, parseISO } from 'date-fns';
import { Download, TrendingUp, AlertCircle, DollarSign, Activity, FileText, Search, CalendarDays } from 'lucide-react';

function exportCSV(filename: string, rows: any[][], headers: string[]) {
  const lines = [headers, ...rows].map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','));
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
}

const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];

function StatCard({ label, value, sub, color, icon: Icon }: any) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs font-medium text-gray-400 mb-1 uppercase tracking-wider">{label}</div>
          <div className={`text-2xl font-bold ${color || 'text-gray-900'}`}>{value}</div>
          {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
        </div>
        {Icon && <div className="w-9 h-9 bg-gray-50 rounded-xl flex items-center justify-center"><Icon className="w-4 h-4 text-gray-400" /></div>}
      </div>
    </div>
  );
}

type Tab = 'overview' | 'advanced' | 'pl' | 'outstanding' | 'expiry';
type AdvancedReportType = 'billing' | 'pos' | 'consultations' | 'patients' | 'lab' | 'expenses' | 'inventory';

export function Reports() {
  const [tab, setTab] = useState<Tab>('overview');
  const [bills, setBills] = useState<any[]>([]);
  const [patients, setPatients] = useState<any[]>([]);
  const [consultations, setConsultations] = useState<any[]>([]);
  const [admissions, setAdmissions] = useState<any[]>([]);
  const [labOrders, setLabOrders] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [medicines, setMedicines] = useState<any[]>([]);
  const [posSales, setPosSales] = useState<any[]>([]);
  const [period, setPeriod] = useState<'7d' | '30d' | '3m'>('30d');
  const [outstandingSearch, setOutstandingSearch] = useState('');
  const [advancedType, setAdvancedType] = useState<AdvancedReportType>('billing');
  const [advancedFrom, setAdvancedFrom] = useState(format(subDays(new Date(), 30), 'yyyy-MM-dd'));
  const [advancedTo, setAdvancedTo] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [advancedSearch, setAdvancedSearch] = useState('');

  useEffect(() => {
    const u = [
      onSnapshot(collection(db, 'bills'),         s => setBills(s.docs.map(d => ({ id: d.id, ...d.data() })))),
      onSnapshot(collection(db, 'patients'),       s => setPatients(s.docs.map(d => ({ id: d.id, ...d.data() })))),
      onSnapshot(collection(db, 'consultations'),  s => setConsultations(s.docs.map(d => ({ id: d.id, ...d.data() })))),
      onSnapshot(collection(db, 'admissions'),     s => setAdmissions(s.docs.map(d => ({ id: d.id, ...d.data() })))),
      onSnapshot(collection(db, 'labOrders'),      s => setLabOrders(s.docs.map(d => ({ id: d.id, ...d.data() })))),
      onSnapshot(collection(db, 'expenses'),       s => setExpenses(s.docs.map(d => ({ id: d.id, ...d.data() })))),
      onSnapshot(collection(db, 'medicines'),      s => setMedicines(s.docs.map(d => ({ id: d.id, ...d.data() })))),
      onSnapshot(collection(db, 'sales'),          s => setPosSales(s.docs.map(d => ({ id: d.id, ...d.data() })))),
    ];
    return () => u.forEach(f => f());
  }, []);

  // ── Computed values ──────────────────────────────────────────────────────────
  const totalOpdRevenue  = bills.reduce((s, b) => s + (b.total || 0), 0);
  const totalOpdCollected = bills.reduce((s, b) => s + (b.paid || 0), 0);
  const totalPosRevenue  = posSales.reduce((s, p) => s + (p.total || 0), 0);
  const totalRevenue     = totalOpdRevenue + totalPosRevenue;
  const totalExpenses    = expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const netProfit        = totalRevenue - totalExpenses;
  const totalPending     = totalOpdRevenue - totalOpdCollected;
  const completedLab     = labOrders.filter(l => l.status === 'completed').length;

  // Revenue chart (days)
  const days = period === '7d' ? 7 : period === '30d' ? 30 : 90;
  const revenueChart = Array.from({ length: Math.min(days, 30) }).map((_, i) => {
    const d = subDays(new Date(), (Math.min(days, 30) - 1) - i);
    const dateStr = format(d, 'yyyy-MM-dd');
    const opd     = bills.filter(b => (b.date || '').startsWith(dateStr)).reduce((s, b) => s + (b.total || 0), 0);
    const pos     = posSales.filter(p => (p.date || '').startsWith(dateStr)).reduce((s, p) => s + (p.total || 0), 0);
    const exp     = expenses.filter(e => (e.date || '').startsWith(dateStr)).reduce((s, e) => s + (Number(e.amount) || 0), 0);
    return { date: format(d, 'MMM dd'), opd, pos, total: opd + pos, expenses: exp };
  });

  // Monthly P&L (last 6 months)
  const monthlyPL = Array.from({ length: 6 }).map((_, i) => {
    const d     = subMonths(new Date(), 5 - i);
    const start = format(startOfMonth(d), 'yyyy-MM-dd');
    const end   = format(endOfMonth(d), 'yyyy-MM-dd');
    const opd   = bills.filter(b => b.date >= start && b.date <= end).reduce((s, b) => s + (b.total || 0), 0);
    const pos   = posSales.filter(p => p.date >= start && p.date <= end).reduce((s, p) => s + (p.total || 0), 0);
    const exp   = expenses.filter(e => e.date >= start && e.date <= end).reduce((s, e) => s + (Number(e.amount) || 0), 0);
    const revenue = opd + pos;
    return { month: format(d, 'MMM yy'), revenue, expenses: exp, profit: revenue - exp };
  });

  // Dept chart
  const deptData: Record<string, number> = {};
  consultations.forEach(c => { deptData[c.department || 'Unknown'] = (deptData[c.department || 'Unknown'] || 0) + 1; });
  const deptChart = Object.entries(deptData).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, value]) => ({ name, value }));

  // Payment pie
  const paidCount    = bills.filter(b => b.paymentStatus === 'paid').length;
  const partialCount = bills.filter(b => b.paymentStatus === 'partial').length;
  const pendingCount = bills.filter(b => b.paymentStatus === 'pending').length;
  const paymentPie   = [
    { name: 'Paid', value: paidCount }, { name: 'Partial', value: partialCount }, { name: 'Pending', value: pendingCount },
  ].filter(d => d.value > 0);

  // Outstanding dues
  const outstanding = bills
    .filter(b => b.paymentStatus !== 'paid' && (b.balance || 0) > 0)
    .filter(b => !outstandingSearch || b.patientName?.toLowerCase().includes(outstandingSearch.toLowerCase()) || b.patientMRN?.includes(outstandingSearch))
    .sort((a, b) => (b.balance || 0) - (a.balance || 0));
  const totalOutstanding = outstanding.reduce((s, b) => s + (b.balance || 0), 0);

  // Expiry tracking
  const today = format(new Date(), 'yyyy-MM-dd');
  const expiryItems = medicines
    .filter(m => m.expiryDate)
    .map(m => {
      const daysLeft = differenceInDays(parseISO(m.expiryDate), new Date());
      return { ...m, daysLeft };
    })
    .filter(m => m.daysLeft <= 90)
    .sort((a, b) => a.daysLeft - b.daysLeft);

  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview',     label: 'Overview' },
    { id: 'advanced',     label: 'Advanced Generator' },
    { id: 'pl',           label: 'P&L' },
    { id: 'outstanding',  label: `Outstanding (${outstanding.length})` },
    { id: 'expiry',       label: `Expiring (${expiryItems.length})` },
  ];

  const reportConfigs: Record<AdvancedReportType, { label: string; headers: string[]; rows: any[][]; dateIndex?: number; moneyIndexes?: number[] }> = {
    billing: {
      label: 'Clinic Billing',
      headers: ['Bill No', 'Patient', 'MRN', 'Date', 'Total', 'Paid', 'Balance', 'Status'],
      rows: bills.map(b => [b.billNo || b.id, b.patientName, b.patientMRN, b.date?.split('T')[0], b.total || 0, b.paid || 0, b.balance || 0, b.paymentStatus || '']),
      dateIndex: 3,
      moneyIndexes: [4, 5, 6],
    },
    pos: {
      label: 'Pharmacy Sales',
      headers: ['Receipt No', 'Customer', 'Type', 'Date', 'Items', 'Subtotal', 'Discount', 'Total', 'Paid', 'Pending'],
      rows: posSales.map(s => [s.receiptNo || s.saleId || s.id, s.customerName || 'Walk-in', s.customerType || 'customer', s.date?.split('T')[0], s.items?.length || 0, s.subtotal || 0, s.discount || 0, s.total || 0, s.amountPaid || 0, s.pendingAmount || 0]),
      dateIndex: 3,
      moneyIndexes: [5, 6, 7, 8, 9],
    },
    consultations: {
      label: 'OPD Consultations',
      headers: ['Patient', 'MRN', 'Doctor', 'Department', 'Date', 'Diagnosis', 'Fee', 'Medicines', 'Lab Tests'],
      rows: consultations.map(c => [c.patientName, c.patientMRN, c.doctorName, c.department, c.date || c.createdAt?.split('T')[0], c.diagnosis || '', c.fee || 0, c.prescriptions?.length || 0, c.labOrders?.length || 0]),
      dateIndex: 4,
      moneyIndexes: [6],
    },
    patients: {
      label: 'Patient Registry',
      headers: ['MRN', 'Name', 'Age', 'Gender', 'Phone', 'Blood Group', 'Registered'],
      rows: patients.map(p => [p.mrn, p.name, p.age, p.gender, p.phone, p.bloodGroup, p.createdAt?.split('T')[0]]),
      dateIndex: 6,
    },
    lab: {
      label: 'Laboratory Orders',
      headers: ['Patient', 'MRN', 'Doctor', 'Date', 'Tests', 'Status', 'Result Date', 'PDF'],
      rows: labOrders.map(l => [l.patientName, l.patientMRN, l.doctorName, l.date || l.createdAt?.split('T')[0], (l.tests || []).map((t: any) => t.testName || t.name).join(', '), l.status, l.resultDate || l.completedAt?.split('T')[0] || '', l.reportPdf?.url ? 'Uploaded' : l.reportPdf?.pendingUpload ? 'Pending upload' : '']),
      dateIndex: 3,
    },
    expenses: {
      label: 'Expenses',
      headers: ['Date', 'Category', 'Description', 'Amount', 'Created By'],
      rows: expenses.map(e => [e.date?.split('T')[0], e.category, e.description || e.title || '', Number(e.amount) || 0, e.createdBy || '']),
      dateIndex: 0,
      moneyIndexes: [3],
    },
    inventory: {
      label: 'Medicine Inventory',
      headers: ['Medicine', 'Category/Form', 'Batch', 'Expiry', 'Stock', 'Cost Price', 'Retail Price', 'Stock Value', 'Status'],
      rows: medicines.map(m => {
        const daysLeft = m.expiryDate ? differenceInDays(parseISO(m.expiryDate), new Date()) : null;
        const stock = Number(m.stock) || 0;
        const cost = Number(m.costPrice) || 0;
        return [
          m.name,
          m.category || m.form || '',
          m.batchNo || '',
          m.expiryDate || '',
          stock,
          cost,
          Number(m.retailPrice || m.price) || 0,
          stock * (cost / Math.max(Number(m.unitsPerBox) || 1, 1)),
          daysLeft === null ? 'No expiry' : daysLeft <= 0 ? 'Expired' : daysLeft <= 30 ? 'Expiring soon' : stock <= Math.max(Number(m.unitsPerBox) || 1, 1) * 2 ? 'Low stock' : 'OK',
        ];
      }),
      dateIndex: 3,
      moneyIndexes: [5, 6, 7],
    },
  };

  const activeReport = reportConfigs[advancedType];
  const advancedRows = activeReport.rows.filter(row => {
    const rowDate = activeReport.dateIndex !== undefined ? String(row[activeReport.dateIndex] || '').slice(0, 10) : '';
    const inRange = !rowDate || ((!advancedFrom || rowDate >= advancedFrom) && (!advancedTo || rowDate <= advancedTo));
    const haystack = row.map(v => String(v ?? '').toLowerCase()).join(' ');
    return inRange && (!advancedSearch || haystack.includes(advancedSearch.toLowerCase()));
  });
  const advancedTotals = (activeReport.moneyIndexes || []).map(index => ({
    label: activeReport.headers[index],
    value: advancedRows.reduce((sum, row) => sum + (Number(row[index]) || 0), 0),
  }));

  const exportAdvancedReport = () => {
    exportCSV(`${advancedType}-report-${format(new Date(), 'yyyy-MM-dd')}.csv`, advancedRows, activeReport.headers);
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reports & Analytics</h1>
          <p className="text-sm text-gray-500">{bills.length} bills · {patients.length} patients · {completedLab} lab tests</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => exportCSV(`bills-${format(new Date(),'yyyy-MM-dd')}.csv`,
            bills.map(b => [b.billNo, b.patientName, b.patientMRN, b.date?.split('T')[0], b.total, b.paid, b.balance, b.paymentStatus]),
            ['Bill No','Patient','MRN','Date','Total','Paid','Balance','Status'])}
            className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 bg-white rounded-lg text-sm text-gray-600 hover:bg-gray-50">
            <Download className="w-4 h-4" /> Bills
          </button>
          <button onClick={() => exportCSV(`patients-${format(new Date(),'yyyy-MM-dd')}.csv`,
            patients.map(p => [p.mrn, p.name, p.age, p.gender, p.phone, p.address, p.bloodGroup, p.createdAt?.split('T')[0]]),
            ['MRN','Name','Age','Gender','Phone','Address','Blood Group','Registered'])}
            className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 bg-white rounded-lg text-sm text-gray-600 hover:bg-gray-50">
            <Download className="w-4 h-4" /> Patients
          </button>
          <div className="flex bg-white border border-gray-200 rounded-lg p-1 gap-1">
            {(['7d','30d','3m'] as const).map(p => (
              <button key={p} onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium ${period === p ? 'bg-blue-600 text-white' : 'text-gray-500 hover:text-gray-700'}`}>
                {p === '7d' ? '7 Days' : p === '30d' ? '30 Days' : '3 Months'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === t.id ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW ── */}
      {tab === 'overview' && (<>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="OPD Revenue"      value={formatCurrency(totalOpdRevenue)}  color="text-blue-700"  icon={DollarSign} />
          <StatCard label="POS Revenue"      value={formatCurrency(totalPosRevenue)}  color="text-emerald-700" icon={TrendingUp} />
          <StatCard label="Total Collected"  value={formatCurrency(totalOpdCollected)} color="text-green-700" icon={Activity} />
          <StatCard label="Outstanding"      value={formatCurrency(totalPending)}      color="text-red-500"   icon={AlertCircle} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <h2 className="font-semibold text-gray-900 mb-4">OPD + POS Revenue ({period})</h2>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={revenueChart}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F3F4F6" />
                  <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: '#9CA3AF', fontSize: 10 }} interval={period === '30d' ? 6 : 0} dy={8}/>
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: '#9CA3AF', fontSize: 10 }} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                  <Tooltip contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} formatter={(v: number) => [formatCurrency(v)]} />
                  <Bar dataKey="opd" fill="#BFDBFE" radius={[4,4,0,0]} name="OPD" stackId="a" />
                  <Bar dataKey="pos" fill="#3B82F6" radius={[4,4,0,0]} name="Pharmacy" stackId="a" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

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
                    <Bar dataKey="value" fill="#6366F1" radius={[0,4,4,0]} name="Consultations" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <h2 className="font-semibold text-gray-900 mb-4">Payment Status</h2>
            {paymentPie.length === 0 ? (
              <div className="h-56 flex items-center justify-center text-gray-400 text-sm">No bills yet</div>
            ) : (
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={paymentPie} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={3} dataKey="value">
                      {paymentPie.map((_, i) => <Cell key={i} fill={['#10B981','#F59E0B','#EF4444'][i]} />)}
                    </Pie>
                    <Legend /><Tooltip contentStyle={{ borderRadius: 8, border: 'none' }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <h2 className="font-semibold text-gray-900 mb-4">Quick Stats</h2>
            <div className="space-y-3">
              {[
                { label: 'Total Patients', value: patients.length },
                { label: 'Total Consultations', value: consultations.length },
                { label: 'Active IPD', value: admissions.filter(a => a.status === 'admitted').length },
                { label: 'Lab Tests Done', value: completedLab },
                { label: 'Pending Lab Tests', value: labOrders.filter(l => l.status === 'pending').length },
              ].map(s => (
                <div key={s.label} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                  <span className="text-sm text-gray-600">{s.label}</span>
                  <span className="font-semibold text-gray-900">{s.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </>)}

      {/* ── P&L ── */}
      {/* Advanced Generator */}
      {tab === 'advanced' && (<>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <FileText className="w-5 h-5 text-blue-600" />
                <h2 className="font-semibold text-gray-900">Advanced Report Generator</h2>
              </div>
              <p className="text-sm text-gray-500">Generate filtered reports across clinic, lab, pharmacy, expenses, and inventory.</p>
            </div>
            <button onClick={exportAdvancedReport}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
              <Download className="w-4 h-4" /> Export CSV
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Report Type</label>
              <select value={advancedType} onChange={e => setAdvancedType(e.target.value as AdvancedReportType)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                {(Object.keys(reportConfigs) as AdvancedReportType[]).map(key => (
                  <option key={key} value={key}>{reportConfigs[key].label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">From</label>
              <div className="relative">
                <CalendarDays className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input type="date" value={advancedFrom} onChange={e => setAdvancedFrom(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">To</label>
              <div className="relative">
                <CalendarDays className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input type="date" value={advancedTo} onChange={e => setAdvancedTo(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Search</label>
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input value={advancedSearch} onChange={e => setAdvancedSearch(e.target.value)}
                  placeholder="Any text..."
                  className="w-full border border-gray-200 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Rows" value={advancedRows.length} sub={activeReport.label} icon={FileText} />
          {advancedTotals.slice(0, 3).map(total => (
            <StatCard key={total.label} label={total.label} value={formatCurrency(total.value)} color="text-blue-700" icon={DollarSign} />
          ))}
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between gap-3">
            <h2 className="font-semibold text-gray-900">{activeReport.label} Preview</h2>
            <span className="text-xs text-gray-500">{advancedRows.length} matching rows</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  {activeReport.headers.map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {advancedRows.length === 0 ? (
                  <tr><td colSpan={activeReport.headers.length} className="text-center py-10 text-gray-400 text-sm">No matching records</td></tr>
                ) : advancedRows.slice(0, 100).map((row, i) => (
                  <tr key={`${advancedType}-${i}`} className="hover:bg-gray-50/50">
                    {row.map((cell, j) => (
                      <td key={j} className="px-4 py-3 text-gray-700 whitespace-nowrap">
                        {activeReport.moneyIndexes?.includes(j) ? formatCurrency(Number(cell) || 0) : String(cell ?? '') || '-'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {advancedRows.length > 100 && (
            <div className="px-5 py-3 bg-gray-50 text-xs text-gray-500 border-t border-gray-100">
              Showing first 100 rows. Export CSV includes all {advancedRows.length} matching rows.
            </div>
          )}
        </div>
      </>)}

      {tab === 'pl' && (<>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Total Revenue"  value={formatCurrency(totalRevenue)}  color="text-blue-700"  icon={TrendingUp} />
          <StatCard label="Total Expenses" value={formatCurrency(totalExpenses)} color="text-red-500"   icon={AlertCircle} />
          <StatCard label="Net Profit"     value={formatCurrency(netProfit)}     color={netProfit >= 0 ? 'text-green-700' : 'text-red-600'} icon={DollarSign} />
          <StatCard label="Profit Margin"  value={totalRevenue > 0 ? `${((netProfit / totalRevenue) * 100).toFixed(1)}%` : '—'}
            color={netProfit >= 0 ? 'text-green-700' : 'text-red-600'} icon={Activity} />
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">Monthly P&L (Last 6 Months)</h2>
            <button onClick={() => exportCSV(`pl-${format(new Date(),'yyyy-MM-dd')}.csv`,
              monthlyPL.map(m => [m.month, m.revenue, m.expenses, m.profit]),
              ['Month','Revenue','Expenses','Net Profit'])}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-600 hover:bg-gray-50">
              <Download className="w-3.5 h-3.5" /> Export
            </button>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyPL}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F3F4F6" />
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: '#9CA3AF', fontSize: 11 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#9CA3AF', fontSize: 11 }} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                <Tooltip contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} formatter={(v: number) => [formatCurrency(v)]} />
                <Legend />
                <Bar dataKey="revenue"  fill="#3B82F6" radius={[4,4,0,0]} name="Revenue" />
                <Bar dataKey="expenses" fill="#FCA5A5" radius={[4,4,0,0]} name="Expenses" />
                <Bar dataKey="profit"   fill="#10B981" radius={[4,4,0,0]} name="Net Profit" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>{['Month','Revenue','Expenses','Net Profit','Margin'].map(h => (
                <th key={h} className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase">{h}</th>
              ))}</tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {monthlyPL.map(m => (
                <tr key={m.month} className="hover:bg-gray-50/50">
                  <td className="px-5 py-3 font-medium text-gray-900">{m.month}</td>
                  <td className="px-5 py-3 text-blue-700 font-medium">{formatCurrency(m.revenue)}</td>
                  <td className="px-5 py-3 text-red-500">{formatCurrency(m.expenses)}</td>
                  <td className={`px-5 py-3 font-semibold ${m.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatCurrency(m.profit)}</td>
                  <td className="px-5 py-3 text-gray-500">{m.revenue > 0 ? `${((m.profit / m.revenue) * 100).toFixed(1)}%` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>)}

      {/* ── OUTSTANDING DUES ── */}
      {tab === 'outstanding' && (<>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          <StatCard label="Outstanding Amount" value={formatCurrency(totalOutstanding)} color="text-red-600" icon={AlertCircle} />
          <StatCard label="Partial Payments"   value={partialCount} sub="patients paid partially" />
          <StatCard label="Unpaid Bills"       value={pendingCount} sub="zero payment received" />
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <div className="flex items-center gap-3">
            <input value={outstandingSearch} onChange={e => setOutstandingSearch(e.target.value)}
              placeholder="Search patient name or MRN..."
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <button onClick={() => exportCSV(`outstanding-${format(new Date(),'yyyy-MM-dd')}.csv`,
              outstanding.map(b => [b.billNo, b.patientName, b.patientMRN, b.date?.split('T')[0], b.total, b.paid, b.balance, b.paymentStatus]),
              ['Bill No','Patient','MRN','Date','Total','Paid','Balance','Status'])}
              className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 whitespace-nowrap">
              <Download className="w-4 h-4" /> Export
            </button>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>{['Bill #','Patient','MRN','Date','Total','Paid','Balance','Status'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">{h}</th>
              ))}</tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {outstanding.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-10 text-gray-400 text-sm">No outstanding dues 🎉</td></tr>
              ) : outstanding.map(b => (
                <tr key={b.id} className="hover:bg-gray-50/50">
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">{b.billNo || '—'}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{b.patientName}</td>
                  <td className="px-4 py-3 text-xs text-gray-500 font-mono">{b.patientMRN}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{b.date?.split('T')[0] || '—'}</td>
                  <td className="px-4 py-3 text-gray-700">{formatCurrency(b.total || 0)}</td>
                  <td className="px-4 py-3 text-green-600">{formatCurrency(b.paid || 0)}</td>
                  <td className="px-4 py-3 font-semibold text-red-600">{formatCurrency(b.balance || 0)}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${b.paymentStatus === 'partial' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>
                      {b.paymentStatus}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>)}

      {/* ── EXPIRY TRACKING ── */}
      {tab === 'expiry' && (<>
        <div className="grid grid-cols-3 gap-4">
          <StatCard label="Expiring ≤ 30 days"  value={expiryItems.filter(m => m.daysLeft <= 30).length}  color="text-red-600" icon={AlertCircle} />
          <StatCard label="Expiring ≤ 60 days"  value={expiryItems.filter(m => m.daysLeft <= 60).length}  color="text-orange-600" icon={AlertCircle} />
          <StatCard label="Expiring ≤ 90 days"  value={expiryItems.filter(m => m.daysLeft <= 90).length}  color="text-yellow-600" icon={AlertCircle} />
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Medicines Expiring Within 90 Days</h2>
            <button onClick={() => exportCSV(`expiry-${format(new Date(),'yyyy-MM-dd')}.csv`,
              expiryItems.map(m => [m.name, m.category, m.batchNo, m.expiryDate, m.stock, m.daysLeft]),
              ['Medicine','Category','Batch','Expiry Date','Stock','Days Left'])}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-600 hover:bg-gray-50">
              <Download className="w-3.5 h-3.5" /> Export
            </button>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>{['Medicine','Category','Batch No','Expiry Date','Stock','Days Left'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">{h}</th>
              ))}</tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {expiryItems.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-10 text-gray-400 text-sm">No medicines expiring within 90 days ✓</td></tr>
              ) : expiryItems.map(m => (
                <tr key={m.id} className={`hover:bg-gray-50/50 ${m.daysLeft <= 0 ? 'bg-red-50' : m.daysLeft <= 30 ? 'bg-red-50/40' : m.daysLeft <= 60 ? 'bg-orange-50/40' : 'bg-yellow-50/30'}`}>
                  <td className="px-4 py-3 font-medium text-gray-900">{m.name}</td>
                  <td className="px-4 py-3 text-gray-500">{m.category}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">{m.batchNo || '—'}</td>
                  <td className="px-4 py-3 text-gray-700">{m.expiryDate}</td>
                  <td className="px-4 py-3 text-gray-700">{m.stock || 0} units</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                      m.daysLeft <= 0 ? 'bg-red-200 text-red-800' :
                      m.daysLeft <= 30 ? 'bg-red-100 text-red-700' :
                      m.daysLeft <= 60 ? 'bg-orange-100 text-orange-700' :
                      'bg-yellow-100 text-yellow-700'
                    }`}>
                      {m.daysLeft <= 0 ? 'EXPIRED' : `${m.daysLeft} days`}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>)}
    </div>
  );
}
