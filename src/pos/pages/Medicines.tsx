import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { formatCurrency } from '../lib/utils';
import { Plus, Edit2, Trash2, Search, AlertCircle, Upload, Download } from 'lucide-react';
import { format, isBefore, addDays } from 'date-fns';
import Papa from 'papaparse';

export function Medicines() {
  const [medicines, setMedicines] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCsvModalOpen, setIsCsvModalOpen] = useState(false);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  
  const [formData, setFormData] = useState({
    name: '',
    form: 'Tablet',
    unitsPerBox: '10',
    costPrice: '',
    retailPrice: '',
    unitPrice: '',
    stockBoxes: '0',
    stockLoose: '0',
    expiryDate: '',
    batchNo: ''
  });

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'medicines'), (snapshot) => {
      const meds = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setMedicines(meds);
    }, (error) => handleFirestoreError(error, OperationType.GET, 'medicines'));
    return () => unsub();
  }, []);

  const filteredMedicines = medicines.filter(m => 
    m.name.toLowerCase().includes(search.toLowerCase()) || 
    m.batchNo.toLowerCase().includes(search.toLowerCase())
  );

  const handleRetailPriceChange = (retail: string, units: string) => {
    const rPrice = parseFloat(retail);
    const uBox = parseInt(units);
    if (!isNaN(rPrice) && !isNaN(uBox) && uBox > 0) {
      setFormData(prev => ({ ...prev, retailPrice: retail, unitsPerBox: units, unitPrice: (rPrice / uBox).toFixed(2) }));
    } else {
      setFormData(prev => ({ ...prev, retailPrice: retail, unitsPerBox: units }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const totalStock = (parseInt(formData.stockBoxes || '0') * parseInt(formData.unitsPerBox || '1')) + parseInt(formData.stockLoose || '0');
      
      const data = {
        name: formData.name,
        form: formData.form,
        unitsPerBox: parseInt(formData.unitsPerBox || '1'),
        costPrice: parseFloat(formData.costPrice || '0'),
        retailPrice: parseFloat(formData.retailPrice || '0'),
        unitPrice: parseFloat(formData.unitPrice || '0'),
        stock: totalStock,
        expiryDate: formData.expiryDate,
        batchNo: formData.batchNo,
      };

      if (editingId) {
        await updateDoc(doc(db, 'medicines', editingId), data);
      } else {
        await addDoc(collection(db, 'medicines'), {
          ...data,
          createdAt: new Date().toISOString()
        });
      }
      setIsModalOpen(false);
      setEditingId(null);
    } catch (error) {
      handleFirestoreError(error, editingId ? OperationType.UPDATE : OperationType.CREATE, 'medicines');
    }
  };

  const handleEdit = (med: any) => {
    const unitsPerBox = med.unitsPerBox || 1;
    const stockBoxes = Math.floor((med.stock || 0) / unitsPerBox);
    const stockLoose = (med.stock || 0) % unitsPerBox;

    setFormData({
      name: med.name,
      form: med.form || 'Tablet',
      unitsPerBox: unitsPerBox.toString(),
      costPrice: (med.costPrice || 0).toString(),
      retailPrice: (med.retailPrice || med.price || 0).toString(),
      unitPrice: (med.unitPrice || med.price || 0).toString(),
      stockBoxes: stockBoxes.toString(),
      stockLoose: stockLoose.toString(),
      expiryDate: med.expiryDate || '',
      batchNo: med.batchNo || ''
    });
    setEditingId(med.id);
    setIsModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (window.confirm('Are you sure you want to delete this medicine?')) {
      try {
        await deleteDoc(doc(db, 'medicines', id));
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, `medicines/${id}`);
      }
    }
  };

  const isExpiringSoon = (dateStr: string) => {
    if (!dateStr) return false;
    const expiry = new Date(dateStr);
    const nextMonth = addDays(new Date(), 30);
    return isBefore(expiry, nextMonth);
  };

  const handleDownloadTemplate = () => {
    const template = [
      ['name', 'form', 'unitsPerBox', 'costPrice', 'retailPrice', 'unitPrice', 'stockBoxes', 'stockLoose', 'expiryDate', 'batchNo'],
      ['Paracetamol', 'Tablet', '10', '50', '100', '10', '10', '0', '2025-12-31', 'BATCH001'],
      ['Cough Syrup', 'Syrup', '1', '80', '150', '150', '5', '0', '2024-10-15', 'BATCH002']
    ];
    const csv = Papa.unparse(template);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', 'medicines_template.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setCsvError(null);

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        try {
          const rows = results.data as any[];
          let successCount = 0;

          for (const row of rows) {
            if (!row.name || !row.expiryDate || !row.batchNo) {
              continue; // Skip invalid rows
            }

            const unitsPerBox = parseInt(row.unitsPerBox || '1');
            const stockBoxes = parseInt(row.stockBoxes || '0');
            const stockLoose = parseInt(row.stockLoose || '0');
            const totalStock = (stockBoxes * unitsPerBox) + stockLoose;

            const data = {
              name: row.name,
              form: row.form || 'Tablet',
              unitsPerBox: unitsPerBox,
              costPrice: parseFloat(row.costPrice || '0'),
              retailPrice: parseFloat(row.retailPrice || '0'),
              unitPrice: parseFloat(row.unitPrice || '0'),
              stock: totalStock,
              expiryDate: row.expiryDate,
              batchNo: row.batchNo,
              createdAt: new Date().toISOString()
            };

            await addDoc(collection(db, 'medicines'), data);
            successCount++;
          }

          setIsCsvModalOpen(false);
          alert(`Successfully imported ${successCount} medicines!`);
        } catch (error) {
          console.error("CSV Import Error:", error);
          setCsvError("An error occurred while importing data. Please check the console.");
        } finally {
          setIsUploading(false);
          // Reset file input
          e.target.value = '';
        }
      },
      error: (error) => {
        setCsvError(`Error parsing CSV: ${error.message}`);
        setIsUploading(false);
      }
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

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Medicines Inventory</h1>
        <div className="flex gap-3">
          <button
            onClick={() => setIsCsvModalOpen(true)}
            className="bg-white text-gray-700 border border-gray-300 px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-gray-50"
          >
            <Upload className="w-4 h-4" /> Import CSV
          </button>
          <button
            onClick={() => {
              setEditingId(null);
              setFormData({ name: '', form: 'Tablet', unitsPerBox: '10', costPrice: '', retailPrice: '', unitPrice: '', stockBoxes: '0', stockLoose: '0', expiryDate: '', batchNo: '' });
              setIsModalOpen(true);
            }}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-blue-700"
          >
            <Plus className="w-4 h-4" /> Add Medicine
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-4 border-b border-gray-100">
          <div className="relative max-w-md">
            <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search by name or batch no..."
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
                <th className="p-4 font-medium">Name & Form</th>
                <th className="p-4 font-medium">Batch No</th>
                <th className="p-4 font-medium">Stock</th>
                <th className="p-4 font-medium">Retail Price</th>
                <th className="p-4 font-medium">Expiry Date</th>
                <th className="p-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredMedicines.map((med) => (
                <tr key={med.id} className="hover:bg-gray-50">
                  <td className="p-4">
                    <p className="font-medium text-gray-900">{med.name}</p>
                    <p className="text-xs text-gray-500">{med.form} {med.unitsPerBox > 1 ? `(${med.unitsPerBox}/box)` : ''}</p>
                  </td>
                  <td className="p-4 text-gray-600">{med.batchNo}</td>
                  <td className="p-4">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      med.stock <= (med.unitsPerBox || 1) * 2 ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'
                    }`}>
                      {formatStock(med.stock, med.unitsPerBox)}
                    </span>
                  </td>
                  <td className="p-4">
                    <p className="text-gray-900 font-medium">{formatCurrency(med.retailPrice || med.price)} <span className="text-xs text-gray-500 font-normal">/box</span></p>
                    {med.unitsPerBox > 1 && (
                      <p className="text-xs text-gray-500">{formatCurrency(med.unitPrice || med.price)} /unit</p>
                    )}
                  </td>
                  <td className="p-4">
                    <div className="flex items-center gap-2">
                      <span className={isExpiringSoon(med.expiryDate) ? 'text-red-600 font-medium' : 'text-gray-600'}>
                        {med.expiryDate ? format(new Date(med.expiryDate), 'MMM dd, yyyy') : 'N/A'}
                      </span>
                      {isExpiringSoon(med.expiryDate) && (
                        <span title="Expiring Soon">
                          <AlertCircle className="w-4 h-4 text-red-500" />
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="p-4 flex justify-end gap-2">
                    <button onClick={() => handleEdit(med)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded">
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button onClick={() => handleDelete(med.id)} className="p-1.5 text-red-600 hover:bg-red-50 rounded">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
              {filteredMedicines.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-gray-500">
                    No medicines found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl overflow-hidden my-8">
            <div className="p-6 border-b border-gray-100">
              <h2 className="text-xl font-bold text-gray-900">
                {editingId ? 'Edit Medicine' : 'Add Medicine'}
              </h2>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                  <input required type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Form</label>
                  <select value={formData.form} onChange={e => setFormData({...formData, form: e.target.value})} className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500">
                    <option value="Tablet">Tablet</option>
                    <option value="Capsule">Capsule</option>
                    <option value="Syrup">Syrup</option>
                    <option value="Injection">Injection</option>
                    <option value="Drops">Drops</option>
                    <option value="Cream/Ointment">Cream/Ointment</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Units per Box</label>
                  <input required type="number" min="1" value={formData.unitsPerBox} onChange={e => handleRetailPriceChange(formData.retailPrice, e.target.value)} className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500" />
                  <p className="text-xs text-gray-500 mt-1">E.g., 10 tablets, or 1 for syrup</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Cost Price (per Box)</label>
                  <input required type="number" step="0.01" min="0" value={formData.costPrice} onChange={e => setFormData({...formData, costPrice: e.target.value})} className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Retail Price (per Box)</label>
                  <input required type="number" step="0.01" min="0" value={formData.retailPrice} onChange={e => handleRetailPriceChange(e.target.value, formData.unitsPerBox)} className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500" />
                </div>
              </div>

              {parseInt(formData.unitsPerBox) > 1 && (
                <div className="bg-blue-50 p-3 rounded-lg border border-blue-100">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-blue-800 font-medium">Calculated Unit Price (per {formData.form})</span>
                    <div className="flex items-center gap-2">
                      <span className="text-gray-500 text-sm">Rs.</span>
                      <input type="number" step="0.01" min="0" value={formData.unitPrice} onChange={e => setFormData({...formData, unitPrice: e.target.value})} className="w-24 p-1 text-right border border-blue-200 rounded focus:outline-none focus:border-blue-500" />
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Stock (Full Boxes)</label>
                  <input required type="number" min="0" value={formData.stockBoxes} onChange={e => setFormData({...formData, stockBoxes: e.target.value})} className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500" />
                </div>
                {parseInt(formData.unitsPerBox) > 1 && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Stock (Loose Units)</label>
                    <input required type="number" min="0" max={parseInt(formData.unitsPerBox) - 1} value={formData.stockLoose} onChange={e => setFormData({...formData, stockLoose: e.target.value})} className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500" />
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Batch No</label>
                  <input required type="text" value={formData.batchNo} onChange={e => setFormData({...formData, batchNo: e.target.value})} className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Expiry Date</label>
                  <input required type="date" value={formData.expiryDate} onChange={e => setFormData({...formData, expiryDate: e.target.value})} className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500" />
                </div>
              </div>

              <div className="pt-4 flex justify-end gap-3">
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-md font-medium">
                  Cancel
                </button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-md font-medium hover:bg-blue-700">
                  {editingId ? 'Save Changes' : 'Add Medicine'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CSV Import Modal */}
      {isCsvModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center">
              <h2 className="text-xl font-bold text-gray-900">Import Medicines via CSV</h2>
            </div>
            <div className="p-6 space-y-4">
              <div className="bg-blue-50 p-4 rounded-lg border border-blue-100">
                <h3 className="font-bold text-blue-800 mb-2">Instructions:</h3>
                <ol className="list-decimal list-inside text-sm text-blue-700 space-y-1">
                  <li>Download the CSV template.</li>
                  <li>Fill in your medicine data (do not change the column headers).</li>
                  <li>Upload the completed CSV file below.</li>
                </ol>
                <button
                  onClick={handleDownloadTemplate}
                  className="mt-3 flex items-center gap-2 text-sm font-medium text-blue-600 hover:text-blue-800"
                >
                  <Download className="w-4 h-4" /> Download Template
                </button>
              </div>

              {csvError && (
                <div className="bg-red-50 p-3 rounded-lg border border-red-100 flex gap-2 text-red-700 text-sm">
                  <AlertCircle className="w-5 h-5 shrink-0" />
                  <p>{csvError}</p>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Select CSV File</label>
                <input
                  type="file"
                  accept=".csv"
                  onChange={handleFileUpload}
                  disabled={isUploading}
                  className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 disabled:opacity-50"
                />
              </div>

              {isUploading && (
                <p className="text-sm text-blue-600 font-medium animate-pulse">Uploading and processing data...</p>
              )}

              <div className="pt-4 flex justify-end">
                <button
                  type="button"
                  onClick={() => setIsCsvModalOpen(false)}
                  disabled={isUploading}
                  className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-md font-medium disabled:opacity-50"
                >
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
