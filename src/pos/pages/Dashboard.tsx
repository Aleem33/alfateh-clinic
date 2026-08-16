import { useEffect, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { formatCurrency } from '../lib/utils';
import { DollarSign, AlertTriangle, Package, Clock, ShoppingCart, X } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { format, subDays, isBefore, addDays } from 'date-fns';
import { subscribeToMedicines } from '../../lib/medicineStore';

export function Dashboard() {
  const [stats, setStats] = useState({
    todaySales: 0,
    lowStock: 0,
    expiringSoon: 0,
    totalMedicines: 0,
    totalStockValue: 0,
  });
  const [salesData, setSalesData] = useState<any[]>([]);
  const [expiringMedicines, setExpiringMedicines] = useState<any[]>([]);
  const [showExpiryList, setShowExpiryList] = useState(false);

  useEffect(() => {
    const unsubMedicines = subscribeToMedicines((medicines) => {
      let lowStockCount = 0;
      let expiringCount = 0;
      let inStockCount = 0;
      let stockValue = 0;
      const today = new Date();
      const nextMonth = addDays(today, 30);

      const expiring: any[] = [];
      medicines.forEach(data => {
        const stock = Number(data.stock || 0);
        if (stock > 0) inStockCount++;
        if (stock <= (data.unitsPerBox || 1) * 2) lowStockCount++;
        if (data.expiryDate && isBefore(new Date(data.expiryDate), nextMonth)) {
          expiringCount++;
          expiring.push(data);
        }
        const unitsPerBox = data.unitsPerBox || 1;
        const boxes = stock / unitsPerBox;
        stockValue += (data.costPrice || 0) * boxes;
      });

      setStats(prev => ({ ...prev, lowStock: lowStockCount, expiringSoon: expiringCount, totalMedicines: inStockCount, totalStockValue: stockValue }));
      setExpiringMedicines(expiring.sort((a, b) => String(a.expiryDate).localeCompare(String(b.expiryDate))));
    }, (error) => handleFirestoreError(error, OperationType.GET, 'medicines'));

    const unsubSales = onSnapshot(collection(db, 'sales'), (snapshot) => {
      let todayTotal = 0;
      const todayStr = format(new Date(), 'yyyy-MM-dd');

      const last7Days = Array.from({ length: 7 }).map((_, i) => {
        const d = subDays(new Date(), i);
        return { date: format(d, 'MMM dd'), fullDate: format(d, 'yyyy-MM-dd'), total: 0 };
      }).reverse();

      snapshot.docs.forEach(doc => {
        const data = doc.data();
        const saleDateStr = data.date ? data.date.split('T')[0] : '';
        if (saleDateStr === todayStr) todayTotal += data.total || 0;
        const dayMatch = last7Days.find(d => d.fullDate === saleDateStr);
        if (dayMatch) dayMatch.total += data.total || 0;
      });

      setStats(prev => ({ ...prev, todaySales: todayTotal }));
      setSalesData(last7Days);
    }, (error) => handleFirestoreError(error, OperationType.GET, 'sales'));

    return () => { unsubMedicines(); unsubSales(); };
  }, []);

  const statCards = [
    {
      label: "Today's Sales",
      value: formatCurrency(stats.todaySales),
      icon: DollarSign,
      iconBg: 'bg-green-100',
      iconColor: 'text-green-600',
      valueColor: 'text-gray-900',
    },
    {
      label: 'Low Stock Items',
      value: stats.lowStock.toString(),
      icon: AlertTriangle,
      iconBg: 'bg-red-100',
      iconColor: 'text-red-600',
      valueColor: 'text-gray-900',
    },
    {
      label: 'Expiring Soon',
      value: stats.expiringSoon.toString(),
      icon: Clock,
      iconBg: 'bg-orange-100',
      iconColor: 'text-orange-600',
      valueColor: 'text-gray-900',
      onClick: () => setShowExpiryList(true),
    },
    {
      label: 'Total Medicines',
      value: stats.totalMedicines.toString(),
      icon: Package,
      iconBg: 'bg-blue-100',
      iconColor: 'text-blue-600',
      valueColor: 'text-gray-900',
    },
    {
      label: 'Stock Purchase Value',
      value: formatCurrency(stats.totalStockValue),
      icon: ShoppingCart,
      iconBg: 'bg-indigo-100',
      iconColor: 'text-indigo-600',
      valueColor: 'text-indigo-700',
    },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
        {statCards.map((card) => (
          <button type="button" key={card.label} onClick={card.onClick}
            className={`bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex flex-col gap-3 min-w-0 text-left ${card.onClick ? 'hover:border-orange-300 hover:shadow-md cursor-pointer' : 'cursor-default'}`}>
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-gray-500 leading-tight">{card.label}</p>
              <div className={`p-2 rounded-lg shrink-0 ${card.iconBg} ${card.iconColor}`}>
                <card.icon className="w-4 h-4" />
              </div>
            </div>
            <p className={`text-xl font-bold truncate ${card.valueColor}`} title={card.value}>
              {card.value}
            </p>
          </button>
        ))}
      </div>

      {showExpiryList && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden">
            <div className="p-5 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Expiring Medicines</h2>
                <p className="text-sm text-gray-500">{expiringMedicines.length} batch record{expiringMedicines.length === 1 ? '' : 's'} expiring within 30 days or already expired</p>
              </div>
              <button type="button" onClick={() => setShowExpiryList(false)} className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg"><X className="w-5 h-5" /></button>
            </div>
            <div className="overflow-auto">
              <table className="w-full text-left">
                <thead className="sticky top-0 bg-gray-50 text-xs uppercase text-gray-500 border-b border-gray-100">
                  <tr>
                    <th className="px-4 py-3">Medicine</th>
                    <th className="px-4 py-3">Supplier</th>
                    <th className="px-4 py-3">Batch</th>
                    <th className="px-4 py-3">Stock</th>
                    <th className="px-4 py-3">Expiry</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {expiringMedicines.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-400">No medicines are expiring soon.</td></tr>
                  ) : expiringMedicines.map(medicine => (
                    <tr key={medicine.id}>
                      <td className="px-4 py-3 font-medium text-gray-900">{medicine.name}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{medicine.supplierName || 'No supplier'}</td>
                      <td className="px-4 py-3 text-sm font-mono text-gray-600">{medicine.batchNo || 'N/A'}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{medicine.stock || 0}</td>
                      <td className="px-4 py-3 text-sm font-semibold text-red-600">{format(new Date(medicine.expiryDate), 'MMM dd, yyyy')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Chart */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <h2 className="text-lg font-bold text-gray-900 mb-6">Sales Last 7 Days</h2>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={salesData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
              <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: '#6B7280', fontSize: 12 }} dy={10} />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fill: '#6B7280', fontSize: 12 }}
                tickFormatter={(value) => `Rs. ${value}`}
                width={80}
              />
              <Tooltip
                cursor={{ fill: '#F3F4F6' }}
                contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                formatter={(value: number) => [formatCurrency(value), 'Sales']}
              />
              <Bar dataKey="total" fill="#3B82F6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
