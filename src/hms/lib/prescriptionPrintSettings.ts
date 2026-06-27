export type PrescriptionPrintMode = 'preprinted' | 'fullPad';

export type PrescriptionPrintProfile = {
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

export type PrescriptionPrintSettings = {
  mode: PrescriptionPrintMode;
  profiles: Record<PrescriptionPrintMode, PrescriptionPrintProfile>;
};

const STORAGE_KEY = 'alfateh-prescription-print-settings';

export const DEFAULT_PRESCRIPTION_PRINT_PROFILES: Record<PrescriptionPrintMode, PrescriptionPrintProfile> = {
  preprinted: {
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
  },
  fullPad: {
    offsetX: 0,
    offsetY: 0,
    fontScale: 100,
    patientNameOffsetX: 0,
    patientNameOffsetY: 0,
    patientNameFontSize: 14,
    patientAgeOffsetX: 0,
    patientAgeOffsetY: 0,
    patientAgeFontSize: 14,
    patientDateOffsetX: 0,
    patientDateOffsetY: 0,
    patientDateFontSize: 14,
    vitalsOffsetX: 0,
    vitalsOffsetY: 0,
    vitalsFontSize: 13,
  },
};

export const DEFAULT_PRESCRIPTION_PRINT_SETTINGS: PrescriptionPrintSettings = {
  mode: 'preprinted',
  profiles: {
    preprinted: { ...DEFAULT_PRESCRIPTION_PRINT_PROFILES.preprinted },
    fullPad: { ...DEFAULT_PRESCRIPTION_PRINT_PROFILES.fullPad },
  },
};

function num(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeProfile(value: any, fallback: PrescriptionPrintProfile): PrescriptionPrintProfile {
  return {
    offsetX: num(value?.offsetX, fallback.offsetX),
    offsetY: num(value?.offsetY, fallback.offsetY),
    fontScale: num(value?.fontScale, fallback.fontScale),
    patientNameOffsetX: num(value?.patientNameOffsetX, fallback.patientNameOffsetX),
    patientNameOffsetY: num(value?.patientNameOffsetY, fallback.patientNameOffsetY),
    patientNameFontSize: num(value?.patientNameFontSize, fallback.patientNameFontSize),
    patientAgeOffsetX: num(value?.patientAgeOffsetX, fallback.patientAgeOffsetX),
    patientAgeOffsetY: num(value?.patientAgeOffsetY, fallback.patientAgeOffsetY),
    patientAgeFontSize: num(value?.patientAgeFontSize, fallback.patientAgeFontSize),
    patientDateOffsetX: num(value?.patientDateOffsetX, fallback.patientDateOffsetX),
    patientDateOffsetY: num(value?.patientDateOffsetY, fallback.patientDateOffsetY),
    patientDateFontSize: num(value?.patientDateFontSize, fallback.patientDateFontSize),
    vitalsOffsetX: num(value?.vitalsOffsetX, fallback.vitalsOffsetX),
    vitalsOffsetY: num(value?.vitalsOffsetY, fallback.vitalsOffsetY),
    vitalsFontSize: num(value?.vitalsFontSize, fallback.vitalsFontSize),
  };
}

function normalizeSettings(value: any): PrescriptionPrintSettings {
  const mode: PrescriptionPrintMode = value?.mode === 'fullPad' ? 'fullPad' : 'preprinted';

  if (value?.profiles) {
    return {
      mode,
      profiles: {
        preprinted: normalizeProfile(value.profiles.preprinted, DEFAULT_PRESCRIPTION_PRINT_PROFILES.preprinted),
        fullPad: normalizeProfile(value.profiles.fullPad, DEFAULT_PRESCRIPTION_PRINT_PROFILES.fullPad),
      },
    };
  }

  // Legacy settings were a single flat profile. Preserve that complete profile
  // for preprinted output, while carrying only the previously effective scale
  // into full-pad output so dormant offsets do not unexpectedly move its layout.
  return {
    mode,
    profiles: {
      preprinted: normalizeProfile(value, DEFAULT_PRESCRIPTION_PRINT_PROFILES.preprinted),
      fullPad: {
        ...DEFAULT_PRESCRIPTION_PRINT_PROFILES.fullPad,
        fontScale: num(value?.fontScale, DEFAULT_PRESCRIPTION_PRINT_PROFILES.fullPad.fontScale),
      },
    },
  };
}

export function getPrescriptionPrintSettings(): PrescriptionPrintSettings {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return normalizeSettings(DEFAULT_PRESCRIPTION_PRINT_SETTINGS);
    return normalizeSettings(JSON.parse(saved));
  } catch {
    return normalizeSettings(DEFAULT_PRESCRIPTION_PRINT_SETTINGS);
  }
}

export function savePrescriptionPrintSettings(settings: PrescriptionPrintSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeSettings(settings)));
}
