import { useMemo, useState } from 'react';
import { Edit2, Eye, FileText, Search, X } from 'lucide-react';
import { formatCurrency } from '../lib/utils';
import { groupPurchaseInvoices, type PurchaseInvoiceSummary } from '../lib/purchaseReporting';

export function PurchaseInvoiceHistory({ records, canEdit, onEdit }: {
  records: Record<string, any>[];
  canEdit: boolean;
  onEdit: (purchase: Record<string, any>) => void;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<PurchaseInvoiceSummary | null>(null);
  const invoices = useMemo(() => groupPurchaseInvoices(records), [records]);
  const normalized = query.trim().toLowerCase();
  const visible = invoices.filter(invoice => !normalized || [
    invoice.invoiceNumber,
    invoice.supplierInvoiceNumber,
    invoice.internalInvoiceId,
    invoice.supplier,
    invoice.date,
  ].some(value => String(value || '').toLowerCase().includes(normalized)));

  return <>
    <section className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="p-4 border-b border-gray-100 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h2 className="font-bold text-gray-900">Purchase Bill History</h2>
          <p className="text-xs text-gray-500 mt-0.5">Find a supplier bill and open all medicines recorded in it.</p>
        </div>
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={query} onChange={event => setQuery(event.target.value)}
            placeholder="Enter bill/invoice number…" aria-label="Find purchase bill"
            className="w-full pl-9 pr-9 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          {query && <button type="button" onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400"><X className="w-4 h-4" /></button>}
        </div>
      </div>
      <div className="divide-y divide-gray-100 max-h-80 overflow-y-auto">
        {visible.map(invoice => <button type="button" key={invoice.key} onClick={() => setSelected(invoice)}
          className="w-full px-4 py-3 text-left hover:bg-blue-50 flex items-center justify-between gap-4">
          <div className="min-w-0 flex items-center gap-3">
            <span className="w-9 h-9 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0"><FileText className="w-4 h-4" /></span>
            <div className="min-w-0">
              <p className="font-semibold text-gray-900 truncate">Bill {invoice.invoiceNumber}</p>
              <p className="text-xs text-gray-500 truncate">{invoice.date || 'No date'} · {invoice.supplier} · {invoice.lineCount} medicine item{invoice.lineCount === 1 ? '' : 's'}</p>
              {invoice.supplierInvoiceNumber && <p className="text-xs text-gray-400 truncate">Supplier invoice {invoice.supplierInvoiceNumber}</p>}
            </div>
          </div>
          <div className="text-right shrink-0">
            <p className="font-bold text-gray-900">{formatCurrency(invoice.payable)}</p>
            <span className="inline-flex items-center gap-1 text-xs text-blue-600"><Eye className="w-3.5 h-3.5" /> Open bill</span>
          </div>
        </button>)}
        {!visible.length && <p className="p-8 text-center text-sm text-gray-500">No purchase bills match this number.</p>}
      </div>
    </section>

    {selected && <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-5xl max-h-[95vh] rounded-t-2xl sm:rounded-xl shadow-xl overflow-hidden flex flex-col">
        <div className="p-5 border-b flex justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Purchase Bill {selected.invoiceNumber}</h2>
            <p className="text-sm text-gray-500">{selected.date || 'No date'} · {selected.supplier}{selected.supplierInvoiceNumber ? ` · Supplier invoice ${selected.supplierInvoiceNumber}` : ''}</p>
          </div>
          <button type="button" aria-label="Close purchase bill" onClick={() => setSelected(null)} className="p-2 text-gray-400 hover:bg-gray-100 rounded-lg"><X className="w-5 h-5" /></button>
        </div>
        <div className="overflow-auto flex-1">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 sticky top-0"><tr>{['Medicine', 'Batch', 'Paid', 'Bonus', 'Received', 'Cost/Box', 'Payable', ...(canEdit ? ['Action'] : [])].map(label => <th key={label} className="p-3 text-left whitespace-nowrap">{label}</th>)}</tr></thead>
            <tbody className="divide-y">{selected.records.map(record => <tr key={record.id}>
              <td className="p-3 font-medium">{record.medicineName || 'Unknown medicine'}{record.expiryDate && <p className="text-xs text-gray-400">Expiry {record.expiryDate}</p>}</td>
              <td className="p-3 font-mono text-xs">{record.batchNo || 'N/A'}</td>
              <td className="p-3">{record.paidUnits ?? record.totalUnitsAdded ?? 0}</td>
              <td className="p-3">{record.bonusUnits || 0}</td>
              <td className="p-3">{record.totalUnitsAdded ?? record.unitsAdded ?? 0}</td>
              <td className="p-3">{formatCurrency(record.costPrice ?? record.costPerBox ?? 0)}</td>
              <td className="p-3 font-semibold">{formatCurrency(record.totalCost || 0)}</td>
              {canEdit && <td className="p-3"><button type="button" onClick={() => { setSelected(null); onEdit(record); }} className="inline-flex items-center gap-1 text-blue-600 font-medium"><Edit2 className="w-4 h-4" /> Edit</button></td>}
            </tr>)}</tbody>
          </table>
        </div>
        <div className="p-4 border-t bg-gray-50 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div><p className="text-gray-500">Medicine items</p><p className="font-bold">{selected.lineCount}</p></div>
          <div><p className="text-gray-500">Paid units</p><p className="font-bold">{selected.paidUnits}</p></div>
          <div><p className="text-gray-500">Bonus / received</p><p className="font-bold">{selected.bonusUnits} / {selected.receivedUnits}</p></div>
          <div><p className="text-gray-500">Supplier payable</p><p className="font-bold">{formatCurrency(selected.payable)}</p></div>
        </div>
      </div>
    </div>}
  </>;
}
