import { useState, useEffect } from 'react';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, query, where } from 'firebase/firestore';
import { db, getNextMRN } from '../../firebase';
import { formatDate, formatCurrency, nowISO } from '../lib/utils';
import { logAudit } from '../lib/audit';
import { Search, Plus, Edit2, Trash2, User, Phone, ChevronDown, X, FileText, BedDouble, FlaskConical, Receipt, History } from 'lucide-react';

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'Unknown'];
const GENDERS = ['Male', 'Female', 'Other'];

const emptyForm = {
  name: '', age: '', gender: 'Male', phone: '', address: '',
  bloodGroup: 'Unknown', allergies: '', emergencyContact: '', emergencyPhone: '',
};

export function Patients() {
  const [patients, setPatients] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [viewPatient, setViewPatient] = useState<any | null>(null);
  const [historyTab, setHistoryTab] = useState<'info' | 'opd' | 'ipd' | 'lab' | 'bills'>('info');

  // Patient history data
  const [histConsults, setHistConsults] = useState<any[]>([]);
  const [histAdmissions, setHistAdmissions] = useState<any[]>([]);
  const [histLab, setHistLab] = useState<any[]>([]);
  const [histBills, setHistBills] = useState<any[]>([]);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'patients'), snap =>
      setPatients(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a: any, b: any) => (b.createdAt || '') > (a.createdAt || '') ? 1 : -1))
    );
    return () => unsub();
  }, []);

  // Load history when a patient is opened
  useEffect(() => {
    if (!viewPatient) {
      setHistConsults([]); setHistAdmissions([]); setHistLab([]); setHistBills([]);
      return;
    }
    const pid = viewPatient.id;
    const u1 = onSnapshot(collection(db, 'consultations'), s =>
      setHistConsults(s.docs.map(d => ({ id: d.id, ...d.data() })).filter((c: any) => c.patientId === pid).sort((a: any, b: any) => b.createdAt > a.createdAt ? 1 : -1))
    );
    const u2 = onSnapshot(collection(db, 'admissions'), s =>
      setHistAdmissions(s.docs.map(d => ({ id: d.id, ...d.data() })).filter((c: any) => c.patientId === pid).sort((a: any, b: any) => b.admissionDate > a.admissionDate ? 1 : -1))
    );
    const u3 = onSnapshot(collection(db, 'labOrders'), s =>
      setHistLab(s.docs.map(d => ({ id: d.id, ...d.data() })).filter((c: any) => c.patientId === pid).sort((a: any, b: any) => b.createdAt > a.createdAt ? 1 : -1))
    );
    const u4 = onSnapshot(collection(db, 'bills'), s =>
      setHistBills(s.docs.map(d => ({ id: d.id, ...d.data() })).filter((c: any) => c.patientId === pid).sort((a: any, b: any) => b.createdAt > a.createdAt ? 1 : -1))
    );
    return () => { u1(); u2(); u3(); u4(); };
  }, [viewPatient]);

  const filtered = patients.filter(p =>
    !search ||
    p.name?.toLowerCase().includes(search.toLowerCase()) ||
    p.mrn?.toLowerCase().includes(search.toLowerCase()) ||
    p.phone?.includes(search)
  );

  const openAdd = () => { setEditId(null); setForm(emptyForm); setError(''); setShowModal(true); };
  const openEdit = (p: any) => {
    setEditId(p.id);
    setForm({ name: p.name, age: p.age, gender: p.gender, phone: p.phone, address: p.address || '', bloodGroup: p.bloodGroup || 'Unknown', allergies: p.allergies || '', emergencyContact: p.emergencyContact || '', emergencyPhone: p.emergencyPhone || '' });
    setError('');
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.phone.trim() || !form.age) { setError('Name, phone and age are required.'); return; }
    setSaving(true); setError('');
    try {
      if (editId) {
        await updateDoc(doc(db, 'patients', editId), { ...form, age: Number(form.age), updatedAt: nowISO() });
        await logAudit('update', 'patient', editId, form.name);
      } else {
        const mrn = await getNextMRN();
        const ref = await addDoc(collection(db, 'patients'), { ...form, age: Number(form.age), mrn, createdAt: nowISO() });
        await logAudit('create', 'patient', ref.id, `${form.name} (${mrn})`);
      }
      setShowModal(false);
    } catch (e: any) {
      setError(e.message || 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete patient "${name}"? This cannot be undone.`)) return;
    await deleteDoc(doc(db, 'patients', id));
    await logAudit('delete', 'patient', id, name);
  };

  const f = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Patients</h1>
          <p className="text-sm text-gray-500">{patients.length} total registered patients</p>
        </div>
        <button onClick={openAdd} className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
          <Plus className="w-4 h-4" /> New Patient
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, MRN or phone..."
          className="w-full pl-9 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>{['MRN','Patient Name','Age/Gender','Phone','Blood Group','Registered','Actions'].map(h => (
              <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>
            ))}</tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {filtered.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-12 text-gray-400">No patients found</td></tr>
            ) : filtered.map(p => (
              <tr key={p.id} className="hover:bg-gray-50/50 transition-colors">
                <td className="px-4 py-3"><span className="font-mono text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded font-medium">{p.mrn}</span></td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 bg-slate-100 rounded-full flex items-center justify-center shrink-0">
                      <User className="w-3.5 h-3.5 text-slate-400" />
                    </div>
                    <div>
                      <div className="text-sm font-medium text-gray-900">{p.name}</div>
                      {p.allergies && <div className="text-xs text-orange-600">⚠ Allergies: {p.allergies}</div>}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-gray-600">{p.age} yrs / {p.gender}</td>
                <td className="px-4 py-3 text-sm text-gray-600">
                  <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{p.phone}</span>
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${p.bloodGroup === 'Unknown' ? 'bg-gray-100 text-gray-500' : 'bg-red-50 text-red-700'}`}>
                    {p.bloodGroup}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-gray-400">{formatDate(p.createdAt)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    <button onClick={() => setViewPatient(p)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="View"><ChevronDown className="w-4 h-4" /></button>
                    <button onClick={() => openEdit(p)} className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors" title="Edit"><Edit2 className="w-4 h-4" /></button>
                    <button onClick={() => handleDelete(p.id, p.name)} className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-colors" title="Delete"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">{editId ? 'Edit Patient' : 'Register New Patient'}</h2>
              <button onClick={() => setShowModal(false)} className="p-1 text-gray-400 hover:text-gray-600 rounded"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              {error && <div className="bg-red-50 text-red-600 text-sm p-3 rounded-lg border border-red-100">{error}</div>}
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Full Name *</label>
                  <input value={form.name} onChange={e => f('name', e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Age *</label>
                  <input type="number" min="0" max="150" value={form.age} onChange={e => f('age', e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Gender</label>
                  <select value={form.gender} onChange={e => f('gender', e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {GENDERS.map(g => <option key={g}>{g}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Phone *</label>
                  <input value={form.phone} onChange={e => f('phone', e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Blood Group</label>
                  <select value={form.bloodGroup} onChange={e => f('bloodGroup', e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {BLOOD_GROUPS.map(g => <option key={g}>{g}</option>)}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Address</label>
                  <input value={form.address} onChange={e => f('address', e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Known Allergies</label>
                  <input value={form.allergies} onChange={e => f('allergies', e.target.value)} placeholder="e.g. Penicillin, Aspirin" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Emergency Contact</label>
                  <input value={form.emergencyContact} onChange={e => f('emergencyContact', e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Emergency Phone</label>
                  <input value={form.emergencyPhone} onChange={e => f('emergencyPhone', e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
            </div>
            <div className="flex gap-3 px-5 pb-5">
              <button onClick={() => setShowModal(false)} className="flex-1 border border-gray-200 text-gray-600 py-2 rounded-lg text-sm font-medium hover:bg-gray-50">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60">
                {saving ? 'Saving...' : editId ? 'Update' : 'Register Patient'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* View Modal */}
      {viewPatient && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-gray-100 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                  <span className="text-blue-600 font-bold text-sm">{viewPatient.name?.[0]}</span>
                </div>
                <div>
                  <h2 className="font-semibold text-gray-900">{viewPatient.name}</h2>
                  <p className="text-xs text-gray-400">{viewPatient.mrn} · {viewPatient.age} yrs · {viewPatient.gender}</p>
                </div>
              </div>
              <button onClick={() => { setViewPatient(null); setHistoryTab('info'); }} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-gray-100 px-5 shrink-0">
              {([
                { key: 'info',  label: 'Info',       icon: User,         count: null },
                { key: 'opd',   label: 'OPD',        icon: FileText,     count: histConsults.length },
                { key: 'ipd',   label: 'IPD',        icon: BedDouble,    count: histAdmissions.length },
                { key: 'lab',   label: 'Lab',        icon: FlaskConical, count: histLab.length },
                { key: 'bills', label: 'Bills',      icon: Receipt,      count: histBills.length },
              ] as const).map(({ key, label, icon: Icon, count }) => (
                <button
                  key={key}
                  onClick={() => setHistoryTab(key)}
                  className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors -mb-px ${
                    historyTab === key ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                  {count !== null && count > 0 && (
                    <span className="bg-blue-100 text-blue-600 text-xs rounded-full px-1.5 py-0.5 font-semibold">{count}</span>
                  )}
                </button>
              ))}
            </div>

            {/* Tab Content */}
            <div className="flex-1 overflow-y-auto p-5">

              {/* INFO TAB */}
              {historyTab === 'info' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      ['Phone', viewPatient.phone],
                      ['Blood Group', viewPatient.bloodGroup],
                      ['Address', viewPatient.address || '—'],
                      ['Allergies', viewPatient.allergies || 'None'],
                      ['Emergency Contact', viewPatient.emergencyContact || '—'],
                      ['Emergency Phone', viewPatient.emergencyPhone || '—'],
                      ['Registered', formatDate(viewPatient.createdAt)],
                    ].map(([label, val]) => (
                      <div key={label as string} className="bg-gray-50 rounded-lg p-3">
                        <div className="text-xs text-gray-400 mb-0.5">{label}</div>
                        <div className="text-sm font-medium text-gray-800">{val}</div>
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-4 gap-3 pt-2 border-t border-gray-100">
                    {[
                      { label: 'OPD Visits',    value: histConsults.length,  color: 'text-blue-600' },
                      { label: 'IPD Admissions',value: histAdmissions.length, color: 'text-purple-600' },
                      { label: 'Lab Orders',    value: histLab.length,       color: 'text-orange-600' },
                      { label: 'Total Bills',   value: formatCurrency(histBills.reduce((s, b) => s + (b.total || 0), 0)), color: 'text-green-600' },
                    ].map(({ label, value, color }) => (
                      <div key={label} className="text-center bg-white border border-gray-100 rounded-xl p-3 shadow-sm">
                        <div className={`text-lg font-bold ${color}`}>{value}</div>
                        <div className="text-xs text-gray-400 mt-0.5">{label}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* OPD TAB */}
              {historyTab === 'opd' && (
                <div className="space-y-3">
                  {histConsults.length === 0
                    ? <p className="text-center text-gray-400 py-10 text-sm">No OPD visits recorded</p>
                    : histConsults.map(c => (
                      <div key={c.id} className="border border-gray-100 rounded-xl p-4 hover:border-blue-100 transition-colors">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-semibold text-gray-800">{formatDate(c.date)}</span>
                          <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-medium">{c.department}</span>
                        </div>
                        {c.diagnosis && <p className="text-sm text-gray-700 mb-1"><span className="text-xs text-gray-400">Diagnosis: </span>{c.diagnosis}</p>}
                        {c.complaints && <p className="text-sm text-gray-500 text-xs"><span className="text-gray-400">Complaints: </span>{c.complaints}</p>}
                        {c.prescriptions?.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {c.prescriptions.map((p: any, i: number) => (
                              <span key={i} className="bg-green-50 text-green-700 text-xs px-2 py-0.5 rounded-full">{p.name} — {p.dosage}</span>
                            ))}
                          </div>
                        )}
                        <div className="mt-2 text-xs text-gray-400">Dr. {c.doctorName || '—'} · Fee: Rs. {c.fee}</div>
                      </div>
                    ))
                  }
                </div>
              )}

              {/* IPD TAB */}
              {historyTab === 'ipd' && (
                <div className="space-y-3">
                  {histAdmissions.length === 0
                    ? <p className="text-center text-gray-400 py-10 text-sm">No IPD admissions recorded</p>
                    : histAdmissions.map(a => (
                      <div key={a.id} className="border border-gray-100 rounded-xl p-4">
                        <div className="flex items-center justify-between mb-2">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${a.status === 'admitted' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                            {a.status}
                          </span>
                          <span className="text-xs text-gray-400">{a.ward} · {a.bedNo}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-sm">
                          <div><span className="text-xs text-gray-400">Admitted</span><div className="font-medium">{formatDate(a.admissionDate)}</div></div>
                          {a.dischargeDate && <div><span className="text-xs text-gray-400">Discharged</span><div className="font-medium">{formatDate(a.dischargeDate)}</div></div>}
                          <div><span className="text-xs text-gray-400">Doctor</span><div className="font-medium">{a.doctorName || '—'}</div></div>
                          <div><span className="text-xs text-gray-400">Daily Rate</span><div className="font-medium">Rs. {a.dailyRate}</div></div>
                        </div>
                        {a.diagnosis && <p className="text-xs text-gray-500 mt-2"><span className="text-gray-400">Diagnosis: </span>{a.diagnosis}</p>}
                        {a.totalCharges && <p className="text-sm font-semibold text-blue-700 mt-2">Total: Rs. {a.totalCharges.toLocaleString()}</p>}
                      </div>
                    ))
                  }
                </div>
              )}

              {/* LAB TAB */}
              {historyTab === 'lab' && (
                <div className="space-y-3">
                  {histLab.length === 0
                    ? <p className="text-center text-gray-400 py-10 text-sm">No lab orders found</p>
                    : histLab.map(o => (
                      <div key={o.id} className="border border-gray-100 rounded-xl p-4">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-medium text-gray-800">{formatDate(o.date)}</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            o.status === 'completed' ? 'bg-green-100 text-green-700' :
                            o.status === 'in-progress' ? 'bg-blue-100 text-blue-700' : 'bg-yellow-100 text-yellow-700'
                          }`}>{o.status}</span>
                        </div>
                        <div className="flex flex-wrap gap-1 mb-2">
                          {o.tests?.map((t: any, i: number) => (
                            <span key={i} className="bg-purple-50 text-purple-700 text-xs px-2 py-0.5 rounded-full">{t.testName}</span>
                          ))}
                        </div>
                        {o.results?.length > 0 && (
                          <div className="mt-2 border-t border-gray-50 pt-2 space-y-1">
                            {o.results.map((r: any, i: number) => (
                              <div key={i} className="flex items-center justify-between text-xs">
                                <span className="text-gray-600">{r.testName}</span>
                                <span className={`font-medium ${r.status === 'abnormal' ? 'text-red-600' : r.status === 'borderline' ? 'text-yellow-600' : 'text-green-600'}`}>
                                  {r.result} {r.unit} <span className="text-gray-400">({r.normalRange})</span>
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))
                  }
                </div>
              )}

              {/* BILLS TAB */}
              {historyTab === 'bills' && (
                <div className="space-y-3">
                  {histBills.length === 0
                    ? <p className="text-center text-gray-400 py-10 text-sm">No bills found</p>
                    : histBills.map(b => (
                      <div key={b.id} className="border border-gray-100 rounded-xl p-4">
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-mono text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded font-medium">{b.billNo}</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            b.paymentStatus === 'paid' ? 'bg-green-100 text-green-700' :
                            b.paymentStatus === 'partial' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'
                          }`}>{b.paymentStatus}</span>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-sm">
                          <div><span className="text-xs text-gray-400 block">Date</span>{formatDate(b.date)}</div>
                          <div><span className="text-xs text-gray-400 block">Total</span><span className="font-semibold">{formatCurrency(b.total)}</span></div>
                          <div><span className="text-xs text-gray-400 block">Balance</span><span className={b.balance > 0 ? 'text-red-500 font-semibold' : 'text-green-600'}>{formatCurrency(b.balance)}</span></div>
                        </div>
                      </div>
                    ))
                  }
                  {histBills.length > 0 && (
                    <div className="border-t border-gray-100 pt-3 flex justify-between text-sm font-semibold">
                      <span className="text-gray-600">Total Billed</span>
                      <span className="text-gray-900">{formatCurrency(histBills.reduce((s, b) => s + (b.total || 0), 0))}</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 pb-5 pt-3 border-t border-gray-100 flex gap-3 shrink-0">
              <button onClick={() => { setViewPatient(null); openEdit(viewPatient); setHistoryTab('info'); }}
                className="flex-1 border border-gray-200 text-gray-600 py-2 rounded-lg text-sm hover:bg-gray-50">
                Edit Patient
              </button>
              <button onClick={() => { setViewPatient(null); setHistoryTab('info'); }}
                className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm hover:bg-blue-700">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
