import { useState, useEffect } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { formatCurrency } from '../lib/utils';
import { format, isBefore, addDays } from 'date-fns';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export function Reports() {
  const [sales, setSales] = useState<any[]>([]);
  const [medicines, setMedicines] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);

  useEffect(() => {
    const unsubSales = onSnapshot(collection(db, 'sales'), (snapshot) => {
      setSales(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => handleFirestoreError(error, OperationType.GET, 'sales'));

    const unsubMedicines = onSnapshot(collection(db, 'medicines'), (snapshot) => {
      setMedicines(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => handleFirestoreError(error, OperationType.GET, 'medicines'));

    const unsubExpenses = onSnapshot(collection(db, 'expenses'), (snapshot) => {
      setExpenses(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => handleFirestoreError(error, OperationType.GET, 'expenses'));

    return () => {
      unsubSales();
      unsubMedicines();
      unsubExpenses();
    };
  }, []);

  // Calculate totals
  const totalRevenue = sales.reduce((sum, sale) => sum + (sale.total || 0), 0);
  
  // Calculate Profit (Revenue - Cost of Goods Sold - Expenses)
  // For this simple version, we'll estimate profit based on items sold
  let totalCost = 0;
  sales.forEach(sale => {
    sale.items?.forEach((item: any) => {
      const med = medicines.find(m => m.id === item.medicineId);
      if (med) {
        const costPerUnit = (med.costPrice || 0) / (med.unitsPerBox || 1);
        const unitsSold = item.quantity * (item.sellType === 'box' ? (item.unitsPerBox || 1) : 1);
        totalCost += costPerUnit * unitsSold;
      }
    });
  });

  const totalExpenses = expenses.reduce((sum, exp) => sum + (exp.amount || 0), 0);
  const totalProfit = totalRevenue - totalCost - totalExpenses;

  // Expiring soon
  const nextMonth = addDays(new Date(), 30);
  const expiringMedicines = medicines.filter(m => m.expiryDate && isBefore(new Date(m.expiryDate), nextMonth));

  // Low stock
  const lowStockMedicines = medicines.filter(m => m.stock <= (m.unitsPerBox || 1) * 2);

  // Sales by customer type
  const customerSales = sales.filter(s => s.customerType === 'customer' || !s.customerType);
  const hospitalSales = sales.filter(s => s.customerType === 'hospital');

  const customerTotal = customerSales.reduce((sum, sale) => sum + (sale.total || 0), 0);
  const hospitalTotal = hospitalSales.reduce((sum, sale) => sum + (sale.total || 0), 0);

  // Sales by date for chart
  const salesByDate = sales.reduce((acc: any, sale) => {
    const date = sale.date ? format(new Date(sale.date), 'MMM dd') : 'Unknown';
    if (!acc[date]) acc[date] = 0;
    acc[date] += sale.total || 0;
    return acc;
  }, {});
  const chartData = Object.keys(salesByDate).map(date => ({ date, total: salesByDate[date] }));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Reports & Analytics</h1>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h3 className="text-sm font-medium text-gray-500 mb-1">Total Revenue</h3>
          <p className="text-3xl font-bold text-gray-900">{formatCurrency(totalRevenue)}</p>
        </div>
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h3 className="text-sm font-medium text-gray-500 mb-1">Total Expenses</h3>
          <p className="text-3xl font-bold text-red-600">{formatCurrency(totalExpenses)}</p>
        </div>
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h3 className="text-sm font-medium text-gray-500 mb-1">Estimated Profit</h3>
          <p className="text-3xl font-bold text-green-600">{formatCurrency(totalProfit)}</p>
        </div>
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h3 className="text-sm font-medium text-gray-500 mb-1">Total Sales</h3>
          <p className="text-3xl font-bold text-blue-600">{sales.length}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Sales by Customer Type */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 lg:col-span-2">
          <h2 className="text-lg font-bold text-gray-900 mb-4">Sales by Customer Type</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-lg border border-blue-100 bg-blue-50 flex justify-between items-center">
              <div>
                <p className="text-sm font-medium text-blue-800 mb-1">Walk-in Customers</p>
                <p className="text-2xl font-bold text-blue-900">{formatCurrency(customerTotal)}</p>
              </div>
              <div className="text-right">
                <p className="text-3xl font-bold text-blue-300">{customerSales.length}</p>
                <p className="text-xs font-medium text-blue-600 uppercase tracking-wider">Transactions</p>
              </div>
            </div>
            <div className="p-4 rounded-lg border-purple-100 bg-purple-50 flex justify-between items-center">
              <div>
                <p className="text-sm font-medium text-purple-800 mb-1">Hospitals</p>
                <p className="text-2xl font-bold text-purple-900">{formatCurrency(hospitalTotal)}</p>
              </div>
              <div className="text-right">
                <p className="text-3xl font-bold text-purple-300">{hospitalSales.length}</p>
                <p className="text-xs font-medium text-purple-600 uppercase tracking-wider">Transactions</p>
              </div>
            </div>
          </div>
        </div>

        {/* Chart */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h2 className="text-lg font-bold text-gray-900 mb-6">Revenue Trend</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: '#6B7280' }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#6B7280' }} tickFormatter={val => `Rs. ${val}`} />
                <Tooltip cursor={{ fill: '#F3F4F6' }} formatter={(value: number) => [formatCurrency(value), 'Revenue']} />
                <Bar dataKey="total" fill="#3B82F6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Alerts */}
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-red-500"></span>
              Low Stock Alerts ({lowStockMedicines.length})
            </h2>
            <div className="space-y-3 max-h-32 overflow-auto">
              {lowStockMedicines.map(m => (
                <div key={m.id} className="flex justify-between items-center text-sm">
                  <span className="font-medium text-gray-700">{m.name}</span>
                  <span className="text-red-600 font-bold">{m.stock} left</span>
                </div>
              ))}
              {lowStockMedicines.length === 0 && <p className="text-sm text-gray-500">All stock levels are good.</p>}
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-orange-500"></span>
              Expiring Soon ({expiringMedicines.length})
            </h2>
            <div className="space-y-3 max-h-32 overflow-auto">
              {expiringMedicines.map(m => (
                <div key={m.id} className="flex justify-between items-center text-sm">
                  <span className="font-medium text-gray-700">{m.name}</span>
                  <span className="text-orange-600 font-medium">
                    {m.expiryDate ? format(new Date(m.expiryDate), 'MMM dd, yyyy') : 'N/A'}
                  </span>
                </div>
              ))}
              {expiringMedicines.length === 0 && <p className="text-sm text-gray-500">No medicines expiring soon.</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
