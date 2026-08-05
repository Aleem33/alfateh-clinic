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

export function getMedicineDocumentId(medicine: Partial<MedicineRecord>): string {
  const identity = getMedicineIdentity(medicine);
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < identity.length; index++) {
    const code = identity.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `med_${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`;
}

function getMedicineDisplayIdentity(medicine: Partial<MedicineRecord>): string {
  return [
    normalizeMedicineText(medicine.name),
    normalizeMedicineText(medicine.category || medicine.form),
    normalizeMedicineText(medicine.batchNo),
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

function medicineTimestamp(medicine: Partial<MedicineRecord>): number {
  const raw = medicine.updatedAt || medicine.createdAt || '';
  const parsed = Date.parse(String(raw));
  return Number.isFinite(parsed) ? parsed : 0;
}

function preferMedicine(current: MedicineRecord, candidate: MedicineRecord): MedicineRecord {
  const currentInStock = Number(current.stock || 0) > 0;
  const candidateInStock = Number(candidate.stock || 0) > 0;
  if (currentInStock !== candidateInStock) return candidateInStock ? candidate : current;
  if (Number(candidate.stock || 0) !== Number(current.stock || 0)) {
    return Number(candidate.stock || 0) > Number(current.stock || 0) ? candidate : current;
  }
  return medicineTimestamp(candidate) > medicineTimestamp(current) ? candidate : current;
}

export function dedupeMedicines(medicines: MedicineRecord[]): MedicineRecord[] {
  const unique = new Map<string, MedicineRecord>();
  for (const medicine of medicines) {
    const identity = getMedicineDisplayIdentity(medicine);
    const key = identity.replace(/\|/g, '') ? identity : `id:${medicine.id}`;
    const existing = unique.get(key);
    unique.set(key, existing ? preferMedicine(existing, medicine) : medicine);
  }
  return [...unique.values()];
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
  options: { inStockOnly?: boolean; limit?: number; dedupe?: boolean } = {},
): MedicineRecord[] {
  const normalizedQuery = normalizeMedicineText(query);
  const queryTokens = normalizedQuery.split(' ').filter(Boolean);
  let results = medicines.filter(medicine => {
    if (options.inStockOnly && Number(medicine.stock || 0) <= 0) return false;
    if (!queryTokens.length) return true;
    const searchText = getMedicineSearchText(medicine);
    return queryTokens.every(token => searchText.includes(token));
  });

  if (options.dedupe !== false) results = dedupeMedicines(results);

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
