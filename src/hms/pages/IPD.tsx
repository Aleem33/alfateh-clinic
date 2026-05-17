import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, addDoc, updateDoc, doc } from 'firebase/firestore';
import { db, auth, getNextBillNo } from '../../firebase';
import { formatDate, today, nowISO } from '../lib/utils';
import { logAudit } from '../lib/audit';
import { Plus, Search, X, BedDouble, LogOut, Eye, Pill, FileText, Activity, ChevronDown, ChevronUp } from 'lucide-react';
import { differenceInDays } from 'date-fns';
import { cn } from '../lib/utils';

const TREATMENT_TYPES = ['Medication', 'Procedure', 'Lab Test', 'Vitals', 'Nursing Note', 'Doctor Note'];

export function IPD() {
  const [admissions, setAdmissions] = useState<any[]>([]);
  const [patients, setPatients] = useState<any[]>([]);
  const [staff, setStaff] = useState<any[]>([]);
  const [wards, setWards] = useState<any[]>([]);
  const [beds, setBeds] = useState<any[]>([]);
  const [treatments, setTreatments] = useState<any[]>([]);

  const [tab, setTab] = useState<'current' | 'discharged'>('current');
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [showDischarge, setShowDischarge] = useState<any | null>(null);
  const [viewAdmission, setViewAdmission] = useState<any | null>(null);
  const [showTreatmentModal, setShowTreatmentModal] = useState<any | null>(null); // admission doc
  const [expandedAdmission, setExpandedAdmission] = useState<string | null>(null);

  const [form, setForm] = useState({ patientId: '', patientName: '', patientMRN: '', patientAge: '', patientGender: '', doctorId: '', doctorName: '', wardId: '', wardName: '', bedId: '', bedNo: '', dailyRate: '2000', admissionDate: today(), diagnosis: '', notes: '', referredBy: '' });
  const [patientSearch, setPatientSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [dischargeSummary, setDischargeSummary] = useState('');
  const [dischargeDate, setDischargeDate] = useState(today());

  // Treatment form
  const [treatForm, setTreatForm] = useState({ type: 'Medication', description: '', date: today(), time: '08:00' });

  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'admissions'), snap => setAdmissions(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a: any, b: any) => b.admissionDate > a.admissionDate ? 1 : -1)));
    const u2 = onSnapshot(collection(db, 'patients'), snap => setPatients(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    const u3 = onSnapshot(collection(db, 'staff'), snap => setStaff(snap.docs.filter(d => d.data().role === 'doctor').map(d => ({ id: d.id, ...d.data() }))));
    const u4 = onSnapshot(collection(db, 'wards'), snap => setWards(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    const u5 = onSnapshot(collection(db, 'beds'), snap => setBeds(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    const u6 = onSnapshot(collection(db, 'bedTreatments'), snap => setTreatments(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    return () => { u1(); u2(); u3(); u4(); u5(); u6(); };
  }, []);

  const filtered = admissions.filter(a => {
    const matchTab = tab === 'current' ? a.status === 'admitted' : a.status === 'discharged';
    const matchSearch = !search || a.patientName?.toLowerCase().includes(search.toLowerCase()) || a.patientMRN?.includes(search);
    return matchTab && matchSearch;
  });

  const filteredPatients = patients.filter(p => !patientSearch || p.name?.toLowerCase().includes(patientSearch.toLowerCase()) || p.mrn?.includes(patientSearch)).slice(0, 5);

  // Available beds (not occupied)
  const occupiedBedIds = admissions.filter(a => a.status === 'admitted').map(a => a.bedId).filter(Boolean);
  const availableBeds = beds.filter(b => !occupiedBedIds.includes(b.id));
  const wardBeds = form.wardId ? availableBeds.filter(b => b.wardId === form.wardId) : availableBeds;

  const handleSave = async () => {
    if (!form.patientId || !form.wardId) { setError('Patient and ward are required.'); return; }
    if (form.bedId) {
      const bedTaken = admissions.find(a => a.status === 'admitted' && a.bedId === form.bedId);
      if (bedTaken) { setError('This bed is already occupied.'); return; }
    }
    setSaving(true); setError('');
    try {
      const ref = await addDoc(collection(db, 'admissions'), { ...form, dailyRate: Number(form.dailyRate), status: 'admitted', createdAt: nowISO() });
      // Mark bed as occupied
      if (form.bedId) await updateDoc(doc(db, 'beds', form.bedId), { status: 'occupied' });
      await logAudit('create', 'admission', ref.id, `${form.patientName} → ${form.wardName} Bed ${form.bedNo}`);
      setShowModal(false);
      setForm({ patientId: '', patientName: '', patientMRN: '', patientAge: '', patientGender: '', doctorId: '', doctorName: '', wardId: '', wardName: '', bedId: '', bedNo: '', dailyRate: '2000', admissionDate: today(), diagnosis: '', notes: '', referredBy: '' });
    } catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  };

  const handleDischarge = async () => {
    if (!showDischarge) return;
    setSaving(true);
    try {
      const days = differenceInDays(new Date(dischargeDate), new Date(showDischarge.admissionDate)) || 1;
      const totalCharges = days * (showDischarge.dailyRate || 0);
      const billNo = await getNextBillNo();

      // Build bill items including extra treatments
      const admTreatments = treatments.filter(t => t.admissionId === showDischarge.id && t.type === 'Medication');
      const extraItems = admTreatments.length > 0 ? [{
        description: `Medications & Treatments (${admTreatments.length} entries)`,
        category: 'Medicine', quantity: 1, rate: 0, amount: 0,
      }] : [];

      await addDoc(collection(db, 'bills'), {
        billNo, patientId: showDischarge.patientId, patientName: showDischarge.patientName, patientMRN: showDischarge.patientMRN,
        date: dischargeDate,
        items: [
          { description: `IPD — ${showDischarge.wardName || showDischarge.ward} Bed ${showDischarge.bedNo}`, category: 'IPD Charges', quantity: days, rate: showDischarge.dailyRate || 0, amount: totalCharges },
          ...extraItems,
        ],
        subtotal: totalCharges, discount: 0, total: totalCharges, paid: 0, balance: totalCharges,
        paymentStatus: 'pending', paymentMethod: 'Cash', cashierId: auth.currentUser?.uid || '',
        notes: `Auto-generated on discharge. ${showDischarge.admissionDate} → ${dischargeDate}`, createdAt: nowISO(),
      });

      await updateDoc(doc(db, 'admissions', showDischarge.id), { status: 'discharged', dischargeDate, dischargeSummary, totalCharges, updatedAt: nowISO() });

      // Free up the bed
      if (showDischarge.bedId) await updateDoc(doc(db, 'beds', showDischarge.bedId), { status: 'available' });
      await logAudit('update', 'admission', showDischarge.id, `${showDischarge.patientName} discharged`);

      setShowDischarge(null); setDischargeSummary(''); setDischargeDate(today());
    } catch (e: any) { alert('Discharge failed: ' + e.message); }
    finally { setSaving(false); }
  };

  const handleAddTreatment = async () => {
    if (!treatForm.description.trim() || !showTreatmentModal) return;
    setSaving(true);
    try {
      await addDoc(collection(db, 'bedTreatments'), {
        ...treatForm, admissionId: showTreatmentModal.id,
        patientId: showTreatmentModal.patientId, patientName: showTreatmentModal.patientName,
        wardName: showTreatmentModal.wardName, bedNo: showTreatmentModal.bedNo,
        addedBy: auth.currentUser?.email || 'staff', createdAt: nowISO(),
      });
      setTreatForm({ type: 'Medication', description: '', date: today(), time: '08:00' });
    } catch (e: any) { alert(e.message); }
    finally { setSaving(false); }
  };

  const f = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));
  const currentCount = admissions.filter(a => a.status === 'admitted').length;

  const wardSummary = wards.map(w => ({
    ...w,
    total: beds.filter(b => b.wardId === w.id).length,
    occupied: admissions.filter(a => a.status === 'admitted' && a.wardId === w.id).length,
  })).filter(w => w.total > 0);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">IPD — Inpatient</h1>
          <p className="text-sm text-gray-500">{currentCount} patients admitted · {availableBeds.length} beds available</p>
        </div>
        <button onClick={() => { setForm({ patientId: '', patientName: '', patientMRN: '', patientAge: '', patientGender: '', doctorId: '', doctorName: '', wardId: '', wardName: '', bedId: '', bedNo: '', dailyRate: '2000', admissionDate: today(), diagnosis: '', notes: '', referredBy: '' }); setError(''); setShowModal(true); }}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-blue-700">
          <Plus className="w-4 h-4" /> Admit Patient
        </button>
      </div>

      {/* Ward summary */}
      {tab === 'current' && wardSummary.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {wardSummary.slice(0, 4).map(w => (
            <div key={w.id} className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-1">
                <BedDouble className="w-4 h-4 text-blue-400" />
                <span className="text-xs text-gray-500 truncate">{w.name}</span>
              </div>
              <div className="text-2xl font-bold text-gray-900">{w.occupied}<span className="text-sm font-normal text-gray-400">/{w.total}</span></div>
              <div className="text-xs text-gray-400">beds occupied</div>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-4">
        <div className="flex bg-white border border-gray-200 rounded-lg p-1 gap-1">
          {(['current','discharged'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} className={`px-4 py-1.5 rounded-md text-sm font-medium ${tab === t ? 'bg-blue-600 text-white' : 'text-gray-500 hover:text-gray-700'}`}>
              {t === 'current' ? 'Currently Admitted' : 'Discharged'}
            </button>
          ))}
        </div>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search patient..."
            className="w-full pl-9 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </div>

      {/* Admissions Table + expandable treatment row */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>{['Patient','Ward / Bed','Doctor','Admitted',tab === 'current' ? 'Days' : 'Discharged','Rate','Treatments','Actions'].map(h => (
              <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-12 text-gray-400">No records found</td></tr>
            ) : filtered.map(a => {
              const days = differenceInDays(new Date(a.dischargeDate || new Date()), new Date(a.admissionDate)) || 1;
              const admTreatments = treatments.filter(t => t.admissionId === a.id);
              const expanded = expandedAdmission === a.id;
              return (
                <React.Fragment key={a.id}>
                  <tr className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium text-gray-900">{a.patientName}</div>
                      <div className="text-xs text-gray-400">{a.patientMRN} · {a.patientAge}y {a.patientGender}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium text-gray-700">{a.wardName || a.ward}</div>
                      <div className="text-xs text-gray-400">{a.bedNo ? `Bed ${a.bedNo}` : '—'}</div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{a.doctorName || '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{formatDate(a.admissionDate)}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {tab === 'current' ? <span className="bg-orange-50 text-orange-700 text-xs px-2 py-0.5 rounded-full font-medium">{days}d</span> : formatDate(a.dischargeDate)}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">Rs.{a.dailyRate?.toLocaleString()}/day</td>
                    <td className="px-4 py-3">
                      <button onClick={() => setExpandedAdmission(expanded ? null : a.id)}
                        className={cn('flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-lg',
                          admTreatments.length > 0 ? 'bg-blue-50 text-blue-700 hover:bg-blue-100' : 'bg-gray-100 text-gray-500 hover:bg-gray-200')}>
                        {admTreatments.length} entries {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        {tab === 'current' && (
                          <>
                            <button onClick={() => setShowTreatmentModal(a)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg" title="Add Treatment">
                              <Pill className="w-4 h-4" />
                            </button>
                            <button onClick={() => { setShowDischarge(a); setDischargeDate(today()); }} className="flex items-center gap-1 text-xs bg-red-50 text-red-600 hover:bg-red-100 px-2 py-1 rounded-lg font-medium">
                              <LogOut className="w-3 h-3" /> Discharge
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                  {expanded && (
                    <tr>
                      <td colSpan={8} className="bg-blue-50/40 px-6 py-3 border-b border-blue-100">
                        <div className="text-xs font-semibold text-blue-700 mb-2">Treatment / Care Log — {a.patientName}</div>
                        {admTreatments.length === 0 ? (
                          <p className="text-xs text-gray-400">No entries yet.</p>
                        ) : (
                          <div className="space-y-1.5 max-h-60 overflow-y-auto">
                            {admTreatments.sort((x: any, y: any) => (y.createdAt > x.createdAt ? 1 : -1)).map((t: any) => (
                              <div key={t.id} className="flex items-start gap-3 bg-white rounded-lg px-3 py-2 border border-blue-100">
                                <span className={cn('text-xs font-semibold px-2 py-0.5 rounded shrink-0',
                                  t.type === 'Medication' ? 'bg-green-100 text-green-700' :
                                  t.type === 'Procedure' ? 'bg-purple-100 text-purple-700' :
                                  t.type === 'Vitals' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600')}>
                                  {t.type}
                                </span>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm text-gray-800">{t.description}</p>
                                  <p className="text-xs text-gray-400 mt-0.5">{t.date} {t.time} · {t.addedBy}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        {tab === 'current' && (
                          <button onClick={() => setShowTreatmentModal(a)} className="mt-2 flex items-center gap-1.5 text-xs text-blue-600 font-medium hover:text-blue-700">
                            <Plus className="w-3.5 h-3.5" /> Add entry
                          </button>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Admit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl w-full max-w-lg my-4">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">Admit Patient</h2>
              <button onClick={() => setShowModal(false)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="p-5 space-y-4">
              {error && <div className="bg-red-50 text-red-600 text-sm p-3 rounded-lg">{error}</div>}
              {/* Patient select */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Patient *</label>
                {form.patientId ? (
                  <div className="flex items-center gap-2 border border-green-200 bg-green-50 rounded-lg px-3 py-2">
                    <span className="text-sm font-medium text-green-800 flex-1">{form.patientName} ({form.patientMRN})</span>
                    <button onClick={() => setForm(p => ({ ...p, patientId: '', patientName: '', patientMRN: '' }))}><X className="w-3.5 h-3.5 text-green-600" /></button>
                  </div>
                ) : (
                  <div className="relative">
                    <input value={patientSearch} onChange={e => setPatientSearch(e.target.value)} placeholder="Search patient..."
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    {patientSearch && filteredPatients.length > 0 && (
                      <div className="absolute top-full left-0 right-0 bg-white border border-gray-200 rounded-lg shadow-lg z-10 mt-1">
                        {filteredPatients.map(p => (
                          <button key={p.id} onClick={() => { setForm(pr => ({ ...pr, patientId: p.id, patientName: p.name, patientMRN: p.mrn, patientAge: String(p.age), patientGender: p.gender })); setPatientSearch(''); }}
                            className="w-full text-left px-3 py-2.5 hover:bg-blue-50 text-sm border-b last:border-0">
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
                  <label className="block text-xs font-medium text-gray-600 mb-1">Ward *</label>
                  <select value={form.wardId} onChange={e => { const w = wards.find(w => w.id === e.target.value); setForm(p => ({ ...p, wardId: w?.id || '', wardName: w?.name || '', bedId: '', bedNo: '' })); }}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">— Select Ward —</option>
                    {wards.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Bed</label>
                  <select value={form.bedId} onChange={e => { const b = beds.find(b => b.id === e.target.value); setForm(p => ({ ...p, bedId: b?.id || '', bedNo: b?.bedNo || '', dailyRate: String(b?.dailyRate || '2000') })); }}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">— Select Bed —</option>
                    {wardBeds.map(b => <option key={b.id} value={b.id}>Bed {b.bedNo} ({b.type})</option>)}
                  </select>
                  {form.wardId && wardBeds.length === 0 && <p className="text-xs text-red-500 mt-1">No available beds in this ward</p>}
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Doctor</label>
                  <select value={form.doctorId} onChange={e => { const d = staff.find(s => s.id === e.target.value); setForm(p => ({ ...p, doctorId: d?.id || '', doctorName: d?.name || '' })); }}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">— Select —</option>
                    {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Admission Date</label>
                  <input type="date" value={form.admissionDate} onChange={e => f('admissionDate', e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Daily Rate (Rs.)</label>
                  <input type="number" value={form.dailyRate} onChange={e => f('dailyRate', e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Referred By</label>
                  <input value={form.referredBy} onChange={e => f('referredBy', e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Admission Diagnosis</label>
                  <textarea value={form.diagnosis} onChange={e => f('diagnosis', e.target.value)} rows={2}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
            </div>
            <div className="flex gap-3 px-5 pb-5">
              <button onClick={() => setShowModal(false)} className="flex-1 border border-gray-200 text-gray-600 py-2 rounded-lg text-sm">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm disabled:opacity-60">{saving ? 'Saving...' : 'Admit Patient'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Treatment/Care Log Modal */}
      {showTreatmentModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <div>
                <h2 className="font-semibold text-gray-900">Add Treatment Entry</h2>
                <p className="text-xs text-gray-400 mt-0.5">{showTreatmentModal.patientName} · Bed {showTreatmentModal.bedNo}</p>
              </div>
              <button onClick={() => setShowTreatmentModal(null)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Type</label>
                  <select value={treatForm.type} onChange={e => setTreatForm(f => ({ ...f, type: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {TREATMENT_TYPES.map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Date</label>
                  <input type="date" value={treatForm.date} onChange={e => setTreatForm(f => ({ ...f, date: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Time</label>
                  <input type="time" value={treatForm.time} onChange={e => setTreatForm(f => ({ ...f, time: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Description / Details *</label>
                <textarea value={treatForm.description} onChange={e => setTreatForm(f => ({ ...f, description: e.target.value }))} rows={3}
                  placeholder="e.g. Tab Paracetamol 500mg — 1 tablet BD after meals"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              {/* Recent entries */}
              {treatments.filter(t => t.admissionId === showTreatmentModal.id).slice(0, 3).map((t: any) => (
                <div key={t.id} className="text-xs bg-gray-50 rounded-lg px-3 py-2 flex items-center gap-2">
                  <span className="font-semibold text-gray-600">{t.type}</span>
                  <span className="text-gray-500 truncate">{t.description}</span>
                  <span className="text-gray-300 shrink-0">{t.date} {t.time}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-3 px-5 pb-5">
              <button onClick={() => setShowTreatmentModal(null)} className="flex-1 border border-gray-200 text-gray-600 py-2 rounded-lg text-sm">Close</button>
              <button onClick={handleAddTreatment} disabled={saving} className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm disabled:opacity-60">
                {saving ? 'Saving...' : 'Add Entry'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Discharge Modal */}
      {showDischarge && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">Discharge Patient</h2>
              <button onClick={() => setShowDischarge(null)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="bg-orange-50 border border-orange-100 rounded-lg p-3">
                <div className="font-medium text-orange-800">{showDischarge.patientName}</div>
                <div className="text-sm text-orange-600">{showDischarge.wardName} · Bed {showDischarge.bedNo}</div>
                <div className="text-sm text-orange-600">Admitted: {formatDate(showDischarge.admissionDate)}</div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Discharge Date</label>
                <input type="date" value={dischargeDate} onChange={e => setDischargeDate(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Discharge Summary</label>
                <textarea value={dischargeSummary} onChange={e => setDischargeSummary(e.target.value)} rows={3}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="bg-blue-50 rounded-lg p-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-blue-600 font-medium">IPD Bill (auto):</span>
                  <span className="text-blue-800 font-bold">Rs. {((differenceInDays(new Date(dischargeDate), new Date(showDischarge.admissionDate)) || 1) * (showDischarge.dailyRate || 0)).toLocaleString()}</span>
                </div>
                <div className="text-xs text-blue-500 mt-0.5">{differenceInDays(new Date(dischargeDate), new Date(showDischarge.admissionDate)) || 1} days × Rs.{showDischarge.dailyRate}/day</div>
                <p className="text-xs text-blue-400 mt-1 border-t border-blue-100 pt-1">✓ Bill created automatically · Bed will be freed</p>
              </div>
            </div>
            <div className="flex gap-3 px-5 pb-5">
              <button onClick={() => setShowDischarge(null)} className="flex-1 border border-gray-200 text-gray-600 py-2 rounded-lg text-sm">Cancel</button>
              <button onClick={handleDischarge} disabled={saving} className="flex-1 bg-red-600 text-white py-2 rounded-lg text-sm disabled:opacity-60">{saving ? '...' : 'Confirm Discharge'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
