import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { Plus, Edit2, Trash2, Search, X, Phone, MapPin } from 'lucide-react';
import { format } from 'date-fns';

export function Suppliers() {
  const [suppliers, setSuppliers]   = useState<any[]>([]);
  const [search, setSearch]         = useState('');
  const [isModalOpen, setIsModalOpen]       = useState(false);
  const [editingId, setEditingId]           = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [formData, setFormData] = useState({ name: '', contact: '', address: '' });

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'suppliers'), snap => {
      setSuppliers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, err => handleFirestoreError(err, OperationType.GET, 'suppliers'));
    return () => unsub();
  }, []);

  const filteredSuppliers = suppliers.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    (s.contact || '').includes(search)
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const data = { name: formData.name, contact: formData.contact, address: formData.address };
      if (editingId) {
        await updateDoc(doc(db, 'suppliers', editingId), data);
      } else {
        await addDoc(collection(db, 'suppliers'), { ...data, createdAt: new Date().toISOString() });
      }
      setIsModalOpen(false); setEditingId(null);
      setFormData({ name: '', contact: '', address: '' });
    } catch (error) {
      handleFirestoreError(error, editingId ? OperationType.UPDATE : OperationType.CREATE, 'suppliers');
    }
  };

  const handleEdit = (supp: any) => {
    setFormData({ name: supp.name, contact: supp.contact, address: supp.address || '' });
    setEditingId(supp.id); setIsModalOpen(true);
  };

  const confirmDelete = async () => {
    if (!confirmDeleteId) return;
    try { await deleteDoc(doc(db, 'suppliers', confirmDeleteId)); }
    catch (error) { handleFirestoreError(error, OperationType.DELETE, `suppliers/${confirmDeleteId}`); }
    finally { setConfirmDeleteId(null); }
  };

  return (
    <div className="space-y-4 md:space-y-6">

      {/* Confirm delete */}
      {confirmDeleteId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full">
            <h3 className="text-lg font-bold text-gray-900 mb-2">Delete Supplier</h3>
            <p className="text-gray-600 mb-6">Are you sure? This cannot be undone.</p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setConfirmDeleteId(null)} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">Cancel</button>
              <button onClick={confirmDelete} className="px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700">Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex justify-between items-center gap-3">
        <h1 className="text-xl md:text-2xl font-bold text-gray-900">Suppliers</h1>
        <button
          onClick={() => { setEditingId(null); setFormData({ name: '', contact: '', address: '' }); setIsModalOpen(true); }}
          className="bg-blue-600 text-white px-3 py-2 md:px-4 rounded-lg flex items-center gap-2 hover:bg-blue-700 text-sm font-medium shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">Add Supplier</span>
          <span className="sm:hidden">Add</span>
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-4 border-b border-gray-100">
          <div className="relative">
            <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="text" placeholder="Search by name or contact..."
              value={search} onChange={e => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>

        {/* ── Mobile: cards ── */}
        <div className="md:hidden divide-y divide-gray-100">
          {filteredSuppliers.map(supp => (
            <div key={supp.id} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900">{supp.name}</p>
                  {supp.contact && (
                    <p className="flex items-center gap-1 text-sm text-gray-500 mt-0.5">
                      <Phone className="w-3 h-3 shrink-0" /> {supp.contact}
                    </p>
                  )}
                  {supp.address && (
                    <p className="flex items-center gap-1 text-xs text-gray-400 mt-0.5">
                      <MapPin className="w-3 h-3 shrink-0" /> {supp.address}
                    </p>
                  )}
                  <p className="text-xs text-gray-400 mt-1">
                    Added: {supp.createdAt ? format(new Date(supp.createdAt), 'MMM dd, yyyy') : 'N/A'}
                  </p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => handleEdit(supp)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded">
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button onClick={() => setConfirmDeleteId(supp.id)} className="p-1.5 text-red-600 hover:bg-red-50 rounded">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
          {filteredSuppliers.length === 0 && (
            <div className="p-8 text-center text-gray-500">No suppliers found.</div>
          )}
        </div>

        {/* ── Desktop: table ── */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-sm border-b border-gray-100">
                <th className="p-4 font-medium">Name</th>
                <th className="p-4 font-medium">Contact</th>
                <th className="p-4 font-medium">Address</th>
                <th className="p-4 font-medium">Added On</th>
                <th className="p-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredSuppliers.map(supp => (
                <tr key={supp.id} className="hover:bg-gray-50">
                  <td className="p-4 font-medium text-gray-900">{supp.name}</td>
                  <td className="p-4 text-gray-600">{supp.contact}</td>
                  <td className="p-4 text-gray-600">{supp.address || '—'}</td>
                  <td className="p-4 text-gray-600">{supp.createdAt ? format(new Date(supp.createdAt), 'MMM dd, yyyy') : 'N/A'}</td>
                  <td className="p-4 flex justify-end gap-2">
                    <button onClick={() => handleEdit(supp)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded"><Edit2 className="w-4 h-4" /></button>
                    <button onClick={() => setConfirmDeleteId(supp.id)} className="p-1.5 text-red-600 hover:bg-red-50 rounded"><Trash2 className="w-4 h-4" /></button>
                  </td>
                </tr>
              ))}
              {filteredSuppliers.length === 0 && (
                <tr><td colSpan={5} className="p-8 text-center text-gray-500">No suppliers found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Modal (slides up on mobile) ── */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4 z-50">
          <div className="bg-white rounded-t-2xl sm:rounded-xl shadow-xl w-full sm:max-w-md overflow-hidden">
            <div className="p-5 border-b border-gray-100 flex justify-between items-center">
              <h2 className="text-xl font-bold text-gray-900">{editingId ? 'Edit Supplier' : 'Add Supplier'}</h2>
              <button onClick={() => setIsModalOpen(false)} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <input required type="text" value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Contact Details</label>
                <input required type="text" value={formData.contact}
                  onChange={e => setFormData({ ...formData, contact: e.target.value })}
                  className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Address <span className="text-gray-400 font-normal">(optional)</span></label>
                <textarea value={formData.address} rows={2}
                  onChange={e => setFormData({ ...formData, address: e.target.value })}
                  className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500" />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setIsModalOpen(false)}
                  className="flex-1 py-2.5 text-gray-700 border border-gray-200 rounded-lg font-medium hover:bg-gray-50">Cancel</button>
                <button type="submit"
                  className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700">
                  {editingId ? 'Save Changes' : 'Add Supplier'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
