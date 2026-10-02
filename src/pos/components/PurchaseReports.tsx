import { useState } from 'react';
import { purchaseReportLine, summarizePurchases } from '../lib/purchaseReporting';
import { formatCurrency } from '../lib/utils';
import { downloadOrShare } from '../lib/nativeUtils';
import { PHARMACY_RECEIPT_NAME } from '../lib/receiptBrand';

export function PurchaseReports({ records, period }: { records: any[]; period: string }) {
  const [view, setView] = useState<'detail' | 'medicine' | 'supplier' | 'invoice'>('detail');
  const [error, setError] = useState('');
  const lines = records.map(purchaseReportLine);
  const summaries = view === 'detail' ? [] : summarizePurchases(lines, view);
  const totals = lines.reduce((sum, line) => ({ paid: sum.paid + line.paid, bonus: sum.bonus + line.bonus, total: sum.total + line.total, payable: sum.payable + line.payable }), { paid: 0, bonus: 0, total: 0, payable: 0 });
  const headers = view === 'detail'
    ? ['Date', 'Invoice / Record', 'Medicine', 'Supplier', 'Batch', 'Paid Units', 'Bonus Units', 'Received Units', 'Cost/Box', 'Supplier Payable']
    : [view === 'medicine' ? 'Medicine / Batch' : view === 'supplier' ? 'Supplier' : 'Invoice', 'Details', 'Purchase Lines', 'Paid Units', 'Bonus Units', 'Received Units', 'Supplier Payable'];
  const rows = view === 'detail'
    ? lines.map(l => [l.date || 'N/A', l.invoice, l.medicine, l.supplier, l.batch, l.paid, l.bonus, l.total, l.cost.toFixed(2), l.payable.toFixed(2)])
    : summaries.map(l => [l.label, l.detail, l.lines, l.paid, l.bonus, l.total, l.payable.toFixed(2)]);
  const exportReport = async (pdf: boolean) => {
    setError('');
    try {
      const filename = `purchases-${view}-${period || 'all-dates'}`;
      if (!pdf) {
        const csv = [headers, ...rows].map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\r\n');
        await downloadOrShare('\uFEFF' + csv, filename + '.csv', 'text/csv');
        return;
      }
      const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
      const document = new jsPDF({ orientation: 'landscape' });
      document.setFontSize(16); document.text(PHARMACY_RECEIPT_NAME, 14, 16);
      document.setFontSize(11); document.text(`Purchase report: ${view} · ${period || 'All dates'}`, 14, 24);
      document.text(`${lines.length} purchase lines · Paid ${totals.paid} · Bonus ${totals.bonus} · Received ${totals.total} · Payable Rs ${totals.payable.toFixed(2)}`, 14, 32);
      autoTable(document, { startY: 38, head: [headers], body: rows, styles: { fontSize: 8 }, foot: [[...Array(headers.length - 1).fill(''), totals.payable.toFixed(2)]], showFoot: 'lastPage' });
      document.save(filename + '.pdf');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to export purchase report.'); }
  };
  return <div className="space-y-3">
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {[['Paid Units', totals.paid], ['Bonus Units', totals.bonus], ['Received Units', totals.total], ['Supplier Payable', formatCurrency(totals.payable)]].map(([label, value]) =>
        <div key={label} className="bg-white border border-gray-100 rounded-xl p-4"><p className="text-sm text-gray-500">{label}</p><p className="text-xl font-bold text-gray-900">{value}</p></div>)}
    </div>
    <div className="flex items-center gap-2 flex-wrap">
      {(['detail', 'medicine', 'supplier', 'invoice'] as const).map(mode => <button key={mode} type="button" onClick={() => setView(mode)} className={`px-3 py-2 rounded-lg text-sm ${view === mode ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-600'}`}>{mode === 'detail' ? 'Detailed report' : `By ${mode}`}</button>)}
      <button type="button" disabled={!rows.length} onClick={() => void exportReport(true)} className="px-3 py-2 border rounded-lg text-sm disabled:opacity-40">Download PDF</button>
      <button type="button" disabled={!rows.length} onClick={() => void exportReport(false)} className="px-3 py-2 border rounded-lg text-sm disabled:opacity-40">Download CSV</button>
      <span className="text-xs text-gray-500">{lines.length} purchase lines · {new Set(lines.map(line => line.invoice)).size} invoices / records</span>
    </div>
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    {view !== 'detail' && <div className="overflow-x-auto bg-white border rounded-xl"><table className="w-full text-sm"><thead className="bg-gray-50"><tr>{headers.map(header => <th key={header} className="p-3 text-left whitespace-nowrap">{header}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={summaries[index].key} className="border-t">{row.map((cell, column) => <td key={column} className="p-3">{column === headers.length - 1 ? formatCurrency(Number(cell)) : cell}</td>)}</tr>)}{!rows.length && <tr><td colSpan={headers.length} className="p-6 text-center text-gray-500">No purchases match these filters.</td></tr>}</tbody></table></div>}
  </div>;
}
