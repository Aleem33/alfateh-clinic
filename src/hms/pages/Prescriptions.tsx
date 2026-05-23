import { useState, useEffect } from 'react';
import { collection, onSnapshot, doc, getDoc, addDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { formatDate, nowISO } from '../lib/utils';
import { Search, Printer, Eye, FlaskConical, Pill, Send } from 'lucide-react';
import { printPrescription } from '../lib/pdf';
import { transliteratePrescriptionMedicineNames } from '../lib/translate';
import { withPrescriptionListUrdu } from '../lib/prescriptionOptions';
import { formatMedicineNameWithForm } from '../lib/prescriptionMedicine';
import { useAppDialog } from '../../components/AppDialog';

export function Prescriptions() {
  const { alert } = useAppDialog();
  const [consultations, setConsultations] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [viewConsult, setViewConsult] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [hospitalSettings, setHospitalSettings] = useState({ name: 'Al-Fateh Clinic', address: '', phone: '' });
  const [pharmacySentIds, setPharmacySentIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    getDoc(doc(db, 'settings', 'hospital')).then(snap => {
      if (snap.exists()) setHospitalSettings(s => ({ ...s, ...snap.data() }));
    });
    const unsubPharm = onSnapshot(collection(db, 'pharmacyOrders'), snap => {
      setPharmacySentIds(new Set(snap.docs.map(d => d.data().consultationId).filter(Boolean)));
    });
    const unsub = onSnapshot(collection(db, 'consultations'), snap => {
      setConsultations(
        snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter((c: any) => c.prescriptions?.length > 0)
          .sort((a: any, b: any) => (b.createdAt > a.createdAt ? 1 : -1))
      );
      setLoading(false);
    });
    return () => { unsubPharm(); unsub(); };
  }, []);

  const filtered = consultations.filter(c =>
    !search ||
    c.patientName?.toLowerCase().includes(search.toLowerCase()) ||
    c.patientMRN?.includes(search) ||
    c.doctorName?.toLowerCase().includes(search.toLowerCase()) ||
    c.diagnosis?.toLowerCase().includes(search.toLowerCase())
  );

  const sendToPharmacy = async (c: any) => {
    if (!c.prescriptions?.length) return;
    try {
      await addDoc(collection(db, 'pharmacyOrders'), {
        consultationId: c.id,
        patientId: c.patientId, patientName: c.patientName, patientMRN: c.patientMRN,
        patientAge: c.patientAge || '', patientGender: c.patientGender || '',
        doctorName: c.doctorName || '', department: c.department || '',
        diagnosis: c.diagnosis || '', date: c.date,
        prescriptions: c.prescriptions, status: 'pending', createdAt: nowISO(),
      });
    } catch (e: any) { await alert('Error: ' + (e.message || 'Unknown error'), 'Send Failed'); }
  };

  const handlePrint = async (c: any) => {
    const prescriptions = withPrescriptionListUrdu(await transliteratePrescriptionMedicineNames(c.prescriptions || []));
    printPrescription({
      hospitalName: hospitalSettings.name,
      hospitalAddress: hospitalSettings.address,
      hospitalPhone: hospitalSettings.phone,
      patientName: c.patientName,
      patientMRN: c.patientMRN,
      patientAge: c.patientAge,
      patientGender: c.patientGender,
      doctorName: c.doctorName || '',
      department: c.department || '',
      date: formatDate(c.date),
      complaints: c.complaints || '',
      diagnosis: c.diagnosis || '',
      prescriptions,
      labOrders: c.labOrders || [],
      followUpDate: c.followUpDate ? formatDate(c.followUpDate) : undefined,
      notes: c.notes,
      vitals: c.vitals,
    });
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Prescriptions</h1>
        <p className="text-sm text-gray-500">{consultations.length} prescriptions on record</p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by patient, MRN, doctor or diagnosis..."
          className="w-full pl-9 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-100 p-4 animate-pulse">
              <div className="flex gap-4">
                <div className="h-4 bg-gray-200 rounded w-32" />
                <div className="h-4 bg-gray-200 rounded flex-1" />
                <div className="h-4 bg-gray-200 rounded w-24" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                {['Date', 'Patient', 'Doctor', 'Diagnosis', 'Medicines', 'Lab Tests', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-12 text-gray-400 text-sm">No prescriptions found</td></tr>
              ) : filtered.map(c => (
                <tr key={c.id} className="hover:bg-gray-50/50">
                  <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{formatDate(c.date)}</td>
                  <td className="px-4 py-3">
                    <div className="text-sm font-medium text-gray-900">{c.patientName}</div>
                    <div className="text-xs font-mono text-gray-400">{c.patientMRN}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-sm text-gray-700">{c.doctorName || '—'}</div>
                    <div className="text-xs text-gray-400">{c.department}</div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700 max-w-xs">
                    <span className="truncate block max-w-[200px]">{c.diagnosis || '—'}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <Pill className="w-3.5 h-3.5 text-blue-500" />
                      <span className="text-sm font-medium text-blue-700">{c.prescriptions?.length || 0}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {c.labOrders?.length > 0 ? (
                      <div className="flex items-center gap-1">
                        <FlaskConical className="w-3.5 h-3.5 text-purple-500" />
                        <span className="text-sm font-medium text-purple-700">{c.labOrders.length}</span>
                      </div>
                    ) : <span className="text-gray-300 text-sm">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button onClick={() => setViewConsult(c)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg" title="View">
                        <Eye className="w-4 h-4" />
                      </button>
                      <button onClick={() => handlePrint(c)} className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-lg" title="Print">
                        <Printer className="w-4 h-4" />
                      </button>
                      {pharmacySentIds.has(c.id) ? (
                        <span className="text-xs text-emerald-600 font-medium px-2 py-1 bg-emerald-50 rounded-lg">✓ Sent</span>
                      ) : (
                        <button onClick={() => sendToPharmacy(c)}
                          className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg" title="Send to Pharmacy">
                          <Send className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* View / Print Modal */}
      {viewConsult && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <div>
                <h2 className="font-semibold text-gray-900">Prescription</h2>
                <p className="text-xs text-gray-400">{viewConsult.patientName} · {formatDate(viewConsult.date)}</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => handlePrint(viewConsult)}
                  className="flex items-center gap-1.5 text-sm border border-gray-200 px-3 py-1.5 rounded-lg text-gray-600 hover:bg-gray-50">
                  <Printer className="w-4 h-4" /> Print PDF
                </button>
                <button onClick={() => setViewConsult(null)} className="p-1 text-gray-400 hover:text-gray-600">✕</button>
              </div>
            </div>
            <div className="p-5 space-y-4">
              {/* Patient Info */}
              <div className="grid grid-cols-2 gap-3 bg-gray-50 rounded-xl p-4 text-sm">
                {[
                  ['Patient', viewConsult.patientName],
                  ['MRN', viewConsult.patientMRN],
                  ['Age/Gender', `${viewConsult.patientAge || '—'} / ${viewConsult.patientGender || '—'}`],
                  ['Doctor', viewConsult.doctorName || '—'],
                  ['Department', viewConsult.department || '—'],
                  ['Date', formatDate(viewConsult.date)],
                ].map(([l, v]) => (
                  <div key={l as string}>
                    <span className="text-xs text-gray-400 block">{l}</span>
                    <span className="font-medium text-gray-800">{v}</span>
                  </div>
                ))}
              </div>

              {viewConsult.complaints && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Complaints</p>
                  <p className="text-sm text-gray-700 bg-gray-50 p-3 rounded-lg">{viewConsult.complaints}</p>
                </div>
              )}

              {viewConsult.diagnosis && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Diagnosis</p>
                  <p className="text-sm font-medium text-gray-800 bg-blue-50 p-3 rounded-lg">{viewConsult.diagnosis}</p>
                </div>
              )}

              {viewConsult.prescriptions?.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Rx — Medicines</p>
                  <div className="border border-gray-100 rounded-xl overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-blue-50">
                        <tr>
                          {['Medicine (EN)', 'دوائی (اردو)', 'Dosage', 'Frequency', 'Duration', 'Instructions'].map(h => (
                            <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-blue-700">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {viewConsult.prescriptions.map((p: any, i: number) => (
                          <tr key={i}>
                            <td className="px-3 py-2.5 font-medium text-gray-800">{formatMedicineNameWithForm(p.name, p.form || p.category || p.type)}</td>
                            <td className="px-3 py-2.5 text-green-700 font-medium" dir="rtl" style={{ fontFamily: 'Noto Nastaliq Urdu, serif' }}>
                              {p.nameUrdu || '—'}
                            </td>
                            <td className="px-3 py-2.5 text-gray-600">{p.dosage}</td>
                            <td className="px-3 py-2.5 text-gray-600">{p.frequency}</td>
                            <td className="px-3 py-2.5 text-gray-600">{p.duration}</td>
                            <td className="px-3 py-2.5 text-gray-500 text-xs">
                              <div>{p.instructions || '—'}</div>
                              {p.instructionsUrdu && (
                                <div dir="rtl" style={{ fontFamily: 'Noto Nastaliq Urdu, serif' }} className="text-green-600 mt-0.5">{p.instructionsUrdu}</div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {viewConsult.labOrders?.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Lab Orders</p>
                  <div className="flex flex-wrap gap-2">
                    {viewConsult.labOrders.map((l: any, i: number) => (
                      <span key={i} className="bg-purple-50 text-purple-700 text-xs px-3 py-1.5 rounded-full font-medium">
                        {l.testName}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {viewConsult.followUpDate && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-2.5 text-sm">
                  <span className="text-yellow-700 font-medium">Follow-up: </span>
                  <span className="text-yellow-800 font-bold">{formatDate(viewConsult.followUpDate)}</span>
                </div>
              )}
            </div>
            <div className="px-5 pb-5">
              <button onClick={() => setViewConsult(null)} className="w-full border border-gray-200 text-gray-600 py-2 rounded-lg text-sm hover:bg-gray-50">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
