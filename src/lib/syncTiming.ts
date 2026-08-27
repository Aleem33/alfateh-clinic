export class SyncTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SyncTimeoutError';
  }
}

export async function waitForSyncStep<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new SyncTimeoutError(label + ' did not finish within ' + Math.ceil(timeoutMs / 1000) + ' seconds.')), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}