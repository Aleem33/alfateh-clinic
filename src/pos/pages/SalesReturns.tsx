import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, query, orderBy, addDoc, doc, updateDoc, increment, writeBatch } from '@/lib/firestore';
import { printOrShare } from '../lib/nativeUtils';
import { db, auth, handleFirestoreError, OperationType, getNextPosSaleReturnNo } from '../../firebase';
import { formatCurrency } from '../lib/utils';
import { getReturnNo, getSaleReceiptLabel, getSaleReceiptNo } from '../lib/receiptNumbers';
import { waitForOnlineWrite } from '../../lib/offlineWrite';
import { Search, RotateCcw, X, CheckCircle, AlertTriangle, Printer } from 'lucide-react';
import { format } from 'date-fns';
import { subscribeToMedicines } from '../../lib/medicineStore';
import { searchMedicines } from '../../lib/medicineIndex';
import { PHARMACY_RECEIPT_NAME, receiptPolicyHtml } from '../lib/receiptBrand';
import { calculateReturnRefund, calculateReturnStockUnits } from '../lib/saleReturn';

// ── Print via hidden iframe so main page layout is unaffected ────────────────
function printSlip(slipHtml: string) {
  printOrShare(slipHtml, 'sale-return-slip.html');
}

export function SalesReturns() {
  const [sales, setSales] = useState<any[]>([]);
  const [returns, setReturns] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [selectedSale, setSelectedSale] = useState<any>(null);
  const [returnItems, setReturnItems] = useState<any[]>([]);
  const [returnReason, setReturnReason] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [medicines, setMedicines] = useState<any[]>([]);
  const [showNoReceiptReturn, setShowNoReceiptReturn] = useState(false);
  const [medicineSearch, setMedicineSearch] = useState('');
  const [manualMedicine, setManualMedicine] = useState<any>(null);
  const [manualSellType, setManualSellType] = useState<'box' | 'unit'>('unit');
  const [manualQty, setManualQty] = useState(1);
  const [manualRefundPrice, setManualRefundPrice] = useState('');
  const [manualReason, setManualReason] = useState('');

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

    const unsubMedicines = subscribeToMedicines(
      setMedicines,
      (e) => handleFirestoreError(e, OperationType.GET, 'medicines'),
    );

    return () => { unsubSales(); unsubReturns(); unsubMedicines(); };
  }, []);

  const filteredMedicines = searchMedicines(medicines, medicineSearch);

  const medicineBoxPrice = (medicine: any) => Number(medicine.retailPrice || medicine.price || 0);
  const medicineUnitPrice = (medicine: any) => {
    const explicit = Number(medicine.unitPrice || 0);
    if (explicit > 0) return explicit;
    const unitsPerBox = Math.max(1, Number(medicine.unitsPerBox || 1));
    return medicineBoxPrice(medicine) / unitsPerBox;
  };

  const selectManualMedicine = (medicine: any, sellType: 'box' | 'unit' = 'unit') => {
    setManualMedicine(medicine);
    setManualSellType(sellType);
    setManualQty(1);
    setManualRefundPrice(String(sellType === 'box' ? medicineBoxPrice(medicine) : medicineUnitPrice(medicine)));
  };

  const filteredSales = sales.filter(s =>
    getSaleReceiptNo(s, '').toLowerCase().includes(search.toLowerCase()) ||
    s.id.toLowerCase().includes(search.toLowerCase()) ||
    (s.date && format(new Date(s.date), 'MMM dd, yyyy').toLowerCase().includes(search.toLowerCase()))
  );

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

  // Apply order-level discount proportionally: sale.total / sale.subtotal gives the
  // effective multiplier after order discount. item.total already has item-discount applied.
  const orderDiscountRatio = selectedSale && selectedSale.subtotal > 0
    ? selectedSale.total / selectedSale.subtotal
    : 1;

  const returnTotal = returnItems.reduce((sum, item) => {
    const effectiveUnitPrice = (item.total / item.quantity) * orderDiscountRatio;
    return sum + effectiveUnitPrice * item.returnQty;
  }, 0);

  const hasAnyReturn = returnItems.some(i => i.returnQty > 0);

  // Render slip into hidden div then print
  const printReturnData = (data: any) => {
    const slipHtml = `
      <div class="thermal-receipt">
        <div style="text-align:center;margin-bottom:10px">
          <div style="font-size:16px;font-weight:bold">${PHARMACY_RECEIPT_NAME}</div>
          <div style="font-weight:bold;letter-spacing:2px;margin-top:2px">SALE RETURN SLIP</div>
          <div>${format(new Date(data.date), 'dd/MM/yyyy HH:mm')}</div>
          <div style="font-size:10px;margin-top:2px">Return No: ${getReturnNo(data)}</div>
          <div style="font-size:10px">${data.withoutReceipt ? 'Return without receipt' : `Orig. Receipt: ${data.originalReceiptNo || 'Unnumbered'}`}</div>
        </div>
        <div style="border-top:1px dashed #000;border-bottom:1px dashed #000;padding:6px 0;margin-bottom:6px">
          <table style="width:100%;table-layout:fixed;border-collapse:collapse;font-size:10px">
            <colgroup><col style="width:40%"><col style="width:20%"><col style="width:13%"><col style="width:27%"></colgroup>
            <thead><tr>
              <th style="text-align:left;padding-bottom:4px">Item</th>
              <th style="text-align:right;padding-bottom:4px">Price</th>
              <th style="text-align:center;padding-bottom:4px">Qty</th>
              <th style="text-align:right;padding-bottom:4px">Refund</th>
            </tr></thead>
            <tbody>
              ${data.items.map((item: any) => `
                <tr>
                  <td style="padding:3px 2px 3px 0;font-weight:bold;overflow-wrap:anywhere">${item.name}</td>
                  <td style="text-align:right;padding-top:3px;white-space:nowrap">${formatCurrency(item.price)}</td>
                  <td style="text-align:center;padding-top:3px;white-space:nowrap">${item.returnQty}${item.sellType === 'box' ? 'B' : 'U'}</td>
                  <td style="text-align:right;padding-top:3px">${formatCurrency(item.refundAmount)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        ${data.reason ? `<div style="font-size:10px;margin-bottom:6px">Reason: ${data.reason}</div>` : ''}
        <div style="border-top:1px dashed #000;padding-top:6px;break-inside:avoid">
          <div style="display:grid;grid-template-columns:1fr auto;gap:6px;font-weight:bold;font-size:13px">
            <span>Total Refund:</span>
            <span>${formatCurrency(data.totalRefund)}</span>
          </div>
        </div>
        <div style="text-align:center;font-size:10px;margin-top:14px">Thank you for your understanding</div>
        <div style="text-align:center;font-size:10px">${PHARMACY_RECEIPT_NAME}</div>
        ${receiptPolicyHtml()}
      </div>
    `;
    printSlip(slipHtml);
  };

  const handleSubmit = async () => {
    if (!hasAnyReturn || !selectedSale || submitting) return;
    setSubmitting(true);
    try {
      const returnNo = await getNextPosSaleReturnNo();
      const itemsToReturn = returnItems.filter(i => i.returnQty > 0).map(i => ({
        cartItemId: i.cartItemId,
        medicineId: i.medicineId,
        name: i.name,
        sellType: i.sellType,
        price: i.price,
        returnQty: i.returnQty,
        unitsPerBox: i.unitsPerBox || 1,
        refundAmount: (i.total / i.quantity) * orderDiscountRatio * i.returnQty,
      }));

      const returnDoc = {
        returnNo,
        originalSaleId: selectedSale.id,
        originalReceiptNo: getSaleReceiptNo(selectedSale),
        originalDate: selectedSale.date,
        items: itemsToReturn,
        totalRefund: returnTotal,
        reason: returnReason,
        date: new Date().toISOString(),
        processedBy: auth.currentUser?.uid,
      };

      const batch = writeBatch(db);
      const docRef = doc(collection(db, 'saleReturns'));
      batch.set(docRef, returnDoc);

      for (const item of itemsToReturn) {
        const unitsToRestore = item.returnQty * (item.sellType === 'box' ? item.unitsPerBox : 1);
        const movementRef = doc(collection(db, 'stockMovements'));
        batch.set(movementRef, {
          type: 'sale-return',
          returnId: docRef.id,
          returnNo,
          originalSaleId: selectedSale.id,
          originalReceiptNo: getSaleReceiptNo(selectedSale),
          medicineId: item.medicineId,
          medicineName: item.name,
          quantity: unitsToRestore,
          createdAt: new Date().toISOString(),
          processedBy: auth.currentUser?.uid || '',
        });
        batch.update(doc(db, 'medicines', item.medicineId), {
          stock: increment(unitsToRestore),
        });
      }
      await waitForOnlineWrite(batch.commit());

      const dataWithId = { ...returnDoc, id: docRef.id };
      setSelectedSale(null);
      setSuccessMsg(`Return processed — Rs. ${returnTotal.toFixed(2)} refund`);
      setTimeout(() => setSuccessMsg(''), 5000);
      setTimeout(() => printReturnData(dataWithId), 400);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'saleReturns');
    } finally {
      setSubmitting(false);
    }
  };

  const handleNoReceiptSubmit = async () => {
    if (!manualMedicine || submitting) return;
    const quantity = Math.max(1, Math.floor(Number(manualQty) || 1));
    const price = Math.max(0, Number(manualRefundPrice) || 0);
    const unitsPerBox = Math.max(1, Number(manualMedicine.unitsPerBox || 1));
    const unitsToRestore = calculateReturnStockUnits(quantity, manualSellType, unitsPerBox);
    const totalRefund = calculateReturnRefund(quantity, price);
    setSubmitting(true);
    try {
      const returnNo = await getNextPosSaleReturnNo();
      const item = {
        cartItemId: `no-receipt-${manualMedicine.id}-${manualSellType}`,
        medicineId: manualMedicine.id,
        name: manualMedicine.name,
        batchNo: manualMedicine.batchNo || '',
        sellType: manualSellType,
        price,
        returnQty: quantity,
        unitsPerBox,
        refundAmount: totalRefund,
      };
      const returnDoc = {
        returnNo,
        originalSaleId: '',
        originalReceiptNo: '',
        withoutReceipt: true,
        items: [item],
        totalRefund,
        reason: manualReason.trim() || 'Return processed without original receipt',
        date: new Date().toISOString(),
        processedBy: auth.currentUser?.uid || '',
      };
      const batch = writeBatch(db);
      const docRef = doc(collection(db, 'saleReturns'));
      batch.set(docRef, returnDoc);
      const movementRef = doc(collection(db, 'stockMovements'));
      batch.set(movementRef, {
        type: 'sale-return-without-receipt',
        returnId: docRef.id,
        returnNo,
        medicineId: manualMedicine.id,
        medicineName: manualMedicine.name,
        batchNo: manualMedicine.batchNo || '',
        quantity: unitsToRestore,
        createdAt: new Date().toISOString(),
        processedBy: auth.currentUser?.uid || '',
      });
      batch.update(doc(db, 'medicines', manualMedicine.id), { stock: increment(unitsToRestore) });
      await waitForOnlineWrite(batch.commit());

      const dataWithId = { ...returnDoc, id: docRef.id };
      setShowNoReceiptReturn(false);
      setManualMedicine(null);
      setMedicineSearch('');
      setManualReason('');
      setSuccessMsg(`Receipt-less return processed — Rs. ${totalRefund.toFixed(2)} refund`);
      setTimeout(() => setSuccessMsg(''), 5000);
      setTimeout(() => printReturnData(dataWithId), 400);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'saleReturns');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {successMsg && (
        <div className="fixed top-4 right-4 bg-green-600 text-white px-5 py-3 rounded-lg shadow-lg z-50 flex items-center gap-2">
          <CheckCircle className="w-5 h-5" /> {successMsg}
        </div>
      )}

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-bold text-gray-900">Sale Returns</h1>
        <button
          onClick={() => {
            setShowNoReceiptReturn(true);
            setManualMedicine(null);
            setMedicineSearch('');
            setManualReason('');
          }}
          className="flex items-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-lg text-sm font-semibold hover:bg-orange-700"
        >
          <RotateCcw className="w-4 h-4" /> Return Without Receipt
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Left – find sale */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden flex flex-col">
          <div className="p-4 border-b border-gray-100">
            <p className="text-sm font-medium text-gray-600 mb-2">Search a sale to process return</p>
            <div className="relative">
              <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search by receipt no or date..."
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
                    <p className="text-xs text-gray-400 font-mono">{getSaleReceiptLabel(sale)}</p>
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

        {/* Right – return history with reprint */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden flex flex-col">
          <div className="p-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Return History</h2>
          </div>
          <div className="flex-1 overflow-auto divide-y divide-gray-100">
            {returns.map(r => (
              <div key={r.id} className="p-4">
                <div className="flex justify-between items-start gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900">
                      {r.date ? format(new Date(r.date), 'MMM dd, yyyy HH:mm') : 'N/A'}
                    </p>
                    <p className="text-xs text-gray-400 font-mono">Return #{getReturnNo(r)}</p>
                    <p className="text-xs text-gray-400">{r.withoutReceipt ? 'Without original receipt' : `Orig. Receipt: ${r.originalReceiptNo || 'Unnumbered'}`}</p>
                    {r.reason && <p className="text-xs text-gray-500 mt-0.5 italic">"{r.reason}"</p>}
                    <p className="text-xs text-gray-500 mt-1">{r.items?.length} item(s) returned</p>
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <span className="text-red-600 font-bold text-sm">-{formatCurrency(r.totalRefund)}</span>
                    <button
                      onClick={() => printReturnData(r)}
                      className="flex items-center gap-1 text-xs text-gray-500 hover:text-blue-600 border border-gray-200 hover:border-blue-300 px-2 py-1 rounded-md transition-colors"
                      title="Reprint receipt"
                    >
                      <Printer className="w-3.5 h-3.5" /> Print
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {returns.length === 0 && (
              <div className="p-8 text-center text-gray-400 text-sm">No returns yet.</div>
            )}
          </div>
        </div>
      </div>

      {showNoReceiptReturn && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl my-8">
            <div className="p-5 border-b border-gray-100 flex justify-between items-center">
              <div>
                <h2 className="text-xl font-bold text-gray-900">Return Medicine Without Receipt</h2>
                <p className="text-sm text-gray-500 mt-0.5">Select the exact medicine batch. Its stock will be restored separately.</p>
              </div>
              <button onClick={() => setShowNoReceiptReturn(false)} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              {!manualMedicine ? (
                <>
                  <div className="relative">
                    <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      autoFocus
                      value={medicineSearch}
                      onChange={e => setMedicineSearch(e.target.value)}
                      placeholder="Search medicine by name, batch, category or supplier..."
                      className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                    />
                  </div>
                  <p className="text-xs text-gray-500">Showing {filteredMedicines.length} of {medicines.length} active medicine records</p>
                  <div className="max-h-80 overflow-auto divide-y divide-gray-100 border border-gray-100 rounded-lg">
                    {filteredMedicines.map(medicine => (
                      <button key={medicine.id} onClick={() => selectManualMedicine(medicine)} className="w-full text-left p-3 hover:bg-orange-50 flex justify-between gap-4">
                        <div className="min-w-0">
                          <p className="font-semibold text-gray-900 truncate">{medicine.name}</p>
                          <p className="text-xs text-gray-500">{medicine.category || 'Uncategorized'} · Batch {medicine.batchNo || 'N/A'} · {medicine.supplierName || 'No supplier'}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-semibold text-gray-900">{formatCurrency(medicineBoxPrice(medicine))}/box</p>
                          <p className="text-xs text-gray-500">Stock: {Number(medicine.stock || 0)} units</p>
                        </div>
                      </button>
                    ))}
                    {filteredMedicines.length === 0 && <div className="p-8 text-center text-sm text-gray-400">No matching medicine found.</div>}
                  </div>
                </>
              ) : (
                <>
                  <div className="bg-orange-50 border border-orange-100 rounded-lg p-4 flex justify-between gap-3">
                    <div>
                      <p className="font-bold text-gray-900">{manualMedicine.name}</p>
                      <p className="text-xs text-gray-600 mt-0.5">{manualMedicine.category || 'Uncategorized'} · Batch {manualMedicine.batchNo || 'N/A'} · {manualMedicine.supplierName || 'No supplier'}</p>
                    </div>
                    <button onClick={() => setManualMedicine(null)} className="text-sm font-semibold text-orange-700 hover:underline">Change</button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Return As</label>
                      <select
                        value={manualSellType}
                        onChange={e => selectManualMedicine(manualMedicine, e.target.value as 'box' | 'unit')}
                        className="w-full p-2.5 border border-gray-200 rounded-lg text-sm"
                      >
                        <option value="unit">Loose Unit</option>
                        <option value="box">Box</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Quantity</label>
                      <input type="number" min="1" step="1" value={manualQty} onChange={e => setManualQty(Math.max(1, Math.floor(Number(e.target.value) || 1)))} className="w-full p-2.5 border border-gray-200 rounded-lg text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Refund Price per {manualSellType}</label>
                      <input type="number" min="0" step="0.01" value={manualRefundPrice} onChange={e => setManualRefundPrice(e.target.value)} className="w-full p-2.5 border border-gray-200 rounded-lg text-sm" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Reason / Note</label>
                    <input value={manualReason} onChange={e => setManualReason(e.target.value)} placeholder="Optional note for receipt-less return" className="w-full p-2.5 border border-gray-200 rounded-lg text-sm" />
                  </div>
                  <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 flex justify-between">
                    <span className="text-sm font-medium text-blue-800">Refund Total</span>
                    <span className="font-bold text-blue-800">{formatCurrency(calculateReturnRefund(manualQty, Number(manualRefundPrice)))}</span>
                  </div>
                  <div className="flex justify-end gap-3">
                    <button onClick={() => setShowNoReceiptReturn(false)} className="px-4 py-2 text-gray-600 border border-gray-200 rounded-lg">Cancel</button>
                    <button onClick={handleNoReceiptSubmit} disabled={submitting} className="px-4 py-2 bg-orange-600 text-white rounded-lg font-semibold disabled:opacity-50 flex items-center gap-2">
                      <Printer className="w-4 h-4" /> {submitting ? 'Processing...' : 'Confirm Return & Print'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

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
                  disabled={!hasAnyReturn || submitting}
                  className="px-4 py-2 bg-red-600 text-white rounded-md font-medium text-sm hover:bg-red-700 disabled:opacity-50 flex items-center gap-2"
                >
                  <Printer className="w-4 h-4" />
                  {submitting ? 'Processing...' : 'Confirm Return & Print Slip'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
