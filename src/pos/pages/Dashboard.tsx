import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where, orderBy, limit } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { formatCurrency } from '../lib/utils';
import { DollarSign, AlertTriangle, Package, Clock } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { format, subDays, isBefore, addDays } from 'date-fns';

export function Dashboard() {
  const [stats, setStats] = useState({
    todaySales: 0,
    lowStock: 0,
    expiringSoon: 0,
    totalMedicines: 0
  });
  const [salesData, setSalesData] = useState<any[]>([]);

  useEffect(() => {
    // Listen to Medicines for stock and expiry alerts
    const unsubMedicines = onSnapshot(collection(db, 'medicines'), (snapshot) => {
      let lowStockCount = 0;
      let expiringCount = 0;
      const today = new Date();
      const nextMonth = addDays(today, 30);

      snapshot.docs.forEach(doc => {
        const data = doc.data();
        if (data.stock <= (data.unitsPerBox || 1) * 2) lowStockCount++;
        if (data.expiryDate && isBefore(new Date(data.expiryDate), nextMonth)) {
          expiringCount++;
        }
      });

      setStats(prev => ({
        ...prev,
        lowStock: lowStockCount,
        expiringSoon: expiringCount,
        totalMedicines: snapshot.size
      }));
    }, (error) => handleFirestoreError(error, OperationType.GET, 'medicines'));

    // Listen to Sales for today's revenue and chart
    const unsubSales = onSnapshot(collection(db, 'sales'), (snapshot) => {
      let todayTotal = 0;
      const todayStr = format(new Date(), 'yyyy-MM-dd');
      
      // Group sales by date for the last 7 days
      const last7Days = Array.from({ length: 7 }).map((_, i) => {
        const d = subDays(new Date(), i);
        return {
          date: format(d, 'MMM dd'),
          fullDate: format(d, 'yyyy-MM-dd'),
          total: 0
        };
      }).reverse();

      snapshot.docs.forEach(doc => {
        const data = doc.data();
        const saleDateStr = data.date ? data.date.split('T')[0] : '';
        
        if (saleDateStr === todayStr) {
          todayTotal += data.total || 0;
        }

        const dayMatch = last7Days.find(d => d.fullDate === saleDateStr);
        if (dayMatch) {
          dayMatch.total += data.total || 0;
        }
      });

      setStats(prev => ({ ...prev, todaySales: todayTotal }));
      setSalesData(last7Days);
    }, (error) => handleFirestoreError(error, OperationType.GET, 'sales'));

    return () => {
      unsubMedicines();
      unsubSales();
    };
  }, []);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
      
      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center gap-4">
          <div className="p-3 bg-green-100 text-green-600 rounded-lg">
            <DollarSign className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">Today's Sales</p>
            <p className="text-2xl font-bold text-gray-900">{formatCurrency(stats.todaySales)}</p>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center gap-4">
          <div className="p-3 bg-red-100 text-red-600 rounded-lg">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">Low Stock Items</p>
            <p className="text-2xl font-bold text-gray-900">{stats.lowStock}</p>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center gap-4">
          <div className="p-3 bg-orange-100 text-orange-600 rounded-lg">
            <Clock className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">Expiring Soon</p>
            <p className="text-2xl font-bold text-gray-900">{stats.expiringSoon}</p>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center gap-4">
          <div className="p-3 bg-blue-100 text-blue-600 rounded-lg">
            <Package className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">Total Medicines</p>
            <p className="text-2xl font-bold text-gray-900">{stats.totalMedicines}</p>
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <h2 className="text-lg font-bold text-gray-900 mb-6">Sales Last 7 Days</h2>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={salesData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
              <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: '#6B7280' }} dy={10} />
              <YAxis 
                axisLine={false} 
                tickLine={false} 
                tick={{ fill: '#6B7280' }}
                tickFormatter={(value) => `Rs. ${value}`}
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
