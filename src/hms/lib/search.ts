import { useState, useEffect, useCallback } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase';
import { searchMedicines } from '../../lib/medicineIndex';
import { subscribeToMedicines } from '../../lib/medicineStore';

export interface SearchResult {
  id: string;
  type: 'patient' | 'staff' | 'bill' | 'medicine' | 'supplier';
  title: string;
  subtitle: string;
  path: string;
}

export function useGlobalSearch(query: string) {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [patients, setPatients] = useState<any[]>([]);
  const [staff, setStaff] = useState<any[]>([]);
  const [medicines, setMedicines] = useState<any[]>([]);

  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'patients'), s =>
      setPatients(s.docs.map(d => ({ id: d.id, ...d.data() })))
    );
    const u2 = onSnapshot(collection(db, 'staff'), s =>
      setStaff(s.docs.map(d => ({ id: d.id, ...d.data() })))
    );
    const u3 = subscribeToMedicines(setMedicines);
    return () => { u1(); u2(); u3(); };
  }, []);

  useEffect(() => {
    if (!query || query.length < 2) { setResults([]); return; }
    const q = query.toLowerCase();
    const out: SearchResult[] = [];

    patients
      .filter(p => p.name?.toLowerCase().includes(q) || p.mrn?.toLowerCase().includes(q) || p.phone?.includes(q))
      .slice(0, 4)
      .forEach(p => out.push({ id: p.id, type: 'patient', title: p.name, subtitle: `${p.mrn} · ${p.phone || ''}`, path: '/patients' }));

    staff
      .filter(s => s.name?.toLowerCase().includes(q) || s.department?.toLowerCase().includes(q))
      .slice(0, 3)
      .forEach(s => out.push({ id: s.id, type: 'staff', title: s.name, subtitle: `${s.role} · ${s.department}`, path: '/staff' }));

    searchMedicines(medicines, q, { limit: 3 })
      .forEach(m => out.push({
        id: m.id,
        type: 'medicine',
        title: m.name,
        subtitle: [
          m.supplierName || 'No supplier',
          m.batchNo ? `Batch ${m.batchNo}` : 'No batch',
          `Stock: ${m.stock}`,
          `Rs. ${m.retailPrice}`,
        ].join(' · '),
        path: '/pharmacy',
      }));

    setResults(out);
  }, [query, patients, staff, medicines]);

  return results;
}
