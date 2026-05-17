import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, addDoc, doc, updateDoc, increment } from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../../firebase';
import { formatCurrency } from '../lib/utils';
import { Plus, Search, Truck, PackagePlus, X, ChevronDown, CheckCircle } from 'lucide-react';
import { format } from 'date-fns';

export function Purchases() {
  const [medicines, setMedicines] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [purchases, setPurchases] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  const [selectedMedicine, setSelectedMedicine] = useState<any>(null);
  const [medSearch, setMedSearch] = useState('');
  const [medDropdownOpen, setMedDropdownOpen] = useState(false);
  const [formData, setFormData] = useState({
    supplierId: '', boxesPurchased: '', looseUnitsPurchased: '0',
    costPrice: '', retailPrice: '', unitPrice: '',
    batchNo: '', expiryDate: '', notes: '',
  });

  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'medicines'), s => setMedicines(s.docs.map(d => ({ id: d.id, ...d.data() }))),
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

  const filteredMeds = medicines.filter(m =>
    m.name.toLowerCase().includes(medSearch.toLowerCase()) ||
    m.batchNo?.toLowerCase().includes(medSearch.toLowerCase())
  );

  const handleSelectMedicine = (med: any) => {
    setSelectedMedicine(med);
    setMedSearch(med.name);
    setMedDropdownOpen(false);
    setFormData(prev => ({
      ...prev,
      costPrice: (med.costPrice || 0).toString(),
      retailPrice: (med.retailPrice || med.price || 0).toString(),
      unitPrice: (med.unitPrice || med.price || 0).toString(),
      batchNo: med.batchNo || '',
      expiryDate: med.expiryDate || '',
    }));
  };

  const handleRetailChange = (retail: string) => {
    const rPrice = parseFloat(retail);
    const units = selectedMedicine?.unitsPerBox || 1;
    if (!isNaN(rPrice) && units > 0) {
      setFormData(prev => ({ ...prev, retailPrice: retail, unitPrice: (rPrice / units).toFixed(2) }));
    } else {
      setFormData(prev => ({ ...prev, retailPrice: retail }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMedicine) return;
    try {
      const unitsPerBox  = selectedMedicine.unitsPerBox || 1;
      const boxesBought  = parseInt(formData.boxesPurchased || '0');
      const looseBought  = parseInt(formData.looseUnitsPurchased || '0');
      const totalUnits   = (boxesBought * unitsPerBox) + looseBought;
      const supplier     = suppliers.find(s => s.id === formData.supplierId);
      const totalCost    = parseFloat(formData.costPrice || '0') * boxesBought;

      await addDoc(collection(db, 'purchases'), {
        medicineId: selectedMedicine.id, medicineName: selectedMedicine.name,
        supplierId: formData.supplierId || null, supplierName: supplier?.name || 'N/A',
        boxesPurchased: boxesBought, looseUnitsPurchased: looseBought,
        totalUnitsAdded: totalUnits, unitsPerBox,
        costPrice: parseFloat(formData.costPrice || '0'),
        costPricePerUnit: unitsPerBox > 1 ? parseFloat(formData.costPrice || '0') / unitsPerBox : parseFloat(formData.costPrice || '0'),
        retailPrice: parseFloat(formData.retailPrice || '0'),
        unitPrice: parseFloat(formData.unitPrice || '0'),
        batchNo: formData.batchNo, expiryDate: formData.expiryDate,
        notes: formData.notes, totalCost, date: new Date().toISOString(),
        addedBy: auth.currentUser?.uid || 'unknown',
      });
      await updateDoc(doc(db, 'medicines', selectedMedicine.id), {
        stock: increment(totalUnits),
        costPrice: parseFloat(formData.costPrice || '0'),
        retailPrice: parseFloat(formData.retailPrice || '0'),
        unitPrice: parseFloat(formData.unitPrice || '0'),
        batchNo: formData.batchNo, expiryDate: formData.expiryDate,
      });

      setIsModalOpen(false); setSelectedMedicine(null); setMedSearch('');
      setFormData({ supplierId: '', boxesPurchased: '', looseUnitsPurchased: '0', costPrice: '', retailPrice: '', unitPrice: '', batchNo: '', expiryDate: '', notes: '' });
      setSuccessMsg(`✓ Added ${totalUnits} units to "${selectedMedicine.name}"`);
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'purchases');
    }
  };

  const formatStock = (stock: number, unitsPerBox: number) => {
    if (!unitsPerBox || unitsPerBox <= 1) return `${stock} units`;
    const boxes = Math.floor(stock / unitsPerBox);
    const loose = stock % unitsPerBox;
    if (boxes > 0 && loose > 0) return `${boxes} box, ${loose} loose`;
    if (boxes > 0) return `${boxes} box`;
    return `${loose} loose`;
  };

  const closeModal = () => { setIsModalOpen(false); setSelectedMedicine(null); setMedSearch(''); };

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
        <button onClick={() => setIsModalOpen(true)}
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
                </tr>
              ))}
              {filteredPurchases.length === 0 && (
                <tr><td colSpan={7} className="p-8 text-center text-gray-500">
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
              <h2 className="text-xl font-bold text-gray-900">Record Purchase</h2>
              <button onClick={closeModal} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>

            <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto flex-1">

              {/* Medicine search */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Medicine <span className="text-red-500">*</span></label>
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input type="text" placeholder="Search medicine by name..."
                    value={medSearch}
                    onChange={e => { setMedSearch(e.target.value); setMedDropdownOpen(true); setSelectedMedicine(null); }}
                    onFocus={() => setMedDropdownOpen(true)}
                    className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500" />
                  {medDropdownOpen && medSearch && filteredMeds.length > 0 && (
                    <div className="absolute z-10 w-full bg-white border border-gray-200 rounded-lg shadow-lg mt-1 max-h-48 overflow-auto">
                      {filteredMeds.map(med => (
                        <button key={med.id} type="button" onClick={() => handleSelectMedicine(med)}
                          className="w-full text-left px-4 py-2.5 hover:bg-blue-50 border-b border-gray-100 last:border-0">
                          <p className="font-medium text-gray-900">{med.name}</p>
                          <p className="text-xs text-gray-500">{med.form} • Stock: {formatStock(med.stock, med.unitsPerBox)} • Batch: {med.batchNo}</p>
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

              {/* Quantity */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Boxes <span className="text-red-500">*</span></label>
                  <input required type="number" min="0" value={formData.boxesPurchased}
                    onChange={e => setFormData({ ...formData, boxesPurchased: e.target.value })}
                    placeholder="e.g. 10"
                    className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500" />
                  {selectedMedicine?.unitsPerBox > 1 && <p className="text-xs text-gray-400 mt-1">{selectedMedicine.unitsPerBox} units/box</p>}
                </div>
                {selectedMedicine?.unitsPerBox > 1 && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Loose Units</label>
                    <input type="number" min="0" value={formData.looseUnitsPurchased}
                      onChange={e => setFormData({ ...formData, looseUnitsPurchased: e.target.value })}
                      className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500" />
                  </div>
                )}
              </div>

              {/* Prices */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Cost Price/Box</label>
                  <input type="number" step="0.01" min="0" value={formData.costPrice}
                    onChange={e => setFormData({ ...formData, costPrice: e.target.value })}
                    className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Retail Price/Box</label>
                  <input type="number" step="0.01" min="0" value={formData.retailPrice}
                    onChange={e => handleRetailChange(e.target.value)}
                    className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500" />
                </div>
              </div>

              {selectedMedicine?.unitsPerBox > 1 && (
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
                    className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500" />
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
                <div className="bg-green-50 border border-green-100 rounded-lg p-3">
                  <p className="text-sm font-medium text-green-800">Preview:</p>
                  <p className="text-sm text-green-700 mt-1">
                    Stock ↑ by <strong>{(parseInt(formData.boxesPurchased || '0') * (selectedMedicine.unitsPerBox || 1)) + parseInt(formData.looseUnitsPurchased || '0')} units</strong>
                    {' '}→ New total: <strong>{selectedMedicine.stock + (parseInt(formData.boxesPurchased || '0') * (selectedMedicine.unitsPerBox || 1)) + parseInt(formData.looseUnitsPurchased || '0')} units</strong>
                  </p>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={closeModal}
                  className="flex-1 py-2.5 text-gray-700 border border-gray-200 rounded-lg font-medium hover:bg-gray-50">Cancel</button>
                <button type="submit" disabled={!selectedMedicine}
                  className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                  <PackagePlus className="w-4 h-4" /> Save Purchase
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
