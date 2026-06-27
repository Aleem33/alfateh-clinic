import { useState, useEffect, useMemo, useRef } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { updatePassword, reauthenticateWithCredential, EmailAuthProvider } from 'firebase/auth';
import { db, auth, registerUser } from '../../firebase';
import { nowISO } from '../lib/utils';
import { Building2, Download, Upload, Trash2, AlertTriangle, UserPlus, X, Lock, Eye, EyeOff, Bot, CheckCircle, RefreshCw, Printer, FlaskConical } from 'lucide-react';
import { AppUpdater } from '../../components/AppUpdater';
import { getGeminiKey, setGeminiKey } from '../lib/translate';
import {
  DEFAULT_PRESCRIPTION_PRINT_SETTINGS,
  getPrescriptionPrintSettings,
  savePrescriptionPrintSettings,
  type PrescriptionPrintMode,
  type PrescriptionPrintProfile,
  type PrescriptionPrintSettings,
} from '../lib/prescriptionPrintSettings';
import { buildPrescriptionHTML, type PrescriptionPrintData } from '../lib/pdf';
import { deleteAppDataScope, exportAllAppData, GLOBAL_DATA_COLLECTIONS, RESET_COLLECTIONS, restoreAllAppData, summarizeBackup } from '../../lib/dataSync';

const ROLES = ['admin','receptionist','doctor','pharmacist','lab_technician','cashier'];

function F({ label, value, onChange, type = 'text', placeholder = '' }: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
    </div>
  );
}

const PRESCRIPTION_PREVIEW_DATA: PrescriptionPrintData = {
  patientName: 'Muhammad Ahmed Khan',
  patientMRN: 'AF-10428',
  patientAge: '42 Y',
  patientGender: 'Male',
  doctorName: 'Dr. Salman Ali',
  department: 'General Medicine',
  date: '27-06-2026',
  complaints: 'Fever, sore throat and body aches for 3 days',
  diagnosis: 'Upper respiratory tract infection',
  prescriptions: [
    {
      name: 'Amoxicillin / Clavulanate 625 mg',
      form: 'Tablet',
      nameUrdu: 'اموکسی سلین کلاوولینیٹ',
      doseSchedule: {
        morning: { amount: '1', amountUrdu: '۱' },
        afternoon: { amount: '0', amountUrdu: '۰' },
        night: { amount: '1', amountUrdu: '۱' },
      },
      dosage: '1 tablet',
      frequency: 'Twice daily',
      duration: '5 days',
      instructions: 'After meal',
      instructionsUrdu: 'کھانے کے بعد',
    },
    {
      name: 'Paracetamol 500 mg',
      form: 'Tablet',
      nameUrdu: 'پیراسیٹامول',
      doseSchedule: {
        morning: { amount: '1', amountUrdu: '۱' },
        afternoon: { amount: '1', amountUrdu: '۱' },
        night: { amount: '1', amountUrdu: '۱' },
      },
      dosage: '1 tablet',
      frequency: 'Three times daily',
      duration: '3 days',
      instructions: 'If fever or pain',
      instructionsUrdu: 'بخار یا درد کی صورت میں',
    },
  ],
  labOrders: [{ testName: 'CBC' }],
  followUpDate: '02-07-2026',
  notes: 'Drink plenty of fluids and rest.',
  vitals: { bp: '120/80', temperature: '99.4°F', weight: '74 kg', pulse: '82', spo2: '98%' },
};

