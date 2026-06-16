import { useEffect, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { formatCurrency } from '../lib/utils';
import { DollarSign, AlertTriangle, Package, Clock, ShoppingCart } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { format, subDays, isBefore, addDays } from 'date-fns';

export function Dashboard() {
  const [stats, setStats] = useState({
    todaySales: 0,
    lowStock: 0,
    expiringSoon: 0,
    totalMedicines: 0,
    totalStockValue: 0,
  });
  const [salesData, setSalesData] = useState<any[]>([]);

  useEffect(() => {
    const unsubMedicines = onSnapshot(collection(db, 'medicines'), (snapshot) => {
      let lowStockCount = 0;
      let expiringCount = 0;
      let inStockCount = 0;
      let stockValue = 0;
      const today = new Date();
      const nextMonth = addDays(today, 30);

      snapshot.docs.forEach(doc => {
        const data = doc.data();
        const stock = Number(data.stock || 0);
        if (stock > 0) inStockCount++;
        if (stock <= (data.unitsPerBox || 1) * 2) lowStockCount++;
        if (data.expiryDate && isBefore(new Date(data.expiryDate), nextMonth)) expiringCount++;
        const unitsPerBox = data.unitsPerBox || 1;
        const boxes = stock / unitsPerBox;
        stockValue += (data.costPrice || 0) * boxes;
      });

      setStats(prev => ({ ...prev, lowStock: lowStockCount, expiringSoon: expiringCount, totalMedicines: inStockCount, totalStockValue: stockValue }));
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
          <div key={card.label} className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex flex-col gap-3 min-w-0">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-gray-500 leading-tight">{card.label}</p>
              <div className={`p-2 rounded-lg shrink-0 ${card.iconBg} ${card.iconColor}`}>
                <card.icon className="w-4 h-4" />
              </div>
            </div>
            <p className={`text-xl font-bold truncate ${card.valueColor}`} title={card.value}>
              {card.value}
            </p>
          </div>
        ))}
      </div>

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
