export async function waitForOnlineWrite<T>(promise: Promise<T>): Promise<T | undefined> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    promise.catch(error => console.warn('Queued offline write failed after reconnect:', error));
    return undefined;
  }
  return promise;
}
