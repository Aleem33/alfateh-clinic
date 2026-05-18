import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where, orderBy, doc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { today, formatDate } from '../lib/utils';
import { Monitor, ChevronRight, Clock, Users, CheckCircle } from 'lucide-react';

const STAT_COLORS: Record<string, { bg: string; text: string }> = {
  yellow: { bg: 'bg-yellow-100', text: 'text-yellow-600' },
  blue: { bg: 'bg-blue-100', text: 'text-blue-600' },
  green: { bg: 'bg-green-100', text: 'text-green-600' },
};

export function TokenDisplay() {
  const [appointments, setAppointments] = useState<any[]>([]);
  const [calling, setCalling] = useState<string | null>(null);

  useEffect(() => {
    const todayStr = today();
    const unsub = onSnapshot(
      collection(db, 'appointments'),
      snap => {
        const appts = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter((a: any) => a.date === todayStr)
          .sort((a: any, b: any) => (a.tokenNo || 999) - (b.tokenNo || 999));
        setAppointments(appts as any[]);
      }
    );
    return () => unsub();
  }, []);

  const waiting  = appointments.filter((a: any) => a.status === 'scheduled' || a.status === 'waiting');
  const serving  = appointments.filter((a: any) => a.status === 'serving');
  const done     = appointments.filter((a: any) => a.status === 'done' || a.status === 'completed');
  const current  = serving[0] || null;
  const next     = waiting.slice(0, 4);

  const callNext = async () => {
    if (!waiting[0]) return;
    setCalling(waiting[0].id);
    try {
      // Mark current as done
      if (current) await updateDoc(doc(db, 'appointments', current.id), { status: 'done' });
      // Call next
      await updateDoc(doc(db, 'appointments', waiting[0].id), { status: 'serving' });
    } finally {
      setCalling(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center">
            <Monitor className="w-5 h-5 text-indigo-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Token Display</h1>
            <p className="text-sm text-gray-500">Today's queue — {appointments.length} appointments</p>
          </div>
        </div>
        <button onClick={callNext} disabled={!waiting.length || !!calling}
          className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors">
          <ChevronRight className="w-4 h-4" />
          {calling ? 'Calling...' : 'Call Next'}
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Waiting', value: waiting.length, color: 'yellow', icon: Clock },
          { label: 'Being Served', value: serving.length, color: 'blue', icon: Users },
          { label: 'Done Today', value: done.length, color: 'green', icon: CheckCircle },
        ].map(s => {
          const colors = STAT_COLORS[s.color] || STAT_COLORS.blue;
          return (
          <div key={s.label} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 flex items-center gap-4">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${colors.bg}`}>
              <s.icon className={`w-6 h-6 ${colors.text}`} />
            </div>
            <div>
              <div className="text-3xl font-bold text-gray-900">{s.value}</div>
              <div className="text-sm text-gray-500">{s.label}</div>
            </div>
          </div>
        )})}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* NOW SERVING */}
        <div className={`rounded-2xl border-2 p-6 ${current ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-gray-200'}`}>
          <div className={`text-xs font-bold uppercase tracking-widest mb-3 ${current ? 'text-blue-200' : 'text-gray-400'}`}>
            Now Serving
          </div>
          {current ? (
            <div>
              <div className="text-7xl font-black mb-2">{current.tokenNo || '—'}</div>
              <div className="text-xl font-semibold">{current.patientName}</div>
              <div className="text-blue-200 text-sm mt-1">{current.doctorName || 'General OPD'}</div>
            </div>
          ) : (
            <div className="text-4xl font-bold text-gray-300 py-4">—</div>
          )}
        </div>

        {/* NEXT UP */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <div className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Next Up</div>
          {next.length === 0 ? (
            <p className="text-gray-400 text-sm py-4">No patients waiting</p>
          ) : (
            <div className="space-y-2">
              {next.map((a: any, i) => (
                <div key={a.id} className={`flex items-center gap-4 p-3 rounded-xl ${i === 0 ? 'bg-indigo-50 border border-indigo-100' : 'bg-gray-50'}`}>
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-lg shrink-0 ${i === 0 ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-600'}`}>
                    {a.tokenNo || '?'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-gray-900 truncate">{a.patientName}</div>
                    <div className="text-xs text-gray-500">{a.doctorName || 'General OPD'}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Full Queue */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 font-semibold text-gray-700 text-sm">Full Queue ({appointments.length})</div>
        <div className="divide-y divide-gray-50">
          {appointments.length === 0 ? (
            <div className="text-center py-10 text-gray-400 text-sm">No appointments today</div>
          ) : appointments.map((a: any) => (
            <div key={a.id} className="flex items-center gap-3 px-5 py-3">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                a.status === 'serving' ? 'bg-blue-600 text-white' :
                a.status === 'done' || a.status === 'completed' ? 'bg-green-100 text-green-600' :
                'bg-gray-100 text-gray-600'
              }`}>{a.tokenNo || '?'}</div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-900 truncate">{a.patientName}</div>
                <div className="text-xs text-gray-400">{a.type} · {a.doctorName || '—'}</div>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${
                a.status === 'serving' ? 'bg-blue-100 text-blue-700' :
                a.status === 'done' || a.status === 'completed' ? 'bg-green-100 text-green-700' :
                'bg-yellow-100 text-yellow-700'
              }`}>{a.status || 'waiting'}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
