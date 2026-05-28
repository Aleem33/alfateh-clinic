import { useState, useEffect } from 'react';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db } from '../../firebase';
import { Search, User, Pill, ClipboardList, ChevronDown, ChevronUp, Calendar, Stethoscope } from 'lucide-react';

interface RxItem { name: string; dosage: string; frequency: string; duration: string; scheduleText?: string; }
interface Order {
  id: string; consultationId: string; patientId: string;
  patientName: string; patientMRN: string; patientAge: string; patientGender: string;
  doctorName: string; department: string; diagnosis: string; date: string;
  prescriptions: RxItem[]; status: string; createdAt: string;
}

export function PatientHistory() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'pharmacyOrders'), orderBy('createdAt', 'desc')),
      snap => {
        setOrders(snap.docs.map(d => ({ id: d.id, ...d.data() } as Order)));
        setLoading(false);
      },
      err => { console.error(err); setLoading(false); }
    );
    return () => unsub();
  }, []);

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // Group by patient
  const grouped: Record<string, Order[]> = {};
  for (const o of orders) {
    const key = o.patientMRN || o.patientId || o.patientName;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(o);
  }

  const filteredKeys = Object.keys(grouped).filter(key => {
    const patient = grouped[key][0];
    return (
      !search ||
      patient.patientName?.toLowerCase().includes(search.toLowerCase()) ||
      patient.patientMRN?.includes(search) ||
      patient.patientId?.includes(search)
    );
  });

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      pending: 'bg-amber-50 text-amber-700 border-amber-200',
      dispensed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      cancelled: 'bg-red-50 text-red-700 border-red-200',
    };
    return map[status] || 'bg-gray-50 text-gray-600 border-gray-200';
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Patient Prescription History</h1>
          <p className="text-sm text-gray-500 mt-0.5">All prescriptions sent from Hospital OPD</p>
        </div>
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2 text-center">
          <p className="text-2xl font-bold text-emerald-700">{filteredKeys.length}</p>
          <p className="text-xs text-emerald-600">Patients</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by name or MRN..."
          className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
      </div>

      {/* Patient list */}
      {loading ? (
        <div className="text-center py-20 text-gray-400">
          <div className="w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm">Loading records…</p>
        </div>
      ) : filteredKeys.length === 0 ? (
        <div className="text-center py-20 text-gray-400 bg-white rounded-2xl border border-gray-100">
          <ClipboardList className="w-14 h-14 mx-auto mb-3 opacity-20" />
          <p className="font-medium">No patient records found</p>
          <p className="text-sm mt-1">Prescriptions sent from Hospital OPD will appear here</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredKeys.map(key => {
            const patientOrders = grouped[key];
            const patient = patientOrders[0];
            const isOpen = expanded.has(key);
            const pendingCount = patientOrders.filter(o => o.status === 'pending').length;

            return (
              <div key={key} className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
                {/* Patient header row */}
                <button
                  onClick={() => toggleExpand(key)}
                  className="w-full flex items-center gap-4 p-4 text-left hover:bg-gray-50 transition-colors"
                >
                  <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center shrink-0">
                    <User className="w-5 h-5 text-blue-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-900">{patient.patientName}</span>
                      <span className="font-mono text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                        {patient.patientMRN}
                      </span>
                      {patient.patientAge && (
                        <span className="text-xs text-gray-500">
                          {patient.patientAge}y · {patient.patientGender}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {patientOrders.length} visit{patientOrders.length !== 1 ? 's' : ''}
                      {pendingCount > 0 && (
                        <span className="ml-2 font-semibold text-amber-600">
                          · {pendingCount} pending
                        </span>
                      )}
                    </p>
                  </div>
                  {isOpen ? (
                    <ChevronUp className="w-4 h-4 text-gray-400 shrink-0" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
                  )}
                </button>

                {/* Expanded prescriptions */}
                {isOpen && (
                  <div className="border-t border-gray-100 divide-y divide-gray-50">
                    {patientOrders.map(order => (
                      <div key={order.id} className="p-4 bg-gray-50/50">
                        <div className="flex items-start justify-between gap-3 mb-3">
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <Stethoscope className="w-3.5 h-3.5 text-blue-500" />
                              <span className="text-sm font-medium text-gray-700">Dr. {order.doctorName}</span>
                              <span className="text-xs text-gray-400">{order.department}</span>
                            </div>
                            {order.diagnosis && (
                              <p className="text-xs text-blue-600 font-medium mt-0.5">Dx: {order.diagnosis}</p>
                            )}
                            <div className="flex items-center gap-1 mt-1 text-xs text-gray-400">
                              <Calendar className="w-3 h-3" />
                              <span>{order.date || order.createdAt?.slice(0, 10)}</span>
                            </div>
                          </div>
                          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border capitalize ${statusBadge(order.status)}`}>
                            {order.status}
                          </span>
                        </div>

                        {/* Medicine list */}
                        <div className="space-y-1.5">
                          {(order.prescriptions || []).map((rx: RxItem, i: number) => (
                            <div key={i} className="flex items-start gap-2 bg-white rounded-lg px-3 py-2 border border-gray-100">
                              <Pill className="w-3.5 h-3.5 text-emerald-500 mt-0.5 shrink-0" />
                              <div className="min-w-0">
                                <span className="text-sm font-medium text-gray-800">{rx.name}</span>
                                <p className="text-xs text-gray-400 mt-0.5">
                                  {[rx.scheduleText || [rx.dosage, rx.frequency].filter(Boolean).join(' '), rx.duration].filter(Boolean).join(' · ')}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
