import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { formatCurrency } from '../lib/utils';
import { Search, FileText, Eye, X, Printer } from 'lucide-react';
import { format } from 'date-fns';

export function SalesHistory() {
  const [sales, setSales] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [selectedSale, setSelectedSale] = useState<any | null>(null);
  const [showPrintAlert, setShowPrintAlert] = useState(false);

  useEffect(() => {
    // We fetch sales ordered by date descending
    const q = query(collection(db, 'sales'), orderBy('date', 'desc'));
    const unsub = onSnapshot(q, (snapshot) => {
      const salesList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setSales(salesList);
    }, (error) => handleFirestoreError(error, OperationType.GET, 'sales'));
    return () => unsub();
  }, []);

  const filteredSales = sales.filter(s => 
    s.id.toLowerCase().includes(search.toLowerCase()) || 
    (s.date && format(new Date(s.date), 'MMM dd, yyyy').toLowerCase().includes(search.toLowerCase()))
  );

  const handlePrint = () => {
    if (window !== window.top) {
      setShowPrintAlert(true);
      setTimeout(() => setShowPrintAlert(false), 5000);
    } else {
      window.print();
    }
  };

  return (
    <>
      {/* Print Alert Toast */}
      {showPrintAlert && (
        <div className="fixed top-4 right-4 bg-blue-600 text-white px-6 py-3 rounded-lg shadow-lg z-50 animate-fade-in">
          <p className="font-medium">Printing is blocked in this preview.</p>
          <p className="text-sm opacity-90">Please open the app in a new tab to print, or press Ctrl+P / Cmd+P.</p>
        </div>
      )}

      {/* Printable Receipt */}
      {selectedSale && (
        <div className="hidden print:block w-[80mm] mx-auto bg-white text-black text-sm font-mono p-4">
          <div className="text-center mb-4">
            <h2 className="text-xl font-bold">Al-Fateh Pharmacy</h2>
            <p>Receipt (Reprint)</p>
            <p>{selectedSale.date ? format(new Date(selectedSale.date), 'dd/MM/yyyy HH:mm') : 'N/A'}</p>
            <p className="text-xs mt-1">ID: {selectedSale.id.slice(0, 8)}</p>
          </div>
          <table className="w-full mb-4">
            <thead>
              <tr className="border-b border-black border-dashed">
                <th className="text-left pb-1">Item</th>
                <th className="text-center pb-1">Qty</th>
                <th className="text-right pb-1">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 divide-dashed">
              {selectedSale.items?.map((item: any) => (
                <tr key={item.cartItemId}>
                  <td className="py-1">
                    <div className="line-clamp-1">{item.name}</div>
                    <div className="text-xs text-gray-500">{item.sellType === 'box' ? '(Box)' : '(Unit)'} @ {formatCurrency(item.price)}</div>
                  </td>
                  <td className="text-center py-1">{item.quantity}</td>
                  <td className="text-right py-1">{formatCurrency(item.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-t border-black border-dashed pt-2 space-y-1">
            <div className="flex justify-between"><span>Subtotal:</span><span>{formatCurrency(selectedSale.subtotal)}</span></div>
            {selectedSale.discount > 0 && (
              <div className="flex justify-between">
                <span>Discount:</span>
                <span>-{formatCurrency(selectedSale.discount)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-lg mt-2 pt-2 border-t border-black">
              <span>Total:</span>
              <span>{formatCurrency(selectedSale.total)}</span>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-6 print:hidden">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Sales History</h1>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-4 border-b border-gray-100">
          <div className="relative max-w-md">
            <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search by ID or Date..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-sm border-b border-gray-100">
                <th className="p-4 font-medium">Date & Time</th>
                <th className="p-4 font-medium">Sale ID</th>
                <th className="p-4 font-medium">Type</th>
                <th className="p-4 font-medium">Items</th>
                <th className="p-4 font-medium">Subtotal</th>
                <th className="p-4 font-medium">Discount</th>
                <th className="p-4 font-medium">Total</th>
                <th className="p-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredSales.map((sale) => (
                <tr key={sale.id} className="hover:bg-gray-50">
                  <td className="p-4 text-gray-900 font-medium">
                    {sale.date ? format(new Date(sale.date), 'MMM dd, yyyy HH:mm') : 'N/A'}
                  </td>
                  <td className="p-4 text-gray-500 font-mono text-sm">
                    {sale.id.slice(0, 8)}...
                  </td>
                  <td className="p-4">
                    <span className={`inline-block px-2 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${sale.customerType === 'hospital' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                      {sale.customerType || 'customer'}
                    </span>
                  </td>
                  <td className="p-4 text-gray-600">
                    {sale.items?.length || 0} items
                  </td>
                  <td className="p-4 text-gray-600">
                    {formatCurrency(sale.subtotal)}
                  </td>
                  <td className="p-4 text-red-600">
                    {sale.discount > 0 ? `-${formatCurrency(sale.discount)}` : '-'}
                  </td>
                  <td className="p-4 font-bold text-gray-900">
                    {formatCurrency(sale.total)}
                  </td>
                  <td className="p-4 flex justify-end gap-2">
                    <button 
                      onClick={() => setSelectedSale(sale)} 
                      className="p-1.5 text-blue-600 hover:bg-blue-50 rounded flex items-center gap-1 text-sm font-medium"
                    >
                      <Eye className="w-4 h-4" /> View
                    </button>
                  </td>
                </tr>
              ))}
              {filteredSales.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-gray-500">
                    <div className="flex flex-col items-center justify-center">
                      <FileText className="w-12 h-12 text-gray-300 mb-2" />
                      <p>No sales records found.</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Sale Details Modal */}
      {selectedSale && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <div>
                <h2 className="text-xl font-bold text-gray-900">Sale Details</h2>
                <p className="text-sm text-gray-500 mt-1">
                  {selectedSale.date ? format(new Date(selectedSale.date), 'MMM dd, yyyy HH:mm') : 'N/A'} • ID: {selectedSale.id}
                  <span className={`ml-2 inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${selectedSale.customerType === 'hospital' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                    {selectedSale.customerType || 'customer'}
                  </span>
                </p>
              </div>
              <div className="flex gap-2">
                <button onClick={handlePrint} className="p-2 text-blue-600 hover:bg-blue-50 rounded-full transition-colors" title="Print Receipt">
                  <Printer className="w-5 h-5" />
                </button>
                <button onClick={() => setSelectedSale(null)} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded-full transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1">
              <h3 className="font-bold text-gray-900 mb-4">Items Purchased</h3>
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider border-b border-gray-200">
                      <th className="p-3 font-medium">Item</th>
                      <th className="p-3 font-medium text-center">Qty</th>
                      <th className="p-3 font-medium text-right">Price</th>
                      <th className="p-3 font-medium text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {selectedSale.items?.map((item: any, index: number) => (
                      <tr key={index} className="hover:bg-gray-50">
                        <td className="p-3">
                          <p className="font-medium text-gray-900">{item.name}</p>
                          <span className={`inline-block mt-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${item.sellType === 'box' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
                            {item.sellType}
                          </span>
                        </td>
                        <td className="p-3 text-center text-gray-600">{item.quantity}</td>
                        <td className="p-3 text-right text-gray-600">{formatCurrency(item.price)}</td>
                        <td className="p-3 text-right font-medium text-gray-900">{formatCurrency(item.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="p-6 border-t border-gray-100 bg-gray-50">
              <div className="w-64 ml-auto space-y-2">
                <div className="flex justify-between text-sm text-gray-600">
                  <span>Subtotal</span>
                  <span>{formatCurrency(selectedSale.subtotal)}</span>
                </div>
                <div className="flex justify-between text-sm text-red-600">
                  <span>Discount</span>
                  <span>-{formatCurrency(selectedSale.discount)}</span>
                </div>
                <div className="pt-2 border-t border-gray-200 flex justify-between items-center">
                  <span className="font-bold text-gray-900">Total Paid</span>
                  <span className="text-xl font-bold text-blue-600">{formatCurrency(selectedSale.total)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
    </>
  );
}
