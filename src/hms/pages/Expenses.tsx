import { useState, useEffect } from 'react';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore';
import { db, auth } from '../../firebase';
import { formatCurrency, formatDate, today, nowISO } from '../lib/utils';
import { Plus, Search, Edit2, Trash2, X, Receipt, TrendingDown, Filter } from 'lucide-react';
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import { useAppDialog } from '../../components/AppDialog';

const CATEGORIES = [
  'Salaries & Wages', 'Medicine Purchase', 'Medical Equipment',
  'Utilities (Electricity/Gas/Water)', 'Rent', 'Maintenance & Repairs',
  'Stationery & Office Supplies', 'Food & Catering', 'Security',
  'Laundry', 'Ambulance & Transport', 'Marketing', 'Insurance',
  'Miscellaneous',
];

const emptyForm = {
  description: '', category: 'Miscellaneous', amount: '',
  date: today(), paymentMethod: 'Cash', vendor: '', invoiceNo: '', notes: '',
};

export function Expenses() {
  const { alert } = useAppDialog();
  const [expenses, setExpenses] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [monthFilter, setMonthFilter] = useState(format(new Date(), 'yyyy-MM'));
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'expenses'), snap =>
      setExpenses(
        snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .sort((a: any, b: any) => (b.date > a.date ? 1 : -1))
      )
    );
    return () => unsub();
  }, []);

  // Filtering
  const filtered = expenses.filter(e => {
    const matchMonth = !monthFilter || (e.date || '').startsWith(monthFilter);
    const matchCat = !catFilter || e.category === catFilter;
    const matchSearch =
      !search ||
      e.description?.toLowerCase().includes(search.toLowerCase()) ||
      e.vendor?.toLowerCase().includes(search.toLowerCase()) ||
      e.category?.toLowerCase().includes(search.toLowerCase());
    return matchMonth && matchCat && matchSearch;
  });

  const totalFiltered = filtered.reduce((s, e) => s + (e.amount || 0), 0);
  const totalThisMonth = expenses
    .filter(e => (e.date || '').startsWith(format(new Date(), 'yyyy-MM')))
    .reduce((s, e) => s + (e.amount || 0), 0);

  // Group by category for summary
  const byCat: Record<string, number> = {};
  filtered.forEach(e => {
    byCat[e.category] = (byCat[e.category] || 0) + (e.amount || 0);
  });
  const topCats = Object.entries(byCat)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const openAdd = () => { setEditId(null); setForm(emptyForm); setError(''); setShowModal(true); };
  const openEdit = (e: any) => {
    setEditId(e.id);
    setForm({
      description: e.description, category: e.category, amount: String(e.amount),
      date: e.date, paymentMethod: e.paymentMethod || 'Cash',
      vendor: e.vendor || '', invoiceNo: e.invoiceNo || '', notes: e.notes || '',
    });
    setError(''); setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.description || !form.amount || !form.date) {
      setError('Description, amount and date are required.'); return;
    }
    setSaving(true); setError('');
    try {
      const data = {
        ...form,
        amount: parseFloat(form.amount),
        addedBy: auth.currentUser?.email || 'unknown',
        updatedAt: nowISO(),
      };
      if (editId) {
        await updateDoc(doc(db, 'expenses', editId), data);
      } else {
        await addDoc(collection(db, 'expenses'), { ...data, createdAt: nowISO() });
      }
      setShowModal(false); setEditId(null); setForm(emptyForm);
    } catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    try { await deleteDoc(doc(db, 'expenses', id)); setDeleteConfirm(null); }
    catch (e: any) { await alert(e.message || 'Expense could not be deleted.', 'Delete Failed'); }
  };

  // Month options: current + last 5 months
  const monthOptions = Array.from({ length: 6 }, (_, i) => {
    const d = subMonths(new Date(), i);
    return { value: format(d, 'yyyy-MM'), label: format(d, 'MMMM yyyy') };
  });

  const f = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Expenses</h1>
          <p className="text-sm text-gray-500">
            This month: <strong className="text-red-600">{formatCurrency(totalThisMonth)}</strong>
          </p>
        </div>
        <button
          onClick={openAdd}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700"
        >
          <Plus className="w-4 h-4" /> Add Expense
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <div className="text-xs text-gray-400 mb-1 uppercase tracking-wider">Filtered Total</div>
          <div className="text-xl font-bold text-red-600">{formatCurrency(totalFiltered)}</div>
          <div className="text-xs text-gray-400 mt-0.5">{filtered.length} entries</div>
        </div>
        {topCats.slice(0, 3).map(([cat, amt]) => (
          <div key={cat} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <div className="text-xs text-gray-400 mb-1 truncate uppercase tracking-wider">{cat}</div>
            <div className="text-xl font-bold text-gray-800">{formatCurrency(amt)}</div>
            <div className="text-xs text-gray-400 mt-0.5">
              {((amt / totalFiltered) * 100).toFixed(0)}% of total
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={monthFilter}
          onChange={e => setMonthFilter(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All Months</option>
          {monthOptions.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
        <select
          value={catFilter}
          onChange={e => setCatFilter(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All Categories</option>
          {CATEGORIES.map(c => <option key={c}>{c}</option>)}
        </select>
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search description or vendor..."
            className="w-full pl-9 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              {['Date', 'Description', 'Category', 'Vendor', 'Payment', 'Amount', ''].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {filtered.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-12 text-gray-400 text-sm">No expenses found</td></tr>
            ) : filtered.map(e => (
              <tr key={e.id} className="hover:bg-gray-50/50">
                <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{formatDate(e.date)}</td>
                <td className="px-4 py-3">
                  <div className="text-sm font-medium text-gray-900">{e.description}</div>
                  {e.invoiceNo && <div className="text-xs text-gray-400">Inv: {e.invoiceNo}</div>}
                </td>
                <td className="px-4 py-3">
                  <span className="bg-orange-50 text-orange-700 text-xs px-2 py-0.5 rounded-full font-medium">
                    {e.category}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-gray-600">{e.vendor || '—'}</td>
                <td className="px-4 py-3">
                  <span className="bg-gray-100 text-gray-600 text-xs px-2 py-0.5 rounded-full">
                    {e.paymentMethod || 'Cash'}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm font-semibold text-red-600">
                  {formatCurrency(e.amount)}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    <button onClick={() => openEdit(e)} className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-lg">
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button onClick={() => setDeleteConfirm(e.id)} className="p-1.5 text-red-400 hover:bg-red-50 rounded-lg">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
          {filtered.length > 0 && (
            <tfoot className="border-t border-gray-200 bg-gray-50">
              <tr>
                <td colSpan={5} className="px-4 py-3 text-sm font-semibold text-gray-700 text-right">
                  Total ({filtered.length} entries):
                </td>
                <td className="px-4 py-3 text-sm font-bold text-red-600">{formatCurrency(totalFiltered)}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">{editId ? 'Edit Expense' : 'Add Expense'}</h2>
              <button onClick={() => setShowModal(false)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="p-5 space-y-4">
              {error && <div className="bg-red-50 text-red-600 text-sm p-3 rounded-lg">{error}</div>}
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Description *</label>
                  <input value={form.description} onChange={e => f('description', e.target.value)}
                    placeholder="e.g. Monthly electricity bill"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Category</label>
                  <select value={form.category} onChange={e => f('category', e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Amount (Rs.) *</label>
                  <input type="number" value={form.amount} onChange={e => f('amount', e.target.value)}
                    placeholder="0"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Date *</label>
                  <input type="date" value={form.date} onChange={e => f('date', e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Payment Method</label>
                  <select value={form.paymentMethod} onChange={e => f('paymentMethod', e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {['Cash', 'Bank Transfer', 'Cheque', 'Online'].map(m => <option key={m}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Vendor / Payee</label>
                  <input value={form.vendor} onChange={e => f('vendor', e.target.value)}
                    placeholder="Company or person name"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Invoice / Voucher No.</label>
                  <input value={form.invoiceNo} onChange={e => f('invoiceNo', e.target.value)}
                    placeholder="Optional"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
                  <textarea value={form.notes} onChange={e => f('notes', e.target.value)}
                    rows={2} placeholder="Any additional details..."
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
            </div>
            <div className="flex gap-3 px-5 pb-5">
              <button onClick={() => setShowModal(false)} className="flex-1 border border-gray-200 text-gray-600 py-2 rounded-lg text-sm hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={handleSave} disabled={saving}
                className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-60">
                {saving ? 'Saving...' : editId ? 'Update' : 'Add Expense'}
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
            <h2 className="font-semibold text-gray-900 mb-1">Delete Expense?</h2>
            <p className="text-sm text-gray-500 mb-5">This action cannot be undone.</p>
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
