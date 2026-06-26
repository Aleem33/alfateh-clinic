import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore';
import { downloadOrShare } from '../lib/nativeUtils';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { formatCurrency } from '../lib/utils';
import { Plus, Edit2, Trash2, Search, AlertCircle, Upload, Download, X } from 'lucide-react';
import { format, isBefore, addDays } from 'date-fns';
import Papa from 'papaparse';

const CATEGORIES = ['Tablet','Capsule','Syrup','Injection','Drops','Cream/Ointment','Powder','Inhaler','IV Fluid','Other'];

const emptyMedicineForm = {
  name: '', form: 'Tablet', unitsPerBox: '1',
  costPrice: '', retailPrice: '', unitPrice: '',
  stockBoxes: '0', stockLoose: '0',
  expiryDate: '', batchNo: '',
  supplierId: '', supplierName: '',
};

const emptySupplierForm = { name: '', contact: '', address: '' };

const toNumber = (value: string, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export function Medicines() {
  const [medicines, setMedicines]       = useState<any[]>([]);
  const [suppliers, setSuppliers]       = useState<any[]>([]);
  const [search, setSearch]             = useState('');
  const [isModalOpen, setIsModalOpen]   = useState(false);
  const [isCsvModalOpen, setIsCsvModalOpen] = useState(false);
  const [csvError, setCsvError]         = useState<string | null>(null);
  const [isUploading, setIsUploading]   = useState(false);
  const [editingId, setEditingId]       = useState<string | null>(null);
  const [successMsg, setSuccessMsg]     = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showInlineSupplier, setShowInlineSupplier] = useState(false);
  const [supplierForm, setSupplierForm] = useState(emptySupplierForm);

  const [formData, setFormData] = useState(emptyMedicineForm);

  useEffect(() => {
    const unsubMedicines = onSnapshot(collection(db, 'medicines'), snap => {
      setMedicines(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, err => handleFirestoreError(err, OperationType.GET, 'medicines'));
    const unsubSuppliers = onSnapshot(collection(db, 'suppliers'), snap => {
      setSuppliers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, err => handleFirestoreError(err, OperationType.GET, 'suppliers'));
    return () => { unsubMedicines(); unsubSuppliers(); };
  }, []);

  const filteredMedicines = medicines.filter(m =>
    m.name.toLowerCase().includes(search.toLowerCase()) ||
    (m.batchNo || '').toLowerCase().includes(search.toLowerCase())
  );

  const handleRetailPriceChange = (retail: string, units: string) => {
    const rPrice = parseFloat(retail);
    const uBox   = parseInt(units);
    if (!isNaN(rPrice) && !isNaN(uBox) && uBox > 0) {
      setFormData(prev => ({ ...prev, retailPrice: retail, unitsPerBox: units, unitPrice: (rPrice / uBox).toFixed(2) }));
    } else {
      setFormData(prev => ({ ...prev, retailPrice: retail, unitsPerBox: units }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const unitsPerBox = Math.max(1, Math.floor(toNumber(formData.unitsPerBox, 1)));
      const totalStock = (Math.floor(toNumber(formData.stockBoxes)) * unitsPerBox) + Math.floor(toNumber(formData.stockLoose));
      const supplier = suppliers.find(s => s.id === formData.supplierId);
      const supplierName = supplier?.name || formData.supplierName || '';
      const data = {
        name: formData.name.trim(), form: formData.form, category: formData.form,
        unitsPerBox,
        costPrice:   toNumber(formData.costPrice),
        retailPrice: toNumber(formData.retailPrice),
        unitPrice:   toNumber(formData.unitPrice),
        stock: totalStock, expiryDate: formData.expiryDate || '', batchNo: formData.batchNo || '',
        supplierId: formData.supplierId || '',
        supplierName,
      };
      if (editingId) {
        await updateDoc(doc(db, 'medicines', editingId), data);
      } else {
        await addDoc(collection(db, 'medicines'), { ...data, createdAt: new Date().toISOString() });
      }
      setIsModalOpen(false); setEditingId(null); setShowInlineSupplier(false);
    } catch (error) {
      handleFirestoreError(error, editingId ? OperationType.UPDATE : OperationType.CREATE, 'medicines');
    }
  };

  const handleQuickAddSupplier = async () => {
    const name = supplierForm.name.trim();
    if (!name) return;
    try {
      const ref = await addDoc(collection(db, 'suppliers'), {
        name,
        contact: supplierForm.contact.trim(),
        address: supplierForm.address.trim(),
        createdAt: new Date().toISOString(),
      });
      setFormData(prev => ({ ...prev, supplierId: ref.id, supplierName: name }));
      setSupplierForm(emptySupplierForm);
      setShowInlineSupplier(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'suppliers');
    }
  };

  const handleEdit = (med: any) => {
    const unitsPerBox = med.unitsPerBox || 1;
    setFormData({
      name: med.name, form: med.form || med.category || 'Tablet',
      unitsPerBox: unitsPerBox.toString(),
      costPrice:   (med.costPrice   || 0).toString(),
      retailPrice: (med.retailPrice || med.price || 0).toString(),
      unitPrice:   (med.unitPrice   || med.price || 0).toString(),
      stockBoxes:  Math.floor((med.stock || 0) / unitsPerBox).toString(),
      stockLoose:  ((med.stock || 0) % unitsPerBox).toString(),
      expiryDate:  med.expiryDate || '', batchNo: med.batchNo || '',
      supplierId:  med.supplierId || '', supplierName: med.supplierName || '',
    });
    setEditingId(med.id); setShowInlineSupplier(false); setIsModalOpen(true);
  };

  const confirmDelete = async () => {
    if (!confirmDeleteId) return;
    try { await deleteDoc(doc(db, 'medicines', confirmDeleteId)); }
    catch (error) { handleFirestoreError(error, OperationType.DELETE, `medicines/${confirmDeleteId}`); }
    finally { setConfirmDeleteId(null); }
  };

  const isExpiringSoon = (dateStr: string) => {
    if (!dateStr) return false;
    return isBefore(new Date(dateStr), addDays(new Date(), 30));
  };

  const handleDownloadTemplate = () => {
    const headers = ['name','form','unitsPerBox','costPrice','retailPrice','unitPrice','stockBoxes','stockLoose','expiryDate','batchNo'];
    const csv = headers.join(',');
    downloadOrShare(csv, 'medicines_template.csv', 'text/csv;charset=utf-8;');
  };;

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true); setCsvError(null);
    Papa.parse(file, {
      header: true, skipEmptyLines: true,
      complete: async (results) => {
        try {
          const rows = results.data as any[];
          let successCount = 0;
          for (const row of rows) {
            const name = String(row.name || '').trim();
            if (!name) continue;
            const unitsPerBox = parseInt(row.unitsPerBox || '1');
            const stockFromBoxes = (parseInt(row.stockBoxes || '0') * unitsPerBox) + parseInt(row.stockLoose || '0');
            const totalStock = row.stock ? parseInt(row.stock || '0') : stockFromBoxes;
            const retailPrice = parseFloat(row.retailPrice || row.salePrice || '0');
            const unitPrice = parseFloat(row.unitPrice || (unitsPerBox > 0 ? (retailPrice / unitsPerBox).toFixed(2) : '0'));
            await addDoc(collection(db, 'medicines'), {
              name, form: row.form || 'Tablet', unitsPerBox,
              costPrice:   parseFloat(row.costPrice   || '0'),
              retailPrice,
              unitPrice,
              stock: totalStock, expiryDate: row.expiryDate || '', batchNo: row.batchNo || '',
              createdAt: new Date().toISOString(),
            });
            successCount++;
          }
          if (successCount === 0) {
            setCsvError('No medicines were imported. Make sure the CSV has a name column with medicine names.');
            return;
          }
          setIsCsvModalOpen(false);
          setSuccessMsg(`✓ Successfully imported ${successCount} medicines!`);
          setTimeout(() => setSuccessMsg(''), 4000);
        } catch (error) {
          setCsvError('An error occurred while importing data.');
        } finally {
          setIsUploading(false); e.target.value = '';
        }
      },
      error: (error) => { setCsvError(`Error parsing CSV: ${error.message}`); setIsUploading(false); },
    });
  };

  const formatStock = (stock: number, unitsPerBox: number) => {
    if (!unitsPerBox || unitsPerBox <= 1) return `${stock} Units`;
    const boxes = Math.floor(stock / unitsPerBox);
    const loose = stock % unitsPerBox;
    if (boxes > 0 && loose > 0) return `${boxes} Box, ${loose} Loose`;
    if (boxes > 0) return `${boxes} Box`;
    return `${loose} Loose`;
  };

  const lowStock = (med: any) => med.stock <= (med.unitsPerBox || 1) * 2;

  return (
    <div className="space-y-4 md:space-y-6">

      {/* Success Toast */}
      {successMsg && (
        <div className="fixed top-4 right-4 bg-green-600 text-white px-5 py-3 rounded-lg shadow-lg z-50 flex items-center gap-2 max-w-xs">
          {successMsg}
        </div>
      )}

      {/* Confirm Delete Modal */}
      {confirmDeleteId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full">
            <h3 className="text-lg font-bold text-gray-900 mb-2">Delete Medicine</h3>
            <p className="text-gray-600 mb-6">Are you sure? This cannot be undone.</p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setConfirmDeleteId(null)} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">Cancel</button>
              <button onClick={confirmDelete} className="px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700">Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex justify-between items-center gap-2">
        <h1 className="text-xl md:text-2xl font-bold text-gray-900">Medicines</h1>
        <div className="flex gap-2">
          <button onClick={() => setIsCsvModalOpen(true)}
            className="bg-white text-gray-700 border border-gray-300 px-3 py-2 rounded-lg flex items-center gap-1.5 hover:bg-gray-50 text-sm font-medium">
            <Upload className="w-4 h-4" />
            <span className="hidden sm:inline">Import CSV</span>
          </button>
          <button
            onClick={() => {
              setEditingId(null);
              setFormData(emptyMedicineForm);
              setSupplierForm(emptySupplierForm);
              setShowInlineSupplier(false);
              setIsModalOpen(true);
            }}
            className="bg-blue-600 text-white px-3 py-2 rounded-lg flex items-center gap-1.5 hover:bg-blue-700 text-sm font-medium">
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Add Medicine</span>
            <span className="sm:hidden">Add</span>
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-4 border-b border-gray-100">
          <div className="relative">
            <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="text" placeholder="Search by name or batch no..."
              value={search} onChange={e => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>

        {/* ── Mobile: cards ── */}
        <div className="md:hidden divide-y divide-gray-100">
          {filteredMedicines.map(med => (
            <div key={med.id} className="p-4">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-gray-900">{med.name}</p>
                    {isExpiringSoon(med.expiryDate) && (
                      <span className="flex items-center gap-0.5 text-[10px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded">
                        <AlertCircle className="w-3 h-3" /> Expiring
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {med.form}{med.unitsPerBox > 1 ? ` • ${med.unitsPerBox}/box` : ''} • #{med.batchNo}
                  </p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => handleEdit(med)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded">
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button onClick={() => setConfirmDeleteId(med.id)} className="p-1.5 text-red-600 hover:bg-red-50 rounded">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <span className={`px-2 py-1 rounded-full text-xs font-semibold ${lowStock(med) ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}`}>
                  {formatStock(med.stock, med.unitsPerBox)}
                </span>
                <span className="px-2 py-1 rounded-full text-xs bg-blue-50 text-blue-700 font-medium">
                  {formatCurrency(med.retailPrice || med.price)}/box
                  {med.unitsPerBox > 1 && <span className="text-blue-400"> · {formatCurrency(med.unitPrice || med.price)}/unit</span>}
                </span>
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${isExpiringSoon(med.expiryDate) ? 'bg-red-50 text-red-600' : 'bg-gray-100 text-gray-500'}`}>
                  Exp: {med.expiryDate ? format(new Date(med.expiryDate), 'MMM yyyy') : 'N/A'}
                </span>
              </div>
            </div>
          ))}
          {filteredMedicines.length === 0 && (
            <div className="p-8 text-center text-gray-500">No medicines found.</div>
          )}
        </div>

        {/* ── Desktop: table ── */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-sm border-b border-gray-100">
                <th className="p-4 font-medium">Name & Form</th>
                <th className="p-4 font-medium">Batch No</th>
                <th className="p-4 font-medium">Stock</th>
                <th className="p-4 font-medium">Retail Price</th>
                <th className="p-4 font-medium">Expiry Date</th>
                <th className="p-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredMedicines.map(med => (
                <tr key={med.id} className="hover:bg-gray-50">
                  <td className="p-4">
                    <p className="font-medium text-gray-900">{med.name}</p>
                    <p className="text-xs text-gray-500">{med.form} {med.unitsPerBox > 1 ? `(${med.unitsPerBox}/box)` : ''}</p>
                  </td>
                  <td className="p-4 text-gray-600">{med.batchNo}</td>
                  <td className="p-4">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${lowStock(med) ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}`}>
                      {formatStock(med.stock, med.unitsPerBox)}
                    </span>
                  </td>
                  <td className="p-4">
                    <p className="text-gray-900 font-medium">{formatCurrency(med.retailPrice || med.price)} <span className="text-xs text-gray-500 font-normal">/box</span></p>
                    {med.unitsPerBox > 1 && <p className="text-xs text-gray-500">{formatCurrency(med.unitPrice || med.price)} /unit</p>}
                  </td>
                  <td className="p-4">
                    <div className="flex items-center gap-2">
                      <span className={isExpiringSoon(med.expiryDate) ? 'text-red-600 font-medium' : 'text-gray-600'}>
                        {med.expiryDate ? format(new Date(med.expiryDate), 'MMM dd, yyyy') : 'N/A'}
                      </span>
                      {isExpiringSoon(med.expiryDate) && <AlertCircle className="w-4 h-4 text-red-500" />}
                    </div>
                  </td>
                  <td className="p-4 flex justify-end gap-2">
                    <button onClick={() => handleEdit(med)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded"><Edit2 className="w-4 h-4" /></button>
                    <button onClick={() => setConfirmDeleteId(med.id)} className="p-1.5 text-red-600 hover:bg-red-50 rounded"><Trash2 className="w-4 h-4" /></button>
                  </td>
                </tr>
              ))}
              {filteredMedicines.length === 0 && (
                <tr><td colSpan={6} className="p-8 text-center text-gray-500">No medicines found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Add / Edit Modal (slides up on mobile) ── */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4 z-50">
          <div className="bg-white rounded-t-2xl sm:rounded-xl shadow-xl w-full sm:max-w-2xl overflow-hidden flex flex-col max-h-[95vh]">
            <div className="p-5 border-b border-gray-100 flex justify-between items-center shrink-0">
              <h2 className="text-xl font-bold text-gray-900">{editingId ? 'Edit Medicine' : 'Add Medicine'}</h2>
              <button onClick={() => setIsModalOpen(false)} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto flex-1">

              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                  <input required type="text" value={formData.name}
                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                    className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                  <select value={formData.form} onChange={e => setFormData({ ...formData, form: e.target.value })}
                    className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500">
                    {CATEGORIES.map(f => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="border border-gray-100 rounded-lg p-3 space-y-3">
                <div>
                  <div className="flex items-center justify-between gap-3 mb-1">
                    <label className="block text-sm font-medium text-gray-700">Supplier</label>
                    <button type="button" onClick={() => setShowInlineSupplier(prev => !prev)} className="text-xs font-medium text-blue-600 hover:text-blue-700">
                      {showInlineSupplier ? 'Cancel supplier' : '+ Add Supplier'}
                    </button>
                  </div>
                  <select
                    value={formData.supplierId}
                    onChange={e => {
                      const supplier = suppliers.find(s => s.id === e.target.value);
                      setFormData({ ...formData, supplierId: supplier?.id || '', supplierName: supplier?.name || '' });
                    }}
                    className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="">Select Supplier (optional)</option>
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>

                {showInlineSupplier && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 bg-blue-50 border border-blue-100 rounded-lg p-3">
                    <input
                      type="text"
                      value={supplierForm.name}
                      onChange={e => setSupplierForm({ ...supplierForm, name: e.target.value })}
                      placeholder="Supplier name"
                      className="p-2 border border-blue-200 rounded-lg text-sm focus:ring-blue-500 focus:border-blue-500"
                    />
                    <input
                      type="text"
                      value={supplierForm.contact}
                      onChange={e => setSupplierForm({ ...supplierForm, contact: e.target.value })}
                      placeholder="Contact"
                      className="p-2 border border-blue-200 rounded-lg text-sm focus:ring-blue-500 focus:border-blue-500"
                    />
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={supplierForm.address}
                        onChange={e => setSupplierForm({ ...supplierForm, address: e.target.value })}
                        placeholder="Address"
                        className="min-w-0 flex-1 p-2 border border-blue-200 rounded-lg text-sm focus:ring-blue-500 focus:border-blue-500"
                      />
                      <button type="button" onClick={handleQuickAddSupplier} disabled={!supplierForm.name.trim()} className="px-3 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-50">
                        Save
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Units/Box</label>
                  <input type="number" min="1" value={formData.unitsPerBox}
                    onChange={e => handleRetailPriceChange(formData.retailPrice, e.target.value)}
                    className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500" />
                  <p className="text-xs text-gray-400 mt-1">1 for syrup/inj</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Cost/Box</label>
                  <input type="number" step="0.01" min="0" value={formData.costPrice}
                    onChange={e => setFormData({ ...formData, costPrice: e.target.value })}
                    className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Retail/Box</label>
                  <input type="number" step="0.01" min="0" value={formData.retailPrice}
                    onChange={e => handleRetailPriceChange(e.target.value, formData.unitsPerBox)}
                    className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500" />
                </div>
              </div>

              {parseInt(formData.unitsPerBox) > 1 && (
                <div className="bg-blue-50 p-3 rounded-lg border border-blue-100 flex justify-between items-center">
                  <span className="text-sm text-blue-800 font-medium">Unit Price (per {formData.form})</span>
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500 text-sm">Rs.</span>
                    <input type="number" step="0.01" min="0" value={formData.unitPrice}
                      onChange={e => setFormData({ ...formData, unitPrice: e.target.value })}
                      className="w-24 p-1.5 text-right border border-blue-200 rounded focus:outline-none focus:border-blue-500 bg-white" />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Stock (Boxes)</label>
                  <input type="number" min="0" value={formData.stockBoxes}
                    onChange={e => setFormData({ ...formData, stockBoxes: e.target.value })}
                    className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500" />
                </div>
                {parseInt(formData.unitsPerBox) > 1 && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Stock (Loose)</label>
                    <input type="number" min="0" max={parseInt(formData.unitsPerBox) - 1}
                      value={formData.stockLoose}
                      onChange={e => setFormData({ ...formData, stockLoose: e.target.value })}
                      className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500" />
                  </div>
                )}
              </div>

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

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setIsModalOpen(false)}
                  className="flex-1 py-2.5 text-gray-700 border border-gray-200 rounded-lg font-medium hover:bg-gray-50">Cancel</button>
                <button type="submit"
                  className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700">
                  {editingId ? 'Save Changes' : 'Add Medicine'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── CSV Import Modal ── */}
      {isCsvModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4 z-50">
          <div className="bg-white rounded-t-2xl sm:rounded-xl shadow-xl w-full sm:max-w-md overflow-hidden">
            <div className="p-5 border-b border-gray-100 flex justify-between items-center">
              <h2 className="text-xl font-bold text-gray-900">Import via CSV</h2>
              <button onClick={() => setIsCsvModalOpen(false)} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="bg-blue-50 p-4 rounded-lg border border-blue-100">
                <h3 className="font-bold text-blue-800 mb-2">Instructions</h3>
                <ol className="list-decimal list-inside text-sm text-blue-700 space-y-1">
                  <li>Download the CSV template.</li>
                  <li>Fill in your medicine data (don't change headers).</li>
                  <li>Upload the completed CSV file below.</li>
                </ol>
                <button onClick={handleDownloadTemplate}
                  className="mt-3 flex items-center gap-2 text-sm font-medium text-blue-600 hover:text-blue-800">
                  <Download className="w-4 h-4" /> Download Template
                </button>
              </div>

              {csvError && (
                <div className="bg-red-50 p-3 rounded-lg border border-red-100 flex gap-2 text-red-700 text-sm">
                  <AlertCircle className="w-5 h-5 shrink-0" /> <p>{csvError}</p>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Select CSV File</label>
                <input type="file" accept=".csv" onChange={handleFileUpload} disabled={isUploading}
                  className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 disabled:opacity-50" />
              </div>

              {isUploading && <p className="text-sm text-blue-600 font-medium animate-pulse">Uploading and processing...</p>}

              <div className="flex justify-end pt-2">
                <button type="button" onClick={() => setIsCsvModalOpen(false)} disabled={isUploading}
                  className="px-4 py-2.5 text-gray-700 border border-gray-200 rounded-lg font-medium hover:bg-gray-50 disabled:opacity-50">
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
