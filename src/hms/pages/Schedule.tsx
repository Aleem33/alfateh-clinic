import { useState, useEffect } from 'react';
import { collection, onSnapshot, doc, setDoc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { nowISO } from '../lib/utils';
import { logAudit } from '../lib/audit';
import { Clock, Check, X, Save, Calendar } from 'lucide-react';
import { cn } from '../lib/utils';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const TIME_SLOTS = [
  '08:00–09:00', '09:00–10:00', '10:00–11:00', '11:00–12:00',
  '12:00–13:00', '13:00–14:00', '14:00–15:00', '15:00–16:00',
  '16:00–17:00', '17:00–18:00', '18:00–19:00', '19:00–20:00',
];

type Schedule = Record<string, string[]>; // day -> available slots

export function Schedule() {
  const [doctors, setDoctors] = useState<any[]>([]);
  const [selectedDoctor, setSelectedDoctor] = useState<any | null>(null);
  const [schedule, setSchedule] = useState<Schedule>({});
  const [originalSchedule, setOriginalSchedule] = useState<Schedule>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'staff'), snap => {
      const docs = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter((s: any) => s.role === 'doctor' && s.status !== 'inactive') as any[];
      setDoctors(docs);
      if (docs.length > 0 && !selectedDoctor) setSelectedDoctor(docs[0]);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!selectedDoctor) return;
    setLoading(true);
    getDoc(doc(db, 'schedules', selectedDoctor.id)).then(snap => {
      const data: Schedule = snap.exists() ? (snap.data().slots || {}) : {};
      setSchedule(data);
      setOriginalSchedule(data);
      setLoading(false);
    });
  }, [selectedDoctor]);

  const toggleSlot = (day: string, slot: string) => {
    setSchedule(prev => {
      const daySlots = prev[day] || [];
      const has = daySlots.includes(slot);
      return {
        ...prev,
        [day]: has ? daySlots.filter(s => s !== slot) : [...daySlots, slot].sort(),
      };
    });
  };

  const toggleDay = (day: string) => {
    setSchedule(prev => {
      const daySlots = prev[day] || [];
      return {
        ...prev,
        [day]: daySlots.length === TIME_SLOTS.length ? [] : [...TIME_SLOTS],
      };
    });
  };

  const handleSave = async () => {
    if (!selectedDoctor) return;
    setSaving(true);
    try {
      await setDoc(doc(db, 'schedules', selectedDoctor.id), {
        staffId: selectedDoctor.id,
        staffName: selectedDoctor.name,
        department: selectedDoctor.department,
        slots: schedule,
        updatedAt: nowISO(),
      });
      await logAudit('update', 'schedule', selectedDoctor.id, `${selectedDoctor.name} schedule updated`);
      setOriginalSchedule(schedule);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e: any) {
      alert('Failed to save: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const hasChanges = JSON.stringify(schedule) !== JSON.stringify(originalSchedule);

  const totalSlots = Object.values(schedule).reduce((s, v) => s + v.length, 0);
  const totalHours = totalSlots; // each slot = 1 hour

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Staff Schedules</h1>
          <p className="text-sm text-gray-500">Manage weekly availability for doctors</p>
        </div>
        <button onClick={handleSave} disabled={!hasChanges || saving}
          className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors',
            saved ? 'bg-green-600 text-white' :
            hasChanges ? 'bg-blue-600 text-white hover:bg-blue-700' :
            'bg-gray-100 text-gray-400 cursor-not-allowed'
          )}>
          {saved ? <><Check className="w-4 h-4" /> Saved!</> :
           saving ? 'Saving...' :
           <><Save className="w-4 h-4" /> Save Schedule</>}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Doctor list */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Doctors</p>
          </div>
          <div className="divide-y divide-gray-50">
            {doctors.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">No doctors added yet</p>
            ) : doctors.map(d => (
              <button key={d.id} onClick={() => setSelectedDoctor(d)}
                className={cn('w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-blue-50 transition-colors',
                  selectedDoctor?.id === d.id && 'bg-blue-50 border-r-2 border-blue-600')}>
                <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center shrink-0">
                  <span className="text-sm font-semibold text-blue-600">{d.name?.[0]?.toUpperCase()}</span>
                </div>
                <div className="min-w-0">
                  <p className={cn('text-sm font-medium truncate', selectedDoctor?.id === d.id ? 'text-blue-700' : 'text-gray-800')}>{d.name}</p>
                  <p className="text-xs text-gray-400 truncate">{d.department}</p>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Schedule Grid */}
        <div className="lg:col-span-3 bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          {!selectedDoctor ? (
            <div className="flex items-center justify-center h-64 text-gray-400">
              <div className="text-center">
                <Calendar className="w-8 h-8 mx-auto mb-2 text-gray-200" />
                <p className="text-sm">Select a doctor to manage their schedule</p>
              </div>
            </div>
          ) : loading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 7 }).map((_, i) => (
                <div key={i} className="h-10 bg-gray-100 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-gray-50">
                <div>
                  <p className="font-semibold text-gray-900">{selectedDoctor.name}</p>
                  <p className="text-xs text-gray-400">{selectedDoctor.department}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-blue-600">{totalHours}h/week</p>
                  <p className="text-xs text-gray-400">{totalSlots} slots available</p>
                </div>
              </div>

              {/* Grid */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase w-32">Day</th>
                      {TIME_SLOTS.map(slot => (
                        <th key={slot} className="px-1 py-2.5 text-center text-[10px] font-medium text-gray-400 min-w-[52px]">
                          {slot.split('–')[0]}
                        </th>
                      ))}
                      <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500">All</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {DAYS.map(day => {
                      const daySlots = schedule[day] || [];
                      const allSelected = daySlots.length === TIME_SLOTS.length;
                      const someSelected = daySlots.length > 0 && !allSelected;
                      return (
                        <tr key={day} className="hover:bg-gray-50/50">
                          <td className="px-4 py-2">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-gray-700 w-24">{day}</span>
                              {daySlots.length > 0 && (
                                <span className="text-[10px] bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded-full font-semibold">
                                  {daySlots.length}h
                                </span>
                              )}
                            </div>
                          </td>
                          {TIME_SLOTS.map(slot => {
                            const active = daySlots.includes(slot);
                            return (
                              <td key={slot} className="px-1 py-2 text-center">
                                <button
                                  onClick={() => toggleSlot(day, slot)}
                                  title={slot}
                                  className={cn(
                                    'w-9 h-7 rounded-md text-xs font-semibold transition-colors',
                                    active
                                      ? 'bg-blue-600 text-white hover:bg-blue-700'
                                      : 'bg-gray-100 text-gray-300 hover:bg-blue-100 hover:text-blue-500'
                                  )}
                                >
                                  {active ? <Check className="w-3 h-3 mx-auto" /> : '·'}
                                </button>
                              </td>
                            );
                          })}
                          <td className="px-3 py-2 text-center">
                            <button onClick={() => toggleDay(day)}
                              className={cn(
                                'w-9 h-7 rounded-md text-xs font-semibold transition-colors',
                                allSelected ? 'bg-blue-100 text-blue-700 hover:bg-red-100 hover:text-red-600'
                                  : 'bg-gray-100 text-gray-400 hover:bg-blue-100 hover:text-blue-600'
                              )}>
                              {allSelected ? <X className="w-3 h-3 mx-auto" /> : '✓'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Footer hint */}
              <div className="flex items-center gap-4 px-5 py-3 border-t border-gray-100 text-xs text-gray-400">
                <div className="flex items-center gap-1.5"><span className="w-5 h-4 bg-blue-600 rounded-sm inline-block" /> Available</div>
                <div className="flex items-center gap-1.5"><span className="w-5 h-4 bg-gray-100 rounded-sm inline-block" /> Unavailable</div>
                <span className="ml-auto">Click a cell to toggle · Click ✓ to select/clear whole day</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
