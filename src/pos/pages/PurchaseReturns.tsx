import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, addDoc, doc, updateDoc, increment } from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../../firebase';
import { formatCurrency } from '../lib/utils';
import { Search, RotateCcw, X, CheckCircle, AlertTriangle, Printer } from 'lucide-react';
import { format } from 'date-fns';

export function PurchaseReturns() {
  const [purchases, setPurchases] = useState<any[]>([]);
  const [returns, setReturns] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [selectedPurchase, setSelectedPurchase] = useState<any>(null);
  const [returnBoxes, setReturnBoxes] = useState('');
  const [returnLoose, setReturnLoose] = useState('0');
  const [returnReason, setReturnReason] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [printReturn, setPrintReturn] = useState<any>(null);

  useEffect(() => {
    const unsubPurchases = onSnapshot(collection(db, 'purchases'), (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      list.sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setPurchases(list);
    }, (e) => handleFirestoreError(e, OperationType.GET, 'purchases'));

    const unsubReturns = onSnapshot(collection(db, 'purchaseReturns'), (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      list.sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setReturns(list);
    }, (e) => handleFirestoreError(e, OperationType.GET, 'purchaseReturns'));

    return () => { unsubPurchases(); unsubReturns(); };
  }, []);

  const filteredPurchases = purchases.filter(p =>
    p.medicineName?.toLowerCase().includes(search.toLowerCase()) ||
    p.batchNo?.toLowerCase().includes(search.toLowerCase()) ||
    p.supplierName?.toLowerCase().includes(search.toLowerCase())
  );

  // How many units have already been returned for this purchase
  const getAlreadyReturnedUnits = (purchaseId: string) => {
    return returns
      .filter(r => r.originalPurchaseId === purchaseId)
      .reduce((sum, r) => sum + (r.totalUnitsReturned || 0), 0);
  };

  const openReturn = (purchase: any) => {
    setSelectedPurchase(purchase);
    setReturnBoxes('');
    setReturnLoose('0');
    setReturnReason('');
  };

  const unitsPerBox = selectedPurchase?.unitsPerBox || 1;
  // costPricePerUnit: use saved value if available, else divide box price by unitsPerBox
  const costPricePerUnit = selectedPurchase?.costPricePerUnit
    ?? (selectedPurchase ? (selectedPurchase.costPrice || 0) / unitsPerBox : 0);
  const boxes = parseInt(returnBoxes || '0');
  const loose = parseInt(returnLoose || '0');
  const totalUnitsToReturn = boxes * unitsPerBox + loose;
  const alreadyReturned = selectedPurchase ? getAlreadyReturnedUnits(selectedPurchase.id) : 0;
  const maxReturnable = selectedPurchase ? selectedPurchase.totalUnitsAdded - alreadyReturned : 0;
  const isValid = totalUnitsToReturn > 0 && totalUnitsToReturn <= maxReturnable;
  const refundAmount = (boxes * unitsPerBox + loose) * costPricePerUnit;

  const handleSubmit = async () => {
    if (!isValid || !selectedPurchase) return;
    try {
      const returnDoc = {
        originalPurchaseId: selectedPurchase.id,
        medicineId: selectedPurchase.medicineId,
        medicineName: selectedPurchase.medicineName,
        supplierId: selectedPurchase.supplierId || null,
        supplierName: selectedPurchase.supplierName || 'N/A',
        boxesReturned: boxes,
        looseUnitsReturned: loose,
        totalUnitsReturned: totalUnitsToReturn,
        costPrice: selectedPurchase.costPrice || 0,
        costPricePerUnit,
        refundAmount,
        reason: returnReason,
        date: new Date().toISOString(),
        processedBy: auth.currentUser?.uid,
      };

      await addDoc(collection(db, 'purchaseReturns'), returnDoc);

      // Deduct stock
      await updateDoc(doc(db, 'medicines', selectedPurchase.medicineId), {
        stock: increment(-totalUnitsToReturn),
      });

      setPrintReturn(returnDoc);
      setSelectedPurchase(null);
      setSuccessMsg(`Return to supplier processed — ${totalUnitsToReturn} units deducted`);
      setTimeout(() => setSuccessMsg(''), 5000);
      setTimeout(() => window.print(), 600);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'purchaseReturns');
    }
  };

  const formatUnits = (units: number, upb: number) => {
    if (!upb || upb <= 1) return `${units} units`;
    const b = Math.floor(units / upb);
    const l = units % upb;
    if (b > 0 && l > 0) return `${b} box, ${l} loose`;
    if (b > 0) return `${b} box`;
    return `${l} loose`;
  };

  return (
    <>
      {/* Printable return slip */}
      {printReturn && (
        <div className="hidden print:block w-[80mm] mx-auto bg-white text-black text-sm font-mono p-4">
          <div className="text-center mb-4">
            <h2 className="text-xl font-bold">Al-Fateh Pharmacy</h2>
            <p className="font-bold">PURCHASE RETURN</p>
            <p>{format(new Date(printReturn.date), 'dd/MM/yyyy HH:mm')}</p>
          </div>
          <p>Medicine: {printReturn.medicineName}</p>
          <p>Supplier: {printReturn.supplierName}</p>
          <p>Boxes: {printReturn.boxesReturned}</p>
          {printReturn.looseUnitsReturned > 0 && <p>Loose: {printReturn.looseUnitsReturned}</p>}
          <p>Total Units: {printReturn.totalUnitsReturned}</p>
          {printReturn.reason && <p>Reason: {printReturn.reason}</p>}
          <div className="border-t border-black border-dashed mt-3 pt-2">
            <div className="flex justify-between font-bold">
              <span>Refund Value:</span>
              <span>{formatCurrency(printReturn.refundAmount)}</span>
            </div>
          </div>
          <p className="text-center text-xs mt-6">Supplier acknowledgment required</p>
        </div>
      )}

      <div className="space-y-6 print:hidden">
        {successMsg && (
          <div className="fixed top-4 right-4 bg-green-600 text-white px-5 py-3 rounded-lg shadow-lg z-50 flex items-center gap-2">
            <CheckCircle className="w-5 h-5" /> {successMsg}
          </div>
        )}

        <h1 className="text-2xl font-bold text-gray-900">Purchase Returns</h1>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Left – find purchase */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden flex flex-col">
            <div className="p-4 border-b border-gray-100">
              <p className="text-sm font-medium text-gray-600 mb-2">Search a purchase to return to supplier</p>
              <div className="relative">
                <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search by medicine, batch, or supplier..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div className="flex-1 overflow-auto divide-y divide-gray-100">
              {filteredPurchases.map(p => {
                const alreadyRet = getAlreadyReturnedUnits(p.id);
                const remaining = p.totalUnitsAdded - alreadyRet;
                return (
                  <div key={p.id} className="p-4 hover:bg-gray-50 flex justify-between items-center gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-900 text-sm truncate">{p.medicineName}</p>
                      <p className="text-xs text-gray-500">{p.supplierName} • {p.batchNo}</p>
                      <p className="text-xs text-gray-500">
                        {p.date ? format(new Date(p.date), 'MMM dd, yyyy') : ''} • +{formatUnits(p.totalUnitsAdded, p.unitsPerBox || 1)}
                      </p>
                      {alreadyRet > 0 && (
                        <span className="inline-block mt-1 text-[10px] bg-orange-100 text-orange-700 font-semibold px-1.5 py-0.5 rounded">
                          {formatUnits(alreadyRet, p.unitsPerBox || 1)} already returned
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => openReturn(p)}
                      disabled={remaining <= 0}
                      className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-orange-50 text-orange-700 rounded-lg text-xs font-semibold hover:bg-orange-100 border border-orange-200 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <RotateCcw className="w-3.5 h-3.5" /> Return
                    </button>
                  </div>
                );
              })}
              {filteredPurchases.length === 0 && (
                <div className="p-8 text-center text-gray-400 text-sm">No purchases found.</div>
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
                      <p className="text-sm font-semibold text-gray-900">{r.medicineName}</p>
                      <p className="text-xs text-gray-500">{r.supplierName}</p>
                      <p className="text-xs text-gray-400">{r.date ? format(new Date(r.date), 'MMM dd, yyyy HH:mm') : ''}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {r.boxesReturned > 0 ? `${r.boxesReturned} box` : ''}
                        {r.looseUnitsReturned > 0 ? ` ${r.looseUnitsReturned} loose` : ''}
                        {' '}({r.totalUnitsReturned} units)
                      </p>
                      {r.reason && <p className="text-xs italic text-gray-400">"{r.reason}"</p>}
                    </div>
                    <span className="text-orange-600 font-bold text-sm">{formatCurrency(r.refundAmount)}</span>
                  </div>
                </div>
              ))}
              {returns.length === 0 && (
                <div className="p-8 text-center text-gray-400 text-sm">No purchase returns yet.</div>
              )}
            </div>
          </div>
        </div>

        {/* Process Return Modal */}
        {selectedPurchase && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 overflow-y-auto">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md my-8">
              <div className="p-6 border-b border-gray-100 flex justify-between items-center">
                <div>
                  <h2 className="text-xl font-bold text-gray-900">Return to Supplier</h2>
                  <p className="text-sm text-gray-500 mt-0.5">{selectedPurchase.medicineName} • {selectedPurchase.supplierName}</p>
                </div>
                <button onClick={() => setSelectedPurchase(null)} className="p-1 text-gray-400 hover:text-gray-600">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 space-y-4">
                {/* Purchase summary */}
                <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
                  <div className="flex justify-between text-gray-600">
                    <span>Originally purchased:</span>
                    <span className="font-medium">{formatUnits(selectedPurchase.totalUnitsAdded, unitsPerBox)}</span>
                  </div>
                  <div className="flex justify-between text-gray-600">
                    <span>Already returned:</span>
                    <span className="font-medium text-orange-600">{formatUnits(alreadyReturned, unitsPerBox)}</span>
                  </div>
                  <div className="flex justify-between font-semibold text-gray-900 pt-1 border-t border-gray-200">
                    <span>Available to return:</span>
                    <span>{formatUnits(maxReturnable, unitsPerBox)}</span>
                  </div>
                  <div className="flex justify-between text-gray-500 text-xs pt-1">
                    <span>Refund rate:</span>
                    <span>{formatCurrency(costPricePerUnit)} per unit {unitsPerBox > 1 ? `(box price ${formatCurrency(selectedPurchase.costPrice)} ÷ ${unitsPerBox})` : ''}</span>
                  </div>
                </div>

                {/* Qty inputs */}
                {unitsPerBox > 1 ? (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Boxes to Return</label>
                      <input
                        type="number"
                        min="0"
                        value={returnBoxes}
                        placeholder="0"
                        onChange={e => setReturnBoxes(e.target.value)}
                        className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                      />
                      <p className="text-xs text-gray-400 mt-1">{unitsPerBox} units/box</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Loose Units to Return</label>
                      <input
                        type="number"
                        min="0"
                        value={returnLoose}
                        placeholder="0"
                        onChange={e => setReturnLoose(e.target.value)}
                        className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                      />
                      <p className="text-xs text-gray-400 mt-1">individual units</p>
                    </div>
                  </div>
                ) : (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Units to Return</label>
                    <input
                      type="number"
                      min="0"
                      value={returnLoose}
                      placeholder="0"
                      onChange={e => setReturnLoose(e.target.value)}
                      className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                )}

                {/* Validation */}
                {totalUnitsToReturn > maxReturnable && totalUnitsToReturn > 0 && (
                  <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 p-2 rounded-lg">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    Cannot return more than {formatUnits(maxReturnable, unitsPerBox)}.
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Reason (optional)</label>
                  <input
                    type="text"
                    value={returnReason}
                    onChange={e => setReturnReason(e.target.value)}
                    placeholder="e.g. Expired, damaged, over-ordered..."
                    className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-sm"
                  />
                </div>

                {isValid && (
                  <div className="bg-orange-50 border border-orange-100 rounded-lg p-3 space-y-1">
                    <div className="flex justify-between text-sm text-orange-800">
                      <span>Units returning:</span>
                      <span className="font-semibold">{totalUnitsToReturn} units</span>
                    </div>
                    <div className="flex justify-between text-sm font-bold text-orange-900">
                      <span>Estimated Refund Value:</span>
                      <span>{formatCurrency(refundAmount)}</span>
                    </div>
                  </div>
                )}

                <div className="flex justify-end gap-3 pt-2">
                  <button onClick={() => setSelectedPurchase(null)} className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-md font-medium text-sm">
                    Cancel
                  </button>
                  <button
                    onClick={handleSubmit}
                    disabled={!isValid}
                    className="px-4 py-2 bg-orange-600 text-white rounded-md font-medium text-sm hover:bg-orange-700 disabled:opacity-50 flex items-center gap-2"
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
