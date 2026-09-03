import {
  addDoc,
  collection,
  doc,
  getDocsFromServer,
  limit,
  query,
  updateDoc,
  where,
} from '@/lib/firestore';
import { auth, db } from '../firebase';
import { trustedNowISO } from './trustedClock';
import {
  findDuplicateMedicine,
  getMedicineIdentity,
  getMedicineSearchText,
  indexMedicine,
  normalizeMedicineText,
  type MedicineRecord,
} from './medicineIndex';
import { getMedicineStoreSnapshot } from './medicineStore';
import { isCloudOnline } from './lanCoordinator';

export class MedicineConflictError extends Error {
  medicineId?: string;
  archived: boolean;

  constructor(medicine?: Partial<MedicineRecord>) {
    const archived = medicine?.archived === true;
    super(archived
      ? `${medicine?.name || 'This medicine'} already exists in Archived Medicines. Restore it instead.`
      : `${medicine?.name || 'This medicine'} already exists. Edit it or record a purchase instead.`);
    this.name = 'MedicineConflictError';
    this.medicineId = medicine?.id;
    this.archived = archived;
  }
}

type CreateMedicineInput = Record<string, any> & {
  name: string;
  category?: string;
  form?: string;
  batchNo?: string;
  supplierId?: string;
  supplierName?: string;
};

export async function createMedicineSafely(
  input: CreateMedicineInput,
  knownMedicines: MedicineRecord[] = [],
): Promise<string> {
  const timestamp = trustedNowISO();
  const medicineKey = getMedicineIdentity(input);
  const data = {
    ...input,
    medicineKey,
    searchName: normalizeMedicineText(input.name),
    searchText: getMedicineSearchText(input),
    archived: false,
    createdAt: input.createdAt || timestamp,
    updatedAt: input.updatedAt || timestamp,
  };

  const cachedCandidates = [
    ...getMedicineStoreSnapshot().all,
    ...knownMedicines,
  ];
  const cachedDuplicate = findDuplicateMedicine(cachedCandidates, data);
  if (cachedDuplicate) throw new MedicineConflictError(cachedDuplicate);

  if (typeof navigator === 'undefined' || isCloudOnline()) {
    try {
      const existing = await getDocsFromServer(query(
        collection(db, 'medicines'),
        where('medicineKey', '==', medicineKey),
        limit(1),
      ));
      if (!existing.empty) {
        const match = existing.docs[0];
        throw new MedicineConflictError(indexMedicine({ ...match.data(), id: match.id }));
      }
    } catch (error) {
      if (error instanceof MedicineConflictError) throw error;
      // A server check can be unavailable while offline. Auto-generated IDs still
      // guarantee that the queued create cannot replace an existing document.
    }
  }

  const created = await addDoc(collection(db, 'medicines'), data);
  return created.id;
}

type MedicineBatchInput = {
  batchNo: string;
  expiryDate?: string;
  stock: number;
  bonusStockUnits?: number;
  unitsPerBox: number;
  costPrice: number;
  retailPrice?: number;
  unitPrice?: number;
  supplierId?: string;
  supplierName?: string;
};

export function findMedicinePurchaseBatch(
  sourceMedicine: MedicineRecord,
  batchInput: Pick<MedicineBatchInput, 'batchNo' | 'supplierId' | 'supplierName'>,
  knownMedicines: MedicineRecord[],
): MedicineRecord | undefined {
  return findDuplicateMedicine(knownMedicines, {
    name: sourceMedicine.name,
    category: sourceMedicine.category || sourceMedicine.form,
    form: sourceMedicine.form || sourceMedicine.category,
    batchNo: batchInput.batchNo.trim(),
    supplierId: batchInput.supplierId || sourceMedicine.supplierId || '',
    supplierName: batchInput.supplierName || sourceMedicine.supplierName || '',
  });
}

export async function ensureMedicinePurchaseBatch(
  sourceMedicine: MedicineRecord,
  batchInput: MedicineBatchInput,
  knownMedicines: MedicineRecord[],
): Promise<{ medicineId: string; created: boolean }> {
  const candidate = {
    name: sourceMedicine.name,
    category: sourceMedicine.category || sourceMedicine.form,
    form: sourceMedicine.form || sourceMedicine.category,
    batchNo: batchInput.batchNo.trim(),
    supplierId: batchInput.supplierId || sourceMedicine.supplierId || '',
    supplierName: batchInput.supplierName || sourceMedicine.supplierName || '',
  };
  const existing = findMedicinePurchaseBatch(sourceMedicine, batchInput, knownMedicines);
  if (existing) return { medicineId: existing.id, created: false };

  const newBatch = {
    name: sourceMedicine.name,
    nameUrdu: sourceMedicine.nameUrdu || '',
    genericName: sourceMedicine.genericName || '',
    manufacturer: sourceMedicine.manufacturer || '',
    category: candidate.category,
    form: candidate.form,
    batchNo: candidate.batchNo,
    expiryDate: batchInput.expiryDate || '',
    stock: batchInput.stock,
    bonusStockUnits: Math.max(0, Number(batchInput.bonusStockUnits || 0)),
    unitsPerBox: batchInput.unitsPerBox,
    costPrice: batchInput.costPrice,
    retailPrice: batchInput.retailPrice ?? Number(sourceMedicine.retailPrice || sourceMedicine.price || 0),
    unitPrice: batchInput.unitPrice ?? Number(sourceMedicine.unitPrice || 0),
    reorderLevel: Number(sourceMedicine.reorderLevel || 10),
    supplierId: candidate.supplierId,
    supplierName: candidate.supplierName,
    createdFromMedicineId: sourceMedicine.id,
    createdFromPurchase: true,
  };

  try {
    const medicineId = await createMedicineSafely(newBatch, knownMedicines);
    return { medicineId, created: true };
  } catch (error) {
    if (error instanceof MedicineConflictError && !error.archived && error.medicineId) {
      return { medicineId: error.medicineId, created: false };
    }
    throw error;
  }
}

async function writeMedicineAudit(action: 'archive' | 'restore', medicine: MedicineRecord) {
  try {
    await addDoc(collection(db, 'auditLogs'), {
      action,
      entity: 'medicine',
      entityId: medicine.id,
      detail: `${action === 'archive' ? 'Archived' : 'Restored'} medicine: ${medicine.name || medicine.id}`,
      userId: auth.currentUser?.uid || 'system',
      userEmail: auth.currentUser?.email || 'system',
      timestamp: trustedNowISO(),
      createdAt: trustedNowISO(),
    });
  } catch (error) {
    console.warn('Medicine audit log failed:', error);
  }
}

export async function archiveMedicine(medicine: MedicineRecord): Promise<void> {
  const timestamp = trustedNowISO();
  await updateDoc(doc(db, 'medicines', medicine.id), {
    archived: true,
    archivedAt: timestamp,
    archivedBy: auth.currentUser?.uid || 'unknown',
    updatedAt: timestamp,
  });
  await writeMedicineAudit('archive', medicine);
}

export async function restoreMedicine(medicine: MedicineRecord): Promise<void> {
  const timestamp = trustedNowISO();
  await updateDoc(doc(db, 'medicines', medicine.id), {
    archived: false,
    restoredAt: timestamp,
    restoredBy: auth.currentUser?.uid || 'unknown',
    updatedAt: timestamp,
  });
  await writeMedicineAudit('restore', medicine);
}
