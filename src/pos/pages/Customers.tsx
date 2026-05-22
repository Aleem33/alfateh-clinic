import React, { useState, useEffect } from 'react';
import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc,
  doc, increment, query, orderBy, getDocs, where
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { formatCurrency } from '../lib/utils';
import { printOrShare } from '../lib/nativeUtils';
import { getSaleReceiptLabel, getSaleReceiptNo } from '../lib/receiptNumbers';
import {
  Plus, Edit2, Trash2, Search, ChevronDown, ChevronUp,
  Eye, X, Wallet, CheckCircle, Clock, CreditCard, Receipt, Printer
} from 'lucide-react';
import { format } from 'date-fns';

export function Customers() {
  const [customers, setCustomers]       = useState<any[]>([]);
  const [sales, setSales]               = useState<any[]>([]);
  const [payments, setPayments]         = useState<any[]>([]);
  const [search, setSearch]             = useState('');
  const [isModalOpen, setIsModalOpen]   = useState(false);
  const [editingId, setEditingId]       = useState<string | null>(null);
  const [expandedId, setExpandedId]     = useState<string | null>(null);
  const [selectedSale, setSelectedSale] = useState<any | null>(null);
  const [successMsg, setSuccessMsg]     = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [paymentModal, setPaymentModal]     = useState<any | null>(null);
  const [paymentAmount, setPaymentAmount]   = useState('');
  const [paymentNote, setPaymentNote]       = useState('');
  const [paymentLoading, setPaymentLoading] = useState(false);

  const [formData, setFormData] = useState({ name: '', phone: '', creditBalance: '0' });

  useEffect(() => {
    const unsub1 = onSnapshot(collection(db, 'customers'), snap => {
      setCustomers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, err => handleFirestoreError(err, OperationType.GET, 'customers'));
    const unsub2 = onSnapshot(collection(db, 'sales'), snap => {
      setSales(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, err => handleFirestoreError(err, OperationType.GET, 'sales'));
    const unsub3 = onSnapshot(
      query(collection(db, 'customerPayments'), orderBy('date', 'desc')),
      snap => setPayments(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      err => handleFirestoreError(err, OperationType.GET, 'customerPayments')
    );
    return () => { unsub1(); unsub2(); unsub3(); };
  }, []);

  const filteredCustomers = customers.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.phone || '').includes(search)
  );

  const customerSales = (customerId: string) =>
    sales.filter(s => s.customerId === customerId)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const customerPayments = (customerId: string) =>
    payments.filter(p => p.customerId === customerId);

  const totalPending = filteredCustomers.reduce((sum, c) => sum + (c.creditBalance || 0), 0);

  const handleRecordPayment = async () => {
    if (!paymentModal) return;
    const amount = parseFloat(paymentAmount);
    if (!amount || amount <= 0) return;
    const maxPayable = paymentModal.creditBalance || 0;
    if (amount > maxPayable) return;
    setPaymentLoading(true);
    try {
      await addDoc(collection(db, 'customerPayments'), {
        customerId: paymentModal.id, customerName: paymentModal.name,
        amount, note: paymentNote || '', date: new Date().toISOString(),
      });
      await updateDoc(doc(db, 'customers', paymentModal.id), { creditBalance: increment(-amount) });

      // Clear pendingAmount on sales for this customer, oldest-due-first
      let remaining = amount;
      const dueSales = customerSales(paymentModal.id)
        .filter(s => (s.pendingAmount || 0) > 0)
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()); // oldest first

      for (const sale of dueSales) {
        if (remaining <= 0) break;
        const due = sale.pendingAmount || 0;
        if (remaining >= due) {
          // This sale is fully cleared
          await updateDoc(doc(db, 'sales', sale.id), {
            pendingAmount: 0,
            amountPaid: sale.total,
          });
          remaining -= due;
        } else {
          // Partially cleared
          await updateDoc(doc(db, 'sales', sale.id), {
            pendingAmount: due - remaining,
            amountPaid: (sale.amountPaid || 0) + remaining,
          });
          remaining = 0;
        }
      }

      const remainingBalance = maxPayable - amount;
      setPaymentModal(null); setPaymentAmount(''); setPaymentNote('');
      setSuccessMsg(remainingBalance <= 0
        ? `${paymentModal.name}'s balance fully cleared!`
        : `Rs. ${amount.toFixed(2)} recorded. Remaining: ${formatCurrency(remainingBalance)}`);
      setTimeout(() => setSuccessMsg(''), 5000);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'customerPayments');
    } finally { setPaymentLoading(false); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const data = { name: formData.name, phone: formData.phone, creditBalance: Number(formData.creditBalance) };
      if (editingId) {
        await updateDoc(doc(db, 'customers', editingId), data);
        // Propagate name/phone change to all sales that reference this customer
        const salesSnap = await getDocs(query(collection(db, 'sales'), where('customerId', '==', editingId)));
        await Promise.all(salesSnap.docs.map(d =>
          updateDoc(d.ref, { customerName: formData.name, customerPhone: formData.phone })
        ));
      } else {
        await addDoc(collection(db, 'customers'), { ...data, createdAt: new Date().toISOString() });
      }
      setIsModalOpen(false); setEditingId(null);
      setFormData({ name: '', phone: '', creditBalance: '0' });
    } catch (error) {
      handleFirestoreError(error, editingId ? OperationType.UPDATE : OperationType.CREATE, 'customers');
    }
  };

  const handleEdit = (cust: any) => {
    setFormData({ name: cust.name, phone: cust.phone || '', creditBalance: String(cust.creditBalance || 0) });
    setEditingId(cust.id); setIsModalOpen(true);
  };

  const confirmDelete = async () => {
    if (!confirmDeleteId) return;
    try { await deleteDoc(doc(db, 'customers', confirmDeleteId)); }
    catch (error) { handleFirestoreError(error, OperationType.DELETE, `customers/${confirmDeleteId}`); }
    finally { setConfirmDeleteId(null); }
  };

  const handlePrintAllBills = (cust: any) => {
    const custSales = customerSales(cust.id);
    if (custSales.length === 0) return;

    const totalBilled  = custSales.reduce((s, r) => s + (r.total || 0), 0);
    const totalPaidAmt = custSales.reduce((s, r) => s + (r.amountPaid ?? r.total ?? 0), 0);
    const totalPending = custSales.reduce((s, r) => s + (r.pendingAmount || 0), 0);

    const rows = custSales.map((sale) => {
      const itemLines = (sale.items || []).map((item: any) =>
        `<tr>
          <td style="padding:3px 6px;color:#555;font-size:11px;">${item.name}</td>
          <td style="padding:3px 6px;text-align:center;font-size:11px;">${item.quantity} ${item.sellType}</td>
          <td style="padding:3px 6px;text-align:right;font-size:11px;">Rs.${(item.total||0).toFixed(2)}</td>
        </tr>`
      ).join('');

      const pending = sale.pendingAmount || 0;
      return `
        <div style="margin-bottom:14px;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;">
          <div style="background:#f3f4f6;padding:7px 10px;display:flex;justify-content:space-between;align-items:center;">
            <span style="font-weight:700;font-size:12px;color:#374151;">Receipt #${getSaleReceiptNo(sale)} &nbsp;-&nbsp; ${sale.date ? new Date(sale.date).toLocaleDateString('en-PK') : 'N/A'}</span>
            ${pending > 0
              ? `<span style="background:#fee2e2;color:#dc2626;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:700;">DUE Rs.${pending.toFixed(2)}</span>`
              : `<span style="background:#dcfce7;color:#16a34a;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:700;">✓ PAID</span>`
            }
          </div>
          <table style="width:100%;border-collapse:collapse;">
            <thead><tr style="background:#f9fafb;">
              <th style="padding:4px 6px;text-align:left;font-size:10px;color:#6b7280;">ITEM</th>
              <th style="padding:4px 6px;text-align:center;font-size:10px;color:#6b7280;">QTY</th>
              <th style="padding:4px 6px;text-align:right;font-size:10px;color:#6b7280;">AMOUNT</th>
            </tr></thead>
            <tbody>${itemLines}</tbody>
          </table>
          <div style="padding:5px 10px;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between;font-size:11px;">
            <span style="color:#6b7280;">Total: <b>Rs.${(sale.total||0).toFixed(2)}</b></span>
            <span style="color:#16a34a;">Paid: <b>Rs.${(sale.amountPaid ?? sale.total ?? 0).toFixed(2)}</b></span>
            ${pending > 0 ? `<span style="color:#dc2626;">Due: <b>Rs.${pending.toFixed(2)}</b></span>` : ''}
          </div>
        </div>`;
    }).join('');

    const html = `
      <div style="font-family:monospace;max-width:320px;margin:0 auto;padding:8px;">
        <div style="text-align:center;margin-bottom:12px;border-bottom:2px solid #111;padding-bottom:8px;">
          <h2 style="margin:0;font-size:16px;">AL-FATEH PHARMACY POS</h2>
          <p style="margin:4px 0 0;font-size:13px;font-weight:700;">${cust.name}</p>
          ${cust.phone ? `<p style="margin:2px 0 0;font-size:11px;color:#555;">${cust.phone}</p>` : ''}
          <p style="margin:2px 0 0;font-size:10px;color:#888;">Printed: ${new Date().toLocaleString('en-PK')}</p>
        </div>
        ${rows}
        <div style="border-top:2px solid #111;padding-top:8px;margin-top:4px;">
          <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px;">
            <span>Total Billed:</span><b>Rs.${totalBilled.toFixed(2)}</b>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px;color:#16a34a;">
            <span>Total Paid:</span><b>Rs.${totalPaidAmt.toFixed(2)}</b>
          </div>
          ${totalPending > 0
            ? `<div style="display:flex;justify-content:space-between;font-size:13px;font-weight:700;color:#dc2626;background:#fee2e2;padding:5px 8px;border-radius:4px;margin-top:4px;">
                <span>OUTSTANDING:</span><span>Rs.${totalPending.toFixed(2)}</span>
               </div>`
            : `<div style="text-align:center;font-size:12px;font-weight:700;color:#16a34a;background:#dcfce7;padding:5px;border-radius:4px;margin-top:4px;">✓ ALL CLEAR</div>`
          }
        </div>
      </div>`;

    printOrShare(html, `${cust.name.replace(/\s+/g,'-')}-bills.html`);
  };

  const payAmount  = parseFloat(paymentAmount) || 0;
  const maxPayable = paymentModal?.creditBalance || 0;
  const isPayValid = payAmount > 0 && payAmount <= maxPayable;
  const willClear  = payAmount === maxPayable;

  return (
    <div className="space-y-4 md:space-y-6">

      {/* Success toast */}
      {successMsg && (
        <div className="fixed top-4 right-4 bg-green-600 text-white px-5 py-3 rounded-lg shadow-lg z-50 flex items-center gap-2 max-w-xs">
          <CheckCircle className="w-5 h-5 shrink-0" /> {successMsg}
        </div>
      )}

      {/* Confirm delete modal */}
      {confirmDeleteId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full">
            <h3 className="text-lg font-bold text-gray-900 mb-2">Delete Customer</h3>
            <p className="text-gray-600 mb-6">Are you sure you want to delete this customer?</p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setConfirmDeleteId(null)} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">Cancel</button>
              <button onClick={confirmDelete} className="px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700">Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex justify-between items-start gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-900">Customers</h1>
          {totalPending > 0 && (
            <p className="text-sm text-red-600 mt-0.5 font-medium">
              Total outstanding: {formatCurrency(totalPending)}
            </p>
          )}
        </div>
        <button
          onClick={() => { setEditingId(null); setFormData({ name: '', phone: '', creditBalance: '0' }); setIsModalOpen(true); }}
          className="bg-blue-600 text-white px-3 py-2 md:px-4 rounded-lg flex items-center gap-2 hover:bg-blue-700 text-sm font-medium shrink-0"
        >
          <Plus className="w-4 h-4" /> <span className="hidden sm:inline">Add Customer</span><span className="sm:hidden">Add</span>
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-4 border-b border-gray-100">
          <div className="relative">
            <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="text" placeholder="Search by name or phone..."
              value={search} onChange={e => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>

        <div className="divide-y divide-gray-100">
          {filteredCustomers.map(cust => {
            const custSales    = customerSales(cust.id);
            const custPayments = customerPayments(cust.id);
            const isExpanded   = expandedId === cust.id;

            return (
              <div key={cust.id}>
                {/* Customer row */}
                <div className="p-4 hover:bg-gray-50">
                  {/* Top row: expand + name + actions */}
                  <div className="flex items-center gap-2">
                    <button onClick={() => setExpandedId(isExpanded ? null : cust.id)}
                      className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded shrink-0">
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>

                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-900">{cust.name}</p>
                      <p className="text-sm text-gray-500">{cust.phone}</p>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {(cust.creditBalance || 0) > 0 && (
                        <button
                          onClick={() => { setPaymentModal(cust); setPaymentAmount(''); setPaymentNote(''); }}
                          className="flex items-center gap-1 px-2.5 py-1.5 bg-green-600 text-white rounded-lg text-xs font-semibold hover:bg-green-700"
                        >
                          <Wallet className="w-3.5 h-3.5" /> Pay
                        </button>
                      )}
                      {customerSales(cust.id).length > 0 && (
                        <button
                          onClick={() => handlePrintAllBills(cust)}
                          className="flex items-center gap-1 px-2.5 py-1.5 bg-purple-600 text-white rounded-lg text-xs font-semibold hover:bg-purple-700"
                          title="Print all bills"
                        >
                          <Printer className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Print</span>
                        </button>
                      )}
                      <button onClick={() => handleEdit(cust)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded">
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button onClick={() => setConfirmDeleteId(cust.id)} className="p-1.5 text-red-600 hover:bg-red-50 rounded">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Stats row */}
                  <div className="mt-2 ml-8 flex flex-wrap gap-x-4 gap-y-1">
                    <div>
                      <span className="text-xs text-gray-400">Balance: </span>
                      <span className={`text-xs font-bold ${(cust.creditBalance || 0) > 0 ? 'text-red-600' : 'text-green-600'}`}>
                        {(cust.creditBalance || 0) > 0 ? formatCurrency(cust.creditBalance) : '✓ Clear'}
                      </span>
                    </div>
                    <div>
                      <span className="text-xs text-gray-400">Sales: </span>
                      <span className="text-xs font-medium text-gray-700">{custSales.length}</span>
                    </div>
                    <div>
                      <span className="text-xs text-gray-400">Since: </span>
                      <span className="text-xs text-gray-600">
                        {cust.createdAt ? format(new Date(cust.createdAt), 'MMM dd, yyyy') : 'N/A'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Expanded panel */}
                {isExpanded && (
                  <div className="bg-blue-50 border-t border-blue-100 px-4 py-4 space-y-5">

                    {/* Sale history header */}
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-bold text-blue-800">Sale History</h3>
                      {(cust.creditBalance || 0) > 0 && (
                        <span className="text-xs font-bold text-red-700 bg-red-100 px-2 py-1 rounded-full">
                          Outstanding: {formatCurrency(cust.creditBalance)}
                        </span>
                      )}
                    </div>

                    {custSales.length === 0 ? (
                      <p className="text-sm text-blue-400 italic">No sales recorded yet.</p>
                    ) : (
                      <>
                        {/* ── Mobile: cards ── */}
                        <div className="space-y-2 md:hidden">
                          {custSales.map(sale => (
                            <div key={sale.id} className="bg-white rounded-lg border border-blue-100 p-3">
                              <div className="flex items-start justify-between gap-2 mb-2">
                                <div>
                                  <p className="text-xs font-semibold text-gray-700">
                                    {sale.date ? format(new Date(sale.date), 'MMM dd, yyyy') : 'N/A'}
                                  </p>
                                  <p className="text-xs text-blue-500 font-mono">{getSaleReceiptLabel(sale)}</p>
                                  <p className="text-xs text-gray-400">{sale.items?.length || 0} item(s)</p>
                                </div>
                                <button onClick={() => setSelectedSale(sale)}
                                  className="flex items-center gap-1 text-blue-600 text-xs font-medium">
                                  <Eye className="w-3.5 h-3.5" /> View
                                </button>
                              </div>
                              <div className="grid grid-cols-3 gap-2 text-center">
                                <div className="bg-gray-50 rounded p-1.5">
                                  <p className="text-[10px] text-gray-400">Total</p>
                                  <p className="text-xs font-bold text-gray-900">{formatCurrency(sale.total)}</p>
                                </div>
                                <div className="bg-green-50 rounded p-1.5">
                                  <p className="text-[10px] text-gray-400">Paid</p>
                                  <p className="text-xs font-bold text-green-700">{formatCurrency(sale.amountPaid ?? sale.total)}</p>
                                </div>
                                <div className={`rounded p-1.5 ${(sale.pendingAmount || 0) > 0 ? 'bg-red-50' : 'bg-gray-50'}`}>
                                  <p className="text-[10px] text-gray-400">Pending</p>
                                  <p className={`text-xs font-bold ${(sale.pendingAmount || 0) > 0 ? 'text-red-600' : 'text-green-600'}`}>
                                    {(sale.pendingAmount || 0) > 0 ? formatCurrency(sale.pendingAmount) : '✓'}
                                  </p>
                                </div>
                              </div>
                            </div>
                          ))}
                          {/* Mobile totals */}
                          <div className="bg-blue-100 rounded-lg p-3 grid grid-cols-3 gap-2 text-center">
                            <div>
                              <p className="text-[10px] text-blue-600 font-semibold">TOTAL</p>
                              <p className="text-xs font-bold text-blue-900">{formatCurrency(custSales.reduce((s, r) => s + (r.total || 0), 0))}</p>
                            </div>
                            <div>
                              <p className="text-[10px] text-green-600 font-semibold">PAID</p>
                              <p className="text-xs font-bold text-green-800">{formatCurrency(custSales.reduce((s, r) => s + (r.amountPaid ?? r.total ?? 0), 0))}</p>
                            </div>
                            <div>
                              <p className="text-[10px] text-red-600 font-semibold">PENDING</p>
                              <p className="text-xs font-bold text-red-800">{formatCurrency(custSales.reduce((s, r) => s + (r.pendingAmount || 0), 0))}</p>
                            </div>
                          </div>
                        </div>

                        {/* ── Desktop: table ── */}
                        <div className="hidden md:block rounded-lg overflow-hidden border border-blue-200 bg-white">
                          <table className="w-full text-left text-sm border-collapse">
                            <thead>
                              <tr className="bg-blue-100 text-blue-700 text-xs font-semibold uppercase tracking-wider">
                                <th className="p-3">Date</th>
                                <th className="p-3">Receipt No</th>
                                <th className="p-3">Items</th>
                                <th className="p-3 text-right">Total</th>
                                <th className="p-3 text-right">Paid</th>
                                <th className="p-3 text-right">Pending</th>
                                <th className="p-3 text-right">Details</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {custSales.map(sale => (
                                <tr key={sale.id} className="hover:bg-blue-50">
                                  <td className="p-3 text-gray-700 whitespace-nowrap">
                                    {sale.date ? format(new Date(sale.date), 'MMM dd, yyyy HH:mm') : 'N/A'}
                                  </td>
                                  <td className="p-3 text-gray-500 font-mono text-xs">{getSaleReceiptNo(sale)}</td>
                                  <td className="p-3 text-gray-600">{sale.items?.length || 0} item(s)</td>
                                  <td className="p-3 text-right font-semibold text-gray-900">{formatCurrency(sale.total)}</td>
                                  <td className="p-3 text-right text-green-700 font-medium">{formatCurrency(sale.amountPaid ?? sale.total)}</td>
                                  <td className="p-3 text-right">
                                    {(sale.pendingAmount || 0) > 0
                                      ? <span className="font-bold text-red-600">{formatCurrency(sale.pendingAmount)}</span>
                                      : <span className="text-green-600 text-xs font-medium">✓ Paid</span>}
                                  </td>
                                  <td className="p-3 text-right">
                                    <button onClick={() => setSelectedSale(sale)}
                                      className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 text-xs font-medium">
                                      <Eye className="w-3.5 h-3.5" /> View
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              <tr className="bg-blue-50 border-t-2 border-blue-200 text-xs font-bold">
                                <td className="p-3 text-blue-800" colSpan={3}>TOTAL — {custSales.length} sale(s)</td>
                                <td className="p-3 text-right text-blue-900">{formatCurrency(custSales.reduce((s, r) => s + (r.total || 0), 0))}</td>
                                <td className="p-3 text-right text-green-700">{formatCurrency(custSales.reduce((s, r) => s + (r.amountPaid ?? r.total ?? 0), 0))}</td>
                                <td className="p-3 text-right text-red-600">{formatCurrency(custSales.reduce((s, r) => s + (r.pendingAmount || 0), 0))}</td>
                                <td className="p-3"></td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      </>
                    )}

                    {/* Payment history */}
                    {custPayments.length > 0 && (
                      <div>
                        <h3 className="text-sm font-bold text-green-800 mb-3 flex items-center gap-2">
                          <CreditCard className="w-4 h-4" /> Payment History
                        </h3>

                        {/* Mobile: cards */}
                        <div className="space-y-2 md:hidden">
                          {custPayments.map(p => (
                            <div key={p.id} className="bg-white rounded-lg border border-green-100 p-3 flex items-center justify-between gap-2">
                              <div>
                                <div className="flex items-center gap-1 text-xs text-gray-500">
                                  <Clock className="w-3 h-3" />
                                  {p.date ? format(new Date(p.date), 'MMM dd, yyyy HH:mm') : 'N/A'}
                                </div>
                                {p.note && <p className="text-xs text-gray-400 italic mt-0.5">{p.note}</p>}
                              </div>
                              <span className="font-bold text-green-700 text-sm shrink-0">+{formatCurrency(p.amount)}</span>
                            </div>
                          ))}
                          <div className="bg-green-100 rounded-lg p-3 flex justify-between items-center">
                            <span className="text-xs font-bold text-green-800">TOTAL RECEIVED</span>
                            <span className="text-sm font-bold text-green-700">{formatCurrency(custPayments.reduce((s, p) => s + (p.amount || 0), 0))}</span>
                          </div>
                        </div>

                        {/* Desktop: table */}
                        <div className="hidden md:block rounded-lg overflow-hidden border border-green-200 bg-white">
                          <table className="w-full text-left text-sm border-collapse">
                            <thead>
                              <tr className="bg-green-50 text-green-700 text-xs font-semibold uppercase tracking-wider">
                                <th className="p-3">Date & Time</th>
                                <th className="p-3 text-right">Amount Paid</th>
                                <th className="p-3">Note</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {custPayments.map(p => (
                                <tr key={p.id} className="hover:bg-green-50">
                                  <td className="p-3 text-gray-700 whitespace-nowrap">
                                    <div className="flex items-center gap-1.5">
                                      <Clock className="w-3.5 h-3.5 text-gray-400" />
                                      {p.date ? format(new Date(p.date), 'MMM dd, yyyy HH:mm') : 'N/A'}
                                    </div>
                                  </td>
                                  <td className="p-3 text-right font-bold text-green-700">+{formatCurrency(p.amount)}</td>
                                  <td className="p-3 text-gray-500 text-xs italic">{p.note || '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              <tr className="bg-green-50 border-t-2 border-green-200 text-xs font-bold">
                                <td className="p-3 text-green-800">TOTAL RECEIVED</td>
                                <td className="p-3 text-right text-green-700">{formatCurrency(custPayments.reduce((s, p) => s + (p.amount || 0), 0))}</td>
                                <td className="p-3"></td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {filteredCustomers.length === 0 && (
            <div className="p-8 text-center text-gray-500">No customers found.</div>
          )}
        </div>
      </div>

      {/* ── Record Payment Modal ── */}
      {paymentModal && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4 z-50">
          <div className="bg-white rounded-t-2xl sm:rounded-xl shadow-xl w-full sm:max-w-md overflow-hidden">
            <div className="p-5 border-b border-gray-100 flex justify-between items-start">
              <div>
                <h2 className="text-xl font-bold text-gray-900">Record Payment</h2>
                <p className="text-sm text-gray-500 mt-0.5">{paymentModal.name} • {paymentModal.phone}</p>
              </div>
              <button onClick={() => setPaymentModal(null)} className="p-1 text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="bg-red-50 border border-red-100 rounded-lg p-4 flex justify-between items-center">
                <span className="text-sm font-medium text-red-800">Outstanding Balance</span>
                <span className="text-xl font-bold text-red-700">{formatCurrency(maxPayable)}</span>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Amount Received (Rs.)</label>
                <input type="number" min="1" max={maxPayable} value={paymentAmount}
                  onChange={e => setPaymentAmount(e.target.value)}
                  placeholder={`Max: ${maxPayable}`} autoFocus
                  className="w-full p-3 border border-gray-300 rounded-lg focus:ring-green-500 focus:border-green-500 text-lg font-semibold" />
                <div className="flex gap-2 mt-2">
                  <button onClick={() => setPaymentAmount(String(maxPayable))}
                    className="flex-1 py-2 text-xs font-semibold border border-green-300 text-green-700 rounded-md hover:bg-green-50">
                    Full ({formatCurrency(maxPayable)})
                  </button>
                  {maxPayable >= 2 && (
                    <button onClick={() => setPaymentAmount(String(Math.floor(maxPayable / 2)))}
                      className="flex-1 py-2 text-xs font-semibold border border-gray-200 text-gray-600 rounded-md hover:bg-gray-50">
                      Half ({formatCurrency(Math.floor(maxPayable / 2))})
                    </button>
                  )}
                </div>
                {payAmount > maxPayable && <p className="text-xs text-red-600 mt-1">Cannot exceed outstanding balance.</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Note (optional)</label>
                <input type="text" value={paymentNote} onChange={e => setPaymentNote(e.target.value)}
                  placeholder="e.g. Cash received, bank transfer..."
                  className="w-full p-2 border border-gray-300 rounded-lg text-sm" />
              </div>
              {isPayValid && (
                <div className={`rounded-lg p-3 border ${willClear ? 'bg-green-50 border-green-200' : 'bg-blue-50 border-blue-200'}`}>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Amount being paid:</span>
                    <span className="font-bold text-green-700">+{formatCurrency(payAmount)}</span>
                  </div>
                  <div className="flex justify-between text-sm mt-1">
                    <span className="text-gray-600">Remaining after payment:</span>
                    <span className={`font-bold ${willClear ? 'text-green-700' : 'text-red-600'}`}>
                      {willClear ? '✓ Fully Cleared' : formatCurrency(maxPayable - payAmount)}
                    </span>
                  </div>
                </div>
              )}
              <div className="flex gap-3 pt-1">
                <button onClick={() => setPaymentModal(null)}
                  className="flex-1 py-2.5 text-gray-700 border border-gray-200 rounded-lg font-medium text-sm hover:bg-gray-50">Cancel</button>
                <button onClick={handleRecordPayment} disabled={!isPayValid || paymentLoading}
                  className="flex-1 py-2.5 bg-green-600 text-white rounded-lg font-medium text-sm hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2">
                  <Wallet className="w-4 h-4" />
                  {paymentLoading ? 'Saving…' : 'Record Payment'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Add / Edit Customer Modal ── */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4 z-50">
          <div className="bg-white rounded-t-2xl sm:rounded-xl shadow-xl w-full sm:max-w-md overflow-hidden">
            <div className="p-5 border-b border-gray-100 flex justify-between items-center">
              <h2 className="text-xl font-bold text-gray-900">{editingId ? 'Edit Customer' : 'Add Customer'}</h2>
              <button onClick={() => setIsModalOpen(false)} className="p-1 text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <input required type="text" value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number</label>
                <input required type="text" value={formData.phone}
                  onChange={e => setFormData({ ...formData, phone: e.target.value })}
                  className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Outstanding Balance</label>
                <input required type="number" step="0.01" min="0" value={formData.creditBalance}
                  onChange={e => setFormData({ ...formData, creditBalance: e.target.value })}
                  className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500" />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setIsModalOpen(false)}
                  className="flex-1 py-2.5 text-gray-700 border border-gray-200 rounded-lg font-medium hover:bg-gray-50">Cancel</button>
                <button type="submit"
                  className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700">
                  {editingId ? 'Save Changes' : 'Add Customer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Sale Detail Modal ── */}
      {selectedSale && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4 z-50">
          <div className="bg-white rounded-t-2xl sm:rounded-xl shadow-xl w-full sm:max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-4 border-b border-gray-100 flex justify-between items-start bg-gray-50 shrink-0">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Sale Details</h2>
                <p className="text-sm text-gray-500 mt-0.5">
                  {selectedSale.date ? format(new Date(selectedSale.date), 'MMM dd, yyyy HH:mm') : 'N/A'}
                  {' '}- {getSaleReceiptLabel(selectedSale)}
                </p>
              </div>
              <button onClick={() => setSelectedSale(null)}
                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded-full">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="overflow-y-auto flex-1 p-4 space-y-2">
              {selectedSale.items?.map((item: any, i: number) => (
                <div key={i} className="flex items-center justify-between gap-2 py-2 border-b border-gray-100 last:border-0">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 text-sm">{item.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${item.sellType === 'box' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
                        {item.sellType}
                      </span>
                      <span className="text-xs text-gray-400">{formatCurrency(item.price)} × {item.quantity}</span>
                      {item.itemDiscount > 0 && <span className="text-xs text-orange-600">-{formatCurrency(item.itemDiscount)}</span>}
                    </div>
                  </div>
                  <span className="font-semibold text-gray-900 text-sm shrink-0">{formatCurrency(item.total)}</span>
                </div>
              ))}
            </div>
            <div className="p-4 border-t border-gray-100 bg-gray-50 shrink-0 space-y-1.5">
              <div className="flex justify-between text-sm text-gray-600">
                <span>Subtotal</span><span>{formatCurrency(selectedSale.grossSubtotal || selectedSale.subtotal || 0)}</span>
              </div>
              {selectedSale.discount > 0 && (
                <div className="flex justify-between text-sm text-red-500">
                  <span>Discount</span><span>-{formatCurrency(selectedSale.discount)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-gray-900 pt-1 border-t border-gray-200">
                <span>Total</span>
                <span className="text-blue-600 text-lg">{formatCurrency(selectedSale.total)}</span>
              </div>
              {(selectedSale.pendingAmount || 0) > 0 ? (
                <>
                  <div className="flex justify-between text-sm text-green-700">
                    <span>Amount Paid</span><span>{formatCurrency(selectedSale.amountPaid)}</span>
                  </div>
                  <div className="flex justify-between text-sm font-bold text-red-700 bg-red-50 px-3 py-2 rounded-lg">
                    <span>Pending</span><span>{formatCurrency(selectedSale.pendingAmount)}</span>
                  </div>
                </>
              ) : (
                <div className="text-xs text-green-700 bg-green-50 px-3 py-2 rounded-lg">✓ Fully Paid</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
