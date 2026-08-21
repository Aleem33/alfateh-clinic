import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, doc, increment, writeBatch } from '@/lib/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../../firebase';
import { formatCurrency } from '../lib/utils';
import { Search, Truck, PackagePlus, X, ChevronDown, CheckCircle, Edit2, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';
import { searchMedicines } from '../../lib/medicineIndex';
import { subscribeToMedicines } from '../../lib/medicineStore';
import { ensureMedicinePurchaseBatch, findMedicinePurchaseBatch } from '../../lib/medicineOperations';

const today = () => new Date().toISOString().split('T')[0];

export function Purchases({ canEdit = false }: { canEdit?: boolean }) {
  const [medicines, setMedicines] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [purchases, setPurchases] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [formError, setFormError] = useState('');
  const [editingPurchase, setEditingPurchase] = useState<any | null>(null);
  const [purchaseBatchMode, setPurchaseBatchMode] = useState<'existing' | 'new'>('existing');

  const [selectedMedicine, setSelectedMedicine] = useState<any>(null);
  const [medSearch, setMedSearch] = useState('');
  const [medDropdownOpen, setMedDropdownOpen] = useState(false);
  const [formData, setFormData] = useState({
    supplierId: '', boxesPurchased: '', looseUnitsPurchased: '0',
    unitsPerBox: '1', costPrice: '', retailPrice: '', unitPrice: '',
    batchNo: '', expiryDate: '', date: today(), notes: '',
  });

  useEffect(() => {
    const u1 = subscribeToMedicines(setMedicines,
      e => handleFirestoreError(e, OperationType.GET, 'medicines'));
    const u2 = onSnapshot(collection(db, 'suppliers'), s => setSuppliers(s.docs.map(d => ({ id: d.id, ...d.data() }))),
      e => handleFirestoreError(e, OperationType.GET, 'suppliers'));
    const u3 = onSnapshot(collection(db, 'purchases'), s => {
      const list = s.docs.map(d => ({ id: d.id, ...d.data() }));
      list.sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setPurchases(list);
    }, e => handleFirestoreError(e, OperationType.GET, 'purchases'));
    return () => { u1(); u2(); u3(); };
  }, []);

  const filteredPurchases = purchases.filter(p =>
    p.medicineName?.toLowerCase().includes(search.toLowerCase()) ||
    p.batchNo?.toLowerCase().includes(search.toLowerCase()) ||
    p.supplierName?.toLowerCase().includes(search.toLowerCase())
  );

  const filteredMeds = searchMedicines(medicines, medSearch);

  const handleSelectMedicine = (med: any) => {
    setSelectedMedicine(med);
    setMedSearch(med.name);
    setMedDropdownOpen(false);
    setPurchaseBatchMode('existing');
    setFormData(prev => ({
      ...prev,
      unitsPerBox: String(med.unitsPerBox || 1),
      costPrice: (med.costPrice || 0).toString(),
      retailPrice: (med.retailPrice || med.price || 0).toString(),
      unitPrice: (med.unitPrice || (med.unitsPerBox > 0 ? (Number(med.retailPrice || med.price || 0) / med.unitsPerBox) : med.price) || 0).toString(),
      batchNo: med.batchNo || '',
      expiryDate: med.expiryDate || '',
      supplierId: med.supplierId || '',
    }));
  };

  const updateRetailAndUnits = (retail: string, unitsPerBoxValue: string) => {
    const rPrice = parseFloat(retail);
    const units = parseInt(unitsPerBoxValue || '1');
    if (!isNaN(rPrice) && units > 0) {
      setFormData(prev => ({ ...prev, retailPrice: retail, unitsPerBox: unitsPerBoxValue, unitPrice: (rPrice / units).toFixed(2) }));
    } else {
      setFormData(prev => ({ ...prev, retailPrice: retail, unitsPerBox: unitsPerBoxValue }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMedicine) return;
    setFormError('');
    try {
      const unitsPerBox  = Math.max(1, parseInt(formData.unitsPerBox || '1') || 1);
      const boxesBought  = parseInt(formData.boxesPurchased || '0');
      const looseBought  = parseInt(formData.looseUnitsPurchased || '0');
      const totalUnits   = (boxesBought * unitsPerBox) + looseBought;
      if (totalUnits <= 0) return;
      const supplier     = suppliers.find(s => s.id === formData.supplierId);
      const supplierName = formData.supplierId ? (supplier?.name || selectedMedicine.supplierName || 'N/A') : 'N/A';
      const medicineSupplierName = formData.supplierId ? (supplier?.name || selectedMedicine.supplierName || '') : '';
      const costPrice    = parseFloat(formData.costPrice || '0');
      const costPricePerUnit = costPrice / unitsPerBox;
      const totalCost    = totalUnits * costPricePerUnit;
      const retailPriceValue = formData.retailPrice.trim() ? parseFloat(formData.retailPrice) : null;
      const unitPriceValue = formData.unitPrice.trim() ? parseFloat(formData.unitPrice) : null;
      const purchaseDoc: any = {
        medicineId: selectedMedicine.id, medicineName: selectedMedicine.name,
        supplierId: formData.supplierId || null, supplierName,
        boxesPurchased: boxesBought, looseUnitsPurchased: looseBought,
        totalUnitsAdded: totalUnits, unitsPerBox,
        costPrice,
        costPricePerUnit,
        batchNo: formData.batchNo, expiryDate: formData.expiryDate,
        notes: formData.notes, totalCost, date: formData.date || today(),
        addedBy: auth.currentUser?.uid || 'unknown',
        updatedAt: new Date().toISOString(),
      };
      if (retailPriceValue !== null && Number.isFinite(retailPriceValue)) purchaseDoc.retailPrice = retailPriceValue;
      if (unitPriceValue !== null && Number.isFinite(unitPriceValue)) purchaseDoc.unitPrice = unitPriceValue;

      if (editingPurchase) {
        if (!canEdit) return;
        const oldUnits = Number(editingPurchase.totalUnitsAdded || editingPurchase.unitsAdded || 0);
        const stockDelta = totalUnits - oldUnits;
        if (selectedMedicine && Number(selectedMedicine.stock || 0) + stockDelta < 0) {
          setFormError('This change would make the batch stock negative. Reduce the adjustment or correct current stock first.');
          return;
        }
        const batch = writeBatch(db);
        batch.update(doc(db, 'purchases', editingPurchase.id), {
          ...purchaseDoc,
          medicineId: editingPurchase.medicineId || selectedMedicine.id,
          updatedBy: auth.currentUser?.uid || 'unknown',
        });
        if (selectedMedicine) {
          batch.update(doc(db, 'medicines', selectedMedicine.id), {
            stock: increment(stockDelta),
            updatedAt: new Date().toISOString(),
          });
        }
        await batch.commit();
        setSuccessMsg(`✓ Updated purchase for "${selectedMedicine.name}"`);
      } else {
        const batchNo = purchaseBatchMode === 'new'
          ? formData.batchNo.trim()
          : (formData.batchNo.trim() || selectedMedicine.batchNo || '');
        if (purchaseBatchMode === 'new' && !batchNo) {
          setFormError('Enter a batch number for the new batch. Existing batches will not be changed.');
          return;
        }
        if (purchaseBatchMode === 'new' && findMedicinePurchaseBatch(selectedMedicine, {
          batchNo,
          supplierId: formData.supplierId || '',
          supplierName: medicineSupplierName,
        }, medicines)) {
          setFormError(`Batch ${batchNo} already exists for this medicine and supplier. Select Existing Batch or enter a different batch number.`);
          return;
        }
        if (purchaseBatchMode === 'existing') {
          const existingUnits = Math.max(1, Number(selectedMedicine.unitsPerBox || 1));
          const existingCost = Number(selectedMedicine.costPrice || 0);
          const existingRetail = Number(selectedMedicine.retailPrice || selectedMedicine.price || 0);
          const proposedRetail = retailPriceValue ?? existingRetail;
          if (unitsPerBox !== existingUnits || Math.abs(costPrice - existingCost) > 0.001 || Math.abs(proposedRetail - existingRetail) > 0.001) {
            setFormError('Pack size and prices are locked for an existing batch. Choose New Batch to use different packaging or prices.');
            return;
          }
        }
        const batchTarget = await ensureMedicinePurchaseBatch(selectedMedicine, {
          batchNo,
          expiryDate: formData.expiryDate || selectedMedicine.expiryDate || '',
          stock: totalUnits,
          unitsPerBox,
          costPrice,
          retailPrice: retailPriceValue ?? Number(selectedMedicine.retailPrice || selectedMedicine.price || 0),
          unitPrice: unitPriceValue ?? Number(selectedMedicine.unitPrice || 0),
          supplierId: formData.supplierId || '',
          supplierName: medicineSupplierName,
        }, medicines);
        purchaseDoc.medicineId = batchTarget.medicineId;
        purchaseDoc.batchNo = batchNo;
        purchaseDoc.createdAt = new Date().toISOString();
        const batch = writeBatch(db);
        batch.set(doc(collection(db, 'purchases')), purchaseDoc);
        if (!batchTarget.created) {
          batch.update(doc(db, 'medicines', batchTarget.medicineId), {
            stock: increment(totalUnits),
            updatedAt: new Date().toISOString(),
          });
        }
        await batch.commit();
        setSuccessMsg(`✓ Recorded ${selectedMedicine.name}, batch ${batchNo || 'N/A'} (${totalUnits} units)`);
      }

      setIsModalOpen(false); setSelectedMedicine(null); setEditingPurchase(null); setMedSearch('');
      setPurchaseBatchMode('existing');
      setFormData({ supplierId: '', boxesPurchased: '', looseUnitsPurchased: '0', unitsPerBox: '1', costPrice: '', retailPrice: '', unitPrice: '', batchNo: '', expiryDate: '', date: today(), notes: '' });
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (error) {
      setFormError(handleFirestoreError(error, editingPurchase ? OperationType.UPDATE : OperationType.CREATE, 'purchases'));
    }
  };

  const openEditPurchase = (purchase: any) => {
    if (!canEdit) return;
    const medicine = medicines.find(item => item.id === purchase.medicineId);
    if (!medicine) {
      setFormError('The medicine batch linked to this purchase is not available.');
      return;
    }
    const unitsPerBox = Math.max(1, Number(purchase.unitsPerBox || medicine.unitsPerBox || 1));
    setEditingPurchase(purchase);
    setPurchaseBatchMode('existing');
    setSelectedMedicine(medicine);
    setMedSearch(medicine.name);
    setFormData({
      supplierId: purchase.supplierId || medicine.supplierId || '',
      boxesPurchased: String(purchase.boxesPurchased ?? purchase.boxes ?? 0),
      looseUnitsPurchased: String(purchase.looseUnitsPurchased ?? purchase.looseUnits ?? 0),
      unitsPerBox: String(unitsPerBox),
      costPrice: String(purchase.costPrice ?? purchase.costPerBox ?? medicine.costPrice ?? ''),
      retailPrice: String(purchase.retailPrice ?? medicine.retailPrice ?? medicine.price ?? ''),
      unitPrice: String(purchase.unitPrice ?? medicine.unitPrice ?? ''),
      batchNo: purchase.batchNo || medicine.batchNo || '',
      expiryDate: purchase.expiryDate || medicine.expiryDate || '',
      date: purchase.date || today(),
      notes: purchase.notes || '',
    });
    setFormError('');
    setIsModalOpen(true);
  };

  const formatStock = (stock: number, unitsPerBox: number) => {
    if (!unitsPerBox || unitsPerBox <= 1) return `${stock} units`;
    const boxes = Math.floor(stock / unitsPerBox);
    const loose = stock % unitsPerBox;
    if (boxes > 0 && loose > 0) return `${boxes} box, ${loose} loose`;
    if (boxes > 0) return `${boxes} box`;
    return `${loose} loose`;
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setSelectedMedicine(null);
    setEditingPurchase(null);
    setPurchaseBatchMode('existing');
    setMedSearch('');
    setFormError('');
  };

  return (
    <div className="space-y-4 md:space-y-6">
      {successMsg && (
        <div className="fixed top-4 right-4 bg-green-600 text-white px-5 py-3 rounded-lg shadow-lg z-50 flex items-center gap-2">
          <CheckCircle className="w-5 h-5 shrink-0" /> {successMsg}
        </div>
      )}

      {/* Header */}
      <div className="flex justify-between items-center gap-3">
        <h1 className="text-xl md:text-2xl font-bold text-gray-900">Purchases</h1>
        <button onClick={() => { setEditingPurchase(null); setPurchaseBatchMode('existing'); setFormError(''); setIsModalOpen(true); }}
          className="bg-blue-600 text-white px-3 py-2 md:px-4 rounded-lg flex items-center gap-2 hover:bg-blue-700 text-sm font-medium shrink-0">
          <PackagePlus className="w-4 h-4" />
          <span className="hidden sm:inline">Record Purchase</span>
          <span className="sm:hidden">Record</span>
        </button>
      </div>

      {/* List */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-4 border-b border-gray-100">
          <div className="relative">
            <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="text" placeholder="Search by medicine, batch, or supplier..."
              value={search} onChange={e => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>

        {/* ── Mobile: cards ── */}
        <div className="md:hidden divide-y divide-gray-100">
          {filteredPurchases.map(p => (
            <div key={p.id} className="p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-gray-900">{p.medicineName}</p>
                  <p className="text-xs text-gray-400">{p.date ? format(new Date(p.date), 'MMM dd, yyyy') : 'N/A'}</p>
                </div>
                <span className="text-sm font-bold text-gray-900 shrink-0">{formatCurrency(p.totalCost)}</span>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="flex items-center gap-1 text-gray-500">
                  <Truck className="w-3 h-3" /> {p.supplierName || 'N/A'}
                </span>
                {p.batchNo && <span className="font-mono text-gray-500">#{p.batchNo}</span>}
                <span className="bg-green-100 text-green-800 font-semibold px-2 py-0.5 rounded-full">
                  +{p.totalUnitsAdded} units
                </span>
                <span className="text-gray-500">Cost/box: {formatCurrency(p.costPrice)}</span>
                {p.expiryDate && <span className="text-gray-400">Exp: {format(new Date(p.expiryDate), 'MMM yyyy')}</span>}
              </div>
              {canEdit && (
                <button type="button" onClick={() => openEditPurchase(p)} className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-800">
                  <Edit2 className="w-3.5 h-3.5" /> Edit Purchase
                </button>
              )}
            </div>
          ))}
          {filteredPurchases.length === 0 && (
            <div className="p-8 text-center text-gray-500">
              <PackagePlus className="w-10 h-10 text-gray-300 mx-auto mb-2" />
              No purchase records yet.
            </div>
          )}
        </div>

        {/* ── Desktop: table ── */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-sm border-b border-gray-100">
                <th className="p-4 font-medium">Date</th>
                <th className="p-4 font-medium">Medicine</th>
                <th className="p-4 font-medium">Supplier</th>
                <th className="p-4 font-medium">Batch No</th>
                <th className="p-4 font-medium">Qty Added</th>
                <th className="p-4 font-medium">Cost/Box</th>
                <th className="p-4 font-medium">Total Cost</th>
                {canEdit && <th className="p-4 font-medium text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredPurchases.map(p => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="p-4 text-gray-600 text-sm">{p.date ? format(new Date(p.date), 'MMM dd, yyyy') : 'N/A'}</td>
                  <td className="p-4">
                    <p className="font-medium text-gray-900">{p.medicineName}</p>
                    {p.expiryDate && <p className="text-xs text-gray-400">Exp: {format(new Date(p.expiryDate), 'MMM yyyy')}</p>}
                  </td>
                  <td className="p-4 text-gray-600"><div className="flex items-center gap-1"><Truck className="w-3.5 h-3.5 text-gray-400" />{p.supplierName || 'N/A'}</div></td>
                  <td className="p-4 text-gray-600 font-mono text-sm">{p.batchNo || '-'}</td>
                  <td className="p-4">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">+{p.totalUnitsAdded} units</span>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {p.boxesPurchased > 0 ? `${p.boxesPurchased} box` : ''}
                      {p.looseUnitsPurchased > 0 ? ` ${p.looseUnitsPurchased} loose` : ''}
                    </p>
                  </td>
                  <td className="p-4 text-gray-600">{formatCurrency(p.costPrice)}</td>
                  <td className="p-4 font-medium text-gray-900">{formatCurrency(p.totalCost)}</td>
                  {canEdit && (
                    <td className="p-4 text-right">
                      <button type="button" onClick={() => openEditPurchase(p)} title="Edit purchase" className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg">
                        <Edit2 className="w-4 h-4" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {filteredPurchases.length === 0 && (
                <tr><td colSpan={canEdit ? 8 : 7} className="p-8 text-center text-gray-500">
                  <PackagePlus className="w-10 h-10 text-gray-300 mx-auto mb-2" />No purchase records yet.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Record Purchase Modal (slides up on mobile) ── */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4 z-50">
          <div className="bg-white rounded-t-2xl sm:rounded-xl shadow-xl w-full sm:max-w-lg overflow-hidden flex flex-col max-h-[95vh] sm:max-h-[90vh]">
            <div className="p-5 border-b border-gray-100 flex justify-between items-center shrink-0">
              <h2 className="text-xl font-bold text-gray-900">{editingPurchase ? 'Edit Purchase' : 'Record Purchase'}</h2>
              <button onClick={closeModal} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>

            <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto flex-1">

              {formError && (
                <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2.5 text-sm">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {formError}
                </div>
              )}

              {/* Medicine search */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Medicine <span className="text-red-500">*</span></label>
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input type="text" placeholder="Search medicine by name..."
                    value={medSearch}
                    disabled={Boolean(editingPurchase)}
                    onChange={e => { setMedSearch(e.target.value); setMedDropdownOpen(true); setSelectedMedicine(null); }}
                    onFocus={() => setMedDropdownOpen(true)}
                    className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:text-gray-500" />
                  {!editingPurchase && medDropdownOpen && medSearch && filteredMeds.length > 0 && (
                    <div className="absolute z-10 w-full bg-white border border-gray-200 rounded-lg shadow-lg mt-1 max-h-48 overflow-auto">
                      <div className="px-4 py-1.5 text-xs text-gray-500 bg-gray-50 border-b">{filteredMeds.length} matching medicine records</div>
                      {filteredMeds.map(med => (
                        <button key={med.id} type="button" onClick={() => handleSelectMedicine(med)}
                          className="w-full text-left px-4 py-2.5 hover:bg-blue-50 border-b border-gray-100 last:border-0">
                          <p className="font-medium text-gray-900">{med.name}</p>
                          <p className="text-xs text-gray-500">{med.form} • {med.supplierName || 'No supplier'} • Stock: {formatStock(med.stock, med.unitsPerBox)} • Batch: {med.batchNo || 'N/A'}</p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {selectedMedicine && (
                  <div className="mt-2 p-2 bg-blue-50 rounded-lg border border-blue-100 flex justify-between items-center">
                    <div>
                      <span className="text-sm font-medium text-blue-800">{selectedMedicine.name}</span>
                      <span className="text-xs text-blue-600 ml-2">Stock: {formatStock(selectedMedicine.stock, selectedMedicine.unitsPerBox)}</span>
                    </div>
                    <CheckCircle className="w-4 h-4 text-blue-500" />
                  </div>
                )}
              </div>

              {selectedMedicine && !editingPurchase && (
                <div className="rounded-xl border border-gray-200 p-1 bg-gray-50 grid grid-cols-2 gap-1">
                  <button type="button" onClick={() => handleSelectMedicine(selectedMedicine)} className={`rounded-lg px-3 py-2 text-sm font-medium ${purchaseBatchMode === 'existing' ? 'bg-white text-blue-700 shadow-sm border border-blue-200' : 'text-gray-500'}`}>
                    Existing Batch
                  </button>
                  <button type="button" onClick={() => {
                    setPurchaseBatchMode('new');
                    setFormData(previous => ({ ...previous, batchNo: '', expiryDate: '', costPrice: '', retailPrice: '', unitPrice: '' }));
                  }} className={`rounded-lg px-3 py-2 text-sm font-medium ${purchaseBatchMode === 'new' ? 'bg-white text-emerald-700 shadow-sm border border-emerald-200' : 'text-gray-500'}`}>
                    New Batch
                  </button>
                </div>
              )}

              {/* Supplier */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Supplier</label>
                <div className="relative">
                  <select value={formData.supplierId} onChange={e => setFormData({ ...formData, supplierId: e.target.value })}
                    className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 appearance-none">
                    <option value="">— Select Supplier (optional) —</option>
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  <ChevronDown className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                </div>
              </div>

              {/* Purchase Date */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Purchase Date</label>
                <input type="date" value={formData.date}
                  onChange={e => setFormData({ ...formData, date: e.target.value })}
                  className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500" />
              </div>

              {/* Quantity */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Boxes <span className="text-red-500">*</span></label>
                  <input type="number" min="0" value={formData.boxesPurchased}
                    onChange={e => setFormData({ ...formData, boxesPurchased: e.target.value })}
                    placeholder="e.g. 10"
                    className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500" />
                  {parseInt(formData.unitsPerBox || '1') > 1 && <p className="text-xs text-gray-400 mt-1">{formData.unitsPerBox} units/box</p>}
                </div>
                {parseInt(formData.unitsPerBox || '1') > 1 && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Loose Units</label>
                    <input type="number" min="0" value={formData.looseUnitsPurchased}
                      onChange={e => setFormData({ ...formData, looseUnitsPurchased: e.target.value })}
                      className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500" />
                  </div>
                )}
              </div>

              {/* Prices */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Units/Box</label>
                  <input type="number" min="1" value={formData.unitsPerBox}
                    onChange={e => updateRetailAndUnits(formData.retailPrice, e.target.value)}
                    className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Cost Price/Box</label>
                  <input type="number" step="0.01" min="0" value={formData.costPrice}
                    onChange={e => setFormData({ ...formData, costPrice: e.target.value })}
                    className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Retail Price/Box</label>
                  <input type="number" step="0.01" min="0" value={formData.retailPrice}
                    onChange={e => updateRetailAndUnits(e.target.value, formData.unitsPerBox)}
                    className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500" />
                </div>
              </div>

              {parseInt(formData.unitsPerBox || '1') > 1 && (
                <div className="bg-blue-50 p-3 rounded-lg border border-blue-100 flex justify-between items-center">
                  <span className="text-sm text-blue-800 font-medium">Unit Price (auto)</span>
                  <div className="flex items-center gap-1">
                    <span className="text-gray-500 text-sm">Rs.</span>
                    <input type="number" step="0.01" value={formData.unitPrice}
                      onChange={e => setFormData({ ...formData, unitPrice: e.target.value })}
                      className="w-24 p-1.5 text-right border border-blue-200 rounded focus:outline-none focus:border-blue-500 bg-white" />
                  </div>
                </div>
              )}

              {/* Batch & Expiry */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Batch No</label>
                  <input type="text" value={formData.batchNo}
                    onChange={e => setFormData({ ...formData, batchNo: e.target.value })}
                    disabled={Boolean(editingPurchase) || purchaseBatchMode === 'existing'}
                    className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:text-gray-500" />
                  {(editingPurchase || purchaseBatchMode === 'existing') && <p className="text-xs text-gray-400 mt-1">The selected batch is fixed; choose New Batch to create another batch.</p>}
                  {!editingPurchase && purchaseBatchMode === 'new' && <p className="text-xs text-emerald-600 mt-1">Required. A separate medicine record and separate prices will be created.</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Expiry Date</label>
                  <input type="date" value={formData.expiryDate}
                    onChange={e => setFormData({ ...formData, expiryDate: e.target.value })}
                    className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500" />
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
                <textarea value={formData.notes} onChange={e => setFormData({ ...formData, notes: e.target.value })}
                  rows={2} placeholder="e.g. Invoice #1234..."
                  className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500" />
              </div>

              {/* Preview */}
              {selectedMedicine && formData.boxesPurchased && (
                <div className={`${purchaseBatchMode === 'new' ? 'bg-emerald-50 border-emerald-200' : 'bg-blue-50 border-blue-200'} border rounded-lg p-3`}>
                  <p className="text-sm font-medium text-green-800">Preview:</p>
                  <p className="text-sm text-green-700 mt-1">
                    {editingPurchase ? 'Corrected purchase quantity' : purchaseBatchMode === 'new' ? 'Separate new batch stock' : 'Stock added to selected batch'}: <strong>{(parseInt(formData.boxesPurchased || '0') * (parseInt(formData.unitsPerBox || '1') || 1)) + parseInt(formData.looseUnitsPurchased || '0')} units</strong>
                  </p>
                  {!editingPurchase && <p className="text-xs mt-1 text-gray-600">{purchaseBatchMode === 'new' ? 'Existing batch prices will remain unchanged.' : 'Only the selected batch price can be updated.'}</p>}
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={closeModal}
                  className="flex-1 py-2.5 text-gray-700 border border-gray-200 rounded-lg font-medium hover:bg-gray-50">Cancel</button>
                <button type="submit" disabled={!selectedMedicine}
                  className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                  {editingPurchase ? <Edit2 className="w-4 h-4" /> : <PackagePlus className="w-4 h-4" />}
                  {editingPurchase ? 'Save Changes' : 'Save Purchase'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