function PrescriptionPrintPreview({ settings }: { settings: PrescriptionPrintSettings }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [hostWidth, setHostWidth] = useState(0);
  const isFullPad = settings.mode === 'fullPad';
  const nativeWidth = (isFullPad ? 191.2 : 210) * (96 / 25.4);
  const nativeHeight = (isFullPad ? 268.5 : 297) * (96 / 25.4);
  const scale = Math.min(1, Math.max(0.1, (hostWidth - 32) / nativeWidth));
  const html = useMemo(
    () => buildPrescriptionHTML(PRESCRIPTION_PREVIEW_DATA, settings),
    [settings],
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const updateWidth = () => setHostWidth(host.clientWidth);
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div>
          <h3 className="text-sm font-semibold text-gray-800">Live Print Preview</h3>
          <p className="text-xs text-gray-500">Updates immediately; save when the alignment looks right.</p>
        </div>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 bg-gray-100 rounded px-2 py-1">
          {isFullPad ? 'Full pad' : 'A4 overlay'}
        </span>
      </div>
      <div ref={hostRef} className="rounded-xl border border-gray-200 bg-slate-200 p-4 overflow-hidden">
        {hostWidth > 0 && (
          <div
            className="relative mx-auto bg-white shadow-lg"
            style={{ width: nativeWidth * scale, height: nativeHeight * scale }}
          >
            <iframe
              title={`${isFullPad ? 'Full pad' : 'Preprinted'} prescription preview`}
              srcDoc={html}
              className="absolute left-0 top-0 border-0 bg-white pointer-events-none"
              style={{
                width: nativeWidth,
                height: nativeHeight,
                transform: `scale(${scale})`,
                transformOrigin: 'top left',
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

const emptyHospital = { name: 'Al-Fateh General Clinic', address: '', phone: '', email: '', ntn: '', bankAccount: '', footerNote: 'Thank you for choosing our hospital.', consultationFee: '500' };
const emptyUser = { name: '', email: '', password: '', role: 'receptionist' };

export function Settings() {
  const [hospital, setHospital] = useState(emptyHospital);
  const [savingHospital, setSavingHospital] = useState(false);
  const [hospitalMsg, setHospitalMsg] = useState('');

  // Change Password
  const [currentPass, setCurrentPass] = useState('');
  const [newPass, setNewPass] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [passMsg, setPassMsg] = useState('');
  const [savingPass, setSavingPass] = useState(false);

  const handleChangePassword = async () => {
    setPassMsg('');
    if (!currentPass || !newPass || !confirmPass) { setPassMsg('All fields are required.'); return; }
    if (newPass.length < 6) { setPassMsg('New password must be at least 6 characters.'); return; }
    if (newPass !== confirmPass) { setPassMsg('Passwords do not match.'); return; }
    setSavingPass(true);
    try {
      const user = auth.currentUser;
      if (!user || !user.email) throw new Error('Not logged in');
      const credential = EmailAuthProvider.credential(user.email, currentPass);
      await reauthenticateWithCredential(user, credential);
      await updatePassword(user, newPass);
      setPassMsg('✓ Password changed successfully!');
      setCurrentPass(''); setNewPass(''); setConfirmPass('');
      setTimeout(() => setPassMsg(''), 4000);
    } catch (e: any) {
      if (e.code === 'auth/wrong-password' || e.code === 'auth/invalid-credential') {
        setPassMsg('Current password is incorrect.');
      } else {
        setPassMsg('Error: ' + e.message);
      }
    } finally { setSavingPass(false); }
  };

  // Export
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState('');

  // Import
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState('');
  const [pendingImport, setPendingImport] = useState<any>(null);
  const [showImportConfirm, setShowImportConfirm] = useState(false);

  // Reset hospital data
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearText, setClearText] = useState('');
  const [clearing, setClearing] = useState(false);
  const [clearMsg, setClearMsg] = useState('');
  const [showLabClearConfirm, setShowLabClearConfirm] = useState(false);
  const [labClearText, setLabClearText] = useState('');
  const [labClearing, setLabClearing] = useState(false);
  const [labClearMsg, setLabClearMsg] = useState('');

  const [geminiKey, setGeminiKeyState] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [keyMsg, setKeyMsg] = useState('');
  const [printSettings, setPrintSettings] = useState<PrescriptionPrintSettings>(DEFAULT_PRESCRIPTION_PRINT_SETTINGS);
  const [printSettingsMsg, setPrintSettingsMsg] = useState('');
  const activePrintProfile = printSettings.profiles[printSettings.mode];

  const saveGeminiKey = () => {
    setGeminiKey(geminiKey);
    setKeyMsg('✓ API key saved!');
    setTimeout(() => setKeyMsg(''), 3000);
  };

  const savePrintSettings = () => {
    savePrescriptionPrintSettings(printSettings);
    setPrintSettingsMsg('✓ Prescription print settings saved!');
    setTimeout(() => setPrintSettingsMsg(''), 3000);
  };

  const savePrintMode = (mode: PrescriptionPrintMode, title: string) => {
    setPrintSettings(s => {
      const next = { ...s, mode };
      savePrescriptionPrintSettings(next);
      return next;
    });
    setPrintSettingsMsg(`âœ“ Print mode saved: ${title}`);
    setTimeout(() => setPrintSettingsMsg(''), 3000);
  };

  const resetPrintSettings = () => {
    savePrescriptionPrintSettings(DEFAULT_PRESCRIPTION_PRINT_SETTINGS);
    setPrintSettings({
      mode: DEFAULT_PRESCRIPTION_PRINT_SETTINGS.mode,
      profiles: {
        preprinted: { ...DEFAULT_PRESCRIPTION_PRINT_SETTINGS.profiles.preprinted },
        fullPad: { ...DEFAULT_PRESCRIPTION_PRINT_SETTINGS.profiles.fullPad },
      },
    });
    setPrintSettingsMsg('âœ“ Prescription print settings reset!');
    setTimeout(() => setPrintSettingsMsg(''), 3000);
  };

  const updatePrintNumber = (key: keyof PrescriptionPrintProfile, value: string, fallback = 0) => {
    setPrintSettings(s => ({
      ...s,
      profiles: {
        ...s.profiles,
        [s.mode]: {
          ...s.profiles[s.mode],
          [key]: Number(value) || fallback,
        },
      },
    }));
  };

  // New user
  const [showUserModal, setShowUserModal] = useState(false);
  const [userForm, setUserForm] = useState(emptyUser);
  const [creatingUser, setCreatingUser] = useState(false);
  const [userMsg, setUserMsg] = useState('');

  useEffect(() => {
    getDoc(doc(db, 'settings', 'hospital')).then(snap => {
      if (snap.exists()) setHospital({ ...emptyHospital, ...snap.data() });
    });
    setGeminiKeyState(getGeminiKey());
    setPrintSettings(getPrescriptionPrintSettings());
  }, []);

  const saveHospital = async () => {
    setSavingHospital(true); setHospitalMsg('');
    try {
      await setDoc(doc(db, 'settings', 'hospital'), hospital);
      setHospitalMsg('✓ Saved successfully');
      setTimeout(() => setHospitalMsg(''), 3000);
    } catch (e: any) { setHospitalMsg('Error: ' + e.message); }
    finally { setSavingHospital(false); }
  };

  const handleExport = async () => {
    setExporting(true); setExportMsg('Reading data...');
    try {
      const backup = await exportAllAppData(setExportMsg);
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `alfateh-suite-backup-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
      setExportMsg('Done: complete HMS + Pharmacy backup downloaded!');
      setTimeout(() => setExportMsg(''), 4000);
    } catch (e: any) { setExportMsg('Error: ' + e.message); }
    finally { setExporting(false); }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string);
        if (!data.collections) throw new Error('Invalid backup format');
        setPendingImport(data); setShowImportConfirm(true);
      } catch (err: any) { setImportMsg('Invalid backup file: ' + err.message); }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleImport = async () => {
    if (!pendingImport) return;
    setImporting(true); setShowImportConfirm(false); setImportMsg('Importing...');
    try {
      const totalDocs = await restoreAllAppData(pendingImport, setImportMsg);
      setImportMsg(`Done: ${totalDocs} records restored across HMS and Pharmacy.`);
      setTimeout(() => setImportMsg(''), 5000);
    } catch (e: any) { setImportMsg('Error: ' + e.message); }
    finally { setImporting(false); setPendingImport(null); }
  };

  const handleClear = async () => {
    if (clearText !== 'DELETE ALL') return;
    setShowClearConfirm(false);
    setClearing(true);
    setClearMsg('Deleting hospital data...');
    try {
      const totalDocs = await deleteAppDataScope('hms', setClearMsg);
      setClearText('');
      setClearMsg(`Done: deleted ${totalDocs} hospital records. User accounts were kept.`);
      setTimeout(() => setClearMsg(''), 5000);
    } catch (e: any) { setClearMsg('Error: ' + e.message); }
    finally { setClearing(false); }
  };

  const handleClearLab = async () => {
    if (labClearText !== 'DELETE LAB') return;
    setShowLabClearConfirm(false);
    setLabClearing(true);
    setLabClearMsg('Deleting lab data...');
    try {
      const totalDocs = await deleteAppDataScope('lab', setLabClearMsg);
      setLabClearText('');
      setLabClearMsg(`Done: deleted ${totalDocs} lab records. User accounts were kept.`);
      setTimeout(() => setLabClearMsg(''), 5000);
    } catch (e: any) { setLabClearMsg('Error: ' + e.message); }
    finally { setLabClearing(false); }
  };

  const handleCreateUser = async () => {
    if (!userForm.name || !userForm.email || !userForm.password || !userForm.role) { setUserMsg('All fields required.'); return; }
    setCreatingUser(true); setUserMsg('');
    try {
      const cred = await registerUser(userForm.email, userForm.password);
      await setDoc(doc(db, 'users', cred.user.uid), { name: userForm.name, username: userForm.email, email: userForm.email, role: userForm.role, app: 'hms', createdAt: nowISO() });
      setUserMsg('✓ User created successfully!');
      setUserForm(emptyUser);
      setTimeout(() => { setUserMsg(''); setShowUserModal(false); }, 2000);
    } catch (e: any) { setUserMsg('Error: ' + (e.message || 'Could not create user')); }
    finally { setCreatingUser(false); }
  };

  return (
    <div className="space-y-6 max-w-7xl">
      <h1 className="text-2xl font-bold text-gray-900">Settings</h1>

      {/* Hospital Info */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-center gap-2 mb-5">
          <Building2 className="w-5 h-5 text-blue-600" />
          <h2 className="font-semibold text-gray-900">Hospital Information</h2>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <F label="Hospital Name" value={hospital.name} onChange={(v: string) => setHospital(h => ({ ...h, name: v }))} />
          <F label="Phone" value={hospital.phone} onChange={(v: string) => setHospital(h => ({ ...h, phone: v }))} placeholder="+92 XXX XXXXXXX" />
          <F label="Email" value={hospital.email} onChange={(v: string) => setHospital(h => ({ ...h, email: v }))} type="email" />
          <F label="NTN / Registration No" value={hospital.ntn} onChange={(v: string) => setHospital(h => ({ ...h, ntn: v }))} />
          <F label="Default Consultation Fee (Rs.)" value={(hospital as any).consultationFee || '500'} onChange={(v: string) => setHospital(h => ({ ...h, consultationFee: v }))} type="number" placeholder="500" />
          <div className="col-span-2">
            <F label="Address" value={hospital.address} onChange={(v: string) => setHospital(h => ({ ...h, address: v }))} />
          </div>
          <div className="col-span-2">
            <F label="Receipt Footer Note" value={hospital.footerNote} onChange={(v: string) => setHospital(h => ({ ...h, footerNote: v }))} />
          </div>
        </div>
        <div className="flex items-center gap-3 mt-4">
          <button onClick={saveHospital} disabled={savingHospital}
            className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60">
            {savingHospital ? 'Saving...' : 'Save Changes'}
          </button>
          {hospitalMsg && <span className={`text-sm font-medium ${hospitalMsg.startsWith('✓') ? 'text-green-600' : 'text-red-500'}`}>{hospitalMsg}</span>}
        </div>
      </div>

      {/* Change Password */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-center gap-2 mb-5">
          <Lock className="w-5 h-5 text-blue-600" />
          <h2 className="font-semibold text-gray-900">Change Password</h2>
        </div>
        {passMsg && (
          <p className={`text-sm font-medium mb-4 p-3 rounded-lg ${passMsg.startsWith('✓') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
            {passMsg}
          </p>
        )}
        <div className="grid grid-cols-1 gap-4 max-w-md">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Current Password</label>
            <div className="relative">
              <input type={showCurrent ? 'text' : 'password'} value={currentPass} onChange={e => setCurrentPass(e.target.value)}
                placeholder="Enter current password"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 pr-9 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <button type="button" onClick={() => setShowCurrent(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">New Password</label>
            <div className="relative">
              <input type={showNew ? 'text' : 'password'} value={newPass} onChange={e => setNewPass(e.target.value)}
                placeholder="Min. 6 characters"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 pr-9 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <button type="button" onClick={() => setShowNew(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Confirm New Password</label>
            <input type="password" value={confirmPass} onChange={e => setConfirmPass(e.target.value)}
              placeholder="Repeat new password"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <button onClick={handleChangePassword} disabled={savingPass}
            className="w-fit px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60">
            {savingPass ? 'Updating...' : 'Update Password'}
          </button>
        </div>
      </div>

      {/* User Management */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-violet-600" />
            <h2 className="font-semibold text-gray-900">Create Staff User</h2>
          </div>
          <button onClick={() => setShowUserModal(true)} className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white rounded-lg text-sm font-medium hover:bg-violet-700">
            <UserPlus className="w-4 h-4" /> Add User
          </button>
        </div>
        <p className="text-sm text-gray-500">Create login accounts for your staff. Each user will sign in with their email and password.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {ROLES.map(r => (
            <span key={r} className="px-3 py-1 bg-gray-100 text-gray-600 text-xs rounded-full font-medium capitalize">{r.replace('_',' ')}</span>
          ))}
        </div>
      </div>

      {/* Backup & Restore */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-center gap-2 mb-5">
          <Download className="w-5 h-5 text-green-600" />
          <h2 className="font-semibold text-gray-900">Backup & Restore</h2>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="border border-gray-200 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-gray-800 mb-1">Export Backup</h3>
            <p className="text-xs text-gray-500 mb-3">Download all HMS and Pharmacy data as one JSON file.</p>
            <button onClick={handleExport} disabled={exporting}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-60">
              <Download className="w-4 h-4" /> {exporting ? 'Exporting...' : 'Download Backup'}
            </button>
            {exportMsg && <p className={`text-xs mt-2 font-medium ${exportMsg.startsWith('Done') ? 'text-green-600' : 'text-gray-500'}`}>{exportMsg}</p>}
          </div>
          <div className="border border-gray-200 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-gray-800 mb-1">Restore Backup</h3>
            <p className="text-xs text-gray-500 mb-3">Upload a suite backup to restore HMS and Pharmacy data.</p>
            <label className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 cursor-pointer w-fit">
              <Upload className="w-4 h-4" /> Choose File
              <input type="file" accept=".json" className="hidden" onChange={handleFileSelect} />
            </label>
            {importMsg && <p className={`text-xs mt-2 font-medium ${importMsg.startsWith('Done') ? 'text-green-600' : importMsg.startsWith('Error') ? 'text-red-500' : 'text-gray-500'}`}>{importMsg}</p>}
            {pendingImport && <p className="text-xs text-gray-400 mt-2">{summarizeBackup(pendingImport)}</p>}
          </div>
        </div>
      </div>

      {/* Prescription Printing */}
      <div className="bg-white rounded-xl border border-blue-100 shadow-sm p-6">
        <div className="flex items-center gap-2 mb-1">
          <Printer className="w-5 h-5 text-blue-600" />
          <h2 className="font-semibold text-gray-900">Prescription Printing</h2>
        </div>
        <p className="text-xs text-gray-500 mb-4">
          Choose whether to fill existing printed pads or print the complete Al-Fateh pad design.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
          {[
            { mode: 'preprinted' as const, title: 'Overlay on pre-printed pad', desc: 'Print only patient, vitals, and Rx boxes.' },
            { mode: 'fullPad' as const, title: 'Print full pad', desc: 'Print the complete pad artwork plus prescription.' },
          ].map(option => (
            <button
              key={option.mode}
              type="button"
              onClick={() => savePrintMode(option.mode, option.title)}
              className={`text-left border rounded-xl p-4 transition-colors ${printSettings.mode === option.mode ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}`}
            >
              <span className="block text-sm font-semibold text-gray-900">{option.title}</span>
              <span className="block text-xs text-gray-500 mt-1">{option.desc}</span>
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.9fr)] gap-6 items-start">
          <div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <F
                label="Whole Page X Offset (mm)"
                type="number"
                value={String(activePrintProfile.offsetX)}
                onChange={(v: string) => updatePrintNumber('offsetX', v)}
              />
              <F
                label="Whole Page Y Offset (mm)"
                type="number"
                value={String(activePrintProfile.offsetY)}
                onChange={(v: string) => updatePrintNumber('offsetY', v)}
              />
              <F
                label="Content Font Scale (%)"
                type="number"
                value={String(activePrintProfile.fontScale)}
                onChange={(v: string) => updatePrintNumber('fontScale', v, 100)}
              />
            </div>

        <div className="mt-5 border border-gray-100 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-gray-800 mb-3">Patient Details Position</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <F label="Name X Offset (mm)" type="number" value={String(activePrintProfile.patientNameOffsetX)} onChange={(v: string) => updatePrintNumber('patientNameOffsetX', v)} />
            <F label="Name Y Offset (mm)" type="number" value={String(activePrintProfile.patientNameOffsetY)} onChange={(v: string) => updatePrintNumber('patientNameOffsetY', v)} />
            <F label="Name Font Size" type="number" value={String(activePrintProfile.patientNameFontSize)} onChange={(v: string) => updatePrintNumber('patientNameFontSize', v, DEFAULT_PRESCRIPTION_PRINT_SETTINGS.profiles[printSettings.mode].patientNameFontSize)} />
            <F label="Age X Offset (mm)" type="number" value={String(activePrintProfile.patientAgeOffsetX)} onChange={(v: string) => updatePrintNumber('patientAgeOffsetX', v)} />
            <F label="Age Y Offset (mm)" type="number" value={String(activePrintProfile.patientAgeOffsetY)} onChange={(v: string) => updatePrintNumber('patientAgeOffsetY', v)} />
            <F label="Age Font Size" type="number" value={String(activePrintProfile.patientAgeFontSize)} onChange={(v: string) => updatePrintNumber('patientAgeFontSize', v, DEFAULT_PRESCRIPTION_PRINT_SETTINGS.profiles[printSettings.mode].patientAgeFontSize)} />
            <F label="Date X Offset (mm)" type="number" value={String(activePrintProfile.patientDateOffsetX)} onChange={(v: string) => updatePrintNumber('patientDateOffsetX', v)} />
            <F label="Date Y Offset (mm)" type="number" value={String(activePrintProfile.patientDateOffsetY)} onChange={(v: string) => updatePrintNumber('patientDateOffsetY', v)} />
            <F label="Date Font Size" type="number" value={String(activePrintProfile.patientDateFontSize)} onChange={(v: string) => updatePrintNumber('patientDateFontSize', v, DEFAULT_PRESCRIPTION_PRINT_SETTINGS.profiles[printSettings.mode].patientDateFontSize)} />
          </div>
        </div>

        <div className="mt-4 border border-gray-100 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-gray-800 mb-3">Vitals Position</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <F label="Vitals X Offset (mm)" type="number" value={String(activePrintProfile.vitalsOffsetX)} onChange={(v: string) => updatePrintNumber('vitalsOffsetX', v)} />
            <F label="Vitals Y Offset (mm)" type="number" value={String(activePrintProfile.vitalsOffsetY)} onChange={(v: string) => updatePrintNumber('vitalsOffsetY', v)} />
            <F label="Vitals Font Size" type="number" value={String(activePrintProfile.vitalsFontSize)} onChange={(v: string) => updatePrintNumber('vitalsFontSize', v, DEFAULT_PRESCRIPTION_PRINT_SETTINGS.profiles[printSettings.mode].vitalsFontSize)} />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 mt-4">
          <button onClick={savePrintSettings}
            className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
            <CheckCircle className="w-4 h-4" /> Save Print Settings
          </button>
          <button
            type="button"
            onClick={resetPrintSettings}
            className="border border-gray-200 text-gray-600 rounded-lg px-4 py-2 text-sm font-medium hover:bg-gray-50"
          >
            Reset Defaults
          </button>
          {printSettingsMsg && <span className="text-sm font-medium text-green-600">{printSettingsMsg}</span>}
        </div>
          </div>
          <div className="xl:sticky xl:top-4">
            <PrescriptionPrintPreview settings={printSettings} />
          </div>
        </div>
      </div>

      {/* Gemini API Key - Auto Urdu Transliteration */}
      <div className="bg-white rounded-xl border border-purple-100 shadow-sm p-6">
        <div className="flex items-center gap-2 mb-1">
          <Bot className="w-5 h-5 text-purple-600" />
          <h2 className="font-semibold text-gray-900">AI Urdu Auto-Transliteration</h2>
        </div>
        <p className="text-xs text-gray-500 mb-4">
          Enter your Gemini API key to automatically transliterate medicine names into Urdu script when writing or printing prescriptions.
          Your key is saved locally on this device only.
        </p>
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <label className="block text-xs font-medium text-gray-600 mb-1">Gemini API Key</label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={geminiKey}
                onChange={e => setGeminiKeyState(e.target.value)}
                placeholder="AIza..."
                className="w-full border border-purple-200 rounded-lg px-3 py-2 pr-10 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-purple-400"
              />
              <button type="button" onClick={() => setShowKey(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <button onClick={saveGeminiKey}
            className="flex items-center gap-2 px-5 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 whitespace-nowrap">
            <CheckCircle className="w-4 h-4" /> Save Key
          </button>
        </div>
        {keyMsg && <p className="text-sm font-medium text-green-600 mt-2">{keyMsg}</p>}
        <p className="text-xs text-gray-400 mt-3">
          Get your key from <span className="text-purple-600 font-medium">Google AI Studio</span> → API Keys
        </p>
      </div>

      {/* App Updates */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-center gap-2 mb-4">
          <RefreshCw className="w-5 h-5 text-blue-600" />
          <h2 className="font-semibold text-gray-900">App Updates</h2>
        </div>
        <AppUpdater variant="settings" />
      </div>

      {/* Danger Zone */}
      <div className="bg-white rounded-xl border border-red-100 shadow-sm p-6">
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className="w-5 h-5 text-red-500" />
          <h2 className="font-semibold text-red-600">Danger Zone</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="border border-red-100 rounded-xl p-4">
            <p className="text-sm text-gray-500 mb-3">Permanently delete hospital-side records only. Pharmacy and lab records are kept.</p>
            <p className="text-xs text-gray-400 mb-4">
              {RESET_COLLECTIONS.hms.length} hospital collections included. User profiles, Firebase Authentication accounts, and passwords are not deleted or reset.
            </p>
            <button onClick={() => setShowClearConfirm(true)} className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700">
              <Trash2 className="w-4 h-4" /> Reset Hospital Data
            </button>
          </div>
          <div className="border border-red-100 rounded-xl p-4">
            <p className="text-sm text-gray-500 mb-3">Permanently delete lab orders and lab test setup only. Hospital and pharmacy records are kept.</p>
            <p className="text-xs text-gray-400 mb-4">
              {RESET_COLLECTIONS.lab.length} lab collections included. User profiles, Firebase Authentication accounts, and passwords are not deleted or reset.
            </p>
            <button onClick={() => setShowLabClearConfirm(true)} className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700">
              <FlaskConical className="w-4 h-4" /> Reset Lab Data
            </button>
          </div>
        </div>
        {clearMsg && <p className={`text-sm font-medium mt-3 ${clearMsg.startsWith('Done') ? 'text-green-600' : clearMsg.startsWith('Error') ? 'text-red-500' : 'text-blue-600'}`}>{clearMsg}</p>}
        {labClearMsg && <p className={`text-sm font-medium mt-3 ${labClearMsg.startsWith('Done') ? 'text-green-600' : labClearMsg.startsWith('Error') ? 'text-red-500' : 'text-blue-600'}`}>{labClearMsg}</p>}
      </div>

      {/* Import Confirm Modal */}
      {showImportConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full">
            <h2 className="font-semibold text-gray-900 mb-2">Confirm Import</h2>
            <p className="text-sm text-gray-500 mb-3">This will add/overwrite HMS and Pharmacy data from the backup file. Existing records with the same ID will be replaced.</p>
            {pendingImport && <p className="text-xs text-gray-500 mb-4 bg-gray-50 rounded-lg p-3">{summarizeBackup(pendingImport)}</p>}
            <div className="flex gap-3">
              <button onClick={() => { setShowImportConfirm(false); setPendingImport(null); }} className="flex-1 border border-gray-200 text-gray-600 py-2 rounded-lg text-sm">Cancel</button>
              <button onClick={handleImport} disabled={importing} className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm hover:bg-blue-700">Import</button>
            </div>
          </div>
        </div>
      )}

      {/* Clear Confirm Modal */}
      {showClearConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full">
            <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-3"><AlertTriangle className="w-5 h-5 text-red-600" /></div>
            <h2 className="font-semibold text-gray-900 text-center mb-1">Reset Hospital Data?</h2>
            <p className="text-sm text-gray-500 text-center mb-4">
              Type <strong>DELETE ALL</strong> to confirm. This requires internet and keeps all user logins working with the same passwords.
            </p>
            <input value={clearText} onChange={e => setClearText(e.target.value)} placeholder="DELETE ALL"
              className="w-full border border-red-200 rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-red-400 text-center font-mono" />
            <div className="flex gap-3">
              <button onClick={() => { setShowClearConfirm(false); setClearText(''); }} className="flex-1 border border-gray-200 text-gray-600 py-2 rounded-lg text-sm">Cancel</button>
              <button onClick={handleClear} disabled={clearText !== 'DELETE ALL' || clearing}
                className="flex-1 bg-red-600 text-white py-2 rounded-lg text-sm hover:bg-red-700 disabled:opacity-40">
                {clearing ? 'Deleting...' : 'Reset Hospital'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lab Clear Confirm Modal */}
      {showLabClearConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full">
            <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-3"><FlaskConical className="w-5 h-5 text-red-600" /></div>
            <h2 className="font-semibold text-gray-900 text-center mb-1">Reset Lab Data?</h2>
            <p className="text-sm text-gray-500 text-center mb-4">
              Type <strong>DELETE LAB</strong> to confirm. This deletes lab orders and lab tests only.
            </p>
            <input value={labClearText} onChange={e => setLabClearText(e.target.value)} placeholder="DELETE LAB"
              className="w-full border border-red-200 rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-red-400 text-center font-mono" />
            <div className="flex gap-3">
              <button onClick={() => { setShowLabClearConfirm(false); setLabClearText(''); }} className="flex-1 border border-gray-200 text-gray-600 py-2 rounded-lg text-sm">Cancel</button>
              <button onClick={handleClearLab} disabled={labClearText !== 'DELETE LAB' || labClearing}
                className="flex-1 bg-red-600 text-white py-2 rounded-lg text-sm hover:bg-red-700 disabled:opacity-40">
                {labClearing ? 'Deleting...' : 'Reset Lab'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New User Modal */}
      {showUserModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">Create New User</h2>
              <button onClick={() => { setShowUserModal(false); setUserMsg(''); setUserForm(emptyUser); }} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              {userMsg && <p className={`text-sm font-medium p-2 rounded-lg ${userMsg.startsWith('✓') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>{userMsg}</p>}
              <F label="Full Name" value={userForm.name} onChange={(v: string) => setUserForm(f => ({ ...f, name: v }))} />
              <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Username (for login)</label>
              <input type="text" value={userForm.email} onChange={(e) => setUserForm(f => ({ ...f, email: e.target.value.replace(/\s+/g, '.').toLowerCase() }))} placeholder="e.g. dr.ahmed" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono" />
              <p className="text-xs text-gray-400 mt-1">No spaces — use dots (e.g. dr.ahmed, cashier1)</p>
            </div>
              <F label="Password" value={userForm.password} onChange={(v: string) => setUserForm(f => ({ ...f, password: v }))} type="password" placeholder="Min 6 characters" />
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Role</label>
                <select value={userForm.role} onChange={e => setUserForm(f => ({ ...f, role: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {ROLES.map(r => <option key={r} value={r}>{r.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-3 p-5 pt-0">
              <button onClick={() => { setShowUserModal(false); setUserForm(emptyUser); setUserMsg(''); }} className="flex-1 border border-gray-200 text-gray-600 py-2 rounded-lg text-sm">Cancel</button>
              <button onClick={handleCreateUser} disabled={creatingUser} className="flex-1 bg-violet-600 text-white py-2 rounded-lg text-sm hover:bg-violet-700 disabled:opacity-60">
                {creatingUser ? 'Creating...' : 'Create User'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

