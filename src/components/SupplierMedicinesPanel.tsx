import { useEffect, useMemo, useState } from 'react';
import { collection, doc, increment, setDoc, writeBatch } from 'firebase/firestore';
import { CheckCircle, ChevronUp, Package, PackagePlus, Plus, X } from 'lucide-react';
import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import {
  getDefaultMedicineCategory,
  useMedicineCategories,
} from '../lib/medicineCategories';
import {
  dedupeMedicines,
  findDuplicateMedicine,
  getMedicineDocumentId,
  getMedicineIdentity,
  getMedicineSearchText,
  normalizeMedicineText,
} from '../lib/medicineIndex';
import { subscribeToMedicines } from '../lib/medicineStore';

type Supplier = {
  id: string;
  name: string;
};

type MedicineForm = {
  name: string;
  category: string;
  unitsPerBox: string;
  costPrice: string;
  retailPrice: string;
  stockBoxes: string;
  stockLoose: string;
  batchNo: string;
  expiryDate: string;
};

type PurchaseForm = {
  boxesPurchased: string;
  looseUnitsPurchased: string;
  unitsPerBox: string;
  costPrice: string;
  retailPrice: string;
  unitPrice: string;
  batchNo: string;
  expiryDate: string;
  date: string;
  invoiceNo: string;
  notes: string;
};

const today = () => new Date().toISOString().split('T')[0];

const makeEmptyForm = (category: string): MedicineForm => ({
  name: '',
  category,
  unitsPerBox: '1',
  costPrice: '',
  retailPrice: '',
  stockBoxes: '0',
  stockLoose: '0',
  batchNo: '',
  expiryDate: '',
});

