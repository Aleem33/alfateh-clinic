import { useState, useEffect } from 'react';
import { collection, onSnapshot, addDoc, updateDoc, doc, increment } from 'firebase/firestore';
import { db } from '../../firebase';
import { formatDate, today, nowISO } from '../lib/utils';
import { Plus, Search, X, AlertTriangle, Edit2, FileText, CheckCircle, Clock } from 'lucide-react';
import { useAppDialog } from '../../components/AppDialog';

const emptyMed = { name: '', nameUrdu: '', category: 'Tablet', manufacturer: '', batchNo: '', expiryDate: '', costPrice: '', retailPrice: '', unitPrice: '', unitsPerBox: '10', stockBoxes: '0', stockLoose: '0', reorderLevel: '10', supplierId: '', supplierName: '' };
const CATEGORIES = ['Tablet', 'Capsule', 'Syrup', 'Injection', 'Drops', 'Cream/Ointment', 'Powder', 'Inhaler', 'IV Fluid', 'Other'];

// ── RX quantity calculation — exact lookup table matching OPD dropdown values ──
const FREQ_MAP: Record<string, number> = {
  'once daily': 1, 'twice daily': 2, 'three times daily': 3, 'four times daily': 4,
  'as needed': 1, 'before meals': 3, 'after meals': 3, 'at bedtime': 1,
  'od': 1, 'bd': 2, 'bid': 2, 'tds': 3, 'tid': 3, 'qds': 4, 'qid': 4,
};
const DUR_MAP: Record<string, number> = {
  '3 days': 3, '5 days': 5, '7 days': 7, '10 days': 10, '14 days': 14,
  '1 month': 30, 'ongoing': 30,
};

function parseFrequency(freq: string): number {
  if (!freq) return 1;
  const key = freq.trim().toLowerCase();
  if (FREQ_MAP[key] !== undefined) return FREQ_MAP[key];
  if (key.includes('four')) return 4;
  if (key.includes('three')) return 3;
  if (key.includes('twice') || key.includes('two')) return 2;
  if (key.includes('once') || key.includes('one')) return 1;
  const dashMatch = key.match(/^(\d)-(\d)-(\d)$/);
  if (dashMatch) return [dashMatch[1], dashMatch[2], dashMatch[3]].filter((x: string) => x !== '0').length;
  const n = parseInt(key); return isNaN(n) ? 1 : n;
}

function parseDuration(dur: string): number {
  if (!dur) return 7;
  const key = dur.trim().toLowerCase();
  if (DUR_MAP[key] !== undefined) return DUR_MAP[key];
  const m = key.match(/^(\d+)\s*(month|week|day)/);
  if (m) { const n = parseInt(m[1]); if (m[2] === 'month') return n * 30; if (m[2] === 'week') return n * 7; return n; }
  const n = parseInt(key); return isNaN(n) ? 7 : n;
}

function calcQty(freq: string, dur: string): number {
  const q = parseFrequency(freq) * parseDuration(dur);
  return q > 0 ? q : 1;
}

