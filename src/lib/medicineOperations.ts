import {
  addDoc,
  collection,
  doc,
  getDocsFromServer,
  limit,
  query,
  updateDoc,
  where,
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import {
  findDuplicateMedicine,
  getMedicineIdentity,
  getMedicineSearchText,
  indexMedicine,
  normalizeMedicineText,
  type MedicineRecord,
} from './medicineIndex';
import { getMedicineStoreSnapshot } from './medicineStore';

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
  const timestamp = new Date().toISOString();
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

  if (typeof navigator === 'undefined' || navigator.onLine) {
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

async function writeMedicineAudit(action: 'archive' | 'restore', medicine: MedicineRecord) {
  try {
    await addDoc(collection(db, 'auditLogs'), {
      action,
      entity: 'medicine',
      entityId: medicine.id,
      detail: `${action === 'archive' ? 'Archived' : 'Restored'} medicine: ${medicine.name || medicine.id}`,
      userId: auth.currentUser?.uid || 'system',
      userEmail: auth.currentUser?.email || 'system',
      timestamp: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    console.warn('Medicine audit log failed:', error);
  }
}

export async function archiveMedicine(medicine: MedicineRecord): Promise<void> {
  const timestamp = new Date().toISOString();
  await updateDoc(doc(db, 'medicines', medicine.id), {
    archived: true,
    archivedAt: timestamp,
    archivedBy: auth.currentUser?.uid || 'unknown',
    updatedAt: timestamp,
  });
  await writeMedicineAudit('archive', medicine);
}

export async function restoreMedicine(medicine: MedicineRecord): Promise<void> {
  const timestamp = new Date().toISOString();
  await updateDoc(doc(db, 'medicines', medicine.id), {
    archived: false,
    restoredAt: timestamp,
    restoredBy: auth.currentUser?.uid || 'unknown',
    updatedAt: timestamp,
  });
  await writeMedicineAudit('restore', medicine);
}
