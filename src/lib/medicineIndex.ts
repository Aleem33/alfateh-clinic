export type MedicineRecord = Record<string, any> & {
  id: string;
  __medicineKey?: string;
  __searchText?: string;
};

export function normalizeMedicineText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function getMedicineIdentity(medicine: Partial<MedicineRecord>): string {
  if (medicine.__medicineKey) return medicine.__medicineKey;
  return [
    normalizeMedicineText(medicine.name),
    normalizeMedicineText(medicine.category || medicine.form),
    normalizeMedicineText(medicine.batchNo),
    normalizeMedicineText(medicine.supplierId || medicine.supplierName),
  ].join('|');
}

export function getMedicineSearchText(medicine: Partial<MedicineRecord>): string {
  if (medicine.__searchText) return medicine.__searchText;
  return [
    medicine.name,
    medicine.nameUrdu,
    medicine.genericName,
    medicine.manufacturer,
    medicine.category,
    medicine.form,
    medicine.batchNo,
    medicine.supplierName,
  ].map(normalizeMedicineText).filter(Boolean).join(' ');
}

export function indexMedicine(medicine: MedicineRecord): MedicineRecord {
  return {
    ...medicine,
    __medicineKey: getMedicineIdentity(medicine),
    __searchText: getMedicineSearchText(medicine),
  };
}

export function partitionMedicines(medicines: MedicineRecord[]) {
  const active: MedicineRecord[] = [];
  const archived: MedicineRecord[] = [];
  for (const medicine of medicines) {
    (medicine.archived === true ? archived : active).push(medicine);
  }
  return { active, archived };
}

export function findDuplicateMedicine(
  medicines: MedicineRecord[],
  candidate: Partial<MedicineRecord>,
  excludeId?: string | null,
): MedicineRecord | undefined {
  const identity = getMedicineIdentity(candidate);
  if (!normalizeMedicineText(candidate.name)) return undefined;

  // Existing installations can already contain duplicate rows. Do not prevent a
  // user from updating prices, stock, or expiry when the edited row's identity
  // has not changed; only guard identity changes that collide with another row.
  if (excludeId) {
    const editedMedicine = medicines.find(medicine => String(medicine.id) === String(excludeId));
    if (editedMedicine && getMedicineIdentity(editedMedicine) === identity) return undefined;
  }

  return medicines.find(medicine => (
    String(medicine.id) !== String(excludeId ?? '')
    && getMedicineIdentity(medicine) === identity
  ));
}

export function searchMedicines(
  medicines: MedicineRecord[],
  query: string,
  options: { inStockOnly?: boolean; limit?: number } = {},
): MedicineRecord[] {
  const normalizedQuery = normalizeMedicineText(query);
  const queryTokens = normalizedQuery.split(' ').filter(Boolean);
  let results = medicines.filter(medicine => {
    if (options.inStockOnly && Number(medicine.stock || 0) <= 0) return false;
    if (!queryTokens.length) return true;
    const searchText = getMedicineSearchText(medicine);
    return queryTokens.every(token => searchText.includes(token));
  });

  results.sort((a, b) => {
    if (normalizedQuery) {
      const aName = normalizeMedicineText(a.name);
      const bName = normalizeMedicineText(b.name);
      const aScore = aName === normalizedQuery ? 0 : aName.startsWith(normalizedQuery) ? 1 : 2;
      const bScore = bName === normalizedQuery ? 0 : bName.startsWith(normalizedQuery) ? 1 : 2;
      if (aScore !== bScore) return aScore - bScore;
    }
    return String(a.name || '').localeCompare(String(b.name || ''));
  });

  return options.limit ? results.slice(0, options.limit) : results;
}