export function Pharmacy() {
  const { alert } = useAppDialog();
  const [medicines, setMedicines]           = useState<any[]>([]);
  const [suppliers, setSuppliers]           = useState<any[]>([]);
  const [purchases, setPurchases]           = useState<any[]>([]);
  const [pharmacyOrders, setPharmacyOrders] = useState<any[]>([]);

  const [tab, setTab]               = useState<'stock' | 'purchases' | 'rx'>('stock');
  const [search, setSearch]         = useState('');
  const [stockFilter, setStockFilter] = useState<'all' | 'low' | 'expiring'>('all');
  const [showMedModal, setShowMedModal]           = useState(false);
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [editMedId, setEditMedId]   = useState<string | null>(null);
  const [medForm, setMedForm]       = useState(emptyMed);
  const [purchaseForm, setPurchaseForm] = useState({ medicineId: '', medicineName: '', supplierId: '', supplierName: '', boxes: '', costPerBox: '', batchNo: '', expiryDate: today(), invoiceNo: '', date: today() });
  const [saving, setSaving]         = useState(false);
  const [medSearch, setMedSearch]   = useState('');
  const [error, setError]           = useState('');

  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);
  const [dispenseItems, setDispenseItems] = useState<any[]>([]);
  const [rxSearch, setRxSearch]           = useState('');

  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'medicines'), snap =>
      setMedicines(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a: any, b: any) => a.name > b.name ? 1 : -1))
    );
    const u2 = onSnapshot(collection(db, 'suppliers'), snap => setSuppliers(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    const u3 = onSnapshot(collection(db, 'purchases'), snap =>
      setPurchases(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a: any, b: any) => b.date > a.date ? 1 : -1))
    );
    const u4 = onSnapshot(collection(db, 'pharmacyOrders'), snap =>
      setPharmacyOrders(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a: any, b: any) => b.createdAt > a.createdAt ? 1 : -1))
    );
    return () => { u1(); u2(); u3(); u4(); };
  }, []);

  const loadOrder = (order: any) => {
    const items = (order.prescriptions || []).map((p: any) => {
      const qty     = calcQty(p.frequency, p.duration);
      const pName = (p.name || '').toLowerCase().trim();
      const matched = pName ? (medicines.find(m => {
        const mName = (m.name || '').toLowerCase().trim();
        return mName.includes(pName) || pName.includes(mName);
      }) || null) : null;
      return { ...p, qty, matchedId: matched?.id || '', matchedName: matched?.name || '' };
    });
    setDispenseItems(items);
    setSelectedOrder(order);
  };

  const updateDispenseItem = (idx: number, key: string, value: any) => {
    setDispenseItems(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [key]: value };
      if (key === 'matchedId') {
        const med = medicines.find(m => m.id === value);
        next[idx].matchedName = med?.name || '';
      }
      return next;
    });
  };

  const handleDispense = async () => {
    if (!selectedOrder) return;
    const toDispense = dispenseItems.filter(i => i.matchedId && i.qty > 0);
    if (!toDispense.length) { await alert('No medicines linked to stock. Please link each item.', 'Nothing to Dispense'); return; }
    setSaving(true);
    try {
      for (const item of toDispense) {
        await updateDoc(doc(db, 'medicines', item.matchedId), { stock: increment(-item.qty), updatedAt: nowISO() });
      }
      await updateDoc(doc(db, 'pharmacyOrders', selectedOrder.id), {
        status: 'dispensed', dispensedAt: nowISO(),
        dispensedItems: toDispense.map(i => ({ name: i.name, matchedName: i.matchedName, qty: i.qty, frequency: i.frequency, duration: i.duration })),
      });
      setSelectedOrder(null); setDispenseItems([]);
    } catch (e: any) { await alert('Dispense failed: ' + (e.message || 'Unknown error'), 'Dispense Failed'); }
    finally { setSaving(false); }
  };

  const filteredMeds = medicines.filter(m => {
    const matchSearch = !search || m.name?.toLowerCase().includes(search.toLowerCase()) || m.batchNo?.toLowerCase().includes(search.toLowerCase());
    const matchFilter = stockFilter === 'all' ? true
      : stockFilter === 'low' ? m.stock <= (m.unitsPerBox || 1) * 2
      : m.expiryDate && new Date(m.expiryDate) < new Date(Date.now() + 30 * 86400000);
    return matchSearch && matchFilter;
  });

  const filteredPurchases = purchases.filter(p => !search || p.medicineName?.toLowerCase().includes(search.toLowerCase()));
  const filteredOrders    = pharmacyOrders.filter(o =>
    !rxSearch || o.patientName?.toLowerCase().includes(rxSearch.toLowerCase()) || o.patientMRN?.includes(rxSearch)
  );
  const pendingCount  = pharmacyOrders.filter(o => o.status === 'pending').length;
  const lowStockCount = medicines.filter(m => m.stock <= (m.unitsPerBox || 1) * 2).length;
  const expiringCount = medicines.filter(m => m.expiryDate && new Date(m.expiryDate) < new Date(Date.now() + 30 * 86400000)).length;

  const openEdit = (m: any) => {
    const unitsPerBox = m.unitsPerBox || 1;
    setEditMedId(m.id);
    setMedForm({ name: m.name, nameUrdu: m.nameUrdu || '', category: m.category || 'Tablet', manufacturer: m.manufacturer || '', batchNo: m.batchNo || '', expiryDate: m.expiryDate || '', costPrice: String(m.costPrice || ''), retailPrice: String(m.retailPrice || m.price || ''), unitPrice: String(m.unitPrice || ''), unitsPerBox: String(unitsPerBox), stockBoxes: String(Math.floor((m.stock || 0) / unitsPerBox)), stockLoose: String((m.stock || 0) % unitsPerBox), reorderLevel: String(m.reorderLevel || '10'), supplierId: m.supplierId || '', supplierName: m.supplierName || '' });
    setError(''); setShowMedModal(true);
  };

  const handleSaveMed = async () => {
    if (!medForm.name || !medForm.retailPrice) { setError('Name and retail price are required.'); return; }
    setSaving(true); setError('');
    try {
      const unitsPerBox = parseInt(medForm.unitsPerBox || '1');
      const stock = parseInt(medForm.stockBoxes || '0') * unitsPerBox + parseInt(medForm.stockLoose || '0');
      const data = { name: medForm.name, nameUrdu: medForm.nameUrdu || '', category: medForm.category, manufacturer: medForm.manufacturer, batchNo: medForm.batchNo, expiryDate: medForm.expiryDate, costPrice: parseFloat(medForm.costPrice || '0'), retailPrice: parseFloat(medForm.retailPrice), unitPrice: parseFloat(medForm.unitPrice || '0'), unitsPerBox, stock, reorderLevel: parseInt(medForm.reorderLevel || '10'), supplierId: medForm.supplierId, supplierName: medForm.supplierName, updatedAt: nowISO() };
      if (editMedId) await updateDoc(doc(db, 'medicines', editMedId), data);
      else await addDoc(collection(db, 'medicines'), { ...data, createdAt: nowISO() });
      setShowMedModal(false); setEditMedId(null); setMedForm(emptyMed);
    } catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  };

  const handleSavePurchase = async () => {
    if (!purchaseForm.medicineId || !purchaseForm.boxes) { setError('Medicine and boxes are required.'); return; }
    setSaving(true); setError('');
    try {
      const med = medicines.find(m => m.id === purchaseForm.medicineId)!;
      const unitsAdded = parseInt(purchaseForm.boxes) * (med.unitsPerBox || 1);
      const totalCost  = parseFloat(purchaseForm.costPerBox || '0') * parseInt(purchaseForm.boxes);
      await addDoc(collection(db, 'purchases'), { ...purchaseForm, boxes: parseInt(purchaseForm.boxes), unitsAdded, totalCost, costPerBox: parseFloat(purchaseForm.costPerBox || '0'), createdAt: nowISO() });
      await updateDoc(doc(db, 'medicines', purchaseForm.medicineId), { stock: increment(unitsAdded), batchNo: purchaseForm.batchNo || med.batchNo, expiryDate: purchaseForm.expiryDate || med.expiryDate, updatedAt: nowISO() });
      setShowPurchaseModal(false);
      setPurchaseForm({ medicineId: '', medicineName: '', supplierId: '', supplierName: '', boxes: '', costPerBox: '', batchNo: '', expiryDate: today(), invoiceNo: '', date: today() });
    } catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  };

  const mf = (k: string, v: string) => setMedForm(p => ({ ...p, [k]: v }));
  const pf = (k: string, v: string) => setPurchaseForm(p => ({ ...p, [k]: v }));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Pharmacy</h1>
          <p className="text-sm text-gray-500">
            {medicines.length} medicines
            {lowStockCount > 0 && <span className="text-red-500"> · {lowStockCount} low stock</span>}
            {pendingCount  > 0 && <span className="text-orange-500"> · {pendingCount} pending RX</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { setError(''); setShowPurchaseModal(true); }} className="flex items-center gap-2 border border-blue-600 text-blue-600 px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-50">
            <Plus className="w-4 h-4" /> New Purchase
          </button>
          <button onClick={() => { setEditMedId(null); setMedForm(emptyMed); setError(''); setShowMedModal(true); }} className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
            <Plus className="w-4 h-4" /> Add Medicine
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex bg-white border border-gray-200 rounded-lg p-1 gap-1">
          {(['stock', 'purchases', 'rx'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium flex items-center gap-1.5 ${tab === t ? 'bg-blue-600 text-white' : 'text-gray-500 hover:text-gray-700'}`}>
              {t === 'rx' && pendingCount > 0 && (
                <span className={`text-xs rounded-full px-1.5 py-0.5 font-bold ${tab === 'rx' ? 'bg-white text-blue-600' : 'bg-orange-500 text-white'}`}>{pendingCount}</span>
              )}
              {t === 'stock' ? 'Medicine Stock' : t === 'purchases' ? 'Purchase History' : 'Pending RX'}
            </button>
          ))}
        </div>
        {tab === 'stock' && (
          <div className="flex bg-gray-100 rounded-lg p-1 gap-1">
            {(['all', 'low', 'expiring'] as const).map(f => (
              <button key={f} onClick={() => setStockFilter(f)} className={`px-3 py-1.5 rounded-md text-xs font-medium ${stockFilter === f ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500'}`}>
                {f === 'all' ? 'All' : f === 'low' ? `Low Stock (${lowStockCount})` : `Expiring (${expiringCount})`}
              </button>
            ))}
          </div>
        )}
        {tab !== 'rx' ? (
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search medicine..." className="w-full pl-9 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        ) : (
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input value={rxSearch} onChange={e => setRxSearch(e.target.value)} placeholder="Search patient..." className="w-full pl-9 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        )}
      </div>

      {/* Stock Tab */}
      {tab === 'stock' && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>{['Medicine', 'Category', 'Stock', 'Batch', 'Expiry', 'Cost', 'Retail Price', ''].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>
              ))}</tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filteredMeds.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-12 text-gray-400">No medicines found</td></tr>
              ) : filteredMeds.map(m => {
                const isLow      = m.stock <= (m.unitsPerBox || 1) * 2;
                const isExpiring = m.expiryDate && new Date(m.expiryDate) < new Date(Date.now() + 30 * 86400000);
                return (
                  <tr key={m.id} className={`hover:bg-gray-50/50 ${isLow ? 'bg-red-50/30' : ''}`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {(isLow || isExpiring) && <AlertTriangle className="w-3.5 h-3.5 text-red-500 shrink-0" />}
                        <div>
                          <div className="text-sm font-medium text-gray-900">{m.name}</div>
                          {m.nameUrdu && <div className="text-xs text-green-700" dir="rtl" style={{ fontFamily: 'Noto Nastaliq Urdu, serif' }}>{m.nameUrdu}</div>}
                          {m.manufacturer && <div className="text-xs text-gray-400">{m.manufacturer}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3"><span className="bg-gray-100 text-gray-600 text-xs px-2 py-0.5 rounded-full">{m.category || '—'}</span></td>
                    <td className="px-4 py-3">
                      <div className={`text-sm font-bold ${isLow ? 'text-red-600' : 'text-gray-900'}`}>{m.stock}</div>
                      <div className="text-xs text-gray-400">{Math.floor(m.stock / (m.unitsPerBox || 1))} boxes + {m.stock % (m.unitsPerBox || 1)} loose</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 font-mono">{m.batchNo || '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      <span className={isExpiring ? 'text-red-600 font-medium' : ''}>{formatDate(m.expiryDate)}</span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">Rs. {m.costPrice || '—'}</td>
                    <td className="px-4 py-3 text-sm font-medium text-gray-800">Rs. {m.retailPrice || m.price}</td>
                    <td className="px-4 py-3">
                      <button onClick={() => openEdit(m)} className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-lg"><Edit2 className="w-4 h-4" /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Purchases Tab */}
      {tab === 'purchases' && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>{['Date', 'Medicine', 'Supplier', 'Boxes', 'Cost/Box', 'Total', 'Invoice', 'Batch'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">{h}</th>
              ))}</tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filteredPurchases.length === 0
                ? <tr><td colSpan={8} className="text-center py-12 text-gray-400">No purchases yet</td></tr>
                : filteredPurchases.map(p => (
                  <tr key={p.id} className="hover:bg-gray-50/50">
                    <td className="px-4 py-3 text-sm text-gray-600">{formatDate(p.date)}</td>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{p.medicineName}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{p.supplierName || '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{p.boxes}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">Rs. {p.costPerBox}</td>
                    <td className="px-4 py-3 text-sm font-medium text-gray-800">Rs. {p.totalCost?.toLocaleString()}</td>
                    <td className="px-4 py-3 text-xs text-gray-400">{p.invoiceNo || '—'}</td>
                    <td className="px-4 py-3 text-xs font-mono text-gray-400">{p.batchNo || '—'}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pending RX Tab */}
      {tab === 'rx' && (
        <div className="space-y-4">
          {filteredOrders.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-100 p-12 text-center text-gray-400">
              <FileText className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>No prescription orders yet.</p>
              <p className="text-xs mt-1">Doctors send prescriptions from OPD → Prescriptions page.</p>
            </div>
          ) : filteredOrders.map(order => (
            <div key={order.id} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3 bg-gray-50 border-b border-gray-100">
                <div className="flex items-center gap-3">
                  <div>
                    <div className="font-semibold text-gray-900 text-sm">{order.patientName}</div>
                    <div className="text-xs text-gray-400">{order.patientMRN} · Dr. {order.doctorName} · {formatDate(order.date)}</div>
                  </div>
                  {order.diagnosis && <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">{order.diagnosis}</span>}
                </div>
                <div className="flex items-center gap-2">
                  {order.status === 'dispensed' ? (
                    <span className="flex items-center gap-1 text-xs text-green-700 bg-green-50 px-3 py-1 rounded-full font-medium">
                      <CheckCircle className="w-3.5 h-3.5" /> Dispensed
                    </span>
                  ) : (
                    <>
                      <span className="flex items-center gap-1 text-xs text-orange-700 bg-orange-50 px-3 py-1 rounded-full font-medium">
                        <Clock className="w-3.5 h-3.5" /> Pending
                      </span>
                      <button onClick={() => loadOrder(order)}
                        className="flex items-center gap-1.5 text-sm bg-blue-600 text-white px-3 py-1.5 rounded-lg font-medium hover:bg-blue-700">
                        <FileText className="w-3.5 h-3.5" /> Load RX
                      </button>
                    </>
                  )}
                </div>
              </div>
              <div className="px-5 py-3">
                <div className="flex flex-wrap gap-2">
                  {(order.prescriptions || []).map((p: any, i: number) => (
                    <div key={i} className="flex items-center gap-1.5 bg-gray-50 border border-gray-100 rounded-lg px-3 py-1.5 text-xs">
                      <div>
                        <span className="font-semibold text-gray-800">{p.name}</span>
                        {p.nameUrdu && <span className="ml-2 text-green-700" dir="rtl" style={{ fontFamily: 'Noto Nastaliq Urdu, serif' }}>{p.nameUrdu}</span>}
                      </div>
                      <span className="text-gray-400">·</span>
                      <span className="text-gray-600">{p.dosage}</span>
                      <span className="text-gray-400">·</span>
                      <span className="text-gray-600">{p.frequency}</span>
                      <span className="text-gray-400">·</span>
                      <span className="text-gray-600">{p.duration}</span>
                      <span className="text-gray-400">→</span>
                      <span className="font-bold text-blue-700">{calcQty(p.frequency, p.duration)} units</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Dispense Modal */}
      {selectedOrder && (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl w-full max-w-2xl my-4">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <div>
                <h2 className="font-semibold text-gray-900">Dispense Prescription</h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  {selectedOrder.patientName} · {selectedOrder.patientMRN} · Dr. {selectedOrder.doctorName}
                </p>
              </div>
              <button onClick={() => { setSelectedOrder(null); setDispenseItems([]); }}><X className="w-5 h-5 text-gray-400" /></button>
            </div>

            <div className="p-5 space-y-3">
              <p className="text-xs text-blue-700 bg-blue-50 px-3 py-2 rounded-lg">
                Quantities are auto-calculated from <strong>frequency × days</strong>. Adjust if needed, then link each item to a medicine in stock.
              </p>

              {dispenseItems.map((item, idx) => {
                const stockMed = medicines.find(m => m.id === item.matchedId);
                const isLow    = stockMed && stockMed.stock < item.qty;
                return (
                  <div key={idx} className={`border rounded-xl p-4 space-y-3 ${isLow ? 'border-red-200 bg-red-50/30' : 'border-gray-100'}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-gray-900 text-sm">{item.name}</div>
                        {item.nameUrdu && (
                          <div className="text-xs text-green-700 mt-0.5" dir="rtl" style={{ fontFamily: 'Noto Nastaliq Urdu, serif' }}>{item.nameUrdu}</div>
                        )}
                        <div className="text-xs text-gray-500 mt-0.5">{item.dosage} · {item.frequency} · {item.duration}</div>
                        <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                          <span className="bg-blue-100 text-blue-800 text-xs font-mono px-2 py-0.5 rounded">
                            {parseFrequency(item.frequency)} dose/day
                          </span>
                          <span className="text-gray-400 text-xs">×</span>
                          <span className="bg-blue-100 text-blue-800 text-xs font-mono px-2 py-0.5 rounded">
                            {parseDuration(item.duration)} days
                          </span>
                          <span className="text-gray-400 text-xs">=</span>
                          <span className="bg-green-100 text-green-800 text-xs font-bold px-2 py-0.5 rounded">
                            {parseFrequency(item.frequency) * parseDuration(item.duration)} units
                          </span>
                        </div>
                      </div>
                      <div className="flex flex-col items-center gap-1 shrink-0">
                        <label className="text-xs text-gray-500">Dispense Qty</label>
                        <input type="number" min="1" value={item.qty}
                          onChange={e => updateDispenseItem(idx, 'qty', Math.max(1, parseInt(e.target.value) || 1))}
                          className="w-24 border-2 border-blue-300 rounded-lg px-2 py-1.5 text-base text-center font-bold text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-blue-50" />
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-gray-500 shrink-0">Link to stock:</label>
                      <select value={item.matchedId}
                        onChange={e => updateDispenseItem(idx, 'matchedId', e.target.value)}
                        className={`flex-1 border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${item.matchedId ? 'border-green-300 bg-green-50' : 'border-gray-200'}`}>
                        <option value="">— Select medicine from stock —</option>
                        {medicines.map(m => (
                          <option key={m.id} value={m.id}>{m.name} (stock: {m.stock})</option>
                        ))}
                      </select>
                    </div>
                    {isLow && (
                      <p className="text-xs text-red-600 flex items-center gap-1">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        Insufficient stock — only {stockMed.stock} units available, need {item.qty}
                      </p>
                    )}
                    {item.matchedId && !isLow && (
                      <p className="text-xs text-green-700 font-medium">
                        ✓ Will deduct {item.qty} units · remaining after dispense: {stockMed ? stockMed.stock - item.qty : '?'}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex gap-3 px-5 pb-5">
              <button onClick={() => { setSelectedOrder(null); setDispenseItems([]); }}
                className="flex-1 border border-gray-200 text-gray-600 py-2 rounded-lg text-sm">Cancel</button>
              <button onClick={handleDispense} disabled={saving}
                className="flex-1 bg-green-600 text-white py-2 rounded-lg text-sm font-medium disabled:opacity-60 flex items-center justify-center gap-2">
                <CheckCircle className="w-4 h-4" />
                {saving ? 'Dispensing...' : 'Confirm Dispense & Deduct Stock'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Medicine Modal */}
      {showMedModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">{editMedId ? 'Edit Medicine' : 'Add Medicine'}</h2>
              <button onClick={() => setShowMedModal(false)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="p-5 space-y-4">
              {error && <div className="bg-red-50 text-red-600 text-sm p-3 rounded-lg">{error}</div>}
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Medicine Name *</label>
                  <input value={medForm.name} onChange={e => mf('name', e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">دوائی کا نام (اردو) — Urdu Name</label>
                  <input
                    value={medForm.nameUrdu || ''}
                    onChange={e => mf('nameUrdu', e.target.value)}
                    placeholder="مثلاً: پیراسیٹامول"
                    dir="rtl"
                    style={{ fontFamily: 'Noto Nastaliq Urdu, serif' }}
                    className="w-full border border-green-200 bg-green-50 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Category</label>
                  <select value={medForm.category} onChange={e => mf('category', e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Manufacturer</label>
                  <input value={medForm.manufacturer} onChange={e => mf('manufacturer', e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Batch No.</label>
                  <input value={medForm.batchNo} onChange={e => mf('batchNo', e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Expiry Date</label>
                  <input type="date" value={medForm.expiryDate} onChange={e => mf('expiryDate', e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Units Per Box</label>
                  <input type="number" min="1" value={medForm.unitsPerBox} onChange={e => mf('unitsPerBox', e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Stock (Boxes)</label>
                  <input type="number" min="0" value={medForm.stockBoxes} onChange={e => mf('stockBoxes', e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Stock (Loose Units)</label>
                  <input type="number" min="0" value={medForm.stockLoose} onChange={e => mf('stockLoose', e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Cost Price (per box)</label>
                  <input type="number" value={medForm.costPrice} onChange={e => mf('costPrice', e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Retail Price (per box) *</label>
                  <input type="number" value={medForm.retailPrice} onChange={e => mf('retailPrice', e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Reorder Level (units)</label>
                  <input type="number" value={medForm.reorderLevel} onChange={e => mf('reorderLevel', e.target.value)}
                    placeholder="10"
                    className="w-full border border-orange-200 bg-orange-50 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
                  <p className="text-xs text-gray-400 mt-1">Alert when stock drops below this number</p>
                </div>
              </div>
            </div>
            <div className="flex gap-3 px-5 pb-5">
              <button onClick={() => setShowMedModal(false)} className="flex-1 border border-gray-200 text-gray-600 py-2 rounded-lg text-sm">Cancel</button>
              <button onClick={handleSaveMed} disabled={saving} className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm disabled:opacity-60">{saving ? '...' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Purchase Modal */}
      {showPurchaseModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">Record Purchase</h2>
              <button onClick={() => setShowPurchaseModal(false)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="p-5 space-y-4">
              {error && <div className="bg-red-50 text-red-600 text-sm p-3 rounded-lg">{error}</div>}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Medicine *</label>
                {purchaseForm.medicineId ? (
                  <div className="flex items-center gap-2 border border-green-200 bg-green-50 rounded-lg px-3 py-2">
                    <span className="text-sm font-medium text-green-800 flex-1">{purchaseForm.medicineName}</span>
                    <button onClick={() => setPurchaseForm(p => ({ ...p, medicineId: '', medicineName: '' }))}><X className="w-3.5 h-3.5 text-green-600" /></button>
                  </div>
                ) : (
                  <div className="relative">
                    <input value={medSearch} onChange={e => setMedSearch(e.target.value)} placeholder="Search medicine..." className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    {medSearch && (
                      <div className="absolute top-full left-0 right-0 bg-white border border-gray-200 rounded-lg shadow-lg z-10 mt-1 max-h-40 overflow-y-auto">
                        {medicines.filter(m => m.name?.toLowerCase().includes(medSearch.toLowerCase())).slice(0, 6).map(m => (
                          <button key={m.id} onClick={() => { setPurchaseForm(p => ({ ...p, medicineId: m.id, medicineName: m.name })); setMedSearch(''); }} className="w-full text-left px-3 py-2 hover:bg-blue-50 text-sm border-b last:border-0">{m.name}</button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                {[
                  { label: 'Purchase Date', key: 'date', type: 'date' },
                  { label: 'Boxes Purchased *', key: 'boxes', type: 'number' },
                  { label: 'Cost Per Box (Rs.)', key: 'costPerBox', type: 'number' },
                  { label: 'Batch No.', key: 'batchNo', type: 'text' },
                  { label: 'Expiry Date', key: 'expiryDate', type: 'date' },
                  { label: 'Invoice No.', key: 'invoiceNo', type: 'text' },
                ].map(({ label, key, type }) => (
                  <div key={key}>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
                    <input type={type} value={(purchaseForm as any)[key]} onChange={e => pf(key, e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                ))}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Supplier</label>
                  <select value={purchaseForm.supplierId} onChange={e => { const s = suppliers.find(s => s.id === e.target.value); setPurchaseForm(p => ({ ...p, supplierId: s?.id || '', supplierName: s?.name || '' })); }} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">— Select Supplier —</option>
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              </div>
              {purchaseForm.boxes && purchaseForm.costPerBox && (
                <div className="bg-blue-50 rounded-lg p-3 text-sm">
                  <span className="text-blue-600">Total Cost: </span>
                  <span className="font-bold text-blue-800">Rs. {(parseInt(purchaseForm.boxes) * parseFloat(purchaseForm.costPerBox)).toLocaleString()}</span>
                </div>
              )}
            </div>
            <div className="flex gap-3 px-5 pb-5">
              <button onClick={() => setShowPurchaseModal(false)} className="flex-1 border border-gray-200 text-gray-600 py-2 rounded-lg text-sm">Cancel</button>
              <button onClick={handleSavePurchase} disabled={saving} className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm disabled:opacity-60">{saving ? '...' : 'Save Purchase'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
