import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, query, orderBy, addDoc, doc, updateDoc, increment } from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../../firebase';
import { formatCurrency } from '../lib/utils';
import { Search, RotateCcw, Eye, X, CheckCircle, AlertTriangle, Printer } from 'lucide-react';
import { format } from 'date-fns';

export function SalesReturns() {
  const [sales, setSales] = useState<any[]>([]);
  const [returns, setReturns] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [selectedSale, setSelectedSale] = useState<any>(null);
  const [returnItems, setReturnItems] = useState<any[]>([]);
  const [returnReason, setReturnReason] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [printReturn, setPrintReturn] = useState<any>(null);

  useEffect(() => {
    const q = query(collection(db, 'sales'), orderBy('date', 'desc'));
    const unsubSales = onSnapshot(q, (snap) => {
      setSales(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (e) => handleFirestoreError(e, OperationType.GET, 'sales'));

    const unsubReturns = onSnapshot(collection(db, 'saleReturns'), (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      list.sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setReturns(list);
    }, (e) => handleFirestoreError(e, OperationType.GET, 'saleReturns'));

    return () => { unsubSales(); unsubReturns(); };
  }, []);

  const filteredSales = sales.filter(s =>
    s.id.toLowerCase().includes(search.toLowerCase()) ||
    (s.date && format(new Date(s.date), 'MMM dd, yyyy').toLowerCase().includes(search.toLowerCase()))
  );

  // Already-returned quantities per sale item
  const getReturnedQty = (saleId: string, cartItemId: string) => {
    return returns
      .filter(r => r.originalSaleId === saleId)
      .flatMap(r => r.items)
      .filter((i: any) => i.cartItemId === cartItemId)
      .reduce((sum: number, i: any) => sum + i.returnQty, 0);
  };

  const openReturn = (sale: any) => {
    setSelectedSale(sale);
    setReturnItems(
      sale.items.map((item: any) => ({
        ...item,
        returnQty: 0,
        alreadyReturned: getReturnedQty(sale.id, item.cartItemId),
        maxReturn: item.quantity - getReturnedQty(sale.id, item.cartItemId),
      }))
    );
    setReturnReason('');
  };

  const updateReturnQty = (cartItemId: string, val: number) => {
    setReturnItems(prev => prev.map(item => {
      if (item.cartItemId !== cartItemId) return item;
      const safeVal = Math.min(Math.max(0, val), item.maxReturn);
      return { ...item, returnQty: safeVal };
    }));
  };

  const returnTotal = returnItems.reduce((sum, item) => {
    const unitTotal = item.total / item.quantity;
    return sum + unitTotal * item.returnQty;
  }, 0);

  const hasAnyReturn = returnItems.some(i => i.returnQty > 0);

  const handleSubmit = async () => {
    if (!hasAnyReturn || !selectedSale) return;
    try {
      const itemsToReturn = returnItems.filter(i => i.returnQty > 0).map(i => ({
        cartItemId: i.cartItemId,
        medicineId: i.medicineId,
        name: i.name,
        sellType: i.sellType,
        price: i.price,
        returnQty: i.returnQty,
        unitsPerBox: i.unitsPerBox || 1,
        refundAmount: (i.total / i.quantity) * i.returnQty,
      }));

      const returnDoc = {
        originalSaleId: selectedSale.id,
        originalDate: selectedSale.date,
        items: itemsToReturn,
        totalRefund: returnTotal,
        reason: returnReason,
        date: new Date().toISOString(),
        processedBy: auth.currentUser?.uid,
      };

      await addDoc(collection(db, 'saleReturns'), returnDoc);

      // Restore stock
      for (const item of itemsToReturn) {
        const unitsToRestore = item.returnQty * (item.sellType === 'box' ? item.unitsPerBox : 1);
        await updateDoc(doc(db, 'medicines', item.medicineId), {
          stock: increment(unitsToRestore),
        });
      }

      setPrintReturn({ ...returnDoc, saleId: selectedSale.id });
      setSelectedSale(null);
      setSuccessMsg(`Return processed — Rs. ${returnTotal.toFixed(2)} refund`);
      setTimeout(() => setSuccessMsg(''), 5000);
      setTimeout(() => window.print(), 600);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'saleReturns');
    }
  };

  return (
    <>
      {/* Printable return slip */}
      {printReturn && (
        <div className="hidden print:block w-[80mm] mx-auto bg-white text-black text-sm font-mono p-4">
          <div className="text-center mb-4">
            <h2 className="text-xl font-bold">Al-Fateh Pharmacy</h2>
            <p className="font-bold">RETURN SLIP</p>
            <p>{format(new Date(printReturn.date), 'dd/MM/yyyy HH:mm')}</p>
            <p className="text-xs">Orig. Sale: {printReturn.originalSaleId?.slice(0, 8)}</p>
          </div>
          <table className="w-full mb-3">
            <thead>
              <tr className="border-b border-black border-dashed">
                <th className="text-left pb-1">Item</th>
                <th className="text-center pb-1">Qty</th>
                <th className="text-right pb-1">Refund</th>
              </tr>
            </thead>
            <tbody>
              {printReturn.items.map((item: any, i: number) => (
                <tr key={i}>
                  <td className="py-1 text-xs">{item.name} ({item.sellType})</td>
                  <td className="text-center py-1">{item.returnQty}</td>
                  <td className="text-right py-1">{formatCurrency(item.refundAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {printReturn.reason && <p className="text-xs mb-2">Reason: {printReturn.reason}</p>}
          <div className="border-t border-black border-dashed pt-2">
            <div className="flex justify-between font-bold text-base">
              <span>Total Refund:</span>
              <span>{formatCurrency(printReturn.totalRefund)}</span>
            </div>
          </div>
          <p className="text-center text-xs mt-6">Thank you</p>
        </div>
      )}

      <div className="space-y-6 print:hidden">
        {successMsg && (
          <div className="fixed top-4 right-4 bg-green-600 text-white px-5 py-3 rounded-lg shadow-lg z-50 flex items-center gap-2">
            <CheckCircle className="w-5 h-5" /> {successMsg}
          </div>
        )}

        <h1 className="text-2xl font-bold text-gray-900">Sale Returns</h1>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Left – find sale */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden flex flex-col">
            <div className="p-4 border-b border-gray-100">
              <p className="text-sm font-medium text-gray-600 mb-2">Search a sale to process return</p>
              <div className="relative">
                <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search by Sale ID or date..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div className="flex-1 overflow-auto divide-y divide-gray-100">
              {filteredSales.map(sale => {
                const returned = returns.filter(r => r.originalSaleId === sale.id);
                return (
                  <div key={sale.id} className="p-4 hover:bg-gray-50 flex justify-between items-center gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 text-sm">
                        {sale.date ? format(new Date(sale.date), 'MMM dd, yyyy HH:mm') : 'N/A'}
                      </p>
                      <p className="text-xs text-gray-400 font-mono">ID: {sale.id.slice(0, 12)}…</p>
                      <p className="text-xs text-gray-500 mt-0.5">{sale.items?.length || 0} items • {formatCurrency(sale.total)}</p>
                      {returned.length > 0 && (
                        <span className="inline-block mt-1 text-[10px] bg-orange-100 text-orange-700 font-semibold px-1.5 py-0.5 rounded">
                          {returned.length} return(s) processed
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => openReturn(sale)}
                      className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg text-xs font-semibold hover:bg-blue-100 border border-blue-100"
                    >
                      <RotateCcw className="w-3.5 h-3.5" /> Return
                    </button>
                  </div>
                );
              })}
              {filteredSales.length === 0 && (
                <div className="p-8 text-center text-gray-400 text-sm">No sales found.</div>
              )}
            </div>
          </div>

          {/* Right – return history */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden flex flex-col">
            <div className="p-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">Return History</h2>
            </div>
            <div className="flex-1 overflow-auto divide-y divide-gray-100">
              {returns.map(r => (
                <div key={r.id} className="p-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {r.date ? format(new Date(r.date), 'MMM dd, yyyy HH:mm') : 'N/A'}
                      </p>
                      <p className="text-xs text-gray-400">Orig. Sale: {r.originalSaleId?.slice(0, 10)}…</p>
                      {r.reason && <p className="text-xs text-gray-500 mt-0.5 italic">"{r.reason}"</p>}
                      <p className="text-xs text-gray-500 mt-1">
                        {r.items?.length} item(s) returned
                      </p>
                    </div>
                    <span className="text-red-600 font-bold text-sm">-{formatCurrency(r.totalRefund)}</span>
                  </div>
                </div>
              ))}
              {returns.length === 0 && (
                <div className="p-8 text-center text-gray-400 text-sm">No returns yet.</div>
              )}
            </div>
          </div>
        </div>

        {/* Process Return Modal */}
        {selectedSale && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 overflow-y-auto">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-lg my-8">
              <div className="p-6 border-b border-gray-100 flex justify-between items-center">
                <div>
                  <h2 className="text-xl font-bold text-gray-900">Process Sale Return</h2>
                  <p className="text-sm text-gray-500 mt-0.5">
                    {selectedSale.date ? format(new Date(selectedSale.date), 'MMM dd, yyyy HH:mm') : ''} • {formatCurrency(selectedSale.total)}
                  </p>
                </div>
                <button onClick={() => setSelectedSale(null)} className="p-1 text-gray-400 hover:text-gray-600">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 space-y-4">
                <p className="text-sm text-gray-600">Select items and quantities to return. Stock will be restored automatically.</p>

                <div className="space-y-3 max-h-64 overflow-auto">
                  {returnItems.map(item => (
                    <div key={item.cartItemId} className="flex items-center justify-between gap-3 p-3 border border-gray-100 rounded-lg">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 text-sm truncate">{item.name}</p>
                        <p className="text-xs text-gray-500">
                          Sold: {item.quantity} {item.sellType} @ {formatCurrency(item.price)}
                          {item.alreadyReturned > 0 && (
                            <span className="ml-1 text-orange-500">(already returned: {item.alreadyReturned})</span>
                          )}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs text-gray-400">Return:</span>
                        <input
                          type="number"
                          min="0"
                          max={item.maxReturn}
                          value={item.returnQty || ''}
                          placeholder="0"
                          onChange={e => updateReturnQty(item.cartItemId, parseInt(e.target.value) || 0)}
                          className={`w-16 p-1.5 text-center border rounded focus:outline-none text-sm font-semibold
                            ${item.returnQty > 0 ? 'border-blue-400 bg-blue-50' : 'border-gray-200'}
                            ${item.maxReturn === 0 ? 'opacity-40 cursor-not-allowed' : ''}`}
                          disabled={item.maxReturn === 0}
                        />
                        <span className="text-xs text-gray-400">/ {item.maxReturn}</span>
                      </div>
                    </div>
                  ))}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Reason for Return (optional)</label>
                  <input
                    type="text"
                    value={returnReason}
                    onChange={e => setReturnReason(e.target.value)}
                    placeholder="e.g. Wrong medicine, damaged, etc."
                    className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-sm"
                  />
                </div>

                {hasAnyReturn && (
                  <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 flex justify-between items-center">
                    <span className="text-sm font-medium text-blue-800">Total Refund Amount</span>
                    <span className="text-lg font-bold text-blue-700">{formatCurrency(returnTotal)}</span>
                  </div>
                )}

                {!hasAnyReturn && (
                  <div className="flex items-center gap-2 text-amber-600 text-sm">
                    <AlertTriangle className="w-4 h-4" />
                    Select at least one item quantity to return.
                  </div>
                )}

                <div className="flex justify-end gap-3 pt-2">
                  <button onClick={() => setSelectedSale(null)} className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-md font-medium text-sm">
                    Cancel
                  </button>
                  <button
                    onClick={handleSubmit}
                    disabled={!hasAnyReturn}
                    className="px-4 py-2 bg-red-600 text-white rounded-md font-medium text-sm hover:bg-red-700 disabled:opacity-50 flex items-center gap-2"
                  >
                    <RotateCcw className="w-4 h-4" />
                    Confirm Return & Print Slip
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
