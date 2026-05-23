const DEVICE_KEY = 'alfateh.offline.device';
const COUNTER_PREFIX = 'alfateh.offline.counter.';

type DeviceInfo = {
  id: string;
  prefix: string;
  createdAt: string;
};

function makeDeviceInfo(): DeviceInfo {
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  const suffix = Array.from(bytes, b => b.toString(36).padStart(2, '0')).join('').toUpperCase();
  return {
    id: `device-${Date.now().toString(36)}-${suffix.toLowerCase()}`,
    prefix: `R${suffix.slice(0, 3)}`,
    createdAt: new Date().toISOString(),
  };
}

export function getOfflineDevice(): DeviceInfo {
  try {
    const raw = localStorage.getItem(DEVICE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.id && parsed?.prefix) return parsed;
    }
  } catch {
    // Recreate corrupt local identity below.
  }

  const device = makeDeviceInfo();
  localStorage.setItem(DEVICE_KEY, JSON.stringify(device));
  return device;
}

export function getOfflineDevicePrefix(): string {
  return getOfflineDevice().prefix;
}

export function getNextLocalNumber(counterId: string, width = 6): string {
  const device = getOfflineDevice();
  const key = `${COUNTER_PREFIX}${counterId}.${device.id}`;
  const current = Number(localStorage.getItem(key) || '0');
  const next = current + 1;
  localStorage.setItem(key, String(next));
  return `${device.prefix}-${String(next).padStart(width, '0')}`;
}
