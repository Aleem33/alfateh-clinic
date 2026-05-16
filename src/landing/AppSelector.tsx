import logoUrl from '../assets/logo';
import { Building2, Pill, ArrowRight, AlertCircle } from 'lucide-react';
import { AppUpdater } from '../components/AppUpdater';

interface Props {
  onSelect: (mode: 'hms' | 'pos') => void;
  authError?: string;
}

export function AppSelector({ onSelect, authError }: Props) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex flex-col items-center justify-center p-6">
      {/* Logo */}
      <div className="mb-10 text-center">
        <div className="flex items-center justify-center mx-auto mb-4">
          <img src={logoUrl} alt="Al-Fateh Clinic" className="w-24 h-24 object-contain drop-shadow-xl" />
        </div>
        <h1 className="text-3xl font-bold text-white tracking-tight">Al-Fateh Clinic</h1>
        <p className="text-blue-300 mt-1.5 text-sm">Select a system to continue</p>
      </div>

      {/* Auth Error */}
      {authError && (
        <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 text-red-300 text-sm rounded-xl px-4 py-3 mb-6 max-w-md w-full">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {authError}
        </div>
      )}

      {/* Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 w-full max-w-xl">
        {/* Hospital */}
        <button
          onClick={() => onSelect('hms')}
          className="group bg-white/5 hover:bg-white/10 border border-white/10 hover:border-blue-400/50 rounded-2xl p-6 text-left transition-all duration-200 hover:shadow-2xl hover:shadow-blue-500/10 hover:-translate-y-0.5"
        >
          <div className="w-12 h-12 bg-blue-500/20 group-hover:bg-blue-500/30 rounded-xl flex items-center justify-center mb-4 transition-colors">
            <Building2 className="w-6 h-6 text-blue-400" />
          </div>
          <h2 className="text-white font-semibold text-lg mb-1">Hospital</h2>
          <p className="text-blue-200/60 text-sm leading-relaxed">
            Patients · OPD/IPD · Lab · Staff · Billing
          </p>
          <div className="flex items-center gap-1.5 mt-4 text-blue-400 text-sm font-medium">
            <span>Enter HMS</span>
            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </div>
        </button>

        {/* Pharmacy */}
        <button
          onClick={() => onSelect('pos')}
          className="group bg-white/5 hover:bg-white/10 border border-white/10 hover:border-emerald-400/50 rounded-2xl p-6 text-left transition-all duration-200 hover:shadow-2xl hover:shadow-emerald-500/10 hover:-translate-y-0.5"
        >
          <div className="w-12 h-12 bg-emerald-500/20 group-hover:bg-emerald-500/30 rounded-xl flex items-center justify-center mb-4 transition-colors">
            <Pill className="w-6 h-6 text-emerald-400" />
          </div>
          <h2 className="text-white font-semibold text-lg mb-1">Pharmacy POS</h2>
          <p className="text-emerald-200/60 text-sm leading-relaxed">
            Billing · Medicines · Purchases · Reports
          </p>
          <div className="flex items-center gap-1.5 mt-4 text-emerald-400 text-sm font-medium">
            <span>Enter POS</span>
            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </div>
        </button>
      </div>

      <AppUpdater variant="landing" />
    </div>
  );
}
