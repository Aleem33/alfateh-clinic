import { useState, useEffect } from 'react';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../../firebase';
import { formatDate, nowISO } from '../lib/utils';
import { Plus, Search, Edit2, Trash2, X, Truck, Phone, Mail, MapPin } from 'lucide-react';
import { useAppDialog } from '../../components/AppDialog';

const CATEGORIES = ['Medicines', 'Medical Equipment', 'Surgical Supplies', 'Lab Supplies', 'Other'];

function F({ label, value, onChange, type = 'text', placeholder = '', required = false }: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; placeholder?: string; required?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}{required && ' *'}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
    </div>
  );
}

const emptyForm = { name: '', contact: '', email: '', address: '', category: 'Medicines', ntn: '', bankAccount: '', notes: '' };

export function Suppliers() {
  const { alert } = useAppDialog();
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [viewSupplier, setViewSupplier] = useState<any | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'suppliers'), snap =>
      setSuppliers(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a: any, b: any) => a.name > b.name ? 1 : -1))
    );
    return () => unsub();
  }, []);

  const filtered = suppliers.filter(s =>
    !search || s.name?.toLowerCase().includes(search.toLowerCase()) ||
    s.contact?.toLowerCase().includes(search.toLowerCase()) ||
    s.category?.toLowerCase().includes(search.toLowerCase())
  );

  const openAdd = () => { setEditId(null); setForm(emptyForm); setError(''); setShowModal(true); };

  const openEdit = (s: any) => {
    setEditId(s.id);
    setForm({ name: s.name, contact: s.contact || '', email: s.email || '', address: s.address || '', category: s.category || 'Medicines', ntn: s.ntn || '', bankAccount: s.bankAccount || '', notes: s.notes || '' });
    setError(''); setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name || !form.contact) { setError('Name and contact are required.'); return; }
    setSaving(true); setError('');
    try {
      if (editId) {
        await updateDoc(doc(db, 'suppliers', editId), { ...form, updatedAt: nowISO() });
      } else {
        await addDoc(collection(db, 'suppliers'), { ...form, createdAt: nowISO() });
      }
      setShowModal(false); setEditId(null); setForm(emptyForm);
    } catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    try { await deleteDoc(doc(db, 'suppliers', id)); setDeleteConfirm(null); }
    catch (e: any) { await alert(e.message || 'Supplier could not be deleted.', 'Delete Failed'); }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Suppliers</h1>
          <p className="text-sm text-gray-500">{suppliers.length} suppliers registered</p>
        </div>
        <button onClick={openAdd} className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
          <Plus className="w-4 h-4" /> Add Supplier
        </button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name, contact, or category..."
          className="w-full pl-9 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>{['Supplier', 'Category', 'Contact', 'Email', 'Address', 'Added', ''].map(h => (
              <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>
            ))}</tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {filtered.length === 0
              ? <tr><td colSpan={7} className="text-center py-12 text-gray-400">No suppliers found</td></tr>
              : filtered.map(s => (
                <tr key={s.id} className="hover:bg-gray-50/50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center shrink-0">
                        <Truck className="w-4 h-4 text-blue-600" />
                      </div>
                      <div>
                        <div className="text-sm font-medium text-gray-900">{s.name}</div>
                        {s.ntn && <div className="text-xs text-gray-400">NTN: {s.ntn}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="bg-purple-50 text-purple-700 text-xs px-2 py-0.5 rounded-full font-medium">{s.category || '—'}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 text-sm text-gray-600"><Phone className="w-3.5 h-3.5 text-gray-400" />{s.contact}</div>
                  </td>
                  <td className="px-4 py-3">
                    {s.email
                      ? <div className="flex items-center gap-1 text-sm text-gray-600"><Mail className="w-3.5 h-3.5 text-gray-400" />{s.email}</div>
                      : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    {s.address
                      ? <div className="flex items-center gap-1 text-sm text-gray-500 max-w-xs truncate"><MapPin className="w-3.5 h-3.5 text-gray-400 shrink-0" />{s.address}</div>
                      : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-400">{formatDate(s.createdAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button onClick={() => openEdit(s)} className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-lg"><Edit2 className="w-4 h-4" /></button>
                      <button onClick={() => setDeleteConfirm(s.id)} className="p-1.5 text-red-400 hover:bg-red-50 rounded-lg"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">{editId ? 'Edit Supplier' : 'Add Supplier'}</h2>
              <button onClick={() => setShowModal(false)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="p-5 space-y-4">
              {error && <div className="bg-red-50 text-red-600 text-sm p-3 rounded-lg">{error}</div>}
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <F label="Supplier / Company Name" value={form.name} onChange={(v: string) => setForm(f => ({ ...f, name: v }))} required />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Category</label>
                  <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <F label="Contact / Phone" value={form.contact} onChange={(v: string) => setForm(f => ({ ...f, contact: v }))} required />
                <F label="Email" value={form.email} onChange={(v: string) => setForm(f => ({ ...f, email: v }))} type="email" />
                <F label="NTN Number" value={form.ntn} onChange={(v: string) => setForm(f => ({ ...f, ntn: v }))} placeholder="Optional" />
                <div className="col-span-2">
                  <F label="Address" value={form.address} onChange={(v: string) => setForm(f => ({ ...f, address: v }))} />
                </div>
                <div className="col-span-2">
                  <F label="Bank Account Details" value={form.bankAccount} onChange={(v: string) => setForm(f => ({ ...f, bankAccount: v }))} placeholder="Bank name, account number..." />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
                  <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} placeholder="Any additional notes..."
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
            </div>
            <div className="flex gap-3 px-5 pb-5">
              <button onClick={() => setShowModal(false)} className="flex-1 border border-gray-200 text-gray-600 py-2 rounded-lg text-sm hover:bg-gray-50">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-60">
                {saving ? 'Saving...' : editId ? 'Update Supplier' : 'Add Supplier'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full text-center">
            <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <Trash2 className="w-5 h-5 text-red-600" />
            </div>
            <h2 className="font-semibold text-gray-900 mb-1">Delete Supplier?</h2>
            <p className="text-sm text-gray-500 mb-5">This will remove the supplier record. Purchase history will remain.</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteConfirm(null)} className="flex-1 border border-gray-200 text-gray-600 py-2 rounded-lg text-sm">Cancel</button>
              <button onClick={() => handleDelete(deleteConfirm)} className="flex-1 bg-red-600 text-white py-2 rounded-lg text-sm hover:bg-red-700">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
