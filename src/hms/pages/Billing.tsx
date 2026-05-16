import { useState, useEffect } from 'react';
import { collection, onSnapshot, addDoc, updateDoc, doc, getDoc } from 'firebase/firestore';
import { db, auth, getNextBillNo } from '../../firebase';
import { formatCurrency, formatDate, today, nowISO } from '../lib/utils';
import { logAudit } from '../lib/audit';
import { Plus, Search, X, Printer, CheckCircle } from 'lucide-react';
import { printBill } from '../lib/pdf';

const PAYMENT_METHODS = ['Cash', 'Card', 'Online Transfer', 'Cheque'];
const ITEM_CATEGORIES = ['Consultation', 'Lab Test', 'Medicine', 'IPD Charges', 'Procedure', 'Other'];

export function Billing() {
  const [bills, setBills] = useState<any[]>([]);
  const [patients, setPatients] = useState<any[]>([]);
  const [hospitalSettings, setHospitalSettings] = useState({ name: 'Al-Fateh Clinic', address: '', phone: '', footerNote: 'Thank you for choosing our hospital.' });
  const [showModal, setShowModal] = useState(false);
  const [viewBill, setViewBill] = useState<any | null>(null);
  const [payBill, setPayBill] = useState<any | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payingSaving, setPayingSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'partial' | 'paid' | 'cancelled' | 'no-show'>('all');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [patientSearch, setPatientSearch] = useState('');

  const [form, setForm] = useState({ patientId: '', patientName: '', patientMRN: '', date: today(), paymentMethod: 'Cash', discount: '0', paid: '0', notes: '' });
  const [items, setItems] = useState<any[]>([]);
  const [newItem, setNewItem] = useState({ description: '', category: 'Consultation', quantity: '1', rate: '' });

  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'bills'), snap =>
      setBills(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a: any, b: any) => b.createdAt > a.createdAt ? 1 : -1))
    );
    const u2 = onSnapshot(collection(db, 'patients'), snap => setPatients(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    getDoc(doc(db, 'settings', 'hospital')).then(snap => {
      if (snap.exists()) setHospitalSettings(s => ({ ...s, ...snap.data() }));
    });
    return () => { u1(); u2(); };
  }, []);

  const filtered = bills.filter(b => {
    const matchStatus = statusFilter === 'all' || b.paymentStatus === statusFilter;
    const matchSearch = !search || b.patientName?.toLowerCase().includes(search.toLowerCase()) || b.billNo?.includes(search);
    return matchStatus && matchSearch;
  });

  const filteredPatients = patients.filter(p => !patientSearch || p.name?.toLowerCase().includes(patientSearch.toLowerCase()) || p.mrn?.includes(patientSearch)).slice(0, 5);

  const subtotal = items.reduce((s, item) => s + item.quantity * item.rate, 0);
  const discount = parseFloat(form.discount || '0');
  const total = Math.max(0, subtotal - discount);
  const paid = parseFloat(form.paid || '0');
  const balance = Math.max(0, total - paid);
  const paymentStatus = paid >= total ? 'paid' : paid > 0 ? 'partial' : 'pending';

  const addItem = () => {
    if (!newItem.description || !newItem.rate) return;
    setItems(p => [...p, { ...newItem, quantity: parseInt(newItem.quantity || '1'), rate: parseFloat(newItem.rate), amount: parseInt(newItem.quantity || '1') * parseFloat(newItem.rate) }]);
    setNewItem({ description: '', category: 'Consultation', quantity: '1', rate: '' });
  };

  const handleSave = async () => {
    if (!form.patientId || items.length === 0) { setError('Patient and at least one item are required.'); return; }
    setSaving(true); setError('');
    try {
      const billNo = await getNextBillNo();
      const ref = await addDoc(collection(db, 'bills'), {
        ...form, billNo, items, subtotal, discount, total, paid, balance, paymentStatus,
        cashierId: auth.currentUser?.uid, cashierName: auth.currentUser?.email,
        createdAt: nowISO(),
      });
      await logAudit('create', 'bill', ref.id, `${billNo} — ${form.patientName} — Rs.${total}`);
      setShowModal(false);
      setItems([]);
      setForm({ patientId: '', patientName: '', patientMRN: '', date: today(), paymentMethod: 'Cash', discount: '0', paid: '0', notes: '' });
    } catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  };

  const handleCollectPayment = async () => {
    if (!payBill || !payAmount) return;
    setPayingSaving(true);
    try {
      const additional = parseFloat(payAmount);
      const newPaid = Math.min((payBill.paid || 0) + additional, payBill.total);
      const newBalance = Math.max(0, payBill.total - newPaid);
      const newStatus = newBalance === 0 ? 'paid' : newPaid > 0 ? 'partial' : 'pending';
      await updateDoc(doc(db, 'bills', payBill.id), { paid: newPaid, balance: newBalance, paymentStatus: newStatus });
      setPayBill(null); setPayAmount('');
    } catch (e: any) { alert(e.message); }
    finally { setPayingSaving(false); }
  };

  const statusBadge = (s: string) => {
    const map: Record<string, string> = {
      paid: 'bg-green-100 text-green-700',
      partial: 'bg-yellow-100 text-yellow-700',
      pending: 'bg-red-100 text-red-700',
      cancelled: 'bg-gray-200 text-gray-500 line-through',
      'no-show': 'bg-orange-100 text-orange-600',
    };
    return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${map[s] || 'bg-gray-100 text-gray-500'}`}>{s}</span>;
  };

  const todayRevenue = bills.filter(b => b.date === today()).reduce((s, b) => s + (b.paid || 0), 0);
  const pendingRevenue = bills.filter(b => b.paymentStatus !== 'paid' && b.paymentStatus !== 'cancelled' && b.paymentStatus !== 'no-show').reduce((s, b) => s + (b.balance || 0), 0);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Billing</h1>
          <p className="text-sm text-gray-500">Today: {formatCurrency(todayRevenue)} collected · {formatCurrency(pendingRevenue)} pending</p>
        </div>
        <button onClick={() => { setForm({ patientId: '', patientName: '', patientMRN: '', date: today(), paymentMethod: 'Cash', discount: '0', paid: '0', notes: '' }); setItems([]); setError(''); setShowModal(true); }}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
          <Plus className="w-4 h-4" /> New Bill
        </button>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex bg-gray-100 rounded-lg p-1 gap-1">
          {(['all', 'pending', 'partial', 'paid', 'cancelled', 'no-show'] as const).map(s => (
            <button key={s} onClick={() => setStatusFilter(s)} className={`px-3 py-1.5 rounded-md text-xs font-medium ${statusFilter === s ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500'}`}>{s}</button>
          ))}
        </div>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search patient or bill number..." className="w-full pl-9 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>{['Bill No.', 'Patient', 'Date', 'Total', 'Paid', 'Balance', 'Status', ''].map(h => (
              <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">{h}</th>
            ))}</tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {filtered.length === 0 ? <tr><td colSpan={8} className="text-center py-12 text-gray-400">No bills found</td></tr>
            : filtered.map(b => (
              <tr key={b.id} className="hover:bg-gray-50/50">
                <td className="px-4 py-3"><span className="font-mono text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded font-medium">{b.billNo}</span></td>
                <td className="px-4 py-3">
                  <div className="text-sm font-medium text-gray-900">{b.patientName}</div>
                  <div className="text-xs text-gray-400">{b.patientMRN}</div>
                </td>
                <td className="px-4 py-3 text-sm text-gray-600">{formatDate(b.date)}</td>
                <td className="px-4 py-3 text-sm font-medium text-gray-900">{formatCurrency(b.total)}</td>
                <td className="px-4 py-3 text-sm text-green-600 font-medium">{formatCurrency(b.paid)}</td>
                <td className="px-4 py-3 text-sm text-red-500 font-medium">{formatCurrency(b.balance)}</td>
                <td className="px-4 py-3">{statusBadge(b.paymentStatus)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    {b.paymentStatus !== 'paid' && b.paymentStatus !== 'cancelled' && b.paymentStatus !== 'no-show' && (
                      <button onClick={() => { setPayBill(b); setPayAmount(''); }} className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg" title="Collect Payment">
                        <CheckCircle className="w-4 h-4" />
                      </button>
                    )}
                    <button onClick={() => setViewBill(b)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg" title="View Receipt"><Printer className="w-4 h-4" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* New Bill Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl w-full max-w-2xl my-4">
            <div className="flex items-center justify-between p-5 border-b border-gray-100 sticky top-0 bg-white rounded-t-2xl z-10">
              <h2 className="font-semibold text-gray-900">Create New Bill</h2>
              <button onClick={() => setShowModal(false)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="p-5 space-y-5">
              {error && <div className="bg-red-50 text-red-600 text-sm p-3 rounded-lg">{error}</div>}

              {/* Patient */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Patient *</label>
                {form.patientId ? (
                  <div className="flex items-center gap-2 border border-green-200 bg-green-50 rounded-lg px-3 py-2">
                    <span className="text-sm font-medium text-green-800 flex-1">{form.patientName} <span className="text-xs font-normal text-green-600">({form.patientMRN})</span></span>
                    <button onClick={() => setForm(p => ({ ...p, patientId: '', patientName: '', patientMRN: '' }))}><X className="w-3.5 h-3.5 text-green-600" /></button>
                  </div>
                ) : (
                  <div className="relative">
                    <input value={patientSearch} onChange={e => setPatientSearch(e.target.value)} placeholder="Search patient..." className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    {patientSearch && filteredPatients.length > 0 && (
                      <div className="absolute top-full left-0 right-0 bg-white border border-gray-200 rounded-lg shadow-lg z-10 mt-1">
                        {filteredPatients.map(p => (
                          <button key={p.id} onClick={() => { setForm(f => ({ ...f, patientId: p.id, patientName: p.name, patientMRN: p.mrn })); setPatientSearch(''); }} className="w-full text-left px-3 py-2.5 hover:bg-blue-50 text-sm border-b last:border-0">
                            <span className="font-medium">{p.name}</span> <span className="text-xs text-gray-400">({p.mrn})</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Bill Date</label>
                  <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Payment Method</label>
                  <select value={form.paymentMethod} onChange={e => setForm(f => ({ ...f, paymentMethod: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {PAYMENT_METHODS.map(m => <option key={m}>{m}</option>)}
                  </select>
                </div>
              </div>

              {/* Add Items */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-2">BILL ITEMS</label>
                <div className="grid grid-cols-12 gap-2 mb-2">
                  <div className="col-span-4">
                    <input value={newItem.description} onChange={e => setNewItem(p => ({ ...p, description: e.target.value }))} placeholder="Description" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div className="col-span-3">
                    <select value={newItem.category} onChange={e => setNewItem(p => ({ ...p, category: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                      {ITEM_CATEGORIES.map(c => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="col-span-2">
                    <input type="number" min="1" value={newItem.quantity} onChange={e => setNewItem(p => ({ ...p, quantity: e.target.value }))} placeholder="Qty" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div className="col-span-2">
                    <input type="number" value={newItem.rate} onChange={e => setNewItem(p => ({ ...p, rate: e.target.value }))} placeholder="Rate" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div className="col-span-1">
                    <button onClick={addItem} className="w-full h-full bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center justify-center"><Plus className="w-4 h-4" /></button>
                  </div>
                </div>

                {items.length > 0 && (
                  <div className="border border-gray-100 rounded-xl overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50"><tr>{['Description', 'Category', 'Qty', 'Rate', 'Amount', ''].map(h => <th key={h} className="px-3 py-2 text-left text-xs font-medium text-gray-500">{h}</th>)}</tr></thead>
                      <tbody className="divide-y divide-gray-50">
                        {items.map((item, i) => (
                          <tr key={i}>
                            <td className="px-3 py-2 font-medium text-gray-800">{item.description}</td>
                            <td className="px-3 py-2 text-gray-500 text-xs">{item.category}</td>
                            <td className="px-3 py-2 text-gray-600">{item.quantity}</td>
                            <td className="px-3 py-2 text-gray-600">{formatCurrency(item.rate)}</td>
                            <td className="px-3 py-2 font-medium text-gray-800">{formatCurrency(item.quantity * item.rate)}</td>
                            <td className="px-3 py-2"><button onClick={() => setItems(p => p.filter((_, ii) => ii !== i))} className="text-red-400 hover:text-red-600"><X className="w-3.5 h-3.5" /></button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Totals */}
              {items.length > 0 && (
                <div className="bg-gray-50 rounded-xl p-4 space-y-2">
                  <div className="flex justify-between text-sm"><span className="text-gray-500">Subtotal</span><span className="font-medium">{formatCurrency(subtotal)}</span></div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-500">Discount (Rs.)</span>
                    <input type="number" value={form.discount} onChange={e => setForm(f => ({ ...f, discount: e.target.value }))} className="w-28 border border-gray-200 rounded-lg px-2 py-1 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div className="flex justify-between text-base font-bold border-t border-gray-200 pt-2">
                    <span>Total</span><span>{formatCurrency(total)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-500">Amount Paid (Rs.)</span>
                    <input type="number" value={form.paid} onChange={e => setForm(f => ({ ...f, paid: e.target.value }))} className="w-28 border border-gray-200 rounded-lg px-2 py-1 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div className="flex justify-between text-sm font-semibold text-red-600">
                    <span>Balance Due</span><span>{formatCurrency(balance)}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <CheckCircle className={`w-3.5 h-3.5 ${paymentStatus === 'paid' ? 'text-green-500' : paymentStatus === 'partial' ? 'text-yellow-500' : 'text-red-500'}`} />
                    <span className={`font-medium ${paymentStatus === 'paid' ? 'text-green-600' : paymentStatus === 'partial' ? 'text-yellow-600' : 'text-red-500'}`}>Status: {paymentStatus}</span>
                  </div>
                </div>
              )}
            </div>
            <div className="flex gap-3 px-5 pb-5">
              <button onClick={() => setShowModal(false)} className="flex-1 border border-gray-200 text-gray-600 py-2 rounded-lg text-sm">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm disabled:opacity-60">{saving ? 'Saving...' : 'Save Bill'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Collect Payment Modal */}
      {payBill && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">Collect Payment</h2>
              <button onClick={() => setPayBill(null)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-gray-500">Patient</span><span className="font-medium">{payBill.patientName}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Bill No.</span><span className="font-mono text-blue-600 font-medium">{payBill.billNo}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Total Bill</span><span className="font-medium">{formatCurrency(payBill.total)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Already Paid</span><span className="text-green-600 font-medium">{formatCurrency(payBill.paid || 0)}</span></div>
                <div className="flex justify-between font-semibold text-red-600 border-t border-gray-200 pt-2"><span>Balance Due</span><span>{formatCurrency(payBill.balance || payBill.total)}</span></div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Amount to Collect (Rs.)</label>
                <input type="number" value={payAmount} onChange={e => setPayAmount(e.target.value)}
                  max={payBill.balance || payBill.total} placeholder={`Max: ${payBill.balance || payBill.total}`}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 text-center text-lg font-bold" />
              </div>
              {payAmount && (
                <div className="bg-green-50 rounded-lg p-3 text-sm text-center">
                  <span className="text-green-600">New Balance: </span>
                  <span className="font-bold text-green-800">{formatCurrency(Math.max(0, (payBill.balance || payBill.total) - parseFloat(payAmount)))}</span>
                </div>
              )}
            </div>
            <div className="flex gap-3 px-5 pb-5">
              <button onClick={() => setPayBill(null)} className="flex-1 border border-gray-200 text-gray-600 py-2 rounded-lg text-sm">Cancel</button>
              <button onClick={handleCollectPayment} disabled={!payAmount || payingSaving}
                className="flex-1 bg-green-600 text-white py-2 rounded-lg text-sm hover:bg-green-700 disabled:opacity-60">
                {payingSaving ? 'Saving...' : 'Confirm Payment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Receipt Modal */}
      {viewBill && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-gray-100 print:hidden">
              <h2 className="font-semibold text-gray-900">Receipt</h2>
              <div className="flex items-center gap-2">
                <button onClick={() => printBill({
                  hospitalName: hospitalSettings.name,
                  hospitalAddress: hospitalSettings.address,
                  hospitalPhone: hospitalSettings.phone,
                  hospitalFooter: (hospitalSettings as any).footerNote,
                  billNo: viewBill.billNo, date: formatDate(viewBill.date),
                  patientName: viewBill.patientName, patientMRN: viewBill.patientMRN,
                  paymentMethod: viewBill.paymentMethod,
                  items: viewBill.items || [],
                  subtotal: viewBill.subtotal, discount: viewBill.discount,
                  total: viewBill.total, paid: viewBill.paid,
                  balance: viewBill.balance, paymentStatus: viewBill.paymentStatus,
                })} className="flex items-center gap-1.5 text-sm border border-gray-200 px-3 py-1.5 rounded-lg text-gray-500 hover:bg-gray-50">
                  <Printer className="w-4 h-4" /> Print PDF
                </button>
                <button onClick={() => setViewBill(null)}><X className="w-5 h-5 text-gray-400" /></button>
              </div>
            </div>
            <div className="p-5 space-y-4">
              <div className="text-center border-b pb-4">
                <h3 className="text-lg font-bold text-gray-900">{hospitalSettings.name}</h3>
                {hospitalSettings.address && <p className="text-xs text-gray-400">{hospitalSettings.address}</p>}
                {hospitalSettings.phone && <p className="text-xs text-gray-400">{hospitalSettings.phone}</p>}
                <div className="mt-2 font-mono text-sm font-bold text-blue-600">{viewBill.billNo}</div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                {[['Patient', viewBill.patientName], ['MRN', viewBill.patientMRN], ['Date', formatDate(viewBill.date)], ['Payment', viewBill.paymentMethod]].map(([l, v]) => (
                  <div key={l as string}><span className="text-xs text-gray-400 block">{l}</span><span className="font-medium text-gray-800">{v}</span></div>
                ))}
              </div>
              <div>
                <div className="text-xs font-semibold text-gray-500 mb-2">ITEMS</div>
                <table className="w-full text-sm">
                  <thead className="text-xs text-gray-400"><tr><th className="text-left pb-1">Description</th><th className="text-right pb-1">Qty</th><th className="text-right pb-1">Rate</th><th className="text-right pb-1">Amount</th></tr></thead>
                  <tbody className="divide-y divide-gray-50">
                    {viewBill.items?.map((item: any, i: number) => (
                      <tr key={i}><td className="py-1.5">{item.description}</td><td className="text-right py-1.5">{item.quantity}</td><td className="text-right py-1.5">{formatCurrency(item.rate)}</td><td className="text-right py-1.5 font-medium">{formatCurrency(item.quantity * item.rate)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="border-t pt-3 space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-gray-500">Subtotal</span><span>{formatCurrency(viewBill.subtotal)}</span></div>
                {viewBill.discount > 0 && <div className="flex justify-between text-green-600"><span>Discount</span><span>- {formatCurrency(viewBill.discount)}</span></div>}
                <div className="flex justify-between font-bold text-base"><span>Total</span><span>{formatCurrency(viewBill.total)}</span></div>
                <div className="flex justify-between text-green-600"><span>Paid</span><span>{formatCurrency(viewBill.paid)}</span></div>
                <div className="flex justify-between text-red-500 font-semibold"><span>Balance</span><span>{formatCurrency(viewBill.balance)}</span></div>
              </div>
              <div className="text-center pt-2 border-t">
                {statusBadge(viewBill.paymentStatus)}
                {hospitalSettings.footerNote && (
                  <p className="text-xs text-gray-400 mt-2">{hospitalSettings.footerNote}</p>
                )}
              </div>
            </div>
            <div className="px-5 pb-5"><button onClick={() => setViewBill(null)} className="w-full border border-gray-200 text-gray-600 py-2 rounded-lg text-sm">Close</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
