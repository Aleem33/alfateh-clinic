import {
  collection,
  doc,
  getDocFromServer,
  getDocsFromServer,
  runTransaction,
  serverTimestamp,
  setDoc,
  writeBatch,
  writeHardDeleteBatch,
} from '@/lib/firestore';
import { auth, db } from '../firebase';
import { isCloudOnline } from './lanCoordinator';
import { getLocalSyncStatus, queryLocalRecords } from './localMirror';
import { recordFirestoreRead } from './readDiagnostics';
import { getSyncControl } from './syncProtocol';
import { trustedNowISO } from './trustedClock';
import { GLOBAL_DATA_COLLECTIONS } from './dataCollections';
import { getActiveAuthSession } from './offlineAuth';

export { GLOBAL_DATA_COLLECTIONS } from './dataCollections';

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
    'heldBills',
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
  createBatch: typeof writeBatch = writeBatch,
  onChunkCommitted?: (count: number) => void,
) {
  for (let i = 0; i < docs.length; i += 400) {
    const batch = createBatch(db);
    docs.slice(i, i + 400).forEach(item => writeChunk(batch, item));
    await batch.commit();
    onChunkCommitted?.(Math.min(400, docs.length - i));
  }
}

async function canExportCompleteLocalMirror() {
  const generation = getSyncControl().datasetGeneration;
  try {
    const statuses = await Promise.all(GLOBAL_DATA_COLLECTIONS.map(getLocalSyncStatus));
    return statuses.every(status => status.seedComplete && String(status.generation) === String(generation));
  } catch {
    return false;
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
  if (getActiveAuthSession()?.profile.role !== 'admin') {
    throw new Error('Only an admin account can export the complete application database.');
  }
  const backup: BackupFile = {
    exportedAt: trustedNowISO(),
    version: '2.0',
    scope: 'alfateh-clinic-suite',
    collections: {},
  };

  const useLocalMirror = await canExportCompleteLocalMirror();
  if (!useLocalMirror && typeof navigator !== 'undefined' && !isCloudOnline()) {
    throw new Error('Initial synchronization is incomplete. Connect this device to the internet before exporting a full backup.');
  }

  for (const collectionName of GLOBAL_DATA_COLLECTIONS) {
    onProgress?.(`Exporting ${collectionName}...`);
    if (useLocalMirror) {
      const records = await queryLocalRecords(collectionName, { includeDeleted: true });
      backup.collections[collectionName] = records.map(record => ({ _id: record.id, ...record.data }));
      continue;
    }
    const snap = await getDocsFromServer(collection(db, collectionName));
    recordFirestoreRead({ collection: collectionName, source: 'query', reason: 'manual', documents: snap.size });
    backup.collections[collectionName] = snap.docs.map(document => ({ _id: document.id, ...document.data() }));
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
  if (typeof navigator !== 'undefined' && !isCloudOnline()) {
    throw new Error('Reset is blocked while offline. Connect to the internet and try again.');
  }

  const currentUserRef = doc(db, 'users', currentUser.uid);
  const currentUserSnap = await getDocFromServer(currentUserRef);
  const currentUserData = currentUserSnap.exists() ? currentUserSnap.data() : null;
  const isCurrentAdmin = currentUserData?.role === 'admin' && currentUserData?.deleted !== true;
  const isBootstrapAdmin = currentUser.email === BOOTSTRAP_ADMIN_EMAIL;

  if (!isCurrentAdmin && !(isBootstrapAdmin && !currentUserSnap.exists())) {
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
      repairedAt: trustedNowISO(),
    }, { merge: true });
  }

  const controlRef = doc(db, 'syncControl', 'current');
  const resetOperationId = crypto.randomUUID();
  onProgress?.('Preparing synchronized reset...');
  await runTransaction(db, async transaction => {
    const controlSnapshot = await transaction.get(controlRef);
    const controlData = controlSnapshot.data() || {};
    if (controlData.resetInProgress === true) {
      throw new Error('Another reset is already in progress or requires administrator recovery. No records were deleted by this request.');
    }
    transaction.set(controlRef, {
      datasetGeneration: nextDatasetGeneration(controlData.datasetGeneration),
      incrementalEnabled: false,
      rollbackToLegacy: true,
      resetInProgress: true,
      resetOperationId,
      resetStatus: 'running',
      lastResetScope: scope,
      lastResetAt: serverTimestamp(),
      lastResetBy: currentUser.uid,
    }, { merge: true });
  });

  let resetFailure: unknown;
  try {
    for (const collectionName of RESET_COLLECTIONS[scope]) {
      try {
        onProgress?.(`Deleting ${collectionName}...`);
        const snap = await getDocsFromServer(collection(db, collectionName));
        recordFirestoreRead({ collection: collectionName, source: 'query', reason: 'manual', documents: snap.size });
        const docs = snap.docs.filter(document => {
          if (collectionName === 'users') return false;
          if (collectionName === 'counters') return isCounterInScope(document.id, scope);
          if (collectionName === 'expenses') return isExpenseInScope(document.data(), scope);
          return true;
        });
        if (!docs.length) continue;

        await commitInChunks(docs, (batch, document) => batch.delete(document.ref), writeHardDeleteBatch,
          count => { totalDocs += count; });
      } catch (error: any) {
        throw new Error(`Failed deleting ${collectionName}: ${error?.message || error}`);
      }
    }

    onProgress?.('Verifying admin access...');
    const adminSnap = await getDocFromServer(currentUserRef);
    const adminData = adminSnap.exists() ? adminSnap.data() : null;
    if (adminData?.role !== 'admin' || adminData?.deleted === true) {
      throw new Error('Admin access changed during the reset. Administrator review is required.');
    }
  } catch (error) {
    resetFailure = error;
  }

  onProgress?.('Finalizing synchronized reset...');
  try {
    await runTransaction(db, async transaction => {
      const controlSnapshot = await transaction.get(controlRef);
      const controlData = controlSnapshot.data() || {};
      if (controlData.resetOperationId !== resetOperationId) {
        throw new Error('Reset ownership changed. Administrator recovery is required.');
      }
      // Invalidate after the last deletion even when only part of a reset worked.
      // A complete legacy snapshot is required before incremental mode resumes.
      transaction.set(controlRef, {
        datasetGeneration: nextDatasetGeneration(controlData.datasetGeneration),
        incrementalEnabled: false,
        rollbackToLegacy: true,
        resetInProgress: false,
        resetStatus: resetFailure ? 'failed' : 'completed',
        resetDeletedRecords: totalDocs,
        resetFinishedAt: serverTimestamp(),
      }, { merge: true });
    });
  } catch (finalizationError) {
    const detail = resetFailure instanceof Error ? resetFailure.message : 'Reset writes have finished.';
    throw new Error(`${detail} Reset synchronization could not be finalized. Legacy synchronization remains selected; an administrator must check the reset marker before another reset. ${finalizationError instanceof Error ? finalizationError.message : String(finalizationError)}`);
  }
  if (resetFailure) throw resetFailure;

  return totalDocs;
}

function nextDatasetGeneration(value: unknown) {
  const generation = Number(value);
  if (!Number.isSafeInteger(generation) || generation < 1) return 2;
  if (generation === Number.MAX_SAFE_INTEGER) throw new Error('Dataset generation requires administrator recovery.');
  return generation + 1;
}

export function summarizeBackup(backup: Pick<BackupFile, 'collections'>) {
  if (!backup?.collections) return 'No records found.';
  const summary = getRestoreCollections(backup.collections)
    .filter(name => backup.collections[name]?.length > 0)
    .map(name => `${backup.collections[name].length} ${name}`)
    .join(', ');
  return summary || 'No records found.';
}
