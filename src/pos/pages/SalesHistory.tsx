import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, query, orderBy, doc, updateDoc } from 'firebase/firestore';
import { printPageOrShare, downloadOrShare } from '../lib/nativeUtils';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { formatCurrency } from '../lib/utils';
import { getSaleReceiptLabel, getSaleReceiptNo } from '../lib/receiptNumbers';
import {
  Search, FileText, Eye, X, Printer, Download,
  Users, Building2, LayoutList, Table2,
  ArrowUpDown, ArrowUp, ArrowDown, SlidersHorizontal, Edit2, Save,
} from 'lucide-react';
import { format, isWithinInterval, parseISO, startOfDay, endOfDay } from 'date-fns';

type ExportType = 'all' | 'customer' | 'hospital';
type ViewMode   = 'summary' | 'excel';
type SortDir    = 'asc' | 'desc' | null;
type SummaryCol = 'date' | 'type' | 'items' | 'subtotal' | 'discount' | 'total';
type ExcelCol   = 'date' | 'type' | 'itemName' | 'sellType' | 'quantity' | 'unitPrice' | 'itemTotal' | 'subtotal' | 'discount' | 'saleTotal';
interface SortState<T extends string> { col: T | null; dir: SortDir }

function SortIcon({ col, sort }: { col: string; sort: SortState<any> }) {
  if (sort.col !== col) return <ArrowUpDown className="w-3.5 h-3.5 ml-1 opacity-30" />;
  return sort.dir === 'asc'
    ? <ArrowUp   className="w-3.5 h-3.5 ml-1 text-blue-500" />
    : <ArrowDown className="w-3.5 h-3.5 ml-1 text-blue-500" />;
}

function thClass(active: boolean) {
  return `p-4 font-medium select-none cursor-pointer whitespace-nowrap ${active ? 'text-blue-600' : 'text-gray-500 hover:text-gray-700'}`;
}

function getGross(sale: any): number {
  if (sale.grossSubtotal != null) return sale.grossSubtotal;
  return (sale.subtotal || 0) + (sale.totalItemDiscounts || 0);
}

