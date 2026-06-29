import { useEffect, useState } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase';

export const DEFAULT_MEDICINE_CATEGORIES = [
  'Tablet',
  'Capsule',
  'Syrup',
  'Suspension',
  'Injection',
  'Drops',
  'Cream/Ointment',
  'Powder',
  'Sachet',
  'Inhaler',
  'IV Fluid',
  'Other',
];

const CATEGORY_SETTINGS_DOC = doc(db, 'settings', 'medicineCategories');

export function normalizeMedicineCategories(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const categories: string[] = [];
  for (const value of values) {
    const category = String(value ?? '').trim();
    const key = category.toLocaleLowerCase();
    if (!category || seen.has(key)) continue;
    seen.add(key);
    categories.push(category);
  }
  return categories;
}

export function useMedicineCategories() {
  const [categories, setCategories] = useState<string[]>(DEFAULT_MEDICINE_CATEGORIES);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => onSnapshot(
    CATEGORY_SETTINGS_DOC,
    snapshot => {
      const configured = snapshot.exists()
        ? normalizeMedicineCategories(snapshot.data()?.categories)
        : [];
      setCategories(configured.length ? configured : DEFAULT_MEDICINE_CATEGORIES);
      setError('');
      setLoading(false);
    },
    snapshotError => {
      console.error('Could not load medicine categories:', snapshotError);
      setCategories(DEFAULT_MEDICINE_CATEGORIES);
      setError('Could not load saved categories. Showing defaults.');
      setLoading(false);
    },
  ), []);

  return { categories, loading, error };
}

export async function saveMedicineCategories(categories: string[]) {
  const normalized = normalizeMedicineCategories(categories);
  if (!normalized.length) throw new Error('At least one medicine category is required.');
  await setDoc(CATEGORY_SETTINGS_DOC, {
    categories: normalized,
    updatedAt: new Date().toISOString(),
  });
}

export function getDefaultMedicineCategory(categories: string[]) {
  return categories.find(category => category.toLocaleLowerCase() === 'tablet')
    || categories[0]
    || 'Tablet';
}

export function resolveMedicineCategory(categories: string[], current?: string) {
  const value = String(current || '').trim();
  return categories.find(category => category.toLocaleLowerCase() === value.toLocaleLowerCase())
    || value
    || getDefaultMedicineCategory(categories);
}

export function includeLegacyMedicineCategory(categories: string[], current?: string) {
  const legacy = String(current || '').trim();
  if (!legacy || categories.some(category => category.toLocaleLowerCase() === legacy.toLocaleLowerCase())) {
    return categories;
  }
  return [...categories, legacy];
}
