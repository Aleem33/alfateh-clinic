import * as firestore from 'firebase/firestore';
import { ensureLanWriteAccess, isCloudOnline, publishLanActivity } from './lanCoordinator';
import { getActiveAuthSession } from './offlineAuth';

export * from 'firebase/firestore';

type AnyRecord = Record<string, any>;

export const SYNC_PROTOCOL_VERSION = 2;

function syncMetadata() {
  return {
    syncUpdatedAt: firestore.serverTimestamp(),
    syncProtocolVersion: SYNC_PROTOCOL_VERSION,
  };
}

function withSyncMetadata(data: AnyRecord) {
  return { ...data, ...syncMetadata() };
}

function withSyncMergeFields(options?: any) {
  if (!options?.mergeFields) return options;
  const mergeFields = [...options.mergeFields];
  if (!mergeFields.includes('syncUpdatedAt')) mergeFields.push('syncUpdatedAt');
  if (!mergeFields.includes('syncProtocolVersion')) mergeFields.push('syncProtocolVersion');
  return { ...options, mergeFields };
}

function withSyncUpdateArguments(dataOrField: any, moreFieldsAndValues: any[]) {
  if (moreFieldsAndValues.length === 0 && typeof dataOrField === 'object' && dataOrField !== null) {
    return [withSyncMetadata(dataOrField)];
  }
  return [
    dataOrField,
    ...moreFieldsAndValues,
    'syncUpdatedAt',
    firestore.serverTimestamp(),
    'syncProtocolVersion',
    SYNC_PROTOCOL_VERSION,
  ];
}

function softDeleteMetadata() {
  return {
    deleted: true,
    deletedAt: firestore.serverTimestamp(),
    deletedBy: getActiveAuthSession()?.profile.uid || 'unknown',
    ...syncMetadata(),
  };
}

function referenceDetails(reference: any, data?: AnyRecord) {
  const path = String(reference?.path || 'records');
  const parts = path.split('/');
  const collectionName = parts.length > 1 ? parts[parts.length - 2] : parts[0];
  const recordId = parts.length > 1 ? parts[parts.length - 1] : '';
  const label = data?.medicineName || data?.patientName || data?.customerName || data?.supplierName
    || data?.name || data?.receiptNo || data?.billNo || data?.mrn || recordId;
  const summaryParts = [
    data?.batchNo ? `Batch ${data.batchNo}` : '',
    Number.isFinite(Number(data?.total)) ? `Total ${Number(data.total).toFixed(2)}` : '',
    Number.isFinite(Number(data?.totalUnitsAdded)) ? `${Number(data.totalUnitsAdded)} units` : '',
    Array.isArray(data?.items) && data.items.length
      ? data.items.slice(0, 3).map((item: any) => item.name || item.medicineName).filter(Boolean).join(', ')
      : '',
  ].filter(Boolean);
  return { collection: collectionName, recordId, label: String(label || ''), summary: summaryParts.join(' · ') };
}

async function executeWrite<T>(run: () => Promise<T>, activity: AnyRecord): Promise<T | undefined> {
  await ensureLanWriteAccess();
  const pending = run();
  void publishLanActivity(activity);
  if (typeof navigator !== 'undefined' && !isCloudOnline()) {
    pending.catch(error => console.warn('Queued LAN-primary write failed after reconnect:', error));
    return undefined;
  }
  return pending;
}

export const addDoc: typeof firestore.addDoc = (async (reference: any, data: AnyRecord) => {
  await ensureLanWriteAccess();
  const syncedData = withSyncMetadata(data);
  if (isCloudOnline()) {
    const documentRef = await firestore.addDoc(reference, syncedData);
    void publishLanActivity({ action: 'created', ...referenceDetails(documentRef, data) });
    return documentRef;
  }
  const documentRef = firestore.doc(reference);
  const pending = firestore.setDoc(documentRef, syncedData);
  pending.catch(error => console.warn('Queued LAN-primary create failed after reconnect:', error));
  void publishLanActivity({ action: 'created', ...referenceDetails(documentRef, data) });
  return documentRef;
}) as typeof firestore.addDoc;

export const setDoc: typeof firestore.setDoc = (async (reference: any, data: AnyRecord, options?: any) => {
  const syncedData = withSyncMetadata(data);
  const syncedOptions = withSyncMergeFields(options);
  await executeWrite(
    () => syncedOptions ? firestore.setDoc(reference, syncedData, syncedOptions) : firestore.setDoc(reference, syncedData),
    { action: 'saved', ...referenceDetails(reference, data) },
  );
}) as typeof firestore.setDoc;

export const updateDoc: typeof firestore.updateDoc = (async (reference: any, dataOrField: any, ...moreFieldsAndValues: any[]) => {
  const data = moreFieldsAndValues.length === 0 && typeof dataOrField === 'object' && dataOrField !== null ? dataOrField : {};
  const updateArguments = withSyncUpdateArguments(dataOrField, moreFieldsAndValues);
  await executeWrite(
    () => (firestore.updateDoc as any)(reference, ...updateArguments),
    { action: 'updated', ...referenceDetails(reference, data) },
  );
}) as typeof firestore.updateDoc;

export const deleteDoc: typeof firestore.deleteDoc = (async (reference: any) => {
  await executeWrite(
    () => firestore.updateDoc(reference, softDeleteMetadata()),
    { action: 'deleted', ...referenceDetails(reference) },
  );
}) as typeof firestore.deleteDoc;

export const hardDeleteDoc: typeof firestore.deleteDoc = (async (reference: any) => {
  await executeWrite(
    () => firestore.deleteDoc(reference),
    { action: 'permanently deleted', ...referenceDetails(reference) },
  );
}) as typeof firestore.deleteDoc;

function createWriteBatch(database: any, permanentDeletes: boolean) {
  const underlying = firestore.writeBatch(database);
  const activities: AnyRecord[] = [];
  const facade: AnyRecord = {
    set(reference: any, data: AnyRecord, options?: any) {
      activities.push({ action: 'saved', ...referenceDetails(reference, data) });
      const syncedData = withSyncMetadata(data);
      const syncedOptions = withSyncMergeFields(options);
      if (syncedOptions) underlying.set(reference, syncedData, syncedOptions);
      else underlying.set(reference, syncedData);
      return facade;
    },
    update(reference: any, dataOrField: any, ...moreFieldsAndValues: any[]) {
      const data = moreFieldsAndValues.length === 0 && typeof dataOrField === 'object' && dataOrField !== null ? dataOrField : {};
      activities.push({ action: 'updated', ...referenceDetails(reference, data) });
      (underlying.update as any)(reference, ...withSyncUpdateArguments(dataOrField, moreFieldsAndValues));
      return facade;
    },
    delete(reference: any) {
      activities.push({ action: permanentDeletes ? 'permanently deleted' : 'deleted', ...referenceDetails(reference) });
      if (permanentDeletes) underlying.delete(reference);
      else underlying.update(reference, softDeleteMetadata());
      return facade;
    },
    async commit() {
      await ensureLanWriteAccess();
      const pending = underlying.commit();
      activities.forEach(activity => void publishLanActivity(activity));
      if (typeof navigator !== 'undefined' && !isCloudOnline()) {
        pending.catch(error => console.warn('Queued LAN-primary batch failed after reconnect:', error));
        return;
      }
      await pending;
    },
  };
  return facade;
}

export const writeBatch: typeof firestore.writeBatch = ((database: any) => (
  createWriteBatch(database, false)
)) as typeof firestore.writeBatch;

/** Reserved for the explicit, admin-only Full Reset workflow. */
export const writeHardDeleteBatch: typeof firestore.writeBatch = ((database: any) => (
  createWriteBatch(database, true)
)) as typeof firestore.writeBatch;

export const runTransaction: typeof firestore.runTransaction = (async (database: any, updateFunction: any, options?: any) => {
  await ensureLanWriteAccess();
  if (typeof navigator !== 'undefined' && !isCloudOnline()) {
    throw new Error('This operation requires an online database transaction. It is unavailable during offline mode.');
  }
  return firestore.runTransaction(database, updateFunction, options);
}) as typeof firestore.runTransaction;