export function SalesHistory() {
  const [sales, setSales]               = useState<any[]>([]);
  const [search, setSearch]             = useState('');
  const [selectedSale, setSelectedSale] = useState<any | null>(null);
  const [editingSale, setEditingSale]       = useState<any | null>(null);
  const [editSaving, setEditSaving]         = useState(false);
  const [showPrintAlert, setShowPrintAlert] = useState(false);
  const [viewMode, setViewMode]         = useState<ViewMode>('summary');
  const [showFilters, setShowFilters]   = useState(false);

  const [typeFilter, setTypeFilter] = useState<'all' | 'customer' | 'hospital'>('all');
  const [dateFrom, setDateFrom]     = useState('');
  const [dateTo, setDateTo]         = useState('');

  const [summarySort, setSummarySort] = useState<SortState<SummaryCol>>({ col: 'date', dir: 'desc' });
  const [excelSort,   setExcelSort]   = useState<SortState<ExcelCol>  >({ col: 'date', dir: 'desc' });

  const [showExportModal, setShowExportModal] = useState(false);
  const [exportType,      setExportType]      = useState<ExportType>('all');
  const [exportDateFrom,  setExportDateFrom]  = useState('');
  const [exportDateTo,    setExportDateTo]    = useState('');

  useEffect(() => {
    const q = query(collection(db, 'sales'), orderBy('date', 'desc'));
    const unsub = onSnapshot(q, snap => {
      setSales(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, err => handleFirestoreError(err, OperationType.GET, 'sales'));
    return () => unsub();
  }, []);

  const applyFilters = (list: any[], tf: typeof typeFilter, df: string, dt: string, q: string) =>
    list.filter(s => {
      const matchSearch =
        getSaleReceiptNo(s, '').toLowerCase().includes(q.toLowerCase()) ||
        s.id.toLowerCase().includes(q.toLowerCase()) ||
        (s.date && format(new Date(s.date), 'MMM dd, yyyy').toLowerCase().includes(q.toLowerCase())) ||
        (s.customerName && s.customerName.toLowerCase().includes(q.toLowerCase())) ||
        (s.items?.some((it: any) => it.name?.toLowerCase().includes(q.toLowerCase())));
      const matchType =
        tf === 'all' || (tf === 'hospital' ? s.customerType === 'hospital' : s.customerType !== 'hospital');
      let matchDate = true;
      if (df || dt) {
        const d = s.date ? new Date(s.date) : null;
        if (d) {
          if (df && dt) matchDate = isWithinInterval(d, { start: startOfDay(parseISO(df)), end: endOfDay(parseISO(dt)) });
          else if (df)  matchDate = d >= startOfDay(parseISO(df));
          else if (dt)  matchDate = d <= endOfDay(parseISO(dt));
        } else matchDate = false;
      }
      return matchSearch && matchType && matchDate;
    });

  const filteredSales = useMemo(
    () => applyFilters(sales, typeFilter, dateFrom, dateTo, search),
    [sales, typeFilter, dateFrom, dateTo, search]
  );

  const sortedSummary = useMemo(() => {
    const arr = [...filteredSales];
    const { col, dir } = summarySort;
    if (!col || !dir) return arr;
    arr.sort((a, b) => {
      let av: any, bv: any;
      if (col === 'date')     { av = new Date(a.date || 0).getTime(); bv = new Date(b.date || 0).getTime(); }
      if (col === 'type')     { av = a.customerType || 'customer';    bv = b.customerType || 'customer'; }
      if (col === 'items')    { av = a.items?.length || 0;            bv = b.items?.length || 0; }
      if (col === 'subtotal') { av = getGross(a);                     bv = getGross(b); }
      if (col === 'discount') { av = a.discount || 0;                 bv = b.discount || 0; }
      if (col === 'total')    { av = a.total || 0;                    bv = b.total || 0; }
      if (av < bv) return dir === 'asc' ? -1 : 1;
      if (av > bv) return dir === 'asc' ?  1 : -1;
      return 0;
    });
    return arr;
  }, [filteredSales, summarySort]);

  const flatRows = useMemo(() => {
    const rows: any[] = [];
    filteredSales.forEach(sale => {
      if (sale.items?.length) sale.items.forEach((item: any) => { rows.push({ sale, item }); });
      else rows.push({ sale, item: null });
    });
    return rows;
  }, [filteredSales]);

  const sortedExcel = useMemo(() => {
    const arr = [...flatRows];
    const { col, dir } = excelSort;
    if (!col || !dir) return arr;
    arr.sort(({ sale: a, item: ai }, { sale: b, item: bi }) => {
      let av: any, bv: any;
      if (col === 'date')      { av = new Date(a.date || 0).getTime(); bv = new Date(b.date || 0).getTime(); }
      if (col === 'type')      { av = a.customerType || 'customer';    bv = b.customerType || 'customer'; }
      if (col === 'itemName')  { av = ai?.name  || '';                 bv = bi?.name  || ''; }
      if (col === 'sellType')  { av = ai?.sellType || '';              bv = bi?.sellType || ''; }
      if (col === 'quantity')  { av = ai?.quantity || 0;               bv = bi?.quantity || 0; }
      if (col === 'unitPrice') { av = ai?.price || 0;                  bv = bi?.price || 0; }
      if (col === 'itemTotal') { av = ai?.total || 0;                  bv = bi?.total || 0; }
      if (col === 'subtotal')  { av = getGross(a);                     bv = getGross(b); }
      if (col === 'discount')  { av = a.discount || 0;                 bv = b.discount || 0; }
      if (col === 'saleTotal') { av = a.total || 0;                    bv = b.total || 0; }
      if (av < bv) return dir === 'asc' ? -1 : 1;
      if (av > bv) return dir === 'asc' ?  1 : -1;
      return 0;
    });
    return arr;
  }, [flatRows, excelSort]);

  const toggleSummarySort = (col: SummaryCol) =>
    setSummarySort(prev => prev.col === col
      ? { col, dir: prev.dir === 'asc' ? 'desc' : prev.dir === 'desc' ? null : 'asc' }
      : { col, dir: 'asc' });

  const toggleExcelSort = (col: ExcelCol) =>
    setExcelSort(prev => prev.col === col
      ? { col, dir: prev.dir === 'asc' ? 'desc' : prev.dir === 'desc' ? null : 'asc' }
      : { col, dir: 'asc' });

  const totals = useMemo(() => ({
    subtotal: filteredSales.reduce((s, r) => s + getGross(r), 0),
    discount: filteredSales.reduce((s, r) => s + (r.discount || 0), 0),
    total:    filteredSales.reduce((s, r) => s + (r.total    || 0), 0),
    pending:  filteredSales.reduce((s, r) => s + (r.pendingAmount || 0), 0),
  }), [filteredSales]);

  const handleSaveEdit = async () => {
    if (!editingSale) return;
    setEditSaving(true);
    try {
      const { id, ...data } = editingSale;
      // Recalculate totals from items
      const grossSubtotal     = editingSale.items.reduce((s: number, i: any) => s + i.quantity * i.price, 0);
      const totalItemDiscounts = editingSale.items.reduce((s: number, i: any) => s + (i.itemDiscount || 0), 0);
      const subtotalAfterItem  = editingSale.items.reduce((s: number, i: any) => s + i.total, 0);
      const orderDiscountAmt   = subtotalAfterItem * ((editingSale.orderDiscountPct || 0) / 100);
      const grandTotal         = Math.max(0, subtotalAfterItem - orderDiscountAmt);
      const amountPaid         = Math.min(editingSale.amountPaid ?? grandTotal, grandTotal);
      const pendingAmount      = Math.max(0, grandTotal - amountPaid);

      await updateDoc(doc(db, 'sales', editingSale.id), {
        items: editingSale.items,
        grossSubtotal, totalItemDiscounts,
        subtotal: subtotalAfterItem,
        orderDiscount: orderDiscountAmt,
        discount: orderDiscountAmt + totalItemDiscounts,
        total: grandTotal,
        amountPaid,
        pendingAmount,
        customerName: editingSale.customerName,
        customerPhone: editingSale.customerPhone,
        customerType: editingSale.customerType,
        lastEditedAt: new Date().toISOString(),
      });
      setEditingSale(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'sales');
    } finally {
      setEditSaving(false);
    }
  };

  const handlePrint = () => {
    if (window !== window.top) { setShowPrintAlert(true); setTimeout(() => setShowPrintAlert(false), 5000); }
    else printPageOrShare('Sales History');
  };

  const doExport = () => {
    const exportSales = applyFilters(sales, exportType, exportDateFrom, exportDateTo, '');
    const rows: string[][] = [
      ['Date & Time','Receipt No','Sale Type','Customer','Item Name','Sell Type','Quantity','Unit Price','Item Total','Gross Subtotal','Sale Discount','Sale Total','Amount Paid','Pending Amount'],
    ];
    exportSales.forEach(sale => {
      const dateStr  = sale.date ? format(new Date(sale.date), 'dd/MM/yyyy HH:mm') : 'N/A';
      const saleType = sale.customerType === 'hospital' ? 'Hospital' : 'Customer';
      const custName = sale.customerName || '';
      const gross = getGross(sale);
      const paid  = sale.amountPaid ?? sale.total ?? 0;
      const pend  = sale.pendingAmount || 0;
      if (sale.items?.length) {
        sale.items.forEach((item: any, idx: number) => {
          rows.push([
            dateStr, getSaleReceiptNo(sale), saleType, custName,
            item.name || '', item.sellType || '',
            String(item.quantity || 0), String(item.price || 0), String(item.total || 0),
            idx === 0 ? String(gross)              : '',
            idx === 0 ? String(sale.discount || 0) : '',
            idx === 0 ? String(sale.total    || 0) : '',
            idx === 0 ? String(paid)               : '',
            idx === 0 ? String(pend)               : '',
          ]);
        });
      } else {
        rows.push([dateStr, getSaleReceiptNo(sale), saleType, custName, '(no items)', '', '', '', '',
          String(gross), String(sale.discount || 0), String(sale.total || 0), String(paid), String(pend)]);
      }
    });
    const gSub = exportSales.reduce((s, r) => s + getGross(r), 0);
    const gDis = exportSales.reduce((s, r) => s + (r.discount || 0), 0);
    const gTot = exportSales.reduce((s, r) => s + (r.total    || 0), 0);
    const gPen = exportSales.reduce((s, r) => s + (r.pendingAmount || 0), 0);
    const gQty = exportSales.reduce((s, r) => s + (r.items?.reduce((q: number, it: any) => q + (it.quantity || 0), 0) || 0), 0);
    rows.push([]);
    rows.push(['TOTAL', `${exportSales.length} sales`, '', '', '', '', String(gQty), '', '', String(gSub), String(gDis), String(gTot), '', String(gPen)]);
    const csv  = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const typeLabel  = exportType === 'all' ? 'all' : exportType === 'hospital' ? 'hospitals' : 'customers';
    const rangeLabel = exportDateFrom && exportDateTo ? `${exportDateFrom}_to_${exportDateTo}` : exportDateFrom ? `from_${exportDateFrom}` : exportDateTo ? `to_${exportDateTo}` : 'all_dates';
    downloadOrShare('\uFEFF' + csv, `sales_${typeLabel}_${rangeLabel}.csv`, 'text/csv;charset=utf-8;');
    setShowExportModal(false);
  };

  const clearFilters = () => { setTypeFilter('all'); setDateFrom(''); setDateTo(''); setSearch(''); };
  const hasActiveFilters = typeFilter !== 'all' || dateFrom !== '' || dateTo !== '' || search !== '';

  const exportPreviewCount = useMemo(
    () => applyFilters(sales, exportType, exportDateFrom, exportDateTo, '').length,
    [sales, exportType, exportDateFrom, exportDateTo]
  );

  return (
    <>
      {showPrintAlert && (
        <div className="fixed top-4 right-4 bg-blue-600 text-white px-6 py-3 rounded-lg shadow-lg z-50">
          <p className="font-medium">Printing blocked in preview.</p>
          <p className="text-sm opacity-90">Press Ctrl+P / Cmd+P to print.</p>
        </div>
      )}

      {/* Printable receipt */}
      {selectedSale && (
        <div className="hidden print:block w-[80mm] mx-auto bg-white text-black text-sm font-mono p-4">
          <div className="text-center mb-4">
            <h2 className="text-xl font-bold">Al-Fateh Pharmacy</h2>
            <p>Receipt (Reprint)</p>
            <p>{selectedSale.date ? format(new Date(selectedSale.date), 'dd/MM/yyyy HH:mm') : 'N/A'}</p>
            <p className="text-xs mt-1">Receipt No: {getSaleReceiptNo(selectedSale)}</p>
            {selectedSale.customerName && <p className="text-xs mt-1">Customer: {selectedSale.customerName}</p>}
          </div>
          <table className="w-full mb-4">
            <thead><tr className="border-b border-black border-dashed"><th className="text-left pb-1">Item</th><th className="text-center pb-1">Qty</th><th className="text-right pb-1">Total</th></tr></thead>
            <tbody className="divide-y divide-gray-100 divide-dashed">
              {selectedSale.items?.map((item: any) => (
                <tr key={item.cartItemId}>
                  <td className="py-1"><div className="line-clamp-1">{item.name}</div><div className="text-xs text-gray-500">{item.sellType === 'box' ? '(Box)' : '(Unit)'} @ {formatCurrency(item.price)}</div></td>
                  <td className="text-center py-1">{item.quantity}</td>
                  <td className="text-right py-1">{formatCurrency(item.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-t border-black border-dashed pt-2 space-y-1">
            <div className="flex justify-between"><span>Subtotal:</span><span>{formatCurrency(getGross(selectedSale))}</span></div>
            {selectedSale.discount > 0 && <div className="flex justify-between"><span>Discount:</span><span>-{formatCurrency(selectedSale.discount)}</span></div>}
            <div className="flex justify-between font-bold text-lg mt-2 pt-2 border-t border-black"><span>Total:</span><span>{formatCurrency(selectedSale.total)}</span></div>
            {selectedSale.pendingAmount > 0 && (
              <>
                <div className="flex justify-between"><span>Paid:</span><span>{formatCurrency(selectedSale.amountPaid)}</span></div>
                <div className="flex justify-between font-bold"><span>Pending:</span><span>{formatCurrency(selectedSale.pendingAmount)}</span></div>
              </>
            )}
          </div>
        </div>
      )}

      <div className="space-y-4 md:space-y-6 print:hidden">

        {/* Header */}
        <div className="flex justify-between items-center gap-3 flex-wrap">
          <h1 className="text-xl md:text-2xl font-bold text-gray-900">Sales History</h1>
          <div className="flex items-center gap-2">
            {/* View toggle — desktop only */}
            <div className="hidden md:flex items-center bg-gray-100 rounded-lg p-1 gap-1">
              <button onClick={() => setViewMode('summary')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${viewMode === 'summary' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                <LayoutList className="w-4 h-4" /> Summary
              </button>
              <button onClick={() => setViewMode('excel')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${viewMode === 'excel' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                <Table2 className="w-4 h-4" /> Excel View
              </button>
            </div>
            <button onClick={() => setShowExportModal(true)}
              className="flex items-center gap-2 px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-medium">
              <Download className="w-4 h-4" /> <span className="hidden sm:inline">Export</span>
            </button>
          </div>
        </div>

        {/* Totals banner */}
        {filteredSales.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 md:gap-3">
            {[
              { label: 'Gross Subtotal',  value: totals.subtotal, color: 'text-gray-900' },
              { label: 'Total Discounts', value: totals.discount, color: 'text-red-600', prefix: '-' },
              { label: 'Net Revenue',     value: totals.total,    color: 'text-blue-700' },
              { label: 'Pending',         value: totals.pending,  color: totals.pending > 0 ? 'text-orange-600' : 'text-gray-400' },
            ].map(({ label, value, color, prefix }) => (
              <div key={label} className="bg-white rounded-xl border border-gray-100 shadow-sm px-3 py-2.5 md:px-4 md:py-3">
                <p className="text-xs text-gray-500 mb-0.5">{label}</p>
                <p className={`text-base md:text-lg font-bold ${color}`}>{prefix}{formatCurrency(value)}</p>
              </div>
            ))}
          </div>
        )}

        {/* Filter bar */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="p-3 md:p-4 border-b border-gray-100 space-y-3">

            {/* Search + filter toggle */}
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input type="text" placeholder="Search by receipt no, date, customer, item..." value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
              </div>
              <button onClick={() => setShowFilters(f => !f)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${showFilters || hasActiveFilters ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                <SlidersHorizontal className="w-4 h-4" />
                <span className="hidden sm:inline">Filters</span>
                {hasActiveFilters && <span className="w-2 h-2 bg-blue-600 rounded-full" />}
              </button>
              {hasActiveFilters && (
                <button onClick={clearFilters} className="flex items-center gap-1 px-3 py-2 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Expanded filters */}
            {showFilters && (
              <div className="space-y-3 pt-1">
                {/* Type filter */}
                <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1 w-fit">
                  {(['all', 'customer', 'hospital'] as const).map(t => (
                    <button key={t} onClick={() => setTypeFilter(t)}
                      className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                        typeFilter === t
                          ? t === 'hospital' ? 'bg-purple-600 text-white shadow-sm'
                            : t === 'customer' ? 'bg-blue-600 text-white shadow-sm'
                            : 'bg-white text-gray-900 shadow-sm'
                          : 'text-gray-500 hover:text-gray-700'
                      }`}>
                      {t === 'all' ? 'All' : t === 'customer' ? 'Customers' : 'Hospitals'}
                    </button>
                  ))}
                </div>
                {/* Date range */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">From</label>
                    <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">To</label>
                    <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between text-xs text-gray-500">
              <span>
                <span className="font-semibold text-gray-700">{sortedSummary.length}</span> of{' '}
                <span className="font-semibold text-gray-700">{sales.length}</span> sales
              </span>
              {(dateFrom || dateTo) && <span className="text-blue-600 bg-blue-50 px-2 py-0.5 rounded font-medium">Date filter active</span>}
            </div>
          </div>

          {/* ── MOBILE: sale cards ── */}
          <div className="md:hidden divide-y divide-gray-100">
            {sortedSummary.map(sale => (
              <div key={sale.id} className="p-4">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">
                      {sale.date ? format(new Date(sale.date), 'MMM dd, yyyy HH:mm') : 'N/A'}
                    </p>
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${sale.customerType === 'hospital' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                        {sale.customerType || 'customer'}
                      </span>
                      {sale.customerName && <span className="text-xs text-gray-600">{sale.customerName}</span>}
                      {sale.pendingAmount > 0 && (
                        <span className="text-[10px] font-bold text-red-700 bg-red-100 px-1.5 py-0.5 rounded">
                          Due {formatCurrency(sale.pendingAmount)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-bold text-gray-900">{formatCurrency(sale.total)}</p>
                    <p className="text-xs text-gray-400">{sale.items?.length || 0} items</p>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  {sale.discount > 0
                    ? <p className="text-xs text-red-500">Discount: -{formatCurrency(sale.discount)}</p>
                    : <span />}
                  <div className="flex gap-2">
                    <button onClick={() => setSelectedSale(sale)}
                      className="flex items-center gap-1 text-blue-600 text-xs font-medium">
                      <Eye className="w-3.5 h-3.5" /> View
                    </button>
                    <button onClick={() => setEditingSale({ ...sale, orderDiscountPct: sale.subtotal > 0 ? Math.round((sale.orderDiscount || 0) / sale.subtotal * 100) : 0 })}
                      className="flex items-center gap-1 text-orange-600 text-xs font-medium">
                      <Edit2 className="w-3.5 h-3.5" /> Edit
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {sortedSummary.length === 0 && (
              <div className="p-8 text-center text-gray-500">
                <FileText className="w-12 h-12 text-gray-300 mx-auto mb-2" />
                <p>No sales records found.</p>
                {hasActiveFilters && <button onClick={clearFilters} className="mt-2 text-blue-600 text-sm hover:underline">Clear filters</button>}
              </div>
            )}
          </div>

          {/* ── DESKTOP: summary table ── */}
          {viewMode === 'summary' && (
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100 text-sm">
                    <th className={thClass(summarySort.col === 'date')}     onClick={() => toggleSummarySort('date')}><span className="flex items-center">Date & Time <SortIcon col="date" sort={summarySort} /></span></th>
                    <th className="p-4 font-medium text-gray-500">Receipt No</th>
                    <th className="p-4 font-medium text-gray-500">Customer</th>
                    <th className={thClass(summarySort.col === 'type')}     onClick={() => toggleSummarySort('type')}><span className="flex items-center">Type <SortIcon col="type" sort={summarySort} /></span></th>
                    <th className={thClass(summarySort.col === 'items')}    onClick={() => toggleSummarySort('items')}><span className="flex items-center">Items <SortIcon col="items" sort={summarySort} /></span></th>
                    <th className={thClass(summarySort.col === 'subtotal')} onClick={() => toggleSummarySort('subtotal')}><span className="flex items-center">Subtotal <SortIcon col="subtotal" sort={summarySort} /></span></th>
                    <th className={thClass(summarySort.col === 'discount')} onClick={() => toggleSummarySort('discount')}><span className="flex items-center">Discount <SortIcon col="discount" sort={summarySort} /></span></th>
                    <th className={thClass(summarySort.col === 'total')}    onClick={() => toggleSummarySort('total')}><span className="flex items-center">Total <SortIcon col="total" sort={summarySort} /></span></th>
                    <th className="p-4 font-medium text-gray-500 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {sortedSummary.map(sale => (
                    <tr key={sale.id} className="hover:bg-gray-50">
                      <td className="p-4 text-gray-900 font-medium">{sale.date ? format(new Date(sale.date), 'MMM dd, yyyy HH:mm') : 'N/A'}</td>
                      <td className="p-4 text-gray-500 font-mono text-sm">{getSaleReceiptNo(sale)}</td>
                      <td className="p-4 text-sm">
                        {sale.customerName ? <span className="font-medium text-gray-800">{sale.customerName}</span> : <span className="text-gray-300 italic text-xs">—</span>}
                        {sale.pendingAmount > 0 && <span className="ml-1.5 inline-block px-1.5 py-0.5 bg-red-100 text-red-700 rounded text-[10px] font-bold">Due {formatCurrency(sale.pendingAmount)}</span>}
                      </td>
                      <td className="p-4"><span className={`inline-block px-2 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${sale.customerType === 'hospital' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>{sale.customerType || 'customer'}</span></td>
                      <td className="p-4 text-gray-600">{sale.items?.length || 0} items</td>
                      <td className="p-4 text-gray-600">{formatCurrency(getGross(sale))}</td>
                      <td className="p-4 text-red-600">{sale.discount > 0 ? `-${formatCurrency(sale.discount)}` : '—'}</td>
                      <td className="p-4 font-bold text-gray-900">{formatCurrency(sale.total)}</td>
                      <td className="p-4">
                        <div className="flex justify-end gap-1">
                          <button onClick={() => setSelectedSale(sale)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded flex items-center gap-1 text-sm font-medium">
                            <Eye className="w-4 h-4" /> View
                          </button>
                          <button onClick={() => setEditingSale({ ...sale, orderDiscountPct: sale.subtotal > 0 ? Math.round((sale.orderDiscount || 0) / sale.subtotal * 100) : 0 })} className="p-1.5 text-orange-600 hover:bg-orange-50 rounded flex items-center gap-1 text-sm font-medium">
                            <Edit2 className="w-4 h-4" /> Edit
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {sortedSummary.length === 0 && (
                    <tr><td colSpan={9} className="p-8 text-center text-gray-500">
                      <div className="flex flex-col items-center"><FileText className="w-12 h-12 text-gray-300 mb-2" /><p>No sales records found.</p>
                        {hasActiveFilters && <button onClick={clearFilters} className="mt-2 text-blue-600 text-sm hover:underline">Clear filters</button>}
                      </div>
                    </td></tr>
                  )}
                </tbody>
                {sortedSummary.length > 0 && (
                  <tfoot>
                    <tr className="bg-blue-50 border-t-2 border-blue-200 font-bold text-sm">
                      <td className="p-4 text-blue-800" colSpan={5}>TOTAL — {filteredSales.length} sales</td>
                      <td className="p-4 text-blue-800">{formatCurrency(totals.subtotal)}</td>
                      <td className="p-4 text-red-600">-{formatCurrency(totals.discount)}</td>
                      <td className="p-4 text-blue-900 text-base">{formatCurrency(totals.total)}</td>
                      <td className="p-4" />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}

          {/* ── DESKTOP: excel table ── */}
          {viewMode === 'excel' && (
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className={thClass(excelSort.col === 'date')}      onClick={() => toggleExcelSort('date')}><span className="flex items-center">Date & Time <SortIcon col="date" sort={excelSort} /></span></th>
                    <th className="p-4 font-medium text-gray-500 whitespace-nowrap">Receipt No</th>
                    <th className={thClass(excelSort.col === 'type')}      onClick={() => toggleExcelSort('type')}><span className="flex items-center">Type <SortIcon col="type" sort={excelSort} /></span></th>
                    <th className={thClass(excelSort.col === 'itemName')}  onClick={() => toggleExcelSort('itemName')}><span className="flex items-center">Item Name <SortIcon col="itemName" sort={excelSort} /></span></th>
                    <th className={thClass(excelSort.col === 'sellType')}  onClick={() => toggleExcelSort('sellType')}><span className="flex items-center">Sell Type <SortIcon col="sellType" sort={excelSort} /></span></th>
                    <th className={thClass(excelSort.col === 'quantity')}  onClick={() => toggleExcelSort('quantity')}><span className="flex items-center">Qty <SortIcon col="quantity" sort={excelSort} /></span></th>
                    <th className={thClass(excelSort.col === 'unitPrice')} onClick={() => toggleExcelSort('unitPrice')}><span className="flex items-center">Unit Price <SortIcon col="unitPrice" sort={excelSort} /></span></th>
                    <th className={thClass(excelSort.col === 'itemTotal')} onClick={() => toggleExcelSort('itemTotal')}><span className="flex items-center">Item Total <SortIcon col="itemTotal" sort={excelSort} /></span></th>
                    <th className={thClass(excelSort.col === 'subtotal')}  onClick={() => toggleExcelSort('subtotal')}><span className="flex items-center">Gross Sub <SortIcon col="subtotal" sort={excelSort} /></span></th>
                    <th className={thClass(excelSort.col === 'discount')}  onClick={() => toggleExcelSort('discount')}><span className="flex items-center">Discount <SortIcon col="discount" sort={excelSort} /></span></th>
                    <th className={thClass(excelSort.col === 'saleTotal')} onClick={() => toggleExcelSort('saleTotal')}><span className="flex items-center">Sale Total <SortIcon col="saleTotal" sort={excelSort} /></span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {sortedExcel.map(({ sale, item }, idx) => (
                    <tr key={`${sale.id}-${idx}`} className="hover:bg-gray-50">
                      <td className="p-3 text-gray-700 whitespace-nowrap">{sale.date ? format(new Date(sale.date), 'MMM dd, yyyy HH:mm') : 'N/A'}</td>
                      <td className="p-3 text-gray-400 font-mono text-xs">{getSaleReceiptNo(sale)}</td>
                      <td className="p-3"><span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider ${sale.customerType === 'hospital' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>{sale.customerType || 'customer'}</span></td>
                      <td className="p-3 text-gray-900 font-medium">{item?.name || <span className="text-gray-400 italic">—</span>}</td>
                      <td className="p-3">{item ? <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold uppercase ${item.sellType === 'box' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>{item.sellType}</span> : '—'}</td>
                      <td className="p-3 text-gray-700 text-center">{item?.quantity ?? '—'}</td>
                      <td className="p-3 text-gray-600">{item ? formatCurrency(item.price) : '—'}</td>
                      <td className="p-3 text-gray-800 font-medium">{item ? formatCurrency(item.total) : '—'}</td>
                      <td className="p-3 text-gray-600">{formatCurrency(getGross(sale))}</td>
                      <td className="p-3 text-red-500">{sale.discount > 0 ? `-${formatCurrency(sale.discount)}` : '—'}</td>
                      <td className="p-3 font-bold text-gray-900">{formatCurrency(sale.total)}</td>
                    </tr>
                  ))}
                  {sortedExcel.length === 0 && (
                    <tr><td colSpan={11} className="p-8 text-center text-gray-500">
                      <div className="flex flex-col items-center"><FileText className="w-12 h-12 text-gray-300 mb-2" /><p>No records found.</p>
                        {hasActiveFilters && <button onClick={clearFilters} className="mt-2 text-blue-600 text-sm hover:underline">Clear filters</button>}
                      </div>
                    </td></tr>
                  )}
                </tbody>
                {sortedExcel.length > 0 && (
                  <tfoot>
                    <tr className="bg-blue-50 border-t-2 border-blue-200 font-bold text-sm">
                      <td className="p-4 text-blue-800" colSpan={5}>TOTAL — {filteredSales.length} sales / {sortedExcel.length} rows</td>
                      <td className="p-4 text-blue-800 text-center">{sortedExcel.reduce((s, { item }) => s + (item?.quantity || 0), 0)}</td>
                      <td className="p-4" />
                      <td className="p-4 text-blue-800">{formatCurrency(sortedExcel.reduce((s, { item }) => s + (item?.total || 0), 0))}</td>
                      <td className="p-4 text-blue-800">{formatCurrency(totals.subtotal)}</td>
                      <td className="p-4 text-red-600">-{formatCurrency(totals.discount)}</td>
                      <td className="p-4 text-blue-900 text-base">{formatCurrency(totals.total)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </div>

        {/* Sale Details Modal */}
        {selectedSale && (
          <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4 z-50">
            <div className="bg-white rounded-t-2xl sm:rounded-xl shadow-xl w-full sm:max-w-2xl overflow-hidden flex flex-col max-h-[92vh]">
              <div className="p-4 md:p-6 border-b border-gray-100 flex justify-between items-start bg-gray-50 shrink-0">
                <div>
                  <h2 className="text-lg font-bold text-gray-900">Sale Details</h2>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {selectedSale.date ? format(new Date(selectedSale.date), 'MMM dd, yyyy HH:mm') : 'N/A'} •{' '}
                    <span className="font-mono">{getSaleReceiptLabel(selectedSale)}</span>
                    <span className={`ml-1.5 inline-block px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${selectedSale.customerType === 'hospital' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                      {selectedSale.customerType || 'customer'}
                    </span>
                  </p>
                  {selectedSale.customerName && (
                    <p className="text-sm text-gray-800 mt-1 font-medium">
                      👤 {selectedSale.customerName}
                      {selectedSale.customerPhone && <span className="text-gray-400 font-normal"> • {selectedSale.customerPhone}</span>}
                    </p>
                  )}
                </div>
                <div className="flex gap-1 shrink-0">
                  <button onClick={handlePrint} className="p-2 text-blue-600 hover:bg-blue-50 rounded-full"><Printer className="w-5 h-5" /></button>
                  <button onClick={() => setSelectedSale(null)} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded-full"><X className="w-5 h-5" /></button>
                </div>
              </div>

              <div className="p-4 md:p-6 overflow-y-auto flex-1 space-y-2">
                {selectedSale.items?.map((item: any, i: number) => (
                  <div key={i} className="flex items-center justify-between gap-2 py-2 border-b border-gray-100 last:border-0">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 text-sm">{item.name}</p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${item.sellType === 'box' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>{item.sellType}</span>
                        <span className="text-xs text-gray-400">{formatCurrency(item.price)} × {item.quantity}</span>
                        {item.itemDiscount > 0 && <span className="text-xs text-orange-600">-{formatCurrency(item.itemDiscount)}</span>}
                      </div>
                    </div>
                    <span className="font-semibold text-gray-900 shrink-0">{formatCurrency(item.total)}</span>
                  </div>
                ))}
              </div>

              <div className="p-4 md:p-6 border-t border-gray-100 bg-gray-50 shrink-0 space-y-1.5">
                <div className="flex justify-between text-sm text-gray-600"><span>Gross Subtotal</span><span>{formatCurrency(getGross(selectedSale))}</span></div>
                {(selectedSale.totalItemDiscounts || 0) > 0 && <div className="flex justify-between text-sm text-orange-600"><span>Item Discounts</span><span>-{formatCurrency(selectedSale.totalItemDiscounts)}</span></div>}
                {(selectedSale.orderDiscount || 0) > 0 && <div className="flex justify-between text-sm text-red-500"><span>Order Discount</span><span>-{formatCurrency(selectedSale.orderDiscount)}</span></div>}
                <div className="pt-2 border-t border-gray-200 flex justify-between items-center">
                  <span className="font-bold text-gray-900">Total</span>
                  <span className="text-xl font-bold text-blue-600">{formatCurrency(selectedSale.total)}</span>
                </div>
                {selectedSale.pendingAmount > 0 ? (
                  <>
                    <div className="flex justify-between text-sm text-green-700"><span>Amount Paid</span><span>{formatCurrency(selectedSale.amountPaid)}</span></div>
                    <div className="flex justify-between text-sm font-bold text-red-700 bg-red-50 px-3 py-2 rounded-lg border border-red-100"><span>Pending</span><span>{formatCurrency(selectedSale.pendingAmount)}</span></div>
                  </>
                ) : (
                  <div className="text-xs text-green-700 bg-green-50 px-3 py-2 rounded-lg">✓ Fully Paid</div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Export Modal */}
        {showExportModal && (
          <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4 z-50">
            <div className="bg-white rounded-t-2xl sm:rounded-xl shadow-xl w-full sm:max-w-md overflow-hidden">
              <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                <div>
                  <h2 className="text-lg font-bold text-gray-900">Export Sales</h2>
                  <p className="text-sm text-gray-500 mt-0.5">Each item sold will be a separate row</p>
                </div>
                <button onClick={() => setShowExportModal(false)} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded-full"><X className="w-5 h-5" /></button>
              </div>
              <div className="p-5 space-y-5">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Sale Type</label>
                  <div className="grid grid-cols-3 gap-2">
                    {([
                      { value: 'all',      label: 'All Sales',      icon: Download,  color: 'gray' },
                      { value: 'customer', label: 'Customers',      icon: Users,     color: 'blue' },
                      { value: 'hospital', label: 'Hospitals',      icon: Building2, color: 'purple' },
                    ] as const).map(opt => (
                      <button key={opt.value} onClick={() => setExportType(opt.value)}
                        className={`flex flex-col items-center gap-2 p-3 rounded-lg border-2 transition-all text-center ${
                          exportType === opt.value
                            ? opt.color === 'blue' ? 'border-blue-500 bg-blue-50 text-blue-700'
                              : opt.color === 'purple' ? 'border-purple-500 bg-purple-50 text-purple-700'
                              : 'border-gray-500 bg-gray-50 text-gray-700'
                            : 'border-gray-200 text-gray-500 hover:border-gray-300'
                        }`}>
                        <opt.icon className="w-5 h-5" />
                        <span className="text-xs font-semibold leading-tight">{opt.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Date Range <span className="text-gray-400 font-normal">(optional)</span></label>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="block text-xs text-gray-500 mb-1">From</label>
                      <input type="date" value={exportDateFrom} onChange={e => setExportDateFrom(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
                    <div><label className="block text-xs text-gray-500 mb-1">To</label>
                      <input type="date" value={exportDateTo} onChange={e => setExportDateTo(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
                  </div>
                  {(exportDateFrom || exportDateTo) && (
                    <button onClick={() => { setExportDateFrom(''); setExportDateTo(''); }} className="mt-2 text-xs text-red-500 hover:underline flex items-center gap-1">
                      <X className="w-3 h-3" /> Clear dates
                    </button>
                  )}
                </div>
                <div className="bg-blue-50 rounded-lg px-4 py-3 text-sm text-blue-700">
                  Will export <span className="font-bold">{exportPreviewCount}</span> sales with all items
                </div>
              </div>
              <div className="p-5 pt-0 flex gap-3">
                <button onClick={() => setShowExportModal(false)} className="flex-1 px-4 py-2.5 border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 text-sm font-medium">Cancel</button>
                <button onClick={doExport} className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-medium">
                  <Download className="w-4 h-4" /> Download CSV
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Edit Sale Modal ── */}
        {editingSale && (
          <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4 z-50">
            <div className="bg-white rounded-t-2xl sm:rounded-xl shadow-xl w-full sm:max-w-2xl overflow-hidden flex flex-col max-h-[95vh]">
              <div className="p-4 md:p-5 border-b border-gray-100 flex justify-between items-start bg-orange-50 shrink-0">
                <div>
                  <h2 className="text-lg font-bold text-gray-900">Edit Sale</h2>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {editingSale.date ? format(new Date(editingSale.date), 'MMM dd, yyyy HH:mm') : 'N/A'} - <span className="font-mono">{getSaleReceiptLabel(editingSale)}</span>
                  </p>
                </div>
                <button onClick={() => setEditingSale(null)} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded-full"><X className="w-5 h-5" /></button>
              </div>

              <div className="overflow-y-auto flex-1 p-4 space-y-4">

                {/* Customer info */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Customer Name</label>
                    <input type="text" value={editingSale.customerName || ''} placeholder="—"
                      onChange={e => setEditingSale((s: any) => ({ ...s, customerName: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Phone</label>
                    <input type="text" value={editingSale.customerPhone || ''} placeholder="—"
                      onChange={e => setEditingSale((s: any) => ({ ...s, customerPhone: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
                  </div>
                </div>

                {/* Sale type */}
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Sale Type</label>
                  <div className="flex bg-gray-100 rounded-lg p-1 gap-1 w-fit">
                    {(['customer', 'hospital'] as const).map(t => (
                      <button key={t} onClick={() => setEditingSale((s: any) => ({ ...s, customerType: t }))}
                        className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${editingSale.customerType === t ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                        {t.charAt(0).toUpperCase() + t.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Items */}
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-2">Items</label>
                  <div className="space-y-2">
                    {editingSale.items?.map((item: any, idx: number) => (
                      <div key={idx} className="border border-gray-100 rounded-lg p-3 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-medium text-sm text-gray-900 flex-1">{item.name}
                            <span className={`ml-2 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${item.sellType === 'box' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>{item.sellType}</span>
                          </p>
                          <button onClick={() => setEditingSale((s: any) => ({ ...s, items: s.items.filter((_: any, i: number) => i !== idx) }))}
                            className="p-1 text-red-400 hover:bg-red-50 rounded shrink-0"><X className="w-3.5 h-3.5" /></button>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <label className="block text-[10px] text-gray-400 mb-0.5">Qty</label>
                            <input type="number" min="1" value={item.quantity}
                              onChange={e => setEditingSale((s: any) => ({
                                ...s, items: s.items.map((it: any, i: number) => {
                                  if (i !== idx) return it;
                                  const q = parseInt(e.target.value) || 1;
                                  const disc = it.itemDiscount || 0;
                                  return { ...it, quantity: q, total: Math.max(0, q * it.price - disc) };
                                })
                              }))}
                              className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-orange-400" />
                          </div>
                          <div>
                            <label className="block text-[10px] text-gray-400 mb-0.5">Unit Price</label>
                            <input type="number" min="0" step="0.01" value={item.price}
                              onChange={e => setEditingSale((s: any) => ({
                                ...s, items: s.items.map((it: any, i: number) => {
                                  if (i !== idx) return it;
                                  const p = parseFloat(e.target.value) || 0;
                                  const disc = it.itemDiscount || 0;
                                  return { ...it, price: p, total: Math.max(0, it.quantity * p - disc) };
                                })
                              }))}
                              className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-orange-400" />
                          </div>
                          <div>
                            <label className="block text-[10px] text-gray-400 mb-0.5">Item Disc Rs.</label>
                            <input type="number" min="0" step="0.01" value={item.itemDiscount || 0}
                              onChange={e => setEditingSale((s: any) => ({
                                ...s, items: s.items.map((it: any, i: number) => {
                                  if (i !== idx) return it;
                                  const d = parseFloat(e.target.value) || 0;
                                  return { ...it, itemDiscount: d, total: Math.max(0, it.quantity * it.price - d) };
                                })
                              }))}
                              className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-orange-400" />
                          </div>
                        </div>
                        <div className="flex justify-end text-xs text-gray-500">Line total: <span className="font-bold text-gray-800 ml-1">{formatCurrency(item.total)}</span></div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Order discount & payment */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Order Discount %</label>
                    <input type="number" min="0" max="100" value={editingSale.orderDiscountPct || 0}
                      onChange={e => setEditingSale((s: any) => ({ ...s, orderDiscountPct: parseFloat(e.target.value) || 0 }))}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Amount Paid</label>
                    <input type="number" min="0" step="0.01" value={editingSale.amountPaid ?? ''}
                      onChange={e => setEditingSale((s: any) => ({ ...s, amountPaid: parseFloat(e.target.value) || 0 }))}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
                  </div>
                </div>

                {/* Live totals preview */}
                {(() => {
                  const sub   = (editingSale.items || []).reduce((s: number, i: any) => s + i.total, 0);
                  const gross = (editingSale.items || []).reduce((s: number, i: any) => s + i.quantity * i.price, 0);
                  const odAmt = sub * ((editingSale.orderDiscountPct || 0) / 100);
                  const total = Math.max(0, sub - odAmt);
                  const paid  = Math.min(editingSale.amountPaid ?? total, total);
                  const pend  = Math.max(0, total - paid);
                  return (
                    <div className="bg-orange-50 border border-orange-100 rounded-lg p-3 space-y-1 text-sm">
                      <div className="flex justify-between text-gray-600"><span>Gross Subtotal</span><span>{formatCurrency(gross)}</span></div>
                      {gross !== sub && <div className="flex justify-between text-orange-600"><span>Item Discounts</span><span>-{formatCurrency(gross - sub)}</span></div>}
                      {odAmt > 0 && <div className="flex justify-between text-red-500"><span>Order Discount ({editingSale.orderDiscountPct}%)</span><span>-{formatCurrency(odAmt)}</span></div>}
                      <div className="flex justify-between font-bold text-gray-900 border-t border-orange-200 pt-1 mt-1"><span>New Total</span><span className="text-orange-700">{formatCurrency(total)}</span></div>
                      {pend > 0 && <div className="flex justify-between font-bold text-red-600"><span>Pending</span><span>{formatCurrency(pend)}</span></div>}
                      {pend === 0 && <div className="text-xs text-green-700 bg-green-50 px-2 py-1 rounded">✓ Fully Paid</div>}
                    </div>
                  );
                })()}
              </div>

              <div className="p-4 border-t border-gray-100 bg-gray-50 shrink-0 flex gap-3">
                <button onClick={() => setEditingSale(null)} className="flex-1 py-2.5 border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-100 font-medium text-sm">Cancel</button>
                <button onClick={handleSaveEdit} disabled={editSaving}
                  className="flex-1 py-2.5 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50 font-medium text-sm flex items-center justify-center gap-2">
                  <Save className="w-4 h-4" />
                  {editSaving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
