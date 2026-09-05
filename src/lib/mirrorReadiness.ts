type MirrorReadinessEntry = {
  ready: boolean;
  generation: number;
  updatedAt: string;
};

const STORAGE_KEY = 'alfateh.local-mirror-readiness.v2';

function readEntries(): Record<string, MirrorReadinessEntry> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

export function setOfflineMirrorReadiness(role: string, ready: boolean, generation: number) {
  if (!role || typeof localStorage === 'undefined') return;
  const entries = readEntries();
  entries[role] = {
    ready,
    generation: Math.max(1, Number(generation) || 1),
    updatedAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // IndexedDB remains intact; a storage failure simply keeps offline writes blocked.
  }
}

export function isOfflineMirrorReady(role: string | null | undefined) {
  if (!role) return false;
  if (typeof localStorage === 'undefined') return true;
  return readEntries()[role]?.ready === true;
}
