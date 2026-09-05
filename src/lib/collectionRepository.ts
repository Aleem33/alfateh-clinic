import {
  readLocalCollectionSnapshot,
  subscribeLocalSyncStatus,
  type LocalMirrorDocument,
  type LocalMirrorQueryOptions,
} from './localMirror';
import { getActiveAuthSession } from './offlineAuth';
import { canRoleReadOfflineCollection } from './offlineDataPolicy';
import { getSyncControl, subscribeSyncControl } from './syncProtocol';

export type CollectionRecord = Record<string, any> & { id: string };

function materialize<T extends Record<string, any>>(document: LocalMirrorDocument<T>): T & { id: string } {
  return { ...document.data, id: document.id };
}

function assertLocalCollectionAccess(collectionName: string) {
  const cachedRole = typeof localStorage === 'undefined' ? '' : localStorage.getItem('alfateh.cachedUserRole') || '';
  const role = getActiveAuthSession()?.profile.role || cachedRole;
  if (!canRoleReadOfflineCollection(role, collectionName)) {
    throw new Error(`Your role is not permitted to read ${collectionName} from the local database.`);
  }
}

export function subscribeToLocalCollection<T extends Record<string, any> = Record<string, any>>(
  collectionName: string,
  onData: (records: Array<T & { id: string }>) => void,
  onError?: (error: Error) => void,
  options: LocalMirrorQueryOptions<T> = {},
) {
  try {
    assertLocalCollectionAccess(collectionName);
  } catch (error) {
    onError?.(error as Error);
    return () => undefined;
  }
  let stopped = false;
  let revision = 0;
  const deliver = async () => {
    const currentRevision = ++revision;
    try {
      const { status, records } = await readLocalCollectionSnapshot<T>(collectionName, options);
      if (stopped || currentRevision !== revision) return;
      assertLocalCollectionAccess(collectionName);
      if (!status.seedComplete || String(status.generation) !== String(getSyncControl().datasetGeneration)) return;
      onData(records.map(materialize));
    } catch (error) {
      if (!stopped && currentRevision === revision) onError?.(error as Error);
    }
  };
  const unsubscribeStatus = subscribeLocalSyncStatus(
    collectionName,
    () => { void deliver(); },
    onError,
  );
  const unsubscribeControl = subscribeSyncControl(() => { void deliver(); });
  return () => {
    stopped = true;
    unsubscribeControl();
    unsubscribeStatus();
  };
}

export async function getLocalCollectionOnce<T extends Record<string, any> = Record<string, any>>(
  collectionName: string,
  options: LocalMirrorQueryOptions<T> = {},
) {
  assertLocalCollectionAccess(collectionName);
  const { status, records } = await readLocalCollectionSnapshot<T>(collectionName, options);
  assertLocalCollectionAccess(collectionName);
  if (!status.seedComplete || String(status.generation) !== String(getSyncControl().datasetGeneration)) {
    throw new Error(`Initial synchronization is required before ${collectionName} can be read locally.`);
  }
  return records.map(materialize);
}
