import { useState, useEffect } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { formatCurrency } from '../lib/utils';
import {
  format, isBefore, addDays, startOfDay, endOfDay,
  startOfWeek, endOfWeek, startOfMonth, endOfMonth,
  parseISO, isWithinInterval,
} from 'date-fns';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Calendar, X, TrendingUp, TrendingDown, DollarSign, ShoppingCart, AlertTriangle, Clock } from 'lucide-react';

type PeriodFilter = 'daily' | 'weekly' | 'monthly' | 'custom' | 'all';

export function Reports() {
  const [sales, setSales]         = useState<any[]>([]);
  const [medicines, setMedicines] = useState<any[]>([]);
  const [expenses, setExpenses]   = useState<any[]>([]);

  const [period, setPeriod]     = useState<PeriodFilter>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo]     = useState('');
  const [showCustom, setShowCustom] = useState(false);

  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'sales'),    s => setSales(s.docs.map(d => ({ id: d.id, ...d.data() }))),    e => handleFirestoreError(e, OperationType.GET, 'sales'));
    const u2 = onSnapshot(collection(db, 'medicines'),s => setMedicines(s.docs.map(d => ({ id: d.id, ...d.data() }))),e => handleFirestoreError(e, OperationType.GET, 'medicines'));
    const u3 = onSnapshot(collection(db, 'expenses'), s => setExpenses(s.docs.map(d => ({ id: d.id, ...d.data() }))), e => handleFirestoreError(e, OperationType.GET, 'expenses'));
    return () => { u1(); u2(); u3(); };
  }, []);

  const getDateRange = (): { start: Date; end: Date } | null => {
    const now = new Date();
    if (period === 'daily')   return { start: startOfDay(now), end: endOfDay(now) };
    if (period === 'weekly')  return { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfWeek(now, { weekStartsOn: 1 }) };
    if (period === 'monthly') return { start: startOfMonth(now), end: endOfMonth(now) };
    if (period === 'custom' && dateFrom && dateTo)  return { start: startOfDay(parseISO(dateFrom)), end: endOfDay(parseISO(dateTo)) };
    if (period === 'custom' && dateFrom) return { start: startOfDay(parseISO(dateFrom)), end: endOfDay(now) };
    if (period === 'custom' && dateTo)   return { start: new Date(0), end: endOfDay(parseISO(dateTo)) };
    return null;
  };

  const dateRange = getDateRange();

  const filteredSales = dateRange
    ? sales.filter(s => { const d = s.date ? new Date(s.date) : null; return d ? isWithinInterval(d, dateRange) : false; })
    : sales;

  const filteredExpenses = dateRange
    ? expenses.filter(e => { const d = e.date ? new Date(e.date) : null; return d ? isWithinInterval(d, dateRange) : false; })
    : expenses;

  const totalRevenue  = filteredSales.reduce((sum, s) => sum + (s.total || 0), 0);
  const totalExpenses = filteredExpenses.reduce((sum, e) => sum + (e.amount || 0), 0);

  let totalCost = 0;
  filteredSales.forEach(sale => {
    sale.items?.forEach((item: any) => {
      const costPrice  = item.costPrice   || 0;
      const unitsPerBox = item.unitsPerBox || 1;
      const costPerUnit = costPrice / unitsPerBox;
      const unitsSold   = item.quantity * (item.sellType === 'box' ? unitsPerBox : 1);
      totalCost += costPerUnit * unitsSold;
    });
  });

  const totalProfit = totalRevenue - totalCost - totalExpenses;

  const nextMonth         = addDays(new Date(), 30);
  const expiringMedicines = medicines.filter(m => m.expiryDate && isBefore(new Date(m.expiryDate), nextMonth));
  const lowStockMedicines = medicines.filter(m => m.stock <= (m.unitsPerBox || 1) * 2);

  const customerSales = filteredSales.filter(s => s.customerType === 'customer' || !s.customerType);
  const hospitalSales = filteredSales.filter(s => s.customerType === 'hospital');
  const customerTotal = customerSales.reduce((sum, s) => sum + (s.total || 0), 0);
  const hospitalTotal = hospitalSales.reduce((sum, s) => sum + (s.total || 0), 0);

  const salesByDate = filteredSales.reduce((acc: any, sale) => {
    const date = sale.date ? format(new Date(sale.date), 'MMM dd') : 'Unknown';
    acc[date] = (acc[date] || 0) + (sale.total || 0);
    return acc;
  }, {});
  const chartData = Object.keys(salesByDate).map(date => ({ date, total: salesByDate[date] }));

  const periodLabels: Record<PeriodFilter, string> = {
    daily: 'Today', weekly: 'This Week', monthly: 'This Month', custom: 'Custom', all: 'All Time',
  };

  const setPeriodAndClose = (p: PeriodFilter) => {
    setPeriod(p);
    if (p !== 'custom') { setDateFrom(''); setDateTo(''); setShowCustom(false); }
    else setShowCustom(true);
  };

  return (
    <div className="space-y-4 md:space-y-6">

      {/* Header + period selector */}
      <div className="space-y-3">
        <h1 className="text-xl md:text-2xl font-bold text-gray-900">Reports & Analytics</h1>

        {/* Period pills — scrollable on mobile */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide">
          {(['daily', 'weekly', 'monthly', 'all', 'custom'] as PeriodFilter[]).map(p => (
            <button key={p}
              onClick={() => setPeriodAndClose(p)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-semibold whitespace-nowrap transition-all shrink-0 ${
                period === p
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-white text-gray-600 border border-gray-200 hover:border-blue-300'
              }`}>
              {p === 'custom' && <Calendar className="w-3.5 h-3.5" />}
              {p === 'custom' ? 'Custom' : p === 'all' ? 'All Time' : p.charAt(0).toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>

        {/* Custom date range */}
        {period === 'custom' && (
          <div className="flex items-center gap-2 flex-wrap">
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="flex-1 min-w-0 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <span className="text-gray-400 shrink-0">–</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="flex-1 min-w-0 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            {(dateFrom || dateTo) && (
              <button onClick={() => { setDateFrom(''); setDateTo(''); }}
                className="p-2 text-gray-400 hover:text-red-500">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        )}

        {/* Active period badge */}
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span className="bg-blue-50 text-blue-700 px-2.5 py-1 rounded-full font-medium">
            {periodLabels[period]}
            {period === 'custom' && dateFrom && dateTo
              ? `: ${format(parseISO(dateFrom), 'MMM dd')} – ${format(parseISO(dateTo), 'MMM dd, yyyy')}`
              : ''}
          </span>
          <span>{filteredSales.length} transactions</span>
        </div>
      </div>

      {/* KPI cards — 2 cols on mobile, 4 on desktop */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <div className="bg-white p-4 md:p-6 rounded-xl shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs md:text-sm font-medium text-gray-500">Revenue</p>
            <TrendingUp className="w-4 h-4 text-blue-400" />
          </div>
          <p className="text-xl md:text-3xl font-bold text-gray-900">{formatCurrency(totalRevenue)}</p>
        </div>
        <div className="bg-white p-4 md:p-6 rounded-xl shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs md:text-sm font-medium text-gray-500">Expenses</p>
            <TrendingDown className="w-4 h-4 text-red-400" />
          </div>
          <p className="text-xl md:text-3xl font-bold text-red-600">{formatCurrency(totalExpenses)}</p>
        </div>
        <div className="bg-white p-4 md:p-6 rounded-xl shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs md:text-sm font-medium text-gray-500">Est. Profit</p>
            <DollarSign className={`w-4 h-4 ${totalProfit >= 0 ? 'text-green-400' : 'text-red-400'}`} />
          </div>
          <p className={`text-xl md:text-3xl font-bold ${totalProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {formatCurrency(totalProfit)}
          </p>
        </div>
        <div className="bg-white p-4 md:p-6 rounded-xl shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs md:text-sm font-medium text-gray-500">Total Sales</p>
            <ShoppingCart className="w-4 h-4 text-purple-400" />
          </div>
          <p className="text-xl md:text-3xl font-bold text-blue-600">{filteredSales.length}</p>
        </div>
      </div>

      {/* Customer vs Hospital */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4">
        <div className="p-4 md:p-5 rounded-xl border border-blue-100 bg-blue-50 flex justify-between items-center">
          <div>
            <p className="text-sm font-medium text-blue-800 mb-1">Walk-in Customers</p>
            <p className="text-xl md:text-2xl font-bold text-blue-900">{formatCurrency(customerTotal)}</p>
          </div>
          <div className="text-right">
            <p className="text-2xl md:text-3xl font-bold text-blue-200">{customerSales.length}</p>
            <p className="text-[10px] font-bold text-blue-600 uppercase tracking-wider">Sales</p>
          </div>
        </div>
        <div className="p-4 md:p-5 rounded-xl border border-purple-100 bg-purple-50 flex justify-between items-center">
          <div>
            <p className="text-sm font-medium text-purple-800 mb-1">Hospitals</p>
            <p className="text-xl md:text-2xl font-bold text-purple-900">{formatCurrency(hospitalTotal)}</p>
          </div>
          <div className="text-right">
            <p className="text-2xl md:text-3xl font-bold text-purple-200">{hospitalSales.length}</p>
            <p className="text-[10px] font-bold text-purple-600 uppercase tracking-wider">Sales</p>
          </div>
        </div>
      </div>

      {/* Revenue chart */}
      <div className="bg-white p-4 md:p-6 rounded-xl shadow-sm border border-gray-100">
        <h2 className="text-base md:text-lg font-bold text-gray-900 mb-4">Revenue Trend</h2>
        {chartData.length === 0 ? (
          <div className="h-48 flex items-center justify-center text-gray-400 text-sm">
            No sales data for selected period.
          </div>
        ) : (
          <div className="h-48 md:h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 0, right: 0, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                <XAxis dataKey="date" axisLine={false} tickLine={false}
                  tick={{ fill: '#6B7280', fontSize: 11 }} dy={8} />
                <YAxis axisLine={false} tickLine={false}
                  tick={{ fill: '#6B7280', fontSize: 11 }}
                  tickFormatter={val => `${val >= 1000 ? (val / 1000).toFixed(0) + 'k' : val}`} />
                <Tooltip cursor={{ fill: '#F3F4F6' }}
                  formatter={(value: number) => [formatCurrency(value), 'Revenue']} />
                <Bar dataKey="total" fill="#3B82F6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Alerts — side by side on desktop, stacked on mobile */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">

        {/* Low stock */}
        <div className="bg-white p-4 md:p-6 rounded-xl shadow-sm border border-gray-100">
          <h2 className="text-base font-bold text-gray-900 mb-3 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-500" />
            Low Stock
            {lowStockMedicines.length > 0 && (
              <span className="ml-auto bg-red-100 text-red-700 text-xs font-bold px-2 py-0.5 rounded-full">
                {lowStockMedicines.length}
              </span>
            )}
          </h2>
          <div className="space-y-2 max-h-40 overflow-auto">
            {lowStockMedicines.length === 0 ? (
              <p className="text-sm text-gray-500 italic">All stock levels are good ✓</p>
            ) : lowStockMedicines.map(m => (
              <div key={m.id} className="flex justify-between items-center py-1.5 border-b border-gray-100 last:border-0">
                <span className="text-sm font-medium text-gray-700 truncate mr-2">{m.name}</span>
                <span className="text-red-600 font-bold text-sm shrink-0 bg-red-50 px-2 py-0.5 rounded">{m.stock} left</span>
              </div>
            ))}
          </div>
        </div>

        {/* Expiring soon */}
        <div className="bg-white p-4 md:p-6 rounded-xl shadow-sm border border-gray-100">
          <h2 className="text-base font-bold text-gray-900 mb-3 flex items-center gap-2">
            <Clock className="w-4 h-4 text-orange-500" />
            Expiring Soon
            {expiringMedicines.length > 0 && (
              <span className="ml-auto bg-orange-100 text-orange-700 text-xs font-bold px-2 py-0.5 rounded-full">
                {expiringMedicines.length}
              </span>
            )}
          </h2>
          <div className="space-y-2 max-h-40 overflow-auto">
            {expiringMedicines.length === 0 ? (
              <p className="text-sm text-gray-500 italic">No medicines expiring soon ✓</p>
            ) : expiringMedicines.map(m => (
              <div key={m.id} className="flex justify-between items-center py-1.5 border-b border-gray-100 last:border-0">
                <span className="text-sm font-medium text-gray-700 truncate mr-2">{m.name}</span>
                <span className="text-orange-600 font-medium text-xs shrink-0 bg-orange-50 px-2 py-0.5 rounded">
                  {m.expiryDate ? format(new Date(m.expiryDate), 'MMM dd, yyyy') : 'N/A'}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
