export type PrescriptionPrintMode = 'preprinted';

export type PrescriptionPrintSettings = {
  mode: PrescriptionPrintMode;
  offsetX: number;
  offsetY: number;
  fontScale: number;
  patientNameOffsetX: number;
  patientNameOffsetY: number;
  patientNameFontSize: number;
  patientAgeOffsetX: number;
  patientAgeOffsetY: number;
  patientAgeFontSize: number;
  patientDateOffsetX: number;
  patientDateOffsetY: number;
  patientDateFontSize: number;
  vitalsOffsetX: number;
  vitalsOffsetY: number;
  vitalsFontSize: number;
};

const STORAGE_KEY = 'alfateh-prescription-print-settings';

export const DEFAULT_PRESCRIPTION_PRINT_SETTINGS: PrescriptionPrintSettings = {
  mode: 'preprinted',
  offsetX: 0,
  offsetY: 0,
  fontScale: 100,
  patientNameOffsetX: 0,
  patientNameOffsetY: 0,
  patientNameFontSize: 12,
  patientAgeOffsetX: 0,
  patientAgeOffsetY: 0,
  patientAgeFontSize: 12,
  patientDateOffsetX: 0,
  patientDateOffsetY: 0,
  patientDateFontSize: 12,
  vitalsOffsetX: 0,
  vitalsOffsetY: 0,
  vitalsFontSize: 10.5,
};

function num(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getPrescriptionPrintSettings(): PrescriptionPrintSettings {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return DEFAULT_PRESCRIPTION_PRINT_SETTINGS;
    const parsed = JSON.parse(saved);
    return {
      mode: 'preprinted',
      offsetX: num(parsed.offsetX, DEFAULT_PRESCRIPTION_PRINT_SETTINGS.offsetX),
      offsetY: num(parsed.offsetY, DEFAULT_PRESCRIPTION_PRINT_SETTINGS.offsetY),
      fontScale: num(parsed.fontScale, DEFAULT_PRESCRIPTION_PRINT_SETTINGS.fontScale),
      patientNameOffsetX: num(parsed.patientNameOffsetX, DEFAULT_PRESCRIPTION_PRINT_SETTINGS.patientNameOffsetX),
      patientNameOffsetY: num(parsed.patientNameOffsetY, DEFAULT_PRESCRIPTION_PRINT_SETTINGS.patientNameOffsetY),
      patientNameFontSize: num(parsed.patientNameFontSize, DEFAULT_PRESCRIPTION_PRINT_SETTINGS.patientNameFontSize),
      patientAgeOffsetX: num(parsed.patientAgeOffsetX, DEFAULT_PRESCRIPTION_PRINT_SETTINGS.patientAgeOffsetX),
      patientAgeOffsetY: num(parsed.patientAgeOffsetY, DEFAULT_PRESCRIPTION_PRINT_SETTINGS.patientAgeOffsetY),
      patientAgeFontSize: num(parsed.patientAgeFontSize, DEFAULT_PRESCRIPTION_PRINT_SETTINGS.patientAgeFontSize),
      patientDateOffsetX: num(parsed.patientDateOffsetX, DEFAULT_PRESCRIPTION_PRINT_SETTINGS.patientDateOffsetX),
      patientDateOffsetY: num(parsed.patientDateOffsetY, DEFAULT_PRESCRIPTION_PRINT_SETTINGS.patientDateOffsetY),
      patientDateFontSize: num(parsed.patientDateFontSize, DEFAULT_PRESCRIPTION_PRINT_SETTINGS.patientDateFontSize),
      vitalsOffsetX: num(parsed.vitalsOffsetX, DEFAULT_PRESCRIPTION_PRINT_SETTINGS.vitalsOffsetX),
      vitalsOffsetY: num(parsed.vitalsOffsetY, DEFAULT_PRESCRIPTION_PRINT_SETTINGS.vitalsOffsetY),
      vitalsFontSize: num(parsed.vitalsFontSize, DEFAULT_PRESCRIPTION_PRINT_SETTINGS.vitalsFontSize),
    };
  } catch {
    return DEFAULT_PRESCRIPTION_PRINT_SETTINGS;
  }
}

export function savePrescriptionPrintSettings(settings: PrescriptionPrintSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    mode: 'preprinted',
    offsetX: num(settings.offsetX, DEFAULT_PRESCRIPTION_PRINT_SETTINGS.offsetX),
    offsetY: num(settings.offsetY, DEFAULT_PRESCRIPTION_PRINT_SETTINGS.offsetY),
    fontScale: num(settings.fontScale, DEFAULT_PRESCRIPTION_PRINT_SETTINGS.fontScale),
    patientNameOffsetX: num(settings.patientNameOffsetX, DEFAULT_PRESCRIPTION_PRINT_SETTINGS.patientNameOffsetX),
    patientNameOffsetY: num(settings.patientNameOffsetY, DEFAULT_PRESCRIPTION_PRINT_SETTINGS.patientNameOffsetY),
    patientNameFontSize: num(settings.patientNameFontSize, DEFAULT_PRESCRIPTION_PRINT_SETTINGS.patientNameFontSize),
    patientAgeOffsetX: num(settings.patientAgeOffsetX, DEFAULT_PRESCRIPTION_PRINT_SETTINGS.patientAgeOffsetX),
    patientAgeOffsetY: num(settings.patientAgeOffsetY, DEFAULT_PRESCRIPTION_PRINT_SETTINGS.patientAgeOffsetY),
    patientAgeFontSize: num(settings.patientAgeFontSize, DEFAULT_PRESCRIPTION_PRINT_SETTINGS.patientAgeFontSize),
    patientDateOffsetX: num(settings.patientDateOffsetX, DEFAULT_PRESCRIPTION_PRINT_SETTINGS.patientDateOffsetX),
    patientDateOffsetY: num(settings.patientDateOffsetY, DEFAULT_PRESCRIPTION_PRINT_SETTINGS.patientDateOffsetY),
    patientDateFontSize: num(settings.patientDateFontSize, DEFAULT_PRESCRIPTION_PRINT_SETTINGS.patientDateFontSize),
    vitalsOffsetX: num(settings.vitalsOffsetX, DEFAULT_PRESCRIPTION_PRINT_SETTINGS.vitalsOffsetX),
    vitalsOffsetY: num(settings.vitalsOffsetY, DEFAULT_PRESCRIPTION_PRINT_SETTINGS.vitalsOffsetY),
    vitalsFontSize: num(settings.vitalsFontSize, DEFAULT_PRESCRIPTION_PRINT_SETTINGS.vitalsFontSize),
  }));
}
