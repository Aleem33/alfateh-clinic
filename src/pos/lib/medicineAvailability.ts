import { addMonths, format, isValid, parseISO } from 'date-fns';
import { searchMedicines, type MedicineRecord } from '../../lib/medicineIndex';

export function hasAvailableStock(medicine: Record<string, any>) {
  const stock = Number(medicine.stock);
  return Number.isFinite(stock) && stock > 0;
}

export function expiringStockWithinSixMonths<T extends Record<string, any>>(medicines: T[], todayKey: string): T[] {
  const today = parseISO(todayKey);
  if (!isValid(today)) return [];
  const cutoff = format(addMonths(today, 6), 'yyyy-MM-dd');
  return medicines.filter(medicine => {
    if (!hasAvailableStock(medicine) || medicine.archived === true || medicine.deleted === true) return false;
    const expiry = String(medicine.expiryDate || '');
    // Expiry is a calendar date, not an instant. Retain expired stocked batches
    // so they still need attention; include the entire six-month boundary day.
    return /^\d{4}-\d{2}-\d{2}$/.test(expiry) && isValid(parseISO(expiry)) && expiry <= cutoff;
  }).sort((a, b) => String(a.expiryDate).localeCompare(String(b.expiryDate)));
}

export function purchaseMedicineOptions(medicines: MedicineRecord[], search: string, includeOutOfStock: boolean) {
  const matches = searchMedicines(medicines, search);
  return {
    total: matches.length,
    hidden: includeOutOfStock ? 0 : matches.filter(medicine => !hasAvailableStock(medicine)).length,
    visible: includeOutOfStock ? matches : matches.filter(hasAvailableStock),
  };
}
