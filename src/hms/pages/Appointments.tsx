import { useState, useEffect } from 'react';
import { collection, onSnapshot, addDoc, updateDoc, doc, getDoc, query, where, getDocs } from 'firebase/firestore';
import { db, auth, getNextMRN } from '../../firebase';
import { formatDate, today, nowISO } from '../lib/utils';
import { logAudit } from '../lib/audit';
import { useNavigate } from 'react-router-dom';
import {
  Plus, Search, X, CheckCircle, XCircle, Clock, CalendarDays,
  ChevronLeft, ChevronRight, LayoutList, UserPlus, User, Stethoscope,
} from 'lucide-react';
import {
  format, startOfMonth, endOfMonth, eachDayOfInterval, getDay,
  isSameDay, isSameMonth, addMonths, subMonths, parseISO,
} from 'date-fns';
import { cn } from '../lib/utils';

const DEPARTMENTS = ['General Medicine','Surgery','Gynecology','Pediatrics','ENT','Orthopedics','Dermatology','Cardiology','Neurology','Ophthalmology','Dentistry','Radiology'];
const TYPES = ['OPD','Follow-up','Emergency','Procedure'];
const BLOOD_GROUPS = ['A+','A-','B+','B-','AB+','AB-','O+','O-','Unknown'];

function StatusBadge({ s }: { s: string }) {
  const map: Record<string,string> = {
    scheduled: 'bg-blue-100 text-blue-700',
    completed: 'bg-green-100 text-green-700',
    cancelled: 'bg-red-100 text-red-700',
    'no-show': 'bg-gray-100 text-gray-600',
  };
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${map[s] || map['scheduled']}`}>{s}</span>;
}

function CalendarCell({ date, appointments, currentMonth, onDayClick, todayDate }: any) {
  const isToday = isSameDay(date, todayDate);
  const isCurrentMonth = isSameMonth(date, currentMonth);
  const dayAppts = appointments.filter((a: any) => { try { return isSameDay(parseISO(a.date), date); } catch { return false; } });
  const colorByStatus = (s: string) => s === 'completed' ? 'bg-green-500' : s === 'cancelled' ? 'bg-red-400' : s === 'no-show' ? 'bg-gray-400' : 'bg-blue-500';
  return (
    <div onClick={() => onDayClick(date)}
      className={cn('min-h-[80px] p-1.5 border-b border-r border-gray-100 cursor-pointer hover:bg-blue-50/50 transition-colors', !isCurrentMonth && 'bg-gray-50/60')}>
      <span className={cn('inline-flex w-6 h-6 items-center justify-center rounded-full text-xs font-semibold mb-1',
        isToday ? 'bg-blue-600 text-white' : isCurrentMonth ? 'text-gray-700' : 'text-gray-300')}>
        {format(date, 'd')}
      </span>
      <div className="space-y-0.5">
        {dayAppts.slice(0, 2).map((a: any) => (
          <div key={a.id} className={`text-[10px] rounded px-1 py-0.5 text-white font-medium truncate ${colorByStatus(a.status)}`}>
            {a.time} {a.patientName}
          </div>
        ))}
        {dayAppts.length > 2 && <div className="text-[10px] text-gray-400 pl-1">+{dayAppts.length - 2} more</div>}
      </div>
    </div>
  );
}

export function Appointments() {
  const [appointments, setAppointments] = useState<any[]>([]);
  const [patients, setPatients] = useState<any[]>([]);
  const [staff, setStaff] = useState<any[]>([]);
  const [consultationFee, setConsultationFee] = useState('500');
  const [view, setView] = useState<'list' | 'calendar'>('list');
  const [tab, setTab] = useState<'today' | 'all'>('today');
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [calMonth, setCalMonth] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);

  // Detect if current user is a doctor
  const [currentStaffId, setCurrentStaffId] = useState<string | null>(null);
  const [currentRole, setCurrentRole] = useState<string>('');

  // Patient search / creation
  const [patientSearch, setPatientSearch] = useState('');
  const [patientMode, setPatientMode] = useState<'search' | 'new'>('search');
  const [selectedPatient, setSelectedPatient] = useState<any | null>(null);

  // New patient form (inline)
  const [newPt, setNewPt] = useState({ name: '', age: '', gender: 'Male', phone: '', address: '', bloodGroup: 'Unknown', allergies: '' });

  // Appointment form
  const [apptForm, setApptForm] = useState({
    doctorId: '', doctorName: '', department: 'General Medicine',
    date: today(), time: '09:00', type: 'OPD', fee: consultationFee, notes: '',
  });

  // Vitals
  const [vitals, setVitals] = useState({ bp: '', temperature: '', weight: '', pulse: '', spo2: '' });

  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'appointments'), snap =>
      setAppointments(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a: any, b: any) =>
        (b.date + b.time) > (a.date + a.time) ? -1 : 1))
    );
    const u2 = onSnapshot(collection(db, 'patients'), snap => setPatients(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    const u3 = onSnapshot(collection(db, 'staff'), snap => {
      const doctors = snap.docs.filter(d => d.data().role === 'doctor').map(d => ({ id: d.id, ...d.data() }));
      setStaff(doctors as any[]);
    });
    getDoc(doc(db, 'settings', 'hospital')).then(snap => {
      if (snap.exists() && snap.data().consultationFee) {
        setConsultationFee(String(snap.data().consultationFee));
        setApptForm(f => ({ ...f, fee: String(snap.data().consultationFee) }));
      }
    });
    // Determine current user's staff record and role
    getDoc(doc(db, 'users', auth.currentUser?.uid || 'x')).then(snap => {
      if (snap.exists()) {
        const role = snap.data().role;
        setCurrentRole(role);
        if (role === 'doctor') {
          // Find staff record by email
          onSnapshot(collection(db, 'staff'), s => {
            const me = s.docs.find(d => d.data().userId === auth.currentUser?.uid);
            if (me) setCurrentStaffId(me.id);
          });
        }
      }
    });
    return () => { u1(); u2(); u3(); };
  }, []);

  // Doctors only see their own appointments
  const visibleAppointments = currentRole === 'doctor' && currentStaffId
    ? appointments.filter(a => a.doctorId === currentStaffId)
    : appointments;

  const todayStr = today();
  const filtered = visibleAppointments.filter(a => {
    const matchTab = tab === 'today' ? a.date === todayStr : true;
    const matchSearch = !search || a.patientName?.toLowerCase().includes(search.toLowerCase()) || a.patientMRN?.includes(search) || a.doctorName?.toLowerCase().includes(search.toLowerCase());
    return matchTab && matchSearch;
  });

  const filteredPatients = patients.filter(p =>
    patientSearch && (p.name?.toLowerCase().includes(patientSearch.toLowerCase()) || p.mrn?.includes(patientSearch) || p.phone?.includes(patientSearch))
  ).slice(0, 6);

  const selectPatient = (p: any) => { setSelectedPatient(p); setPatientSearch(''); };

  const openAdd = () => {
    setSelectedPatient(null);
    setPatientSearch('');
    setPatientMode('search');
    setNewPt({ name: '', age: '', gender: 'Male', phone: '', address: '', bloodGroup: 'Unknown', allergies: '' });
    setApptForm({ doctorId: '', doctorName: '', department: 'General Medicine', date: today(), time: '09:00', type: 'OPD', fee: consultationFee, notes: '' });
    setVitals({ bp: '', temperature: '', weight: '', pulse: '', spo2: '' });
    setError('');
    setShowModal(true);
  };

  const af = (k: string, v: string) => setApptForm(p => ({ ...p, [k]: v }));

  const handleSave = async () => {
    // Validate patient
    if (!selectedPatient && patientMode === 'search') { setError('Select a patient or click "New Patient".'); return; }
    if (patientMode === 'new' && !newPt.name.trim()) { setError('Patient name is required.'); return; }
    if (!apptForm.date || !apptForm.time) { setError('Date and time are required.'); return; }

    // Conflict detection
    if (apptForm.doctorId) {
      const conflict = visibleAppointments.find(a =>
        a.doctorId === apptForm.doctorId && a.date === apptForm.date &&
        a.time === apptForm.time && a.status === 'scheduled'
      );
      if (conflict) { setError(`⚠ Dr. ${apptForm.doctorName} already has an appointment at ${apptForm.time} on this date.`); return; }
    }

    setSaving(true); setError('');
    try {
      let patientId = selectedPatient?.id || '';
      let patientName = selectedPatient?.name || '';
      let patientMRN = selectedPatient?.mrn || '';
      let patientAge = selectedPatient?.age ? String(selectedPatient.age) : '';
      let patientGender = selectedPatient?.gender || '';

      // Create new patient if needed
      if (patientMode === 'new') {
        const mrn = await getNextMRN();
        const ref = await addDoc(collection(db, 'patients'), { ...newPt, age: Number(newPt.age) || 0, mrn, createdAt: nowISO() });
        await logAudit('create', 'patient', ref.id, `${newPt.name} (${mrn}) — via appointment`);
        patientId = ref.id; patientName = newPt.name; patientMRN = mrn;
        patientAge = newPt.age; patientGender = newPt.gender;
      }

      const tokenNo = appointments.filter(a => a.date === apptForm.date).length + 1;

      // Save appointment with vitals
      const apptRef = await addDoc(collection(db, 'appointments'), {
        ...apptForm, fee: Number(apptForm.fee), tokenNo,
        patientId, patientName, patientMRN, patientAge, patientGender,
        vitals, status: 'scheduled', createdAt: nowISO(),
      });
      await logAudit('create', 'appointment', apptRef.id, `${patientName} — ${apptForm.date} ${apptForm.time}`);

      setShowModal(false);
    } catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  };

  const navigate = useNavigate();

  const updateStatus = async (id: string, status: string) => {
    await updateDoc(doc(db, 'appointments', id), { status, updatedAt: nowISO() });
    await logAudit('update', 'appointment', id, `status → ${status}`);
    if (status === 'cancelled' || status === 'no-show') {
      try {
        const billsQ = query(collection(db, 'bills'), where('appointmentId', '==', id));
        const snap = await getDocs(billsQ);
        for (const b of snap.docs) {
          await updateDoc(doc(db, 'bills', b.id), { paymentStatus: status, updatedAt: nowISO() });
        }
      } catch (e) { console.error('Bill update failed:', e); }
    }
  };

  const sendToOPD = (appt: any) => {
    sessionStorage.setItem('opd_prefill', JSON.stringify({
      patientId: appt.patientId,
      patientName: appt.patientName,
      patientMRN: appt.patientMRN,
      patientAge: appt.patientAge || '',
      patientGender: appt.patientGender || '',
      doctorId: appt.doctorId || '',
      doctorName: appt.doctorName || '',
      department: appt.department || 'General Medicine',
      date: appt.date,
      appointmentId: appt.id,
      fee: String(appt.fee || '500'),
      notes: appt.notes || '',
      vitals: appt.vitals || {},
    }));
    navigate('/opd');
  };

  // Calendar
  const calStart = startOfMonth(calMonth);
  const calEnd = endOfMonth(calMonth);
  const calDays = eachDayOfInterval({ start: calStart, end: calEnd });
  const startPad = getDay(calStart);
  const dayLabels = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const selectedDayAppts = selectedDay
    ? visibleAppointments.filter(a => { try { return isSameDay(parseISO(a.date), selectedDay); } catch { return false; } })
    : [];

  const todayCount = visibleAppointments.filter(a => a.date === todayStr).length;
  const completedToday = visibleAppointments.filter(a => a.date === todayStr && a.status === 'completed').length;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Appointments</h1>
          <p className="text-sm text-gray-500">
            Today: {completedToday}/{todayCount} completed
            {currentRole === 'doctor' && ' · Showing your appointments only'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-white border border-gray-200 rounded-lg p-1 gap-1">
            <button onClick={() => setView('list')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium ${view === 'list' ? 'bg-blue-600 text-white' : 'text-gray-500 hover:text-gray-700'}`}>
              <LayoutList className="w-3.5 h-3.5" /> List
            </button>
            <button onClick={() => setView('calendar')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium ${view === 'calendar' ? 'bg-blue-600 text-white' : 'text-gray-500 hover:text-gray-700'}`}>
              <CalendarDays className="w-3.5 h-3.5" /> Calendar
            </button>
          </div>
          <button onClick={openAdd} className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-blue-700">
            <Plus className="w-4 h-4" /> New Appointment
          </button>
        </div>
      </div>

      {/* LIST VIEW */}
      {view === 'list' && (
        <>
          <div className="flex items-center gap-4">
            <div className="flex bg-white border border-gray-200 rounded-lg p-1 gap-1">
              {(['today','all'] as const).map(t => (
                <button key={t} onClick={() => setTab(t)} className={`px-4 py-1.5 rounded-md text-sm font-medium ${tab === t ? 'bg-blue-600 text-white' : 'text-gray-500 hover:text-gray-700'}`}>
                  {t === 'today' ? "Today's" : 'All'}
                </button>
              ))}
            </div>
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search patient, MRN or doctor..."
                className="w-full pl-9 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>{['Token','Date & Time','Patient','Doctor / Dept','Type','Fee','Status','Actions'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>
                ))}</tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.length === 0 ? (
                  <tr><td colSpan={8} className="text-center py-12 text-gray-400 text-sm">No appointments found</td></tr>
                ) : filtered.map(a => (
                  <tr key={a.id} className="hover:bg-gray-50/50">
                    <td className="px-4 py-3"><div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center"><span className="text-xs font-bold text-white">{a.tokenNo||'—'}</span></div></td>
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium text-gray-900">{a.date === todayStr ? 'Today' : formatDate(a.date)}</div>
                      <div className="text-xs text-gray-400 flex items-center gap-1"><Clock className="w-3 h-3" />{a.time}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium text-gray-900">{a.patientName}</div>
                      <div className="text-xs font-mono text-gray-400">{a.patientMRN}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm text-gray-700">{a.doctorName || '—'}</div>
                      <div className="text-xs text-gray-400">{a.department}</div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{a.type}</td>
                    <td className="px-4 py-3 text-sm font-medium text-gray-800">Rs. {a.fee}</td>
                    <td className="px-4 py-3"><StatusBadge s={a.status} /></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button onClick={() => sendToOPD(a)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg" title="Send to OPD"><Stethoscope className="w-4 h-4" /></button>
                        {a.status === 'scheduled' && (
                          <>
                            <button onClick={() => updateStatus(a.id, 'completed')} className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg" title="Complete"><CheckCircle className="w-4 h-4" /></button>
                            <button onClick={() => updateStatus(a.id, 'cancelled')} className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg" title="Cancel"><XCircle className="w-4 h-4" /></button>
                            <button onClick={() => updateStatus(a.id, 'no-show')} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg" title="No Show"><Clock className="w-4 h-4" /></button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* CALENDAR VIEW */}
      {view === 'calendar' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <button onClick={() => setCalMonth(m => subMonths(m, 1))} className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-lg"><ChevronLeft className="w-4 h-4" /></button>
              <h2 className="font-semibold text-gray-900 text-sm">{format(calMonth, 'MMMM yyyy')}</h2>
              <button onClick={() => setCalMonth(m => addMonths(m, 1))} className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-lg"><ChevronRight className="w-4 h-4" /></button>
            </div>
            <div className="grid grid-cols-7 border-b border-gray-100">
              {dayLabels.map(d => <div key={d} className="py-2 text-center text-xs font-semibold text-gray-400 uppercase">{d}</div>)}
            </div>
            <div className="grid grid-cols-7">
              {Array.from({ length: startPad }).map((_, i) => <div key={`pad-${i}`} className="min-h-[80px] border-b border-r border-gray-100 bg-gray-50/40" />)}
              {calDays.map(date => (
                <CalendarCell key={date.toISOString()} date={date} appointments={visibleAppointments} currentMonth={calMonth}
                  todayDate={new Date()} onDayClick={(d: Date) => setSelectedDay(isSameDay(d, selectedDay || new Date(0)) ? null : d)} />
              ))}
            </div>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900 text-sm">{selectedDay ? format(selectedDay, 'EEEE, MMMM d') : 'Select a day'}</h3>
              {selectedDay && <p className="text-xs text-gray-400 mt-0.5">{selectedDayAppts.length} appointment{selectedDayAppts.length !== 1 ? 's' : ''}</p>}
            </div>
            <div className="overflow-y-auto max-h-96">
              {!selectedDay ? (
                <div className="px-5 py-10 text-center text-sm text-gray-400"><CalendarDays className="w-8 h-8 text-gray-200 mx-auto mb-2" />Click a day</div>
              ) : selectedDayAppts.length === 0 ? (
                <div className="px-5 py-8 text-center">
                  <p className="text-sm text-gray-400">No appointments</p>
                  <button onClick={() => { openAdd(); setApptForm(f => ({ ...f, date: format(selectedDay, 'yyyy-MM-dd') })); }}
                    className="mt-3 text-xs text-blue-600 font-medium flex items-center gap-1 mx-auto"><Plus className="w-3 h-3" /> Add one</button>
                </div>
              ) : selectedDayAppts.map(a => (
                <div key={a.id} className="px-4 py-3 border-b border-gray-50 last:border-0">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-medium text-gray-900">{a.patientName}</div>
                      <div className="text-xs text-gray-400 flex items-center gap-1 mt-0.5"><Clock className="w-3 h-3" />{a.time} · {a.department}</div>
                    </div>
                    <StatusBadge s={a.status} />
                  </div>
                  {a.status === 'scheduled' && (
                    <div className="flex gap-1.5 mt-2">
                      <button onClick={() => sendToOPD(a)} className="flex-1 text-xs bg-blue-50 text-blue-700 py-1 rounded-lg hover:bg-blue-100 font-medium">OPD</button>
                      <button onClick={() => updateStatus(a.id, 'completed')} className="flex-1 text-xs bg-green-50 text-green-700 py-1 rounded-lg hover:bg-green-100 font-medium">Done</button>
                      <button onClick={() => updateStatus(a.id, 'cancelled')} className="flex-1 text-xs bg-red-50 text-red-700 py-1 rounded-lg hover:bg-red-100 font-medium">Cancel</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* NEW APPOINTMENT MODAL */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl w-full max-w-xl my-4">
            <div className="flex items-center justify-between p-5 border-b border-gray-100 sticky top-0 bg-white rounded-t-2xl">
              <h2 className="font-semibold text-gray-900">New Appointment</h2>
              <button onClick={() => setShowModal(false)} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-5">
              {error && <div className="bg-red-50 text-red-600 text-sm p-3 rounded-lg">{error}</div>}

              {/* ── PATIENT SECTION ── */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Patient *</label>
                  <div className="flex bg-gray-100 rounded-lg p-0.5 gap-0.5">
                    <button onClick={() => { setPatientMode('search'); setSelectedPatient(null); }}
                      className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium ${patientMode === 'search' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500'}`}>
                      <Search className="w-3 h-3" /> Existing
                    </button>
                    <button onClick={() => { setPatientMode('new'); setSelectedPatient(null); }}
                      className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium ${patientMode === 'new' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500'}`}>
                      <UserPlus className="w-3 h-3" /> New Patient
                    </button>
                  </div>
                </div>

                {patientMode === 'search' && (
                  selectedPatient ? (
                    <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
                      <div className="w-9 h-9 bg-green-100 rounded-full flex items-center justify-center shrink-0">
                        <User className="w-4 h-4 text-green-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-green-800">{selectedPatient.name}</div>
                        <div className="text-xs text-green-600">{selectedPatient.mrn} · {selectedPatient.age}yrs · {selectedPatient.gender} · {selectedPatient.phone}</div>
                      </div>
                      <button onClick={() => setSelectedPatient(null)} className="text-green-500 hover:text-green-700"><X className="w-4 h-4" /></button>
                    </div>
                  ) : (
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input value={patientSearch} onChange={e => setPatientSearch(e.target.value)}
                        placeholder="Search by name, MRN or phone..."
                        className="w-full pl-9 pr-4 border border-gray-200 rounded-xl py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      {patientSearch && filteredPatients.length > 0 && (
                        <div className="absolute top-full left-0 right-0 bg-white border border-gray-200 rounded-xl shadow-lg z-10 mt-1 max-h-52 overflow-y-auto">
                          {filteredPatients.map(p => (
                            <button key={p.id} onClick={() => selectPatient(p)}
                              className="w-full text-left px-4 py-3 hover:bg-blue-50 border-b border-gray-50 last:border-0">
                              <div className="font-medium text-sm text-gray-800">{p.name}</div>
                              <div className="text-xs text-gray-400">{p.mrn} · {p.age}yrs · {p.phone}</div>
                            </button>
                          ))}
                        </div>
                      )}
                      {patientSearch && filteredPatients.length === 0 && (
                        <div className="absolute top-full left-0 right-0 bg-white border border-gray-200 rounded-xl shadow-lg z-10 mt-1 p-3 text-center text-sm text-gray-400">
                          No patient found — <button className="text-blue-600 font-medium" onClick={() => { setPatientMode('new'); setNewPt(n => ({ ...n, name: patientSearch })); }}>create new?</button>
                        </div>
                      )}
                    </div>
                  )
                )}

                {patientMode === 'new' && (
                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-3">
                    <p className="text-xs font-semibold text-blue-700 flex items-center gap-1.5"><UserPlus className="w-3.5 h-3.5" /> New patient will be created with auto-MRN</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="col-span-2">
                        <label className="block text-xs font-medium text-gray-600 mb-1">Full Name *</label>
                        <input value={newPt.name} onChange={e => setNewPt(p => ({ ...p, name: e.target.value }))}
                          className="w-full border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Age</label>
                        <input type="number" value={newPt.age} onChange={e => setNewPt(p => ({ ...p, age: e.target.value }))}
                          className="w-full border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Gender</label>
                        <select value={newPt.gender} onChange={e => setNewPt(p => ({ ...p, gender: e.target.value }))}
                          className="w-full border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                          {['Male','Female','Other'].map(g => <option key={g}>{g}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Phone</label>
                        <input value={newPt.phone} onChange={e => setNewPt(p => ({ ...p, phone: e.target.value }))}
                          className="w-full border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Blood Group</label>
                        <select value={newPt.bloodGroup} onChange={e => setNewPt(p => ({ ...p, bloodGroup: e.target.value }))}
                          className="w-full border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                          {BLOOD_GROUPS.map(g => <option key={g}>{g}</option>)}
                        </select>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* ── VITALS ── */}
              <div>
                <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">Vitals</p>
                <div className="grid grid-cols-5 gap-2">
                  {[['BP','bp','120/80'],['Temp °F','temperature','98.6'],['Weight kg','weight','70'],['Pulse','pulse','72'],['SpO2 %','spo2','99']].map(([label, key, placeholder]) => (
                    <div key={key}>
                      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
                      <input value={(vitals as any)[key]} onChange={e => setVitals(v => ({ ...v, [key]: e.target.value }))} placeholder={placeholder}
                        className="w-full border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                  ))}
                </div>
              </div>

              {/* ── APPOINTMENT DETAILS ── */}
              <div>
                <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">Appointment Details</p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Date *</label>
                    <input type="date" value={apptForm.date} onChange={e => af('date', e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Time *</label>
                    <input type="time" value={apptForm.time} onChange={e => af('time', e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Department</label>
                    <select value={apptForm.department} onChange={e => af('department', e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                      {DEPARTMENTS.map(d => <option key={d}>{d}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Doctor</label>
                    <select value={apptForm.doctorId} onChange={e => { const d = staff.find(s => s.id === e.target.value); setApptForm(f => ({ ...f, doctorId: d?.id || '', doctorName: d?.name || '' })); }}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                      <option value="">— Select Doctor —</option>
                      {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Type</label>
                    <select value={apptForm.type} onChange={e => af('type', e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                      {TYPES.map(t => <option key={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Consultation Fee (Rs.)</label>
                    <input type="number" value={apptForm.fee} onChange={e => af('fee', e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
                    <textarea value={apptForm.notes} onChange={e => af('notes', e.target.value)} rows={2}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                </div>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5 text-xs text-blue-700">
                ✓ A bill will be generated when the doctor completes the OPD consultation.
              </div>
            </div>
            <div className="flex gap-3 px-5 pb-5">
              <button onClick={() => setShowModal(false)} className="flex-1 border border-gray-200 text-gray-600 py-2 rounded-lg text-sm hover:bg-gray-50">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-60">
                {saving ? 'Saving...' : 'Book Appointment'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
