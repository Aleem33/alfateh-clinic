export type PrescriptionPrintMode = 'full' | 'preprinted';

export type PrescriptionPrintSettings = {
  mode: PrescriptionPrintMode;
  offsetX: number;
  offsetY: number;
  fontScale: number;
};

const STORAGE_KEY = 'alfateh-prescription-print-settings';

export const DEFAULT_PRESCRIPTION_PRINT_SETTINGS: PrescriptionPrintSettings = {
  mode: 'full',
  offsetX: 0,
  offsetY: 0,
  fontScale: 100,
};

export function getPrescriptionPrintSettings(): PrescriptionPrintSettings {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return DEFAULT_PRESCRIPTION_PRINT_SETTINGS;
    const parsed = JSON.parse(saved);
    return {
      mode: parsed.mode === 'preprinted' ? 'preprinted' : 'full',
      offsetX: Number(parsed.offsetX) || 0,
      offsetY: Number(parsed.offsetY) || 0,
      fontScale: Number(parsed.fontScale) || 100,
    };
  } catch {
    return DEFAULT_PRESCRIPTION_PRINT_SETTINGS;
  }
}

export function savePrescriptionPrintSettings(settings: PrescriptionPrintSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    mode: settings.mode,
    offsetX: Number(settings.offsetX) || 0,
    offsetY: Number(settings.offsetY) || 0,
    fontScale: Number(settings.fontScale) || 100,
  }));
}
