import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../../firebase';
import { formatCurrency } from '../lib/utils';
import { Plus, Edit2, Trash2, Search, Receipt, X } from 'lucide-react';
import { format } from 'date-fns';

const CATEGORIES = ['Utility', 'Rent', 'Salary', 'Maintenance', 'Supplies', 'Other'];

const CATEGORY_COLORS: Record<string, string> = {
  Utility:     'bg-blue-100 text-blue-800',
  Rent:        'bg-purple-100 text-purple-800',
  Salary:      'bg-green-100 text-green-800',
  Maintenance: 'bg-orange-100 text-orange-800',
  Supplies:    'bg-teal-100 text-teal-800',
  Other:       'bg-gray-100 text-gray-800',
};

export function Expenses() {
  const [expenses, setExpenses]     = useState<any[]>([]);
  const [search, setSearch]         = useState('');
  const [isModalOpen, setIsModalOpen]   = useState(false);
  const [editingId, setEditingId]       = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    description: '', amount: '', category: 'Utility',
    date: format(new Date(), 'yyyy-MM-dd'),
  });

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'expenses'), snap => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as any));
      list.sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setExpenses(list);
    }, err => handleFirestoreError(err, OperationType.GET, 'expenses'));
    return () => unsub();
  }, []);

  const filteredExpenses = expenses.filter(e =>
    e.description.toLowerCase().includes(search.toLowerCase()) ||
    e.category.toLowerCase().includes(search.toLowerCase())
  );

  const totalAmount = filteredExpenses.reduce((sum, e) => sum + (e.amount || 0), 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const data = {
        description: formData.description, amount: parseFloat(formData.amount || '0'),
        category: formData.category, date: formData.date,
        scope: 'pharmacy',
        addedBy: auth.currentUser?.uid || 'unknown',
      };
      if (editingId) {
        await updateDoc(doc(db, 'expenses', editingId), data);
      } else {
        await addDoc(collection(db, 'expenses'), { ...data, createdAt: new Date().toISOString() });
      }
      setIsModalOpen(false); setEditingId(null);
    } catch (error) {
      handleFirestoreError(error, editingId ? OperationType.UPDATE : OperationType.CREATE, 'expenses');
    }
  };

  const handleEdit = (exp: any) => {
    setFormData({ description: exp.description, amount: exp.amount.toString(), category: exp.category, date: exp.date });
    setEditingId(exp.id); setIsModalOpen(true);
  };

  const confirmDelete = async () => {
    if (!confirmDeleteId) return;
    try { await deleteDoc(doc(db, 'expenses', confirmDeleteId)); }
    catch (error) { handleFirestoreError(error, OperationType.DELETE, `expenses/${confirmDeleteId}`); }
    finally { setConfirmDeleteId(null); }
  };

  const openAdd = () => {
    setEditingId(null);
    setFormData({ description: '', amount: '', category: 'Utility', date: format(new Date(), 'yyyy-MM-dd') });
    setIsModalOpen(true);
  };

  return (
    <div className="space-y-4 md:space-y-6">

      {/* Confirm delete */}
      {confirmDeleteId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full">
            <h3 className="text-lg font-bold text-gray-900 mb-2">Delete Expense</h3>
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
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-900">Expenses</h1>
          {filteredExpenses.length > 0 && (
            <p className="text-sm text-red-600 font-medium mt-0.5">Total: {formatCurrency(totalAmount)}</p>
          )}
        </div>
        <button onClick={openAdd}
          className="bg-blue-600 text-white px-3 py-2 md:px-4 rounded-lg flex items-center gap-2 hover:bg-blue-700 text-sm font-medium shrink-0">
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">Add Expense</span>
          <span className="sm:hidden">Add</span>
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-4 border-b border-gray-100">
          <div className="relative">
            <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="text" placeholder="Search expenses..."
              value={search} onChange={e => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>

        {/* ── Mobile: cards ── */}
        <div className="md:hidden divide-y divide-gray-100">
          {filteredExpenses.map(exp => (
            <div key={exp.id} className="p-4 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-gray-900">{exp.description}</p>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${CATEGORY_COLORS[exp.category] || CATEGORY_COLORS.Other}`}>
                    {exp.category}
                  </span>
                </div>
                <p className="text-xs text-gray-400 mt-0.5">
                  {exp.date ? format(new Date(exp.date), 'MMM dd, yyyy') : 'N/A'}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="font-bold text-gray-900">{formatCurrency(exp.amount)}</span>
                <button onClick={() => handleEdit(exp)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded">
                  <Edit2 className="w-4 h-4" />
                </button>
                <button onClick={() => setConfirmDeleteId(exp.id)} className="p-1.5 text-red-600 hover:bg-red-50 rounded">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
          {filteredExpenses.length > 0 && (
            <div className="p-4 bg-gray-50 flex justify-between items-center">
              <span className="text-sm font-bold text-gray-700">Total</span>
              <span className="font-bold text-red-600">{formatCurrency(totalAmount)}</span>
            </div>
          )}
          {filteredExpenses.length === 0 && (
            <div className="p-8 text-center text-gray-500">No expenses found.</div>
          )}
        </div>

        {/* ── Desktop: table ── */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-sm border-b border-gray-100">
                <th className="p-4 font-medium">Date</th>
                <th className="p-4 font-medium">Description</th>
                <th className="p-4 font-medium">Category</th>
                <th className="p-4 font-medium">Amount</th>
                <th className="p-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredExpenses.map(exp => (
                <tr key={exp.id} className="hover:bg-gray-50">
                  <td className="p-4 text-gray-600">{exp.date ? format(new Date(exp.date), 'MMM dd, yyyy') : 'N/A'}</td>
                  <td className="p-4">
                    <p className="font-medium text-gray-900 flex items-center gap-2">
                      <Receipt className="w-4 h-4 text-gray-400 shrink-0" /> {exp.description}
                    </p>
                  </td>
                  <td className="p-4">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${CATEGORY_COLORS[exp.category] || CATEGORY_COLORS.Other}`}>
                      {exp.category}
                    </span>
                  </td>
                  <td className="p-4 font-medium text-gray-900">{formatCurrency(exp.amount)}</td>
                  <td className="p-4 flex justify-end gap-2">
                    <button onClick={() => handleEdit(exp)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded"><Edit2 className="w-4 h-4" /></button>
                    <button onClick={() => setConfirmDeleteId(exp.id)} className="p-1.5 text-red-600 hover:bg-red-50 rounded"><Trash2 className="w-4 h-4" /></button>
                  </td>
                </tr>
              ))}
              {filteredExpenses.length === 0 && (
                <tr><td colSpan={5} className="p-8 text-center text-gray-500">No expenses found.</td></tr>
              )}
            </tbody>
            {filteredExpenses.length > 0 && (
              <tfoot>
                <tr className="bg-gray-50 border-t-2 border-gray-200 font-bold text-sm">
                  <td className="p-4 text-gray-700" colSpan={3}>TOTAL — {filteredExpenses.length} expense(s)</td>
                  <td className="p-4 text-red-600 text-base">{formatCurrency(totalAmount)}</td>
                  <td className="p-4" />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* ── Modal (slides up on mobile) ── */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4 z-50">
          <div className="bg-white rounded-t-2xl sm:rounded-xl shadow-xl w-full sm:max-w-md overflow-hidden">
            <div className="p-5 border-b border-gray-100 flex justify-between items-center">
              <h2 className="text-xl font-bold text-gray-900">{editingId ? 'Edit Expense' : 'Add Expense'}</h2>
              <button onClick={() => setIsModalOpen(false)} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <input required type="text" value={formData.description}
                  onChange={e => setFormData({ ...formData, description: e.target.value })}
                  placeholder="e.g. Electricity Bill"
                  className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Amount (Rs.)</label>
                  <input required type="number" step="0.01" min="0" value={formData.amount}
                    onChange={e => setFormData({ ...formData, amount: e.target.value })}
                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                  <input required type="date" value={formData.date}
                    onChange={e => setFormData({ ...formData, date: e.target.value })}
                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Category</label>
                <div className="grid grid-cols-3 gap-2">
                  {CATEGORIES.map(cat => (
                    <button key={cat} type="button" onClick={() => setFormData({ ...formData, category: cat })}
                      className={`py-2 px-2 rounded-lg text-xs font-semibold border-2 transition-all ${
                        formData.category === cat
                          ? 'border-blue-500 bg-blue-50 text-blue-700'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}>
                      {cat}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setIsModalOpen(false)}
                  className="flex-1 py-2.5 text-gray-700 border border-gray-200 rounded-lg font-medium hover:bg-gray-50">Cancel</button>
                <button type="submit"
                  className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700">
                  {editingId ? 'Save Changes' : 'Add Expense'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
