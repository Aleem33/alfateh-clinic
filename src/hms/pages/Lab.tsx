import { useState, useEffect } from 'react';
import { collection, onSnapshot, addDoc, updateDoc, doc } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { db, storage } from '../../firebase';
import { formatDate, today, nowISO } from '../lib/utils';
import { Plus, Search, X, CheckCircle, Clock, BookOpen, Printer, FileText, Upload } from 'lucide-react';
import { queueLabReportUpload } from '../../lib/offlineSync';
import { waitForOnlineWrite } from '../../lib/offlineWrite';

const CATEGORIES = ['Hematology', 'Biochemistry', 'Microbiology', 'Serology', 'Urine Analysis', 'Imaging', 'Pathology', 'Other'];

const MAX_REPORT_PDF_SIZE = 12 * 1024 * 1024;

function safeFileName(name: string) {
  return name.replace(/[^a-z0-9._-]+/gi, '_').replace(/^_+|_+$/g, '') || 'lab-report.pdf';
}

export function Lab() {
  const [labOrders, setLabOrders] = useState<any[]>([]);
  const [labTests, setLabTests] = useState<any[]>([]);
  const [patients, setPatients] = useState<any[]>([]);
  const [tab, setTab] = useState<'orders' | 'catalog'>('orders');
  const [statusFilter, setStatusFilter] = useState<'pending' | 'in-progress' | 'completed' | 'all'>('pending');
  const [search, setSearch] = useState('');
  const [showResultModal, setShowResultModal] = useState<any | null>(null);
  const [showTestModal, setShowTestModal] = useState(false);
  const [editTestId, setEditTestId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [resultError, setResultError] = useState('');
  const [testForm, setTestForm] = useState({ name: '', category: 'Hematology', price: '', unit: '', normalRange: '', turnaround: '24 hours' });
  const [results, setResults] = useState<any[]>([]);
  const [reportPdf, setReportPdf] = useState<File | null>(null);
  // New Order state
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [orderPatientSearch, setOrderPatientSearch] = useState('');
  const [orderForm, setOrderForm] = useState({ patientId: '', patientName: '', patientMRN: '', doctorName: '', selectedTests: [] as string[] });
  const [orderError, setOrderError] = useState('');

  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'labOrders'), snap =>
      setLabOrders(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a: any, b: any) => b.createdAt > a.createdAt ? 1 : -1))
    );
    const u2 = onSnapshot(collection(db, 'labTests'), snap =>
      setLabTests(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a: any, b: any) => a.name > b.name ? 1 : -1))
    );
    const u3 = onSnapshot(collection(db, 'patients'), snap =>
      setPatients(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );
    return () => { u1(); u2(); u3(); };
  }, []);

  const handleSaveOrder = async () => {
    if (!orderForm.patientId) { setOrderError('Select a patient.'); return; }
    if (orderForm.selectedTests.length === 0) { setOrderError('Select at least one test.'); return; }
    setSaving(true); setOrderError('');
    try {
      const tests = orderForm.selectedTests.map(tid => {
        const t = labTests.find(lt => lt.id === tid)!;
        return { testId: t.id, testName: t.name, price: t.price, unit: t.unit || '', normalRange: t.normalRange || '' };
      });
      await addDoc(collection(db, 'labOrders'), {
        patientId: orderForm.patientId, patientName: orderForm.patientName, patientMRN: orderForm.patientMRN,
        doctorName: orderForm.doctorName, tests, status: 'pending',
        date: new Date().toISOString(), createdAt: nowISO(),
      });
      setShowOrderModal(false);
      setOrderForm({ patientId: '', patientName: '', patientMRN: '', doctorName: '', selectedTests: [] });
      setOrderPatientSearch('');
    } catch (e: any) { setOrderError(e.message); }
    finally { setSaving(false); }
  };

  const toggleTest = (tid: string) => {
    setOrderForm(f => ({
      ...f, selectedTests: f.selectedTests.includes(tid)
        ? f.selectedTests.filter(x => x !== tid)
        : [...f.selectedTests, tid]
    }));
  };

  const filteredOrders = labOrders.filter(o => {
    const matchStatus = statusFilter === 'all' || o.status === statusFilter;
    const matchSearch = !search || o.patientName?.toLowerCase().includes(search.toLowerCase()) || o.patientMRN?.includes(search);
    return matchStatus && matchSearch;
  });

  const filteredTests = labTests.filter(t => !search || t.name?.toLowerCase().includes(search.toLowerCase()) || t.category?.toLowerCase().includes(search.toLowerCase()));

  const openResultEntry = (order: any) => {
    const preResults = order.tests.map((t: any) => ({
      testId: t.testId, testName: t.testName, result: t.result || '', unit: t.unit || '', normalRange: t.normalRange || '', status: 'normal',
    }));
    setResults(preResults);
    setReportPdf(null);
    setResultError('');
    setShowResultModal(order);
  };

  const updateResult = (idx: number, key: string, val: string) => {
    setResults(r => r.map((item, i) => i === idx ? { ...item, [key]: val } : item));
  };

  const handleSaveResults = async () => {
    if (!showResultModal) return;
    if (!results.some(r => r.result?.trim()) && !reportPdf && !showResultModal.reportPdf?.url) {
      setResultError('Enter at least one result or upload a PDF report.');
      return;
    }
    setSaving(true);
    setResultError('');
    try {
      let reportPdfData = showResultModal.reportPdf || null;
      if (reportPdf) {
        const path = `labReports/${showResultModal.id}/${Date.now()}-${safeFileName(reportPdf.name)}`;
        try {
          if (!navigator.onLine) throw new Error('Offline: PDF upload queued.');
          const storageRef = ref(storage, path);
          await uploadBytes(storageRef, reportPdf, { contentType: 'application/pdf' });
          const url = await getDownloadURL(storageRef);
          reportPdfData = {
            name: reportPdf.name,
            size: reportPdf.size,
            type: reportPdf.type || 'application/pdf',
            storagePath: path,
            url,
            uploadedAt: nowISO(),
            pendingUpload: false,
          };
        } catch (uploadError: any) {
          await queueLabReportUpload({ orderId: showResultModal.id, file: reportPdf, storagePath: path });
          reportPdfData = {
            name: reportPdf.name,
            size: reportPdf.size,
            type: reportPdf.type || 'application/pdf',
            storagePath: path,
            url: '',
            pendingUpload: true,
            queuedAt: nowISO(),
            uploadError: uploadError?.message || '',
          };
        }
      }
      await waitForOnlineWrite(updateDoc(doc(db, 'labOrders', showResultModal.id), {
        results,
        reportPdf: reportPdfData,
        status: 'completed',
        completedAt: showResultModal.completedAt || nowISO(),
        updatedAt: nowISO(),
      }));
      setReportPdf(null);
      setShowResultModal(null);
    } catch (e: any) { setResultError(e.message || 'Could not save lab report.'); }
    finally { setSaving(false); }
  };

  const handlePdfSelect = (file?: File) => {
    if (!file) return;
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setResultError('Please select a PDF file.');
      return;
    }
    if (file.size > MAX_REPORT_PDF_SIZE) {
      setResultError('PDF must be 12 MB or smaller.');
      return;
    }
    setReportPdf(file);
    setResultError('');
  };

  const updateOrderStatus = async (id: string, status: string) => {
    await updateDoc(doc(db, 'labOrders', id), { status, updatedAt: nowISO() });
  };

  const handleSaveTest = async () => {
    if (!testForm.name || !testForm.price) return;
    setSaving(true);
    try {
      const data = { ...testForm, price: Number(testForm.price), updatedAt: nowISO() };
      if (editTestId) { await updateDoc(doc(db, 'labTests', editTestId), data); }
      else { await addDoc(collection(db, 'labTests'), { ...data, createdAt: nowISO() }); }
      setShowTestModal(false);
      setEditTestId(null);
      setTestForm({ name: '', category: 'Hematology', price: '', unit: '', normalRange: '', turnaround: '24 hours' });
    } catch (e) { console.error(e); }
    finally { setSaving(false); }
  };

  const pendingCount = labOrders.filter(o => o.status === 'pending').length;
  const inProgressCount = labOrders.filter(o => o.status === 'in-progress').length;

  const statusBadge = (s: string) => {
    const map: Record<string, string> = { pending: 'bg-yellow-100 text-yellow-700', 'in-progress': 'bg-blue-100 text-blue-700', completed: 'bg-green-100 text-green-700' };
    return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${map[s] || 'bg-gray-100 text-gray-600'}`}>{s}</span>;
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Laboratory</h1>
          <p className="text-sm text-gray-500">{pendingCount} pending · {inProgressCount} in progress</p>
        </div>
        <div className="flex items-center gap-2">
          {tab === 'orders' && (
            <button onClick={() => { setOrderForm({ patientId: '', patientName: '', patientMRN: '', doctorName: '', selectedTests: [] }); setOrderPatientSearch(''); setOrderError(''); setShowOrderModal(true); }}
              className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
              <Plus className="w-4 h-4" /> New Order
            </button>
          )}
          {tab === 'catalog' && (
            <button onClick={() => { setEditTestId(null); setTestForm({ name: '', category: 'Hematology', price: '', unit: '', normalRange: '', turnaround: '24 hours' }); setShowTestModal(true); }}
              className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
              <Plus className="w-4 h-4" /> Add Test
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-4">
        <div className="flex bg-white border border-gray-200 rounded-lg p-1 gap-1">
          {(['orders', 'catalog'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium ${tab === t ? 'bg-blue-600 text-white' : 'text-gray-500 hover:text-gray-700'}`}>
              {t === 'orders' ? <><Clock className="w-3.5 h-3.5" /> Orders</> : <><BookOpen className="w-3.5 h-3.5" /> Test Catalog</>}
            </button>
          ))}
        </div>
        {tab === 'orders' && (
          <div className="flex bg-gray-100 rounded-lg p-1 gap-1">
            {(['pending', 'in-progress', 'completed', 'all'] as const).map(s => (
              <button key={s} onClick={() => setStatusFilter(s)} className={`px-3 py-1.5 rounded-md text-xs font-medium ${statusFilter === s ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500'}`}>{s}</button>
            ))}
          </div>
        )}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder={tab === 'orders' ? 'Search patient...' : 'Search test...'} className="w-full pl-9 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </div>

      {/* Lab Orders Table */}
      {tab === 'orders' && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>{['Date', 'Patient', 'Doctor', 'Tests', 'Report', 'Status', 'Actions'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>
              ))}</tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filteredOrders.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-12 text-gray-400">No orders found</td></tr>
              ) : filteredOrders.map(o => (
                <tr key={o.id} className="hover:bg-gray-50/50">
                  <td className="px-4 py-3 text-sm text-gray-600">{formatDate(o.date)}</td>
                  <td className="px-4 py-3">
                    <div className="text-sm font-medium text-gray-900">{o.patientName}</div>
                    <div className="text-xs text-gray-400">{o.patientMRN}</div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">{o.doctorName || '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {o.tests?.map((t: any, i: number) => (
                        <span key={i} className="bg-gray-100 text-gray-600 text-xs px-2 py-0.5 rounded-full">{t.testName}</span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {o.reportPdf?.pendingUpload ? (
                      <span className="inline-flex items-center gap-1 text-xs text-amber-700 border border-amber-100 bg-amber-50 px-2 py-1 rounded-lg font-medium">
                        <Clock className="w-3 h-3" /> PDF upload pending
                      </span>
                    ) : o.reportPdf?.url ? (
                      <button
                        onClick={() => window.open(o.reportPdf.url, '_blank')}
                        className="inline-flex items-center gap-1 text-xs text-red-600 hover:text-red-700 border border-red-100 bg-red-50 px-2 py-1 rounded-lg font-medium"
                      >
                        <FileText className="w-3 h-3" /> PDF
                      </button>
                    ) : (
                      <span className="text-xs text-gray-400">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3">{statusBadge(o.status)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      {o.status === 'pending' && (
                        <button onClick={() => updateOrderStatus(o.id, 'in-progress')} className="text-xs bg-blue-50 text-blue-700 hover:bg-blue-100 px-2 py-1 rounded-lg font-medium">Start</button>
                      )}
                      {(o.status === 'in-progress' || o.status === 'pending') && (
                        <button onClick={() => openResultEntry(o)} className="flex items-center gap-1 text-xs bg-green-50 text-green-700 hover:bg-green-100 px-2 py-1 rounded-lg font-medium">
                          <CheckCircle className="w-3 h-3" /> Enter Results
                        </button>
                      )}
                      {o.status === 'completed' && (
                        <button onClick={() => openResultEntry(o)} className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded-lg border border-gray-200">View Results</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Test Catalog */}
      {tab === 'catalog' && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>{['Test Name', 'Category', 'Price', 'Normal Range', 'Unit', 'Turnaround', ''].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>
              ))}</tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filteredTests.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-12 text-gray-400">No tests in catalog. Add tests to get started.</td></tr>
              ) : filteredTests.map(t => (
                <tr key={t.id} className="hover:bg-gray-50/50">
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">{t.name}</td>
                  <td className="px-4 py-3"><span className="bg-purple-50 text-purple-700 text-xs px-2 py-0.5 rounded-full">{t.category}</span></td>
                  <td className="px-4 py-3 text-sm font-medium text-gray-800">Rs. {t.price}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{t.normalRange || '—'}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{t.unit || '—'}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{t.turnaround || '—'}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => { setEditTestId(t.id); setTestForm({ name: t.name, category: t.category, price: String(t.price), unit: t.unit || '', normalRange: t.normalRange || '', turnaround: t.turnaround || '24 hours' }); setShowTestModal(true); }} className="text-xs text-blue-600 hover:text-blue-800 font-medium">Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Result Entry Modal */}
      {showResultModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <div>
                <h2 className="font-semibold text-gray-900">Enter Results</h2>
                <p className="text-xs text-gray-400">{showResultModal.patientName} · {formatDate(showResultModal.date)}</p>
              </div>
              <button onClick={() => setShowResultModal(null)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="p-5 space-y-3">
              {resultError && <div className="bg-red-50 text-red-600 text-sm p-3 rounded-lg">{resultError}</div>}
              <div className="border border-red-100 bg-red-50/60 rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 bg-white rounded-lg flex items-center justify-center shrink-0">
                    <FileText className="w-4 h-4 text-red-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-gray-900 text-sm">PDF Lab Report</div>
                    <p className="text-xs text-gray-500 mt-0.5">Upload the finalized report PDF. The file is saved with this lab order.</p>
                    {showResultModal.reportPdf?.url && !reportPdf && (
                      <button
                        onClick={() => window.open(showResultModal.reportPdf.url, '_blank')}
                        className="mt-2 inline-flex items-center gap-1.5 text-xs text-red-700 bg-white border border-red-100 rounded-lg px-2.5 py-1.5 font-medium hover:bg-red-50"
                      >
                        <FileText className="w-3.5 h-3.5" /> Open saved PDF
                      </button>
                    )}
                    {reportPdf && (
                      <div className="mt-2 text-xs text-red-700 bg-white border border-red-100 rounded-lg px-2.5 py-1.5">
                        {reportPdf.name} ({(reportPdf.size / 1024 / 1024).toFixed(2)} MB)
                      </div>
                    )}
                  </div>
                  <label className="inline-flex items-center gap-1.5 text-xs bg-red-600 text-white rounded-lg px-3 py-2 font-medium hover:bg-red-700 cursor-pointer">
                    <Upload className="w-3.5 h-3.5" /> {showResultModal.reportPdf?.url ? 'Replace PDF' : 'Upload PDF'}
                    <input
                      type="file"
                      accept="application/pdf,.pdf"
                      className="hidden"
                      onChange={e => handlePdfSelect(e.target.files?.[0])}
                    />
                  </label>
                </div>
              </div>
              {results.map((r, i) => (
                <div key={i} className="border border-gray-100 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-medium text-gray-800 text-sm">{r.testName}</span>
                    <select value={r.status} onChange={e => updateResult(i, 'status', e.target.value)} className={`text-xs px-2 py-0.5 rounded-full font-medium border-0 focus:outline-none focus:ring-2 focus:ring-blue-400 ${r.status === 'normal' ? 'bg-green-100 text-green-700' : r.status === 'abnormal' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}`}>
                      <option value="normal">Normal</option>
                      <option value="abnormal">Abnormal</option>
                      <option value="borderline">Borderline</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="text-xs text-gray-400 block mb-1">Result</label>
                      <input value={r.result} onChange={e => updateResult(i, 'result', e.target.value)} className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 block mb-1">Unit</label>
                      <input value={r.unit} onChange={e => updateResult(i, 'unit', e.target.value)} className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 block mb-1">Normal Range</label>
                      <input value={r.normalRange} onChange={e => updateResult(i, 'normalRange', e.target.value)} className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-3 px-5 pb-5">
              <button onClick={() => setShowResultModal(null)} className="flex-1 border border-gray-200 text-gray-600 py-2 rounded-lg text-sm">Cancel</button>
              <button onClick={handleSaveResults} disabled={saving || (showResultModal.status === 'completed' && !reportPdf)} className="flex-1 bg-green-600 text-white py-2 rounded-lg text-sm disabled:opacity-60">
                {saving ? 'Saving...' : showResultModal.status === 'completed' && !reportPdf ? 'Already Saved' : 'Save Report'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Lab Order Modal */}
      {showOrderModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-gray-100 sticky top-0 bg-white rounded-t-2xl">
              <h2 className="font-semibold text-gray-900">New Lab Order</h2>
              <button onClick={() => setShowOrderModal(false)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="p-5 space-y-4">
              {orderError && <div className="bg-red-50 text-red-600 text-sm p-3 rounded-lg">{orderError}</div>}

              {/* Patient */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Patient *</label>
                {orderForm.patientId ? (
                  <div className="flex items-center gap-2 border border-green-200 bg-green-50 rounded-lg px-3 py-2">
                    <span className="text-sm font-medium text-green-800 flex-1">{orderForm.patientName} <span className="text-xs font-normal text-green-600">({orderForm.patientMRN})</span></span>
                    <button onClick={() => setOrderForm(f => ({ ...f, patientId: '', patientName: '', patientMRN: '' }))}><X className="w-3.5 h-3.5 text-green-600" /></button>
                  </div>
                ) : (
                  <div className="relative">
                    <input value={orderPatientSearch} onChange={e => setOrderPatientSearch(e.target.value)} placeholder="Search patient by name or MRN..."
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    {orderPatientSearch && (
                      <div className="absolute top-full left-0 right-0 bg-white border border-gray-200 rounded-lg shadow-lg z-10 mt-1 max-h-40 overflow-y-auto">
                        {patients.filter(p => p.name?.toLowerCase().includes(orderPatientSearch.toLowerCase()) || p.mrn?.includes(orderPatientSearch)).slice(0, 6).map(p => (
                          <button key={p.id} onClick={() => { setOrderForm(f => ({ ...f, patientId: p.id, patientName: p.name, patientMRN: p.mrn })); setOrderPatientSearch(''); }}
                            className="w-full text-left px-3 py-2.5 hover:bg-blue-50 text-sm border-b last:border-0">
                            <span className="font-medium">{p.name}</span> <span className="text-xs text-gray-400">({p.mrn})</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Doctor */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Referred by Doctor</label>
                <input value={orderForm.doctorName} onChange={e => setOrderForm(f => ({ ...f, doctorName: e.target.value }))} placeholder="Dr. Name"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>

              {/* Tests */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-2">Select Tests * ({orderForm.selectedTests.length} selected)</label>
                {labTests.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-4 border border-dashed border-gray-200 rounded-lg">No tests in catalog. Add tests first.</p>
                ) : (
                  <div className="border border-gray-200 rounded-xl overflow-hidden max-h-52 overflow-y-auto">
                    {CATEGORIES.map(cat => {
                      const catTests = labTests.filter(t => t.category === cat);
                      if (catTests.length === 0) return null;
                      return (
                        <div key={cat}>
                          <div className="bg-gray-50 px-3 py-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wider sticky top-0">{cat}</div>
                          {catTests.map(t => (
                            <label key={t.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-blue-50 cursor-pointer border-b border-gray-50 last:border-0">
                              <input type="checkbox" checked={orderForm.selectedTests.includes(t.id)} onChange={() => toggleTest(t.id)}
                                className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500" />
                              <span className="flex-1 text-sm text-gray-800">{t.name}</span>
                              <span className="text-xs text-gray-400">Rs. {t.price}</span>
                            </label>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                )}
                {orderForm.selectedTests.length > 0 && (
                  <div className="mt-2 bg-blue-50 rounded-lg px-3 py-2 text-sm">
                    <span className="text-blue-600">Total: </span>
                    <span className="font-bold text-blue-800">Rs. {orderForm.selectedTests.reduce((s, tid) => s + (labTests.find(t => t.id === tid)?.price || 0), 0).toLocaleString()}</span>
                  </div>
                )}
              </div>
            </div>
            <div className="flex gap-3 px-5 pb-5">
              <button onClick={() => setShowOrderModal(false)} className="flex-1 border border-gray-200 text-gray-600 py-2 rounded-lg text-sm">Cancel</button>
              <button onClick={handleSaveOrder} disabled={saving} className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-60">
                {saving ? 'Saving...' : 'Create Order'}
              </button>
            </div>
          </div>
        </div>
      )}
      {showTestModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">{editTestId ? 'Edit Test' : 'Add Lab Test'}</h2>
              <button onClick={() => setShowTestModal(false)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="p-5 space-y-3">
              {[
                { label: 'Test Name *', key: 'name', type: 'text' },
                { label: 'Price (Rs.) *', key: 'price', type: 'number' },
                { label: 'Unit', key: 'unit', type: 'text', placeholder: 'mg/dL, g/L...' },
                { label: 'Normal Range', key: 'normalRange', type: 'text', placeholder: '70-110' },
                { label: 'Turnaround', key: 'turnaround', type: 'text', placeholder: '24 hours' },
              ].map(({ label, key, type, placeholder }) => (
                <div key={key}>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
                  <input type={type} value={(testForm as any)[key]} placeholder={placeholder} onChange={e => setTestForm(p => ({ ...p, [key]: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              ))}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Category</label>
                <select value={testForm.category} onChange={e => setTestForm(p => ({ ...p, category: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-3 px-5 pb-5">
              <button onClick={() => setShowTestModal(false)} className="flex-1 border border-gray-200 text-gray-600 py-2 rounded-lg text-sm">Cancel</button>
              <button onClick={handleSaveTest} disabled={saving} className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm disabled:opacity-60">{saving ? '...' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
