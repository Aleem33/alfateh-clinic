import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { Plus, Tags, Trash2 } from 'lucide-react';
import { db } from '../firebase';
import { useAppDialog } from './AppDialog';
import {
  saveMedicineCategories,
  useMedicineCategories,
} from '../lib/medicineCategories';

export function MedicineCategoryManager() {
  const { confirm } = useAppDialog();
  const { categories, loading, error: loadError } = useMedicineCategories();
  const [medicines, setMedicines] = useState<any[]>([]);
  const [newCategory, setNewCategory] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [usageReady, setUsageReady] = useState(false);

  useEffect(() => onSnapshot(
    collection(db, 'medicines'),
    snapshot => {
      setMedicines(snapshot.docs.map(item => item.data()));
      setUsageReady(true);
    },
    snapshotError => {
      console.error('Could not load medicine category usage:', snapshotError);
      setUsageReady(false);
      setMessage('Could not verify category usage. Removal is disabled.');
    },
  ), []);

  const usage = useMemo(() => {
    const counts = new Map<string, number>();
    for (const medicine of medicines) {
      const category = String(medicine.category || medicine.form || '').trim().toLocaleLowerCase();
      if (category) counts.set(category, (counts.get(category) || 0) + 1);
    }
    return counts;
  }, [medicines]);

  const addCategory = async () => {
    const category = newCategory.trim();
    setMessage('');
    if (!category) {
      setMessage('Enter a category name.');
      return;
    }
    if (categories.some(item => item.toLocaleLowerCase() === category.toLocaleLowerCase())) {
      setMessage('That category already exists.');
      return;
    }
    setSaving(true);
    try {
      await saveMedicineCategories([...categories, category]);
      setNewCategory('');
      setMessage(`Category added: ${category}`);
    } catch (saveError: any) {
      setMessage(saveError?.message || 'Could not add the category.');
    } finally {
      setSaving(false);
    }
  };

  const removeCategory = async (category: string) => {
    const count = usage.get(category.toLocaleLowerCase()) || 0;
    setMessage('');
    if (!usageReady) {
      setMessage('Could not verify category usage. Removal is disabled.');
      return;
    }
    if (count > 0) {
      setMessage(`${category} is used by ${count} medicine${count === 1 ? '' : 's'}. Reassign them before removing it.`);
      return;
    }
    if (categories.length <= 1) {
      setMessage('At least one medicine category is required.');
      return;
    }
    const approved = await confirm(`Remove “${category}” from medicine categories?`, {
      title: 'Remove Medicine Category',
      confirmLabel: 'Remove Category',
      tone: 'danger',
    });
    if (!approved) return;

    setSaving(true);
    try {
      await saveMedicineCategories(categories.filter(item => item !== category));
      setMessage(`Category removed: ${category}`);
    } catch (saveError: any) {
      setMessage(saveError?.message || 'Could not remove the category.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-indigo-100 shadow-sm overflow-hidden">
      <div className="p-6 border-b border-indigo-100 bg-indigo-50 flex items-center gap-3">
        <Tags className="w-6 h-6 text-indigo-600" />
        <div>
          <h2 className="font-semibold text-indigo-950">Medicine Categories</h2>
          <p className="text-sm text-indigo-700 mt-0.5">Categories are shared by HMS and Pharmacy POS.</p>
        </div>
      </div>
      <div className="p-6">
        <div className="flex flex-col sm:flex-row gap-2 mb-4">
          <input
            value={newCategory}
            onChange={event => setNewCategory(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault();
                addCategory();
              }
            }}
            placeholder="New category name"
            disabled={saving}
            className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60"
          />
          <button
            type="button"
            onClick={addCategory}
            disabled={saving || loading}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-60"
          >
            <Plus className="w-4 h-4" /> Add Category
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {categories.map(category => {
            const count = usage.get(category.toLocaleLowerCase()) || 0;
            return (
              <div key={category} className="flex items-center justify-between gap-3 border border-gray-100 rounded-lg px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{category}</p>
                  <p className="text-xs text-gray-400">{count} medicine{count === 1 ? '' : 's'}</p>
                </div>
                <button
                  type="button"
                  onClick={() => removeCategory(category)}
                  disabled={saving || !usageReady || count > 0 || categories.length <= 1}
                  title={count > 0 ? 'Reassign medicines before removing this category' : 'Remove category'}
                  className="p-2 text-red-500 rounded-lg hover:bg-red-50 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            );
          })}
        </div>

        {(message || loadError) && (
          <p className={`text-sm mt-4 ${message.includes('added:') || message.includes('removed:') ? 'text-green-600' : 'text-amber-700'}`}>
            {message || loadError}
          </p>
        )}
      </div>
    </div>
  );
}
