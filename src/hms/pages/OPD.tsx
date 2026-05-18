import { useState, useEffect } from 'react';
import { collection, onSnapshot, addDoc, doc, updateDoc, getDoc, query, where, getDocs } from 'firebase/firestore';
import { db, auth, getNextBillNo } from '../../firebase';
import { formatDate, today, nowISO } from '../lib/utils';
import { logAudit } from '../lib/audit';
import { Plus, Search, X, Stethoscope, FlaskConical, Printer, Eye, ArrowRight, Send, Loader2, History, ChevronDown, ChevronUp, RotateCcw, Clock, Pill, BookOpen, MessageCircle, CheckSquare, Square, TrendingUp } from 'lucide-react';
import { printPrescription } from '../lib/pdf';
import { getGeminiKey, transliterateMedicineNamesToUrdu, transliteratePrescriptionMedicineNames } from '../lib/translate';
import { DOSAGE_OPTIONS, DURATION_OPTIONS, FREQUENCY_OPTIONS, INSTRUCTION_OPTIONS, getDosageUrdu, getDurationUrdu, getFrequencyUrdu, getInstructionUrdu, withPrescriptionListUrdu } from '../lib/prescriptionOptions';
import { useNavigate } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { useAppDialog } from '../../components/AppDialog';

const DEPARTMENTS = ['General Medicine', 'Surgery', 'Gynecology', 'Pediatrics', 'ENT', 'Orthopedics', 'Dermatology', 'Cardiology', 'Neurology', 'Ophthalmology'];

function getPatientHistory(consultations: any[], patientId: string) {
  return consultations
    .filter((c: any) => c.patientId === patientId)
    .sort((a: any, b: any) => {
      const aTime = a.createdAt || a.date || '';
      const bTime = b.createdAt || b.date || '';
      return bTime > aTime ? 1 : bTime < aTime ? -1 : 0;
    });
}

