import { collection, doc, getDoc, getDocs, setDoc, writeBatch } from 'firebase/firestore';
import { auth, db } from '../firebase';

export const GLOBAL_DATA_COLLECTIONS = [
  'settings',
  'counters',
  'schedules',
  'users',
  'patients',
  'appointments',
  'consultations',
  'prescriptionTemplates',
  'admissions',
  'wards',
  'rooms',
  'beds',
  'bedTreatments',
  'labOrders',
  'labTests',
  'bills',
  'staff',
  'medicines',
  'suppliers',
  'purchases',
  'purchaseReturns',
  'sales',
  'saleReturns',
  'stockMovements',
  'syncIssues',
  'posSales',
  'customers',
  'customerPayments',
  'expenses',
  'pharmacyOrders',
  'auditLogs',
  'notifications',
];

export type BackupFile = {
  exportedAt: string;
  version: string;
  scope: 'alfateh-clinic-suite';
  collections: Record<string, any[]>;
};

type ProgressFn = (message: string) => void;
export type ResetScope = 'hms' | 'pharmacy' | 'lab';
const BOOTSTRAP_ADMIN_EMAIL = 'admin@alfateh-clinic.internal';
const HMS_COUNTER_IDS = new Set(['mrn', 'bill']);
const PHARMACY_COUNTER_IDS = new Set(['posReceipt', 'posSaleReturn', 'posPurchaseReturn', 'sale', 'saleReturn', 'purchaseReturn']);

export const RESET_COLLECTIONS: Record<ResetScope, string[]> = {
  hms: [
    'settings',
    'counters',
    'schedules',
    'patients',
    'appointments',
    'consultations',
    'prescriptionTemplates',
    'admissions',
    'wards',
    'rooms',
    'beds',
    'bedTreatments',
    'bills',
    'staff',
    'expenses',
    'auditLogs',
    'notifications',
  ],
  lab: [
    'labOrders',
    'labTests',
  ],
  pharmacy: [
    'counters',
    'medicines',
    'suppliers',
    'purchases',
    'purchaseReturns',
    'sales',
    'saleReturns',
    'stockMovements',
    'syncIssues',
    'posSales',
    'customers',
    'customerPayments',
    'expenses',
    'pharmacyOrders',
  ],
};

function getRestoreCollections(collections: Record<string, any[]>) {
  const known = GLOBAL_DATA_COLLECTIONS.filter(name => collections[name]);
  const extra = Object.keys(collections).filter(name => !GLOBAL_DATA_COLLECTIONS.includes(name));
  return [...known, ...extra];
}

async function commitInChunks<T>(
  docs: T[],
  writeChunk: (batch: ReturnType<typeof writeBatch>, item: T) => void,
) {
  for (let i = 0; i < docs.length; i += 400) {
    const batch = writeBatch(db);
    docs.slice(i, i + 400).forEach(item => writeChunk(batch, item));
    await batch.commit();
  }
}

function isExpenseInScope(data: any, scope: ResetScope) {
  if (scope === 'lab') return false;
  const value = data?.scope || data?.app || data?.module || data?.source || data?.createdFrom;
  if (!value) return false;
  const normalized = String(value).toLowerCase();
  if (scope === 'hms') return ['hms', 'hospital', 'clinic'].includes(normalized);
  return ['pos', 'pharmacy'].includes(normalized);
}

function isCounterInScope(id: string, scope: ResetScope) {
  if (scope === 'lab') return false;
  return scope === 'hms' ? HMS_COUNTER_IDS.has(id) : PHARMACY_COUNTER_IDS.has(id);
}

export async function exportAllAppData(onProgress?: ProgressFn): Promise<BackupFile> {
  const backup: BackupFile = {
    exportedAt: new Date().toISOString(),
    version: '2.0',
    scope: 'alfateh-clinic-suite',
    collections: {},
  };

  for (const collectionName of GLOBAL_DATA_COLLECTIONS) {
    onProgress?.(`Exporting ${collectionName}...`);
    const snap = await getDocs(collection(db, collectionName));
    backup.collections[collectionName] = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
  }

  return backup;
}

export async function restoreAllAppData(backup: BackupFile, onProgress?: ProgressFn) {
  if (!backup?.collections || typeof backup.collections !== 'object') {
    throw new Error('Invalid backup file.');
  }

  let totalDocs = 0;
  for (const collectionName of getRestoreCollections(backup.collections)) {
    const docs = backup.collections[collectionName] || [];
    if (!docs.length) continue;

    onProgress?.(`Importing ${collectionName} (${docs.length} records)...`);
    await commitInChunks(docs, (batch, docData: any) => {
      const { _id, ...data } = docData;
      if (!_id) return;
      batch.set(doc(db, collectionName, _id), data);
    });
    totalDocs += docs.length;
  }

  return totalDocs;
}

export async function deleteAppDataScope(scope: ResetScope, onProgress?: ProgressFn) {
  let totalDocs = 0;
  const currentUser = auth.currentUser;

  if (!currentUser) {
    throw new Error('You must be logged in as an admin to reset app data.');
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new Error('Reset is blocked while offline. Connect to the internet and try again.');
  }

  const currentUserRef = doc(db, 'users', currentUser.uid);
  const currentUserSnap = await getDoc(currentUserRef);
  const currentUserData = currentUserSnap.exists() ? currentUserSnap.data() : null;
  const isCurrentAdmin = currentUserData?.role === 'admin';
  const isBootstrapAdmin = currentUser.email === BOOTSTRAP_ADMIN_EMAIL;

  if (!isCurrentAdmin && !isBootstrapAdmin) {
    throw new Error('Only an admin account can reset app data.');
  }

  if (!currentUserSnap.exists() && isBootstrapAdmin) {
    onProgress?.('Repairing bootstrap admin profile...');
    await setDoc(currentUserRef, {
      name: 'Admin',
      username: 'admin',
      email: 'admin',
      role: 'admin',
      app: 'hms',
      repairedAt: new Date().toISOString(),
    }, { merge: true });
  }

  for (const collectionName of RESET_COLLECTIONS[scope]) {
    try {
      onProgress?.(`Deleting ${collectionName}...`);
      const snap = await getDocs(collection(db, collectionName));
      const docs = snap.docs.filter(document => {
        if (collectionName === 'users') return false;
        if (collectionName === 'counters') return isCounterInScope(document.id, scope);
        if (collectionName === 'expenses') return isExpenseInScope(document.data(), scope);
        return true;
      });
      if (!docs.length) continue;

      await commitInChunks(docs, (batch, document) => batch.delete(document.ref));
      totalDocs += docs.length;
    } catch (error: any) {
      throw new Error(`Failed deleting ${collectionName}: ${error?.message || error}`);
    }
  }

  onProgress?.('Verifying admin access...');
  const adminSnap = await getDoc(currentUserRef);
  const adminData = adminSnap.exists() ? adminSnap.data() : null;
  if (adminData?.role !== 'admin') {
    await setDoc(currentUserRef, {
      name: currentUserData?.name || 'Admin',
      username: currentUserData?.username || 'admin',
      email: currentUserData?.email || 'admin',
      role: 'admin',
      app: currentUserData?.app || 'hms',
      repairedAt: new Date().toISOString(),
    }, { merge: true });
  }

  return totalDocs;
}

export function summarizeBackup(backup: Pick<BackupFile, 'collections'>) {
  if (!backup?.collections) return 'No records found.';
  const summary = getRestoreCollections(backup.collections)
    .filter(name => backup.collections[name]?.length > 0)
    .map(name => `${backup.collections[name].length} ${name}`)
    .join(', ');
  return summary || 'No records found.';
}
