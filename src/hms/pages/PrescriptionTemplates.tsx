import { useState, useEffect } from 'react';
import { collection, onSnapshot, addDoc, deleteDoc, doc } from 'firebase/firestore';
import { db, auth } from '../../firebase';
import { nowISO } from '../lib/utils';
import { Stethoscope, Plus, Trash2, Search, ChevronDown, ChevronUp, BookOpen } from 'lucide-react';

export function PrescriptionTemplates() {
  const [templates, setTemplates] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'prescriptionTemplates'), snap => {
      setTemplates(snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a: any, b: any) => (b.createdAt || '') > (a.createdAt || '') ? 1 : -1));
    });
    return () => unsub();
  }, []);

  const filtered = templates.filter(t =>
    !search || t.name?.toLowerCase().includes(search.toLowerCase()) ||
    t.diagnosis?.toLowerCase().includes(search.toLowerCase())
  );

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this template?')) return;
    setDeleting(id);
    await deleteDoc(doc(db, 'prescriptionTemplates', id));
    setDeleting(null);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
            <BookOpen className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Prescription Templates</h1>
            <p className="text-sm text-gray-500">Save common prescriptions for quick reuse in OPD</p>
          </div>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search templates by name or diagnosis..."
          className="w-full pl-9 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-xl border border-gray-100">
          <BookOpen className="w-12 h-12 text-gray-200 mx-auto mb-4" />
          <p className="text-gray-500 font-medium">No templates yet</p>
          <p className="text-sm text-gray-400 mt-1">In OPD, after adding medicines, click "Save as Template"</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(t => (
            <div key={t.id} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="flex items-center gap-3 px-5 py-4 cursor-pointer hover:bg-gray-50"
                onClick={() => setExpanded(expanded === t.id ? null : t.id)}>
                <div className="w-9 h-9 bg-blue-50 rounded-lg flex items-center justify-center shrink-0">
                  <Stethoscope className="w-4 h-4 text-blue-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-gray-900">{t.name}</div>
                  <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-2">
                    {t.diagnosis && <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">{t.diagnosis}</span>}
                    <span>{t.medicines?.length || 0} medicine{t.medicines?.length !== 1 ? 's' : ''}</span>
                    <span>· by {t.createdByEmail || 'Unknown'}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={e => { e.stopPropagation(); handleDelete(t.id); }}
                    disabled={deleting === t.id}
                    className="p-1.5 text-gray-300 hover:text-red-500 transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                  {expanded === t.id ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                </div>
              </div>
              {expanded === t.id && (
                <div className="px-5 pb-4 border-t border-gray-50">
                  <div className="mt-3 space-y-2">
                    {t.medicines?.map((m: any, i: number) => (
                      <div key={i} className="flex items-start gap-3 bg-blue-50 rounded-lg px-3 py-2">
                        <div className="text-xs font-bold text-blue-700 min-w-[20px] mt-0.5">{i + 1}.</div>
                        <div>
                          <div className="text-sm font-semibold text-blue-900">{m.name}</div>
                          {m.nameUrdu && <div className="text-xs text-green-700" dir="rtl" style={{ fontFamily: 'Noto Nastaliq Urdu, serif' }}>{m.nameUrdu}</div>}
                          <div className="text-xs text-blue-600 mt-0.5">{m.dosage} · {m.frequency} · {m.duration}
                            {m.instructions && ` · ${m.instructions}`}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                  {t.notes && <p className="text-xs text-gray-500 mt-3 italic">{t.notes}</p>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