const toNumber = (value: string, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const makePurchaseForm = (medicine: any): PurchaseForm => {
  const unitsPerBox = Math.max(1, Math.floor(Number(medicine.unitsPerBox) || 1));
  const retailPrice = Number(medicine.retailPrice || medicine.price || 0);
  const unitPrice = Number(medicine.unitPrice || (retailPrice / unitsPerBox) || 0);
  return {
    boxesPurchased: '',
    looseUnitsPurchased: '0',
    unitsPerBox: String(unitsPerBox),
    costPrice: String(medicine.costPrice || ''),
    retailPrice: String(retailPrice || ''),
    unitPrice: String(unitPrice || ''),
    batchNo: medicine.batchNo || '',
    expiryDate: medicine.expiryDate || '',
    date: today(),
    invoiceNo: '',
    notes: '',
  };
};

function formatStock(stock: number, unitsPerBox: number) {
  const safeStock = Math.max(0, Number(stock) || 0);
  const safeUnits = Math.max(1, Number(unitsPerBox) || 1);
  if (safeUnits === 1) return `${safeStock} units`;
  const boxes = Math.floor(safeStock / safeUnits);
  const loose = safeStock % safeUnits;
  return `${boxes} boxes${loose ? ` + ${loose} loose` : ''}`;
}

export function SupplierMedicinesPanel({
  supplier,
  onCollapse,
}: {
  supplier: Supplier;
  onCollapse: () => void;
}) {
  const { categories } = useMedicineCategories();
  const [medicines, setMedicines] = useState<any[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [purchasingMedicine, setPurchasingMedicine] = useState<any | null>(null);
  const [purchaseForm, setPurchaseForm] = useState<PurchaseForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [form, setForm] = useState<MedicineForm>(() =>
    makeEmptyForm(getDefaultMedicineCategory(categories))
  );

  useEffect(() => {
    const unsubscribe = subscribeToMedicines(
      setMedicines,
      error => handleFirestoreError(error, OperationType.GET, 'medicines')
    );
    return unsubscribe;
  }, []);

  useEffect(() => {
    setShowAddForm(false);
    setPurchasingMedicine(null);
    setPurchaseForm(null);
    setError('');
    setSuccessMessage('');
    setForm(makeEmptyForm(getDefaultMedicineCategory(categories)));
  }, [supplier.id]);

  const supplierMedicines = useMemo(() => {
    const supplierName = supplier.name.trim().toLocaleLowerCase();
    return dedupeMedicines(medicines
      .filter(medicine =>
        medicine.supplierId === supplier.id ||
        (!medicine.supplierId &&
          String(medicine.supplierName || '').trim().toLocaleLowerCase() === supplierName)
      )
    ).sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  }, [medicines, supplier.id, supplier.name]);

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = form.name.trim();
    if (!name) {
      setError('Medicine name is required.');
      return;
    }

    const unitsPerBox = Math.max(1, Math.floor(toNumber(form.unitsPerBox, 1)));
    const stockBoxes = Math.max(0, Math.floor(toNumber(form.stockBoxes)));
    const stockLoose = Math.max(0, Math.floor(toNumber(form.stockLoose)));
    const retailPrice = Math.max(0, toNumber(form.retailPrice));
    const category = form.category || getDefaultMedicineCategory(categories);
    const candidate = {
      name,
      category,
      form: category,
      batchNo: form.batchNo.trim(),
      supplierId: supplier.id,
      supplierName: supplier.name,
    };
    const duplicate = findDuplicateMedicine(medicines, candidate);
    if (duplicate) {
      setError(`${duplicate.name} already exists for this supplier${duplicate.batchNo ? ` in batch ${duplicate.batchNo}` : ''}. Record a purchase instead of adding it again.`);
      return;
    }

    setSaving(true);
    setError('');
    try {
      await setDoc(doc(db, 'medicines', getMedicineDocumentId(candidate)), {
        name,
        form: category,
        category,
        unitsPerBox,
        costPrice: Math.max(0, toNumber(form.costPrice)),
        retailPrice,
        unitPrice: unitsPerBox > 0 ? Number((retailPrice / unitsPerBox).toFixed(2)) : 0,
        stock: stockBoxes * unitsPerBox + stockLoose,
        batchNo: form.batchNo.trim(),
        expiryDate: form.expiryDate || '',
        supplierId: supplier.id,
        supplierName: supplier.name,
        medicineKey: getMedicineIdentity(candidate),
        searchName: normalizeMedicineText(name),
        searchText: getMedicineSearchText(candidate),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      setForm(makeEmptyForm(getDefaultMedicineCategory(categories)));
      setShowAddForm(false);
    } catch (saveError) {
      setError('Medicine could not be saved. Please try again.');
      handleFirestoreError(saveError, OperationType.CREATE, 'medicines');
    } finally {
      setSaving(false);
    }
  };

  const openPurchase = (medicine: any) => {
    setPurchasingMedicine(medicine);
    setPurchaseForm(makePurchaseForm(medicine));
    setError('');
  };

  const updatePurchaseRetailAndUnits = (retailPrice: string, unitsPerBox: string) => {
    const units = Math.max(1, Math.floor(toNumber(unitsPerBox, 1)));
    const retail = toNumber(retailPrice);
    setPurchaseForm(current => current ? {
      ...current,
      retailPrice,
      unitsPerBox,
      unitPrice: retailPrice.trim() ? (retail / units).toFixed(2) : '',
    } : current);
  };

  const handlePurchaseSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!purchasingMedicine || !purchaseForm) return;

    const unitsPerBox = Math.max(1, Math.floor(toNumber(purchaseForm.unitsPerBox, 1)));
    const boxesPurchased = Math.max(0, Math.floor(toNumber(purchaseForm.boxesPurchased)));
    const looseUnitsPurchased = Math.max(0, Math.floor(toNumber(purchaseForm.looseUnitsPurchased)));
    const totalUnitsAdded = boxesPurchased * unitsPerBox + looseUnitsPurchased;
    if (totalUnitsAdded <= 0) {
      setError('Enter at least one box or loose unit.');
      return;
    }

    const costPrice = Math.max(0, toNumber(purchaseForm.costPrice));
    const retailPrice = Math.max(0, toNumber(purchaseForm.retailPrice));
    const unitPrice = purchaseForm.unitPrice.trim()
      ? Math.max(0, toNumber(purchaseForm.unitPrice))
      : Number((retailPrice / unitsPerBox).toFixed(2));
    const costPricePerUnit = costPrice / unitsPerBox;
    const totalCost = totalUnitsAdded * costPricePerUnit;
    const timestamp = new Date().toISOString();

    setSaving(true);
    setError('');
    try {
      const batch = writeBatch(db);
      const purchaseRef = doc(collection(db, 'purchases'));
      batch.set(purchaseRef, {
        medicineId: purchasingMedicine.id,
        medicineName: purchasingMedicine.name,
        supplierId: supplier.id,
        supplierName: supplier.name,
        boxes: boxesPurchased,
        boxesPurchased,
        looseUnits: looseUnitsPurchased,
        looseUnitsPurchased,
        totalUnitsAdded,
        unitsAdded: totalUnitsAdded,
        unitsPerBox,
        costPerBox: costPrice,
        costPrice,
        costPricePerUnit,
        retailPrice,
        unitPrice,
        totalCost,
        batchNo: purchaseForm.batchNo.trim(),
        expiryDate: purchaseForm.expiryDate || '',
        invoiceNo: purchaseForm.invoiceNo.trim(),
        notes: purchaseForm.notes.trim(),
        date: purchaseForm.date || today(),
        addedBy: auth.currentUser?.uid || 'unknown',
        createdAt: timestamp,
      });
      batch.update(doc(db, 'medicines', purchasingMedicine.id), {
        stock: increment(totalUnitsAdded),
        unitsPerBox,
        costPrice,
        retailPrice,
        unitPrice,
        batchNo: purchaseForm.batchNo.trim() || purchasingMedicine.batchNo || '',
        expiryDate: purchaseForm.expiryDate || purchasingMedicine.expiryDate || '',
        supplierId: supplier.id,
        supplierName: supplier.name,
        updatedAt: timestamp,
      });
      await batch.commit();

      setPurchasingMedicine(null);
      setPurchaseForm(null);
      setSuccessMessage(`Purchase recorded: ${totalUnitsAdded} units added to ${purchasingMedicine.name}.`);
      window.setTimeout(() => setSuccessMessage(''), 4000);
    } catch (purchaseError) {
      setError('Purchase could not be recorded. Please try again.');
      handleFirestoreError(purchaseError, OperationType.CREATE, 'purchases');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-blue-50/60 border-y border-blue-100 p-4 md:p-5" onClick={event => event.stopPropagation()}>
      {successMessage && (
        <div className="mb-4 flex items-center gap-2 bg-green-50 border border-green-200 text-green-700 rounded-lg px-3 py-2.5 text-sm">
          <CheckCircle className="w-4 h-4 shrink-0" /> {successMessage}
        </div>
      )}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2">
            <Package className="w-5 h-5 text-blue-600" />
            <h3 className="font-semibold text-gray-900">{supplier.name} Medicines</h3>
            <span className="text-xs font-semibold bg-white text-blue-700 border border-blue-100 rounded-full px-2 py-0.5">
              {supplierMedicines.length}
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-1">Only medicines assigned to this supplier are shown here.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => { setShowAddForm(true); setError(''); }}
            className="flex items-center justify-center gap-1.5 bg-blue-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-blue-700"
          >
            <Plus className="w-4 h-4" /> Add Medicine
          </button>
          <button
            type="button"
            onClick={onCollapse}
            className="flex items-center justify-center gap-1.5 bg-white text-gray-600 border border-gray-200 px-3 py-2 rounded-lg text-sm hover:bg-gray-50"
          >
            <ChevronUp className="w-4 h-4" /> Collapse
          </button>
        </div>
      </div>

      {supplierMedicines.length === 0 ? (
        <div className="bg-white border border-dashed border-blue-200 rounded-xl px-4 py-8 text-center">
          <Package className="w-8 h-8 text-blue-200 mx-auto mb-2" />
          <p className="text-sm font-medium text-gray-600">No medicines added for {supplier.name} yet.</p>
          <p className="text-xs text-gray-400 mt-1">Use "Add Medicine" to create the first one.</p>
        </div>
      ) : (
        <div className="bg-white border border-blue-100 rounded-xl overflow-hidden">
          <div className="md:hidden divide-y divide-gray-100">
            {supplierMedicines.map(medicine => (
              <div key={medicine.id} className="p-3">
                <div className="flex justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{medicine.name}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {medicine.category || medicine.form || 'Medicine'}
                      {medicine.batchNo ? ` - Batch ${medicine.batchNo}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <span className="text-xs font-medium text-green-700 bg-green-50 rounded-full px-2 py-1 h-fit">
                      {formatStock(medicine.stock, medicine.unitsPerBox)}
                    </span>
                    <button
                      type="button"
                      onClick={() => openPurchase(medicine)}
                      className="flex items-center gap-1 bg-emerald-600 text-white rounded-lg px-2.5 py-1.5 text-xs font-medium hover:bg-emerald-700"
                    >
                      <PackagePlus className="w-3.5 h-3.5" /> Record Purchase
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Medicine</th>
                  <th className="px-4 py-2.5 font-semibold">Category</th>
                  <th className="px-4 py-2.5 font-semibold">Batch</th>
                  <th className="px-4 py-2.5 font-semibold">Stock</th>
                  <th className="px-4 py-2.5 font-semibold">Retail / Box</th>
                  <th className="px-4 py-2.5 font-semibold">Expiry</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Purchase</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {supplierMedicines.map(medicine => (
                  <tr key={medicine.id}>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{medicine.name}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{medicine.category || medicine.form || '-'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{medicine.batchNo || '-'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{formatStock(medicine.stock, medicine.unitsPerBox)}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">Rs. {Number(medicine.retailPrice || medicine.price || 0).toFixed(2)}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{medicine.expiryDate || '-'}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => openPurchase(medicine)}
                        className="inline-flex items-center gap-1.5 bg-emerald-600 text-white rounded-lg px-3 py-2 text-xs font-medium hover:bg-emerald-700"
                      >
                        <PackagePlus className="w-3.5 h-3.5" /> Record Purchase
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showAddForm && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-[60] p-0 sm:p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-2xl max-h-[95vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-3 p-5 border-b border-gray-100">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Add Medicine</h2>
                <p className="text-sm text-blue-600 mt-0.5">Supplier: {supplier.name}</p>
              </div>
              <button type="button" onClick={() => setShowAddForm(false)} className="p-1 text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSave} className="p-5 space-y-4">
              {error && <div className="bg-red-50 text-red-600 text-sm p-3 rounded-lg">{error}</div>}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Medicine Name *</label>
                  <input
                    autoFocus
                    required
                    value={form.name}
                    onChange={event => setForm(current => ({ ...current, name: event.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Category *</label>
                  <select
                    value={form.category}
                    onChange={event => setForm(current => ({ ...current, category: event.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {categories.map(category => <option key={category} value={category}>{category}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Units Per Box</label>
                  <input
                    type="number"
                    min="1"
                    value={form.unitsPerBox}
                    onChange={event => setForm(current => ({ ...current, unitsPerBox: event.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Batch Number</label>
                  <input
                    value={form.batchNo}
                    onChange={event => setForm(current => ({ ...current, batchNo: event.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Cost Per Box</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.costPrice}
                    onChange={event => setForm(current => ({ ...current, costPrice: event.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Retail Price Per Box</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.retailPrice}
                    onChange={event => setForm(current => ({ ...current, retailPrice: event.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Opening Stock (Boxes)</label>
                  <input
                    type="number"
                    min="0"
                    value={form.stockBoxes}
                    onChange={event => setForm(current => ({ ...current, stockBoxes: event.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Opening Stock (Loose Units)</label>
                  <input
                    type="number"
                    min="0"
                    max={Math.max(0, Math.floor(toNumber(form.unitsPerBox, 1)) - 1)}
                    value={form.stockLoose}
                    onChange={event => setForm(current => ({ ...current, stockLoose: event.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Expiry Date</label>
                  <input
                    type="date"
                    value={form.expiryDate}
                    onChange={event => setForm(current => ({ ...current, expiryDate: event.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
              <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-sm text-blue-700">
                This medicine will be saved only under <strong>{supplier.name}</strong>.
              </div>
              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="flex-1 border border-gray-200 text-gray-600 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 bg-blue-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60"
                >
                  {saving ? 'Saving...' : `Add to ${supplier.name}`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {purchasingMedicine && purchaseForm && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-[60] p-0 sm:p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-2xl max-h-[95vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-3 p-5 border-b border-gray-100">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Record Purchase</h2>
                <p className="text-sm text-gray-500 mt-0.5">{purchasingMedicine.name}</p>
                <p className="text-xs text-blue-600 mt-0.5">Supplier: {supplier.name}</p>
              </div>
              <button
                type="button"
                onClick={() => { setPurchasingMedicine(null); setPurchaseForm(null); setError(''); }}
                className="p-1 text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handlePurchaseSave} className="p-5 space-y-4">
              {error && <div className="bg-red-50 text-red-600 text-sm p-3 rounded-lg">{error}</div>}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Boxes Purchased *</label>
                  <input
                    autoFocus
                    type="number"
                    min="0"
                    value={purchaseForm.boxesPurchased}
                    onChange={event => setPurchaseForm(current => current ? ({ ...current, boxesPurchased: event.target.value }) : current)}
                    placeholder="e.g. 10"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Loose Units</label>
                  <input
                    type="number"
                    min="0"
                    value={purchaseForm.looseUnitsPurchased}
                    onChange={event => setPurchaseForm(current => current ? ({ ...current, looseUnitsPurchased: event.target.value }) : current)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Units Per Box</label>
                  <input
                    type="number"
                    min="1"
                    value={purchaseForm.unitsPerBox}
                    onChange={event => updatePurchaseRetailAndUnits(purchaseForm.retailPrice, event.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Cost Per Box</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={purchaseForm.costPrice}
                    onChange={event => setPurchaseForm(current => current ? ({ ...current, costPrice: event.target.value }) : current)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Retail Price Per Box</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={purchaseForm.retailPrice}
                    onChange={event => updatePurchaseRetailAndUnits(event.target.value, purchaseForm.unitsPerBox)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Unit Sale Price</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={purchaseForm.unitPrice}
                    onChange={event => setPurchaseForm(current => current ? ({ ...current, unitPrice: event.target.value }) : current)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Batch Number</label>
                  <input
                    value={purchaseForm.batchNo}
                    onChange={event => setPurchaseForm(current => current ? ({ ...current, batchNo: event.target.value }) : current)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Expiry Date</label>
                  <input
                    type="date"
                    value={purchaseForm.expiryDate}
                    onChange={event => setPurchaseForm(current => current ? ({ ...current, expiryDate: event.target.value }) : current)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Purchase Date</label>
                  <input
                    type="date"
                    value={purchaseForm.date}
                    onChange={event => setPurchaseForm(current => current ? ({ ...current, date: event.target.value }) : current)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div className="sm:col-span-3">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Invoice Number</label>
                  <input
                    value={purchaseForm.invoiceNo}
                    onChange={event => setPurchaseForm(current => current ? ({ ...current, invoiceNo: event.target.value }) : current)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div className="sm:col-span-3">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
                  <textarea
                    rows={2}
                    value={purchaseForm.notes}
                    onChange={event => setPurchaseForm(current => current ? ({ ...current, notes: event.target.value }) : current)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-emerald-50 border border-emerald-100 rounded-lg p-3 text-sm">
                <div>
                  <p className="text-xs text-emerald-600">Units to add</p>
                  <p className="font-semibold text-emerald-900">
                    {Math.max(0, Math.floor(toNumber(purchaseForm.boxesPurchased))) * Math.max(1, Math.floor(toNumber(purchaseForm.unitsPerBox, 1))) + Math.max(0, Math.floor(toNumber(purchaseForm.looseUnitsPurchased)))}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-emerald-600">Current stock</p>
                  <p className="font-semibold text-emerald-900">{formatStock(purchasingMedicine.stock, purchasingMedicine.unitsPerBox)}</p>
                </div>
                <div>
                  <p className="text-xs text-emerald-600">Purchase total</p>
                  <p className="font-semibold text-emerald-900">
                    Rs. {(
                      (Math.max(0, Math.floor(toNumber(purchaseForm.boxesPurchased))) * Math.max(1, Math.floor(toNumber(purchaseForm.unitsPerBox, 1))) + Math.max(0, Math.floor(toNumber(purchaseForm.looseUnitsPurchased)))) *
                      (Math.max(0, toNumber(purchaseForm.costPrice)) / Math.max(1, Math.floor(toNumber(purchaseForm.unitsPerBox, 1))))
                    ).toFixed(2)}
                  </p>
                </div>
              </div>

              <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-sm text-blue-700">
                This purchase will be recorded for <strong>{supplier.name}</strong> and will increase <strong>{purchasingMedicine.name}</strong> stock.
              </div>
              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => { setPurchasingMedicine(null); setPurchaseForm(null); setError(''); }}
                  className="flex-1 border border-gray-200 text-gray-600 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 bg-emerald-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-60"
                >
                  {saving ? 'Saving...' : 'Record Purchase'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
