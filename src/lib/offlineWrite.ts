import { isCloudOnline } from './lanCoordinator';

export async function waitForOnlineWrite<T>(promise: Promise<T>): Promise<T | undefined> {
  if (typeof navigator !== 'undefined' && !isCloudOnline()) {
    promise.catch(error => console.warn('Queued offline write failed after reconnect:', error));
    return undefined;
  }
  return promise;
}