export function OPD() {
  const { alert } = useAppDialog();
  const navigate = useNavigate();
  const [consultations, setConsultations] = useState<any[]>([]);
  const [patients, setPatients] = useState<any[]>([]);
  const [staff, setStaff] = useState<any[]>([]);
  const [labTests, setLabTests] = useState<any[]>([]);
  const [medicines, setMedicines] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'today' | 'all'>('today');
  const [showModal, setShowModal] = useState(false);
  const [viewConsult, setViewConsult] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [patientSearch, setPatientSearch] = useState('');

  const [form, setForm] = useState({
    patientId: '', patientName: '', patientMRN: '', patientAge: '', patientGender: '',
    doctorId: '', doctorName: '', department: 'General Medicine',
    date: today(), complaints: '', diagnosis: '', notes: '', followUpDate: '', fee: '500',
    paidAmount: '0', paymentMethod: 'Cash',
    appointmentId: '',
    // Vitals
    bp: '', temperature: '', weight: '', pulse: '', spo2: '',
  });
  const [prescriptions, setPrescriptions] = useState<any[]>([]);
  const [labOrders, setLabOrders] = useState<any[]>([]);
  const [medSearch, setMedSearch] = useState('');
  const [labSearch, setLabSearch] = useState('');
  const [translating, setTranslating] = useState(false);
  const [currentDoctorId, setCurrentDoctorId] = useState<string | null>(null);
  const [currentRole, setCurrentRole] = useState('');
  const [pharmacySentIds, setPharmacySentIds] = useState<Set<string>>(new Set());
  const [modalTab, setModalTab] = useState<'prescription' | 'history'>('prescription');
  const [patientHistory, setPatientHistory] = useState<any[]>([]);
  const [historyError, setHistoryError] = useState('');
  const [expandedVisit, setExpandedVisit] = useState<string | null>(null);
  const [templates, setTemplates] = useState<any[]>([]);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [templateSaving, setTemplateSaving] = useState(false);
  const [templateMsg, setTemplateMsg] = useState('');
  const [printQueue, setPrintQueue] = useState<Set<string>>(new Set());
  const [batchPrinting, setBatchPrinting] = useState(false);

  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'consultations'), snap =>
      setConsultations(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a: any, b: any) => b.createdAt > a.createdAt ? 1 : -1))
    );
    const u2 = onSnapshot(collection(db, 'patients'), snap => setPatients(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    const u3 = onSnapshot(collection(db, 'staff'), snap => setStaff(snap.docs.filter(d => d.data().role === 'doctor').map(d => ({ id: d.id, ...d.data() }))));
    const u4 = onSnapshot(collection(db, 'labTests'), snap => setLabTests(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    const u5 = onSnapshot(collection(db, 'medicines'), snap => setMedicines(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    const u6 = onSnapshot(collection(db, 'prescriptionTemplates'), snap => setTemplates(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    // Determine current user role and doctor ID
    getDoc(doc(db, 'users', auth.currentUser?.uid || 'x')).then(snap => {
      if (snap.exists()) {
        const role = snap.data().role;
        setCurrentRole(role);
        if (role === 'doctor') {
          onSnapshot(collection(db, 'staff'), s => {
            const me = s.docs.find(d => d.data().userId === auth.currentUser?.uid);
            if (me) setCurrentDoctorId(me.id);
          });
        }
      }
    });

    // Pre-fill from appointment if navigated from Appointments page
    const prefill = sessionStorage.getItem('opd_prefill');
    if (prefill) {
      try {
        const p = JSON.parse(prefill);
        sessionStorage.removeItem('opd_prefill');
        setForm(prev => ({
          ...prev,
          patientId: p.patientId || '',
          patientName: p.patientName || '',
          patientMRN: p.patientMRN || '',
          patientAge: p.patientAge || '',
          patientGender: p.patientGender || '',
          doctorId: p.doctorId || '',
          doctorName: p.doctorName || '',
          department: p.department || 'General Medicine',
          date: p.date || today(),
          fee: p.fee || '500',
          notes: p.notes || '',
          bp: p.vitals?.bp || '',
          temperature: p.vitals?.temperature || '',
          weight: p.vitals?.weight || '',
          pulse: p.vitals?.pulse || '',
          spo2: p.vitals?.spo2 || '',
          appointmentId: p.appointmentId || '',
        }));
        setPrescriptions([]);
        setLabOrders([]);
        setError('');
        setPatientSearch('');
        setMedSearch('');
        setLabSearch('');
        setShowModal(true);
      } catch(e) { console.error('Pre-fill error:', e); }
    }

    // Track which consultations already sent to pharmacy
    const u7 = onSnapshot(collection(db, 'pharmacyOrders'), snap => {
      setPharmacySentIds(new Set(snap.docs.map(d => d.data().consultationId).filter(Boolean)));
    });

    return () => { u1(); u2(); u3(); u4(); u5(); u6(); u7(); };
  }, []);

  useEffect(() => {
    if (!showModal || !form.patientId) return;
    setPatientHistory(getPatientHistory(consultations, form.patientId));
  }, [consultations, form.patientId, showModal]);

  // ── Template helpers ────────────────────────────────────────────────────────
  const applyTemplate = (t: any) => {
    const toAdd = withPrescriptionListUrdu((t.medicines || []).filter((m: any) => !prescriptions.find(rx => rx.medicineId === m.medicineId || rx.name === m.name)));
    setPrescriptions(prev => [...prev, ...toAdd]);
    if (t.diagnosis && !form.diagnosis) setForm(p => ({ ...p, diagnosis: t.diagnosis }));
    setShowTemplates(false);
  };

  const openSaveTemplateModal = () => {
    if (!prescriptions.length) {
      setTemplateMsg('Add medicines before saving a template.');
      setTimeout(() => setTemplateMsg(''), 3000);
      return;
    }
    setTemplateName(form.diagnosis ? `${form.diagnosis} Protocol` : '');
    setTemplateMsg('');
    setShowTemplateModal(true);
  };

  const normalizeTemplateMedicines = () => withPrescriptionListUrdu(prescriptions).map((p: any) => ({
    medicineId: p.medicineId || '',
    name: p.name || '',
    nameUrdu: p.nameUrdu || '',
    dosage: p.dosage || '',
    dosageUrdu: p.dosageUrdu || getDosageUrdu(p.dosage || ''),
    frequency: p.frequency || '',
    frequencyUrdu: p.frequencyUrdu || getFrequencyUrdu(p.frequency || ''),
    duration: p.duration || '',
    durationUrdu: p.durationUrdu || getDurationUrdu(p.duration || ''),
    instructions: p.instructions || '',
    instructionsUrdu: p.instructionsUrdu || getInstructionUrdu(p.instructions || ''),
  }));

  const saveAsTemplate = async () => {
    const name = templateName.trim();
    if (!name) {
      setTemplateMsg('Template name is required.');
      return;
    }
    setTemplateSaving(true);
    setTemplateMsg('');
    try {
      await addDoc(collection(db, 'prescriptionTemplates'), {
        name,
        diagnosis: form.diagnosis || '',
        medicines: normalizeTemplateMedicines(),
        createdByEmail: auth.currentUser?.email || '',
        createdAt: nowISO(),
      });
      setTemplateMsg('✓ Template saved!');
      setTemplateName('');
      setTimeout(() => {
        setTemplateMsg('');
        setShowTemplateModal(false);
      }, 900);
    } catch (e: any) {
      setTemplateMsg('Could not save template: ' + (e.message || 'Unknown error'));
    } finally {
      setTemplateSaving(false);
    }
  };

  // ── Print queue helpers ─────────────────────────────────────────────────────
  const togglePrintQueue = (id: string) => {
    setPrintQueue(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const printBatchQueue = () => {
    const toPrint = filteredConsultations.filter((c: any) => printQueue.has(c.id));
    if (!toPrint.length) return;
    setBatchPrinting(true);
    toPrint.forEach((c: any, i) => {
      setTimeout(async () => {
        const rx = withPrescriptionListUrdu(await transliteratePrescriptionMedicineNames(c.prescriptions || []));
        printPrescription({
          hospitalName: 'Al-Fateh Clinic', patientName: c.patientName, patientMRN: c.patientMRN,
          patientAge: c.patientAge, patientGender: c.patientGender,
          doctorName: c.doctorName || '', department: c.department || '',
          date: formatDate(c.date), complaints: c.complaints || '', diagnosis: c.diagnosis || '',
          prescriptions: rx, labOrders: c.labOrders || [],
          followUpDate: c.followUpDate ? formatDate(c.followUpDate) : undefined,
          notes: c.notes, vitals: c.vitals || {},
        });
        if (i === toPrint.length - 1) { setPrintQueue(new Set()); setBatchPrinting(false); }
      }, i * 1500);
    });
  };

  // ── WhatsApp share ──────────────────────────────────────────────────────────
  const shareWhatsApp = (c: any) => {
    const patient = patients.find((p: any) => p.id === c.patientId);
    const phone = patient?.phone?.replace(/\D/g, '');
    const meds = (c.prescriptions || []).map((p: any, i: number) =>
      `${i + 1}. ${p.name}${p.nameUrdu ? ` (${p.nameUrdu})` : ''} - ${p.dosage} ${p.frequency} × ${p.duration}`
    ).join('\n');
    const msg = `*Al-Fateh Clinic - Prescription*\nPatient: ${c.patientName}\nDate: ${formatDate(c.date)}\n\n*Diagnosis:* ${c.diagnosis || '—'}\n\n*Medicines:*\n${meds}\n\n_Dhandi Road Kot Sabzal | 0304-7459201_`;
    const url = phone
      ? `https://wa.me/92${phone}?text=${encodeURIComponent(msg)}`
      : `https://wa.me/?text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank');
  };


  const todayStr = today();
  const visibleConsultations = currentRole === 'doctor' && currentDoctorId
    ? consultations.filter(c => c.doctorId === currentDoctorId)
    : consultations;
  const filteredConsultations = visibleConsultations.filter(c => {
    const matchTab    = tab === 'today' ? c.date === todayStr : true;
    const matchSearch = !search || c.patientName?.toLowerCase().includes(search.toLowerCase()) || c.patientMRN?.includes(search);
    return matchTab && matchSearch;
  });

  const filteredPatients = patients.filter(p => !patientSearch || p.name?.toLowerCase().includes(patientSearch.toLowerCase()) || p.mrn?.includes(patientSearch)).slice(0, 5);
  const filteredMeds = medicines.filter(m => medSearch && m.name?.toLowerCase().includes(medSearch.toLowerCase()) && m.stock > 0).slice(0, 5);
  const filteredLabTests = labTests.filter(t => labSearch && t.name?.toLowerCase().includes(labSearch.toLowerCase())).slice(0, 5);

  const selectPatient = (p: any) => {
    setForm(prev => ({ ...prev, patientId: p.id, patientName: p.name, patientMRN: p.mrn, patientAge: String(p.age), patientGender: p.gender }));
    setPatientSearch('');
    setExpandedVisit(null);
    setHistoryError('');
    // Filter directly from already-loaded consultations state — no extra Firestore call needed
    setPatientHistory(getPatientHistory(consultations, p.id));
  };

  const addPrescription = async (med: any) => {
    if (prescriptions.find(p => p.medicineId === med.id)) return;
    const newRx = {
      medicineId: med.id,
      name: med.name,
      nameUrdu: med.nameUrdu || '',
      dosage: '1 tablet',
      dosageUrdu: getDosageUrdu('1 tablet'),
      frequency: 'Twice daily',
      frequencyUrdu: getFrequencyUrdu('Twice daily'),
      duration: '7 days',
      durationUrdu: getDurationUrdu('7 days'),
      instructions: '',
      instructionsUrdu: getInstructionUrdu(''),
    };
    setPrescriptions(p => [...p, newRx]);
    setMedSearch('');

    if (getGeminiKey()) {
      setTranslating(true);
      try {
        const [nameUr] = await transliterateMedicineNamesToUrdu([med.name]);
        setPrescriptions(p => p.map(rx =>
          rx.medicineId === med.id ? {
            ...rx,
            nameUrdu:      newRx.nameUrdu || nameUr || rx.nameUrdu,
          } : rx
        ));
      } finally {
        setTranslating(false);
      }
    }
  };

  const addLabOrder = (test: any) => {
    if (labOrders.find(l => l.testId === test.id)) return;
    setLabOrders(l => [...l, { testId: test.id, testName: test.name, price: test.price }]);
    setLabSearch('');
  };

  const reuseFromHistory = async (visit: any) => {
    if (!visit.prescriptions?.length) return;
    const toAdd = withPrescriptionListUrdu(visit.prescriptions.filter((p: any) => !prescriptions.find(rx => rx.medicineId === p.medicineId)));
    if (!toAdd.length) return;
    setPrescriptions(prev => [...prev, ...toAdd]);
    // Also copy complaints/diagnosis if current fields are empty
    if (!form.complaints && visit.complaints) setForm(p => ({ ...p, complaints: visit.complaints }));
    if (!form.diagnosis  && visit.diagnosis)  setForm(p => ({ ...p, diagnosis:  visit.diagnosis }));
    setModalTab('prescription');
  };

  const sendToPharmacy = async (c: any) => {
    if (!c.prescriptions?.length) return;
    try {
      await addDoc(collection(db, 'pharmacyOrders'), {
        consultationId: c.id,
        patientId:     c.patientId,
        patientName:   c.patientName,
        patientMRN:    c.patientMRN,
        patientAge:    c.patientAge   || '',
        patientGender: c.patientGender || '',
        doctorName:    c.doctorName   || '',
        department:    c.department   || '',
        diagnosis:     c.diagnosis    || '',
        date:          c.date,
        prescriptions: withPrescriptionListUrdu(c.prescriptions || []),
        status:        'pending',
        createdAt:     nowISO(),
      });
    } catch (e: any) { await alert('Error sending to pharmacy: ' + (e.message || 'Unknown error'), 'Pharmacy Send Failed'); }
  };

  const updatePrescription = (idx: number, key: string, val: string) => {
    setPrescriptions(p => p.map((item, i) => {
      if (i !== idx) return item;
      const next = { ...item, [key]: val };
      if (key === 'dosage') next.dosageUrdu = getDosageUrdu(val);
      if (key === 'frequency') next.frequencyUrdu = getFrequencyUrdu(val);
      if (key === 'duration') next.durationUrdu = getDurationUrdu(val);
      if (key === 'instructions') next.instructionsUrdu = getInstructionUrdu(val);
      return next;
    }));
  };

  const printConsultation = async (consult: any) => {
    setTranslating(true);
    try {
      const rx = withPrescriptionListUrdu(await transliteratePrescriptionMedicineNames(consult.prescriptions || []));
      printPrescription({
        hospitalName: 'Al-Fateh Clinic',
        hospitalAddress: '',
        hospitalPhone: '',
        patientName: consult.patientName,
        patientMRN: consult.patientMRN,
        patientAge: consult.patientAge,
        patientGender: consult.patientGender,
        doctorName: consult.doctorName || '',
        department: consult.department || '',
        date: formatDate(consult.date),
        complaints: consult.complaints || '',
        diagnosis: consult.diagnosis || '',
        prescriptions: rx,
        labOrders: consult.labOrders || [],
        followUpDate: consult.followUpDate ? formatDate(consult.followUpDate) : undefined,
        notes: consult.notes,
        vitals: {
          bp: consult.vitals?.bp || consult.bp || '',
          temperature: consult.vitals?.temperature || consult.temperature || '',
          weight: consult.vitals?.weight || consult.weight || '',
          pulse: consult.vitals?.pulse || consult.pulse || '',
          spo2: consult.vitals?.spo2 || consult.spo2 || '',
        },
      });
    } finally {
      setTranslating(false);
    }
  };

  const handleSave = async () => {
    if (!form.patientId || !form.complaints) { setError('Patient and complaints are required.'); return; }
    setSaving(true); setError('');
    try {
      const { bp, temperature, weight, pulse, spo2, appointmentId, paidAmount, paymentMethod, ...formRest } = form;
      const vitals = { bp, temperature, weight, pulse, spo2 };
      const fee = Number(form.fee) || 0;
      const paid = Math.min(Number(paidAmount) || 0, fee);
      const balance = Math.max(0, fee - paid);
      const paymentStatus = paid >= fee ? 'paid' : paid > 0 ? 'partial' : 'pending';
      const prescriptionPayload = withPrescriptionListUrdu(prescriptions);

      // Save consultation
      const data = { ...formRest, fee, prescriptions: prescriptionPayload, labOrders, vitals, appointmentId: appointmentId || '', createdAt: nowISO() };
      const ref = await addDoc(collection(db, 'consultations'), data);
      await logAudit('create', 'consultation', ref.id, `${form.patientName} — ${form.diagnosis || form.complaints.slice(0, 40)}`);

      // Auto-generate bill from OPD consultation
      if (fee > 0) {
        const billNo = await getNextBillNo();
        await addDoc(collection(db, 'bills'), {
          billNo,
          patientId: form.patientId, patientName: form.patientName, patientMRN: form.patientMRN,
          date: form.date,
          items: [{ description: `OPD Consultation — ${form.department}`, category: 'Consultation', quantity: 1, rate: fee, amount: fee }],
          subtotal: fee, discount: 0, total: fee,
          paid, balance, paymentStatus, paymentMethod,
          consultationId: ref.id, appointmentId: appointmentId || '',
          cashierId: auth.currentUser?.uid || '',
          createdAt: nowISO(),
        });
        await logAudit('create', 'bill', billNo, `${billNo} — ${form.patientName} — Rs.${fee} (OPD)`);
      }

      // Create lab order documents if any
      if (labOrders.length > 0) {
        const labRef = await addDoc(collection(db, 'labOrders'), {
          patientId: form.patientId, patientName: form.patientName,
          patientMRN: form.patientMRN,
          doctorName: form.doctorName, tests: labOrders, status: 'pending',
          date: form.date, createdAt: nowISO(),
        });
        await logAudit('create', 'labOrder', labRef.id, `${form.patientName} — ${labOrders.length} test(s)`);
      }

      setShowModal(false);
      setPrescriptions([]);
      setLabOrders([]);
    } catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  };

  const f = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">OPD Consultations</h1>
          <p className="text-sm text-gray-500">Today: {visibleConsultations.filter(c => c.date === todayStr).length} consultations{currentRole === 'doctor' ? ' · Showing your patients only' : ''}</p>
        </div>
        <button onClick={() => {
          setForm({ patientId: '', patientName: '', patientMRN: '', patientAge: '', patientGender: '', doctorId: '', doctorName: '', department: 'General Medicine', date: today(), complaints: '', diagnosis: '', notes: '', followUpDate: '', fee: '500', paidAmount: '0', paymentMethod: 'Cash', bp: '', temperature: '', weight: '', pulse: '', spo2: '', appointmentId: '' });
          setPrescriptions([]); setLabOrders([]); setError(''); setPatientSearch(''); setMedSearch(''); setLabSearch('');
          setModalTab('prescription'); setPatientHistory([]); setExpandedVisit(null); setHistoryError('');
          setShowModal(true);
        }}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
          <Plus className="w-4 h-4" /> New Consultation
        </button>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex bg-white border border-gray-200 rounded-lg p-1 gap-1">
          {(['today', 'all'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} className={`px-4 py-1.5 rounded-md text-sm font-medium ${tab === t ? 'bg-blue-600 text-white' : 'text-gray-500 hover:text-gray-700'}`}>{t === 'today' ? 'Today' : 'All'}</button>
          ))}
        </div>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by patient name or MRN..." className="w-full pl-9 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </div>

      {/* Batch Print Bar */}
      {printQueue.size > 0 && (
        <div className="flex items-center justify-between px-4 py-3 bg-blue-600 text-white rounded-xl">
          <span className="text-sm font-medium">{printQueue.size} prescription{printQueue.size > 1 ? 's' : ''} selected</span>
          <div className="flex items-center gap-3">
            <button onClick={() => setPrintQueue(new Set())} className="text-blue-200 hover:text-white text-sm">Clear</button>
            <button onClick={printBatchQueue} disabled={batchPrinting}
              className="flex items-center gap-1.5 bg-white text-blue-600 px-4 py-1.5 rounded-lg text-sm font-semibold hover:bg-blue-50 disabled:opacity-60">
              <Printer className="w-4 h-4" />
              {batchPrinting ? 'Printing...' : 'Print All Selected'}
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>{['☐', 'Date', 'Patient', 'Doctor / Dept', 'Diagnosis', 'Rx', 'Lab', ''].map(h => (
              <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>
            ))}</tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {filteredConsultations.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-12 text-gray-400">No consultations found</td></tr>
            ) : filteredConsultations.map(c => (
              <tr key={c.id} className={`hover:bg-gray-50/50 ${printQueue.has(c.id) ? 'bg-blue-50/40' : ''}`}>
                <td className="px-4 py-3">
                  <button onClick={() => togglePrintQueue(c.id)} className="text-gray-400 hover:text-blue-600">
                    {printQueue.has(c.id) ? <CheckSquare className="w-4 h-4 text-blue-600" /> : <Square className="w-4 h-4" />}
                  </button>
                </td>
                <td className="px-4 py-3 text-sm text-gray-600">{c.date === todayStr ? 'Today' : formatDate(c.date)}</td>
                <td className="px-4 py-3">
                  <div className="text-sm font-medium text-gray-900">{c.patientName}</div>
                  <div className="text-xs text-gray-400">{c.patientMRN}</div>
                </td>
                <td className="px-4 py-3">
                  <div className="text-sm text-gray-700">{c.doctorName || '—'}</div>
                  <div className="text-xs text-gray-400">{c.department}</div>
                </td>
                <td className="px-4 py-3 text-sm text-gray-700 max-w-xs truncate">{c.diagnosis || '—'}</td>
                <td className="px-4 py-3">
                  {c.prescriptions?.length > 0 ? (
                    <span className="bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-full font-medium">{c.prescriptions.length} item{c.prescriptions.length > 1 ? 's' : ''}</span>
                  ) : <span className="text-gray-300 text-xs">—</span>}
                </td>
                <td className="px-4 py-3">
                  {c.labOrders?.length > 0 ? (
                    <span className="bg-purple-100 text-purple-700 text-xs px-2 py-0.5 rounded-full font-medium">{c.labOrders.length} test{c.labOrders.length > 1 ? 's' : ''}</span>
                  ) : <span className="text-gray-300 text-xs">—</span>}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    <button onClick={() => setViewConsult(c)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg" title="View"><Eye className="w-4 h-4" /></button>
                    {c.prescriptions?.length > 0 && (
                      <button onClick={() => shareWhatsApp(c)} className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg" title="Share via WhatsApp">
                        <MessageCircle className="w-4 h-4" />
                      </button>
                    )}
                    {c.prescriptions?.length > 0 && (
                      pharmacySentIds.has(c.id) ? (
                        <span className="text-xs text-emerald-600 font-medium px-2 py-1 bg-emerald-50 rounded-lg">✓ Sent</span>
                      ) : (
                        <button onClick={() => sendToPharmacy(c)} className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg" title="Send to Pharmacy">
                          <Send className="w-4 h-4" />
                        </button>
                      )
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* New Consultation Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl w-full max-w-2xl my-4">
            <div className="flex items-center justify-between p-5 border-b border-gray-100 sticky top-0 bg-white rounded-t-2xl z-10">
              <div className="flex items-center gap-3">
                <h2 className="font-semibold text-gray-900">New OPD Consultation</h2>
                {form.patientId && (
                  <div className="flex bg-gray-100 rounded-lg p-0.5 gap-0.5">
                    <button
                      onClick={() => setModalTab('prescription')}
                      className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${modalTab === 'prescription' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                      <Stethoscope className="w-3 h-3" /> Prescription
                    </button>
                    <button
                      onClick={() => setModalTab('history')}
                      className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${modalTab === 'history' ? 'bg-white text-purple-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                      <History className="w-3 h-3" />
                      History
                      {patientHistory.length > 0 && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${modalTab === 'history' ? 'bg-purple-100 text-purple-700' : 'bg-gray-200 text-gray-600'}`}>
                          {patientHistory.length}
                        </span>
                      )}
                    </button>
                  </div>
                )}
              </div>
              <button onClick={() => setShowModal(false)} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-5">
              {error && <div className="bg-red-50 text-red-600 text-sm p-3 rounded-lg">{error}</div>}

              {/* Patient — always visible */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-2">PATIENT *</label>
                {form.patientId ? (
                  <div className="flex items-center gap-2 border border-green-200 bg-green-50 rounded-lg px-3 py-2">
                    <span className="text-sm font-medium text-green-800 flex-1">{form.patientName} <span className="text-xs font-normal text-green-600">({form.patientMRN}) · {form.patientAge}yrs {form.patientGender}</span></span>
                    <button onClick={() => { setForm(p => ({ ...p, patientId: '', patientName: '', patientMRN: '' })); setPatientHistory([]); }} className="text-green-600"><X className="w-3.5 h-3.5" /></button>
                  </div>
                ) : (
                  <div className="relative">
                    <input value={patientSearch} onChange={e => setPatientSearch(e.target.value)} placeholder="Search patient..." className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    {patientSearch && filteredPatients.length > 0 && (
                      <div className="absolute top-full left-0 right-0 bg-white border border-gray-200 rounded-lg shadow-lg z-10 mt-1">
                        {filteredPatients.map(p => (
                          <button key={p.id} onClick={() => selectPatient(p)} className="w-full text-left px-3 py-2.5 hover:bg-blue-50 text-sm border-b border-gray-50 last:border-0">
                            <span className="font-medium">{p.name}</span> <span className="text-xs text-gray-400">({p.mrn}) · {p.age}yrs</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* ── HISTORY TAB ── */}
              {modalTab === 'history' && (
                <div className="space-y-3">
                  {historyError ? (
                    <div className="text-center py-10">
                      <div className="text-red-400 text-sm font-medium mb-1">Could not load history</div>
                      <div className="text-gray-400 text-xs">{historyError}</div>
                    </div>
                  ) : patientHistory.length === 0 ? (
                    <div className="text-center py-12">
                      <Clock className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                      <p className="text-gray-400 text-sm">No previous visits found for this patient</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-xs text-gray-500 font-medium">{patientHistory.length} previous visit{patientHistory.length !== 1 ? 's' : ''}</p>

                      {/* Vitals Trend Chart */}
                      {patientHistory.some((v: any) => v.bp || v.temperature) && (() => {
                        const chartData = [...patientHistory].reverse().map((v: any) => ({
                          date: v.date?.split('T')[0] || '',
                          bp: v.bp ? parseInt(v.bp.split('/')[0]) : undefined,
                          temp: v.temperature ? parseFloat(v.temperature) : undefined,
                          pulse: v.pulse ? parseInt(v.pulse) : undefined,
                        })).filter(d => d.bp || d.temp || d.pulse);
                        if (!chartData.length) return null;
                        return (
                          <div className="bg-blue-50 rounded-xl p-3">
                            <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-700 mb-2">
                              <TrendingUp className="w-3.5 h-3.5" /> Vitals Trend
                            </div>
                            <div className="h-32">
                              <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={chartData}>
                                  <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: '#93C5FD', fontSize: 9 }} />
                                  <YAxis axisLine={false} tickLine={false} tick={{ fill: '#93C5FD', fontSize: 9 }} />
                                  <Tooltip contentStyle={{ borderRadius: 6, border: 'none', fontSize: 11 }} />
                                  {chartData.some(d => d.bp) && <Line type="monotone" dataKey="bp" stroke="#3B82F6" strokeWidth={2} dot={{ r: 3 }} name="BP Systolic" />}
                                  {chartData.some(d => d.temp) && <Line type="monotone" dataKey="temp" stroke="#F59E0B" strokeWidth={2} dot={{ r: 3 }} name="Temp °F" />}
                                  {chartData.some(d => d.pulse) && <Line type="monotone" dataKey="pulse" stroke="#10B981" strokeWidth={2} dot={{ r: 3 }} name="Pulse" />}
                                </LineChart>
                              </ResponsiveContainer>
                            </div>
                          </div>
                        );
                      })()}
                      {patientHistory.map((visit: any) => (
                        <div key={visit.id} className="border border-gray-100 rounded-xl overflow-hidden shadow-sm">
                          {/* Visit header */}
                          <button
                            className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
                            onClick={() => setExpandedVisit(expandedVisit === visit.id ? null : visit.id)}
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-2 h-2 rounded-full bg-purple-400 shrink-0" />
                              <div>
                                <div className="text-sm font-semibold text-gray-800">{formatDate(visit.date)}</div>
                                <div className="text-xs text-gray-500">{visit.doctorName || 'Unknown Doctor'} · {visit.department}</div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              {visit.prescriptions?.length > 0 && (
                                <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                                  <Pill className="w-2.5 h-2.5 inline mr-1" />{visit.prescriptions.length} med{visit.prescriptions.length !== 1 ? 's' : ''}
                                </span>
                              )}
                              {visit.labOrders?.length > 0 && (
                                <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">
                                  {visit.labOrders.length} lab
                                </span>
                              )}
                              {expandedVisit === visit.id
                                ? <ChevronUp className="w-4 h-4 text-gray-400" />
                                : <ChevronDown className="w-4 h-4 text-gray-400" />}
                            </div>
                          </button>

                          {/* Visit details */}
                          {expandedVisit === visit.id && (
                            <div className="px-4 py-3 space-y-3 border-t border-gray-100">
                              {/* Vitals */}
                              {(visit.bp || visit.temperature || visit.pulse || visit.spo2 || visit.weight) && (
                                <div className="flex flex-wrap gap-2">
                                  {visit.bp          && <span className="text-xs bg-red-50   text-red-700   px-2 py-1 rounded-lg">BP: {visit.bp}</span>}
                                  {visit.temperature && <span className="text-xs bg-orange-50 text-orange-700 px-2 py-1 rounded-lg">T: {visit.temperature}°F</span>}
                                  {visit.pulse       && <span className="text-xs bg-blue-50  text-blue-700  px-2 py-1 rounded-lg">HR: {visit.pulse} bpm</span>}
                                  {visit.spo2        && <span className="text-xs bg-teal-50  text-teal-700  px-2 py-1 rounded-lg">SpO2: {visit.spo2}%</span>}
                                  {visit.weight      && <span className="text-xs bg-gray-100 text-gray-700  px-2 py-1 rounded-lg">Wt: {visit.weight} kg</span>}
                                </div>
                              )}
                              {/* Complaints */}
                              {visit.complaints && (
                                <div>
                                  <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Complaints</div>
                                  <p className="text-sm text-gray-700">{visit.complaints}</p>
                                </div>
                              )}
                              {/* Diagnosis */}
                              {visit.diagnosis && (
                                <div>
                                  <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Diagnosis</div>
                                  <p className="text-sm font-medium text-blue-800">{visit.diagnosis}</p>
                                </div>
                              )}
                              {/* Medicines */}
                              {visit.prescriptions?.length > 0 && (
                                <div>
                                  <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Medicines</div>
                                  <div className="space-y-1.5">
                                    {visit.prescriptions.map((rx: any, i: number) => (
                                      <div key={i} className="flex items-start gap-2 bg-blue-50 rounded-lg px-3 py-2">
                                        <div className="flex-1 min-w-0">
                                          <div className="text-xs font-semibold text-blue-900">{rx.name}</div>
                                          {rx.nameUrdu && (
                                            <div className="text-xs text-green-700 font-medium" dir="rtl" style={{ fontFamily: 'Noto Nastaliq Urdu, serif' }}>{rx.nameUrdu}</div>
                                          )}
                                          <div className="text-xs text-blue-600 mt-0.5">{rx.dosage} · {rx.frequency} · {rx.duration}</div>
                                          {rx.frequencyUrdu && (
                                            <div className="text-xs text-green-600" dir="rtl" style={{ fontFamily: 'Noto Nastaliq Urdu, serif' }}>{rx.frequencyUrdu} · {rx.durationUrdu}</div>
                                          )}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                              {/* Lab orders */}
                              {visit.labOrders?.length > 0 && (
                                <div>
                                  <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Lab Orders</div>
                                  <div className="flex flex-wrap gap-1.5">
                                    {visit.labOrders.map((l: any, i: number) => (
                                      <span key={i} className="text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded-full">{l.testName}</span>
                                    ))}
                                  </div>
                                </div>
                              )}
                              {/* Notes */}
                              {visit.notes && (
                                <div>
                                  <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Notes</div>
                                  <p className="text-xs text-gray-600">{visit.notes}</p>
                                </div>
                              )}
                              {/* Re-use button */}
                              {visit.prescriptions?.length > 0 && (
                                <button
                                  onClick={() => reuseFromHistory(visit)}
                                  className="w-full flex items-center justify-center gap-2 mt-1 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg transition-colors"
                                >
                                  <RotateCcw className="w-3.5 h-3.5" />
                                  Re-use these medicines in current prescription
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ── PRESCRIPTION TAB ── */}
              {modalTab === 'prescription' && (<>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Date</label>
                  <input type="date" value={form.date} onChange={e => f('date', e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Doctor</label>
                  <select value={form.doctorId} onChange={e => { const d = staff.find(s => s.id === e.target.value); setForm(p => ({ ...p, doctorId: d?.id || '', doctorName: d?.name || '' })); }} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">— Select —</option>
                    {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Department</label>
                  <select value={form.department} onChange={e => f('department', e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {DEPARTMENTS.map(d => <option key={d}>{d}</option>)}
                  </select>
                </div>
              </div>

              {/* Vitals */}
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Vitals</p>
                <div className="grid grid-cols-5 gap-3">
                  {[
                    { label: 'BP (mmHg)', key: 'bp', placeholder: '120/80' },
                    { label: 'Temp (°F)', key: 'temperature', placeholder: '98.6' },
                    { label: 'Weight (kg)', key: 'weight', placeholder: '70' },
                    { label: 'Pulse (bpm)', key: 'pulse', placeholder: '72' },
                    { label: 'SpO2 (%)', key: 'spo2', placeholder: '99' },
                  ].map(({ label, key, placeholder }) => (
                    <div key={key}>
                      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
                      <input value={(form as any)[key]} onChange={e => f(key, e.target.value)} placeholder={placeholder}
                        className="w-full border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Chief Complaints *</label>
                  <textarea value={form.complaints} onChange={e => f('complaints', e.target.value)} rows={3} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Diagnosis</label>
                  <textarea value={form.diagnosis} onChange={e => f('diagnosis', e.target.value)} rows={3} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>

              {/* Prescription */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Stethoscope className="w-4 h-4 text-blue-600" />
                  <label className="text-xs font-semibold text-gray-700">PRESCRIPTION</label>
                  {translating && (
                    <span className="flex items-center gap-1 text-xs text-purple-600 font-medium ml-2">
                      <Loader2 className="w-3 h-3 animate-spin" /> Transliterating medicine names...
                    </span>
                  )}
                  <div className="ml-auto flex items-center gap-2">
                    {prescriptions.length > 0 && (
                      <button onClick={openSaveTemplateModal}
                        className="flex items-center gap-1 text-xs text-gray-500 hover:text-blue-600 border border-gray-200 rounded-lg px-2 py-1 transition-colors">
                        <BookOpen className="w-3 h-3" /> Save as Template
                      </button>
                    )}
                    {templates.length > 0 && (
                      <button onClick={() => setShowTemplates(s => !s)}
                        className="flex items-center gap-1 text-xs text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg px-2 py-1 transition-colors font-medium">
                        <BookOpen className="w-3 h-3" /> Templates ({templates.length})
                      </button>
                    )}
                  </div>
                </div>
                {templateMsg && !showTemplateModal && (
                  <div className={`mb-3 rounded-lg px-3 py-2 text-xs font-medium ${templateMsg.startsWith('✓') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                    {templateMsg}
                  </div>
                )}

                {/* Template selector */}
                {showTemplates && (
                  <div className="mb-3 border border-blue-100 bg-blue-50 rounded-xl p-3 space-y-2 max-h-48 overflow-y-auto">
                    <div className="text-xs font-semibold text-blue-700 mb-1">Select a template to apply:</div>
                    {templates.map(t => (
                      <button key={t.id} onClick={() => applyTemplate(t)}
                        className="w-full text-left bg-white border border-blue-100 hover:border-blue-400 rounded-lg px-3 py-2 transition-all">
                        <div className="text-sm font-semibold text-blue-900">{t.name}</div>
                        <div className="text-xs text-gray-500">{t.diagnosis && `${t.diagnosis} · `}{t.medicines?.length || 0} medicines</div>
                      </button>
                    ))}
                  </div>
                )}
                <div className="relative mb-2">
                  <input value={medSearch} onChange={e => setMedSearch(e.target.value)} placeholder="Search medicine to add..." className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  {medSearch && filteredMeds.length > 0 && (
                    <div className="absolute top-full left-0 right-0 bg-white border border-gray-200 rounded-lg shadow-lg z-10 mt-1">
                      {filteredMeds.map(m => (
                        <button key={m.id} onClick={() => addPrescription(m)} className="w-full text-left px-3 py-2 hover:bg-blue-50 text-sm border-b border-gray-50 last:border-0">
                          {m.name} <span className="text-xs text-gray-400">— Stock: {m.stock}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {prescriptions.length > 0 && (
                  <div className="border border-gray-100 rounded-lg overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50">
                        <tr>
                          {['Medicine', 'Dosage', 'Frequency', 'Duration', 'Instructions', ''].map(h => (
                            <th key={h} className="px-2 py-2 text-left font-medium text-gray-500 whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {prescriptions.map((p, i) => (
                          <tr key={i} className="align-top">
                            {/* Medicine name EN + UR */}
                            <td className="px-3 py-2 min-w-[130px]">
                              <div className="font-medium text-gray-800">{p.name}</div>
                              <input
                                value={p.nameUrdu || ''}
                                onChange={e => updatePrescription(i, 'nameUrdu', e.target.value)}
                                placeholder="اردو نام"
                                dir="rtl"
                                className="mt-1 border border-green-200 bg-green-50 rounded px-2 py-0.5 w-full text-xs focus:outline-none focus:ring-1 focus:ring-green-400"
                                style={{ fontFamily: 'Noto Nastaliq Urdu, serif' }}
                              />
                            </td>
                            {/* Dosage EN + UR */}
                            <td className="px-2 py-2 min-w-[90px]">
                              <select
                                value={p.dosage}
                                onChange={e => updatePrescription(i, 'dosage', e.target.value)}
                                className="border border-gray-200 rounded px-2 py-1 w-full text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                              >
                                {DOSAGE_OPTIONS.map(option => <option key={option.en} value={option.en}>{option.en}</option>)}
                              </select>
                              {p.dosageUrdu && (
                                <div className="mt-1 text-green-700 text-xs text-right" dir="rtl" style={{ fontFamily: 'Noto Nastaliq Urdu, serif' }}>{p.dosageUrdu}</div>
                              )}
                            </td>
                            {/* Frequency EN + UR */}
                            <td className="px-2 py-2 min-w-[110px]">
                              <select
                                value={p.frequency}
                                onChange={async e => {
                                  const val = e.target.value;
                                  updatePrescription(i, 'frequency', val);
                                }}
                                className="border border-gray-200 rounded px-2 py-1 w-full text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                              >
                                {FREQUENCY_OPTIONS.map(option => <option key={option.en} value={option.en}>{option.en}</option>)}
                              </select>
                              {p.frequencyUrdu && (
                                <div className="mt-1 text-green-700 text-xs text-right" dir="rtl" style={{ fontFamily: 'Noto Nastaliq Urdu, serif' }}>{p.frequencyUrdu}</div>
                              )}
                            </td>
                            {/* Duration EN + UR */}
                            <td className="px-2 py-2 min-w-[90px]">
                              <select
                                value={p.duration}
                                onChange={async e => {
                                  const val = e.target.value;
                                  updatePrescription(i, 'duration', val);
                                }}
                                className="border border-gray-200 rounded px-2 py-1 w-full text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                              >
                                {DURATION_OPTIONS.map(option => <option key={option.en} value={option.en}>{option.en}</option>)}
                              </select>
                              {p.durationUrdu && (
                                <div className="mt-1 text-green-700 text-xs text-right" dir="rtl" style={{ fontFamily: 'Noto Nastaliq Urdu, serif' }}>{p.durationUrdu}</div>
                              )}
                            </td>
                            {/* Instructions EN + UR */}
                            <td className="px-2 py-2 min-w-[120px]">
                              <select
                                value={p.instructions || ''}
                                onChange={e => updatePrescription(i, 'instructions', e.target.value)}
                                className="border border-gray-200 rounded px-2 py-1 w-full text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                              >
                                {INSTRUCTION_OPTIONS.map(option => <option key={option.en || 'none'} value={option.en}>{option.en || 'No instruction'}</option>)}
                              </select>
                              <input
                                value={p.instructionsUrdu || ''}
                                onChange={e => updatePrescription(i, 'instructionsUrdu', e.target.value)}
                                placeholder="کھانے کے بعد"
                                dir="rtl"
                                className="mt-1 border border-green-200 bg-green-50 rounded px-2 py-0.5 w-full text-xs focus:outline-none focus:ring-1 focus:ring-green-400"
                                style={{ fontFamily: 'Noto Nastaliq Urdu, serif' }}
                              />
                            </td>
                            <td className="px-2 py-2">
                              <button onClick={() => setPrescriptions(p => p.filter((_, ii) => ii !== i))} className="text-red-400 hover:text-red-600">
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Lab Orders */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <FlaskConical className="w-4 h-4 text-purple-600" />
                  <label className="text-xs font-semibold text-gray-700">LAB ORDERS</label>
                </div>
                <div className="relative mb-2">
                  <input value={labSearch} onChange={e => setLabSearch(e.target.value)} placeholder="Search lab test to order..." className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  {labSearch && filteredLabTests.length > 0 && (
                    <div className="absolute top-full left-0 right-0 bg-white border border-gray-200 rounded-lg shadow-lg z-10 mt-1">
                      {filteredLabTests.map(t => (
                        <button key={t.id} onClick={() => addLabOrder(t)} className="w-full text-left px-3 py-2 hover:bg-purple-50 text-sm border-b border-gray-50 last:border-0">
                          {t.name} <span className="text-xs text-gray-400">— Rs. {t.price}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {labOrders.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {labOrders.map((l, i) => (
                      <span key={i} className="flex items-center gap-1.5 bg-purple-50 text-purple-700 text-xs px-2.5 py-1 rounded-full font-medium">
                        {l.testName}
                        <button onClick={() => setLabOrders(lo => lo.filter((_, ii) => ii !== i))} className="text-purple-400 hover:text-purple-700"><X className="w-3 h-3" /></button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Follow-up Date</label>
                  <input type="date" value={form.followUpDate} onChange={e => f('followUpDate', e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Additional Notes</label>
                  <textarea value={form.notes} onChange={e => f('notes', e.target.value)} rows={2} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>

              {/* ── BILLING ── */}
              <div className="bg-green-50 border border-green-200 rounded-xl p-4 space-y-3">
                <p className="text-xs font-semibold text-green-700 uppercase tracking-wider">💳 Consultation Billing</p>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Fee (Rs.) *</label>
                    <input type="number" min="0" value={form.fee}
                      onChange={e => f('fee', e.target.value)}
                      className="w-full border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-green-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Amount Received (Rs.)</label>
                    <input type="number" min="0" value={form.paidAmount}
                      onChange={e => f('paidAmount', e.target.value)}
                      className="w-full border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                      placeholder="0" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Payment Method</label>
                    <select value={form.paymentMethod} onChange={e => f('paymentMethod', e.target.value)}
                      className="w-full border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                      {['Cash','Card','Online Transfer','Cheque','Free'].map(m => <option key={m}>{m}</option>)}
                    </select>
                  </div>
                </div>
                {/* Live balance preview */}
                {(() => {
                  const fee = Number(form.fee) || 0;
                  const paid = Math.min(Number(form.paidAmount) || 0, fee);
                  const bal = fee - paid;
                  const status = paid >= fee ? 'paid' : paid > 0 ? 'partial' : 'pending';
                  return (
                    <div className="flex items-center justify-between text-sm pt-1 border-t border-green-200">
                      <span className="text-green-600">Balance due:</span>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-green-800">Rs. {bal.toLocaleString()}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          status === 'paid' ? 'bg-green-200 text-green-800' :
                          status === 'partial' ? 'bg-yellow-100 text-yellow-800' :
                          'bg-red-100 text-red-700'
                        }`}>{status}</span>
                      </div>
                    </div>
                  );
                })()}
                <p className="text-xs text-green-600">✓ A bill will be auto-created and linked to this consultation.</p>
              </div>
            {/* end prescription tab */}
            </>)}
            </div>
            <div className="flex gap-3 px-5 pb-5">
              <button onClick={() => setShowModal(false)} className="flex-1 border border-gray-200 text-gray-600 py-2 rounded-lg text-sm hover:bg-gray-50">Cancel</button>
              <button onClick={handleSave} disabled={saving || modalTab === 'history'} className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-60">
                {saving ? 'Saving...' : modalTab === 'history' ? 'Switch to Prescription to Save' : 'Save Consultation'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Save Template Modal */}
      {showTemplateModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-xl">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-blue-50 rounded-xl flex items-center justify-center">
                  <BookOpen className="w-4 h-4 text-blue-600" />
                </div>
                <div>
                  <h2 className="font-semibold text-gray-900">Save Prescription Template</h2>
                  <p className="text-xs text-gray-500">{prescriptions.length} medicine{prescriptions.length !== 1 ? 's' : ''} will be saved</p>
                </div>
              </div>
              <button
                onClick={() => { if (!templateSaving) { setShowTemplateModal(false); setTemplateMsg(''); } }}
                className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-50"
                disabled={templateSaving}
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              {templateMsg && (
                <div className={`rounded-lg px-3 py-2 text-sm font-medium ${templateMsg.startsWith('✓') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                  {templateMsg}
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Template Name</label>
                <input
                  value={templateName}
                  onChange={e => setTemplateName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') saveAsTemplate(); }}
                  placeholder='e.g. Viral Fever Protocol'
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  autoFocus
                />
              </div>
              {form.diagnosis && (
                <div className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
                  <div className="text-xs font-semibold text-blue-700 mb-0.5">Diagnosis</div>
                  <div className="text-sm text-blue-900">{form.diagnosis}</div>
                </div>
              )}
            </div>
            <div className="flex gap-3 p-5 pt-0">
              <button
                onClick={() => { setShowTemplateModal(false); setTemplateMsg(''); }}
                disabled={templateSaving}
                className="flex-1 border border-gray-200 text-gray-600 py-2 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={saveAsTemplate}
                disabled={templateSaving}
                className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-60"
              >
                {templateSaving ? 'Saving...' : 'Save Template'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* View Consult Modal */}
      {viewConsult && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-gray-100 print:hidden">
              <h2 className="font-semibold text-gray-900">Consultation Details</h2>
              <div className="flex items-center gap-2">
                <button onClick={() => printConsultation(viewConsult)} className="flex items-center gap-1.5 text-gray-500 hover:text-gray-700 text-sm border border-gray-200 px-3 py-1.5 rounded-lg">
                  <Printer className="w-4 h-4" /> Print PDF
                </button>
                {viewConsult.prescriptions?.length > 0 && (
                  <button onClick={() => shareWhatsApp(viewConsult)}
                    className="flex items-center gap-1.5 text-green-600 hover:text-green-700 text-sm border border-green-200 px-3 py-1.5 rounded-lg">
                    <MessageCircle className="w-4 h-4" /> WhatsApp
                  </button>
                )}
                <button onClick={() => setViewConsult(null)} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
              </div>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                {[['Patient', viewConsult.patientName], ['MRN', viewConsult.patientMRN], ['Date', formatDate(viewConsult.date)], ['Doctor', viewConsult.doctorName || '—'], ['Department', viewConsult.department], ['Fee', `Rs. ${viewConsult.fee}`]].map(([l, v]) => (
                  <div key={l as string}><span className="text-xs text-gray-400 block">{l}</span><span className="font-medium text-gray-800">{v}</span></div>
                ))}
              </div>
              {viewConsult.complaints && <div><span className="text-xs font-semibold text-gray-500 block mb-1">COMPLAINTS</span><p className="text-sm text-gray-700 bg-gray-50 p-3 rounded-lg">{viewConsult.complaints}</p></div>}
              {(viewConsult.bp || viewConsult.temperature || viewConsult.weight || viewConsult.pulse || viewConsult.spo2) && (
                <div>
                  <span className="text-xs font-semibold text-gray-500 block mb-2">VITALS</span>
                  <div className="grid grid-cols-5 gap-2">
                    {[['BP', viewConsult.bp, 'mmHg'], ['Temp', viewConsult.temperature, '°F'], ['Weight', viewConsult.weight, 'kg'], ['Pulse', viewConsult.pulse, 'bpm'], ['SpO2', viewConsult.spo2, '%']].map(([l, v, u]) => v ? (
                      <div key={l as string} className="bg-blue-50 rounded-lg p-2 text-center">
                        <div className="text-xs text-blue-400">{l}</div>
                        <div className="text-sm font-bold text-blue-700">{v}</div>
                        <div className="text-[10px] text-blue-400">{u}</div>
                      </div>
                    ) : null)}
                  </div>
                </div>
              )}
              {viewConsult.diagnosis && <div><span className="text-xs font-semibold text-gray-500 block mb-1">DIAGNOSIS</span><p className="text-sm text-gray-700 bg-gray-50 p-3 rounded-lg">{viewConsult.diagnosis}</p></div>}
              {viewConsult.prescriptions?.length > 0 && (
                <div>
                  <span className="text-xs font-semibold text-gray-500 block mb-2">PRESCRIPTION</span>
                  {viewConsult.prescriptions.map((p: any, i: number) => (
                    <div key={i} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0 text-sm">
                      <span className="font-medium text-gray-800">{p.name}</span>
                      <span className="text-gray-500 text-xs">{p.dosage} · {p.frequency} · {p.duration}</span>
                    </div>
                  ))}
                </div>
              )}
              {viewConsult.labOrders?.length > 0 && (
                <div>
                  <span className="text-xs font-semibold text-gray-500 block mb-2">LAB ORDERS</span>
                  <div className="flex flex-wrap gap-2">
                    {viewConsult.labOrders.map((l: any, i: number) => (
                      <span key={i} className="bg-purple-50 text-purple-700 text-xs px-2.5 py-1 rounded-full font-medium">{l.testName}</span>
                    ))}
                  </div>
                </div>
              )}
              {viewConsult.followUpDate && <div><span className="text-xs text-gray-400">Follow-up: </span><span className="text-sm font-medium text-blue-600">{formatDate(viewConsult.followUpDate)}</span></div>}
            </div>
            <div className="px-5 pb-5 flex gap-3">
              <button onClick={() => setViewConsult(null)} className="flex-1 border border-gray-200 text-gray-600 py-2 rounded-lg text-sm hover:bg-gray-50">Close</button>
              {viewConsult.prescriptions?.length > 0 && (
                pharmacySentIds.has(viewConsult.id) ? (
                  <span className="flex items-center justify-center gap-2 px-4 py-2 bg-emerald-50 text-emerald-700 rounded-lg text-sm font-medium border border-emerald-200">
                    ✓ Sent to Pharmacy
                  </span>
                ) : (
                  <button onClick={() => { sendToPharmacy(viewConsult); setViewConsult(null); }}
                    className="flex items-center justify-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700">
                    <Send className="w-4 h-4" /> Send to Pharmacy
                  </button>
                )
              )}
              <button onClick={() => { navigate('/ipd'); setViewConsult(null); }}
                className="flex items-center justify-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700">
                <ArrowRight className="w-4 h-4" /> Transfer to IPD
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
