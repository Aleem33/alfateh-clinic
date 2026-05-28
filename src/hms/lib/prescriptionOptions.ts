export type PrescriptionOption = {
  en: string;
  ur: string;
};

export type DoseSlotKey = 'daily' | 'morning' | 'afternoon' | 'evening' | 'night';

export type DoseScheduleSlot = {
  amount: string;
  amountUrdu: string;
};

export type DoseSchedule = Partial<Record<DoseSlotKey, DoseScheduleSlot>>;

export type PrescriptionScheduleFields = {
  doseSchedule?: DoseSchedule;
  scheduleText?: string;
  scheduleTextUrdu?: string;
  dosage?: string;
  dosageUrdu?: string;
  frequency?: string;
  frequencyUrdu?: string;
  duration?: string;
  durationUrdu?: string;
  instructions?: string;
  instructionsUrdu?: string;
};

export const DOSE_TIME_OPTIONS: { key: DoseSlotKey; en: string; ur: string }[] = [
  { key: 'daily', en: 'Daily', ur: 'روزانہ' },
  { key: 'morning', en: 'Morning', ur: 'صبح' },
  { key: 'afternoon', en: 'Afternoon', ur: 'دوپہر' },
  { key: 'evening', en: 'Evening', ur: 'شام' },
  { key: 'night', en: 'Night', ur: 'رات' },
];

export const DOSE_GRID_TIME_OPTIONS = DOSE_TIME_OPTIONS.filter(option => ['morning', 'afternoon', 'night'].includes(option.key)) as {
  key: Exclude<DoseSlotKey, 'daily' | 'evening'>;
  en: string;
  ur: string;
}[];

export const DOSE_AMOUNT_OPTIONS: PrescriptionOption[] = [
  { en: '', ur: '' },
  { en: '1 tablet', ur: 'ایک گولی' },
  { en: '1/2 tablet', ur: 'آدھی گولی' },
  { en: '2 tablets', ur: 'دو گولیاں' },
  { en: '1 capsule', ur: 'ایک کیپسول' },
  { en: '2 capsules', ur: 'دو کیپسول' },
  { en: '1 spoon', ur: 'ایک چمچ' },
  { en: '1/2 spoon', ur: 'آدھا چمچ' },
  { en: '2 spoons', ur: 'دو چمچ' },
  { en: '4 spoons', ur: '4 چمچ' },
  { en: '5 ml', ur: 'پانچ ملی لیٹر' },
  { en: '10 ml', ur: 'دس ملی لیٹر' },
  { en: '2 drops', ur: 'دو قطرے' },
  { en: '1 injection', ur: 'ایک انجیکشن' },
];

export const TIMING_OPTIONS: PrescriptionOption[] = [
  { en: '', ur: '' },
  { en: 'Before meal', ur: 'کھانے سے پہلے' },
  { en: 'After meal', ur: 'کھانے کے بعد' },
  { en: 'With meal', ur: 'کھانے کے ساتھ' },
  { en: '20 minutes before meal', ur: '20 منٹ کھانے سے پہلے' },
  { en: '20 minutes after meal', ur: '20 منٹ کھانے کے بعد' },
  { en: 'Take with water', ur: 'پانی کے ساتھ لیں' },
  { en: 'Avoid milk', ur: 'دودھ سے پرہیز کریں' },
];

export const URDU_PRESET_OPTIONS: {
  label: string;
  schedule?: DoseSchedule;
  instructions?: string;
  instructionsUrdu?: string;
}[] = [
  {
    label: 'دو چمچ کھانے کے بعد',
    schedule: { daily: { amount: '2 spoons', amountUrdu: 'دو چمچ' } },
    instructions: 'After meal',
    instructionsUrdu: 'کھانے کے بعد',
  },
  {
    label: 'ایک چمچ صبح دوپہر شام',
    schedule: {
      morning: { amount: '1 spoon', amountUrdu: 'ایک چمچ' },
      afternoon: { amount: '1 spoon', amountUrdu: 'ایک چمچ' },
      evening: { amount: '1 spoon', amountUrdu: 'ایک چمچ' },
    },
  },
  {
    label: 'ایک چمچ روزانہ',
    schedule: { daily: { amount: '1 spoon', amountUrdu: 'ایک چمچ' } },
  },
  {
    label: '1/2 چمچ صبح شام',
    schedule: {
      morning: { amount: '1/2 spoon', amountUrdu: 'آدھا چمچ' },
      evening: { amount: '1/2 spoon', amountUrdu: 'آدھا چمچ' },
    },
  },
  {
    label: '1/2 چمچ روزانہ رات',
    schedule: { night: { amount: '1/2 spoon', amountUrdu: 'آدھا چمچ' } },
  },
  {
    label: '1/2 چمچ روزانہ',
    schedule: { daily: { amount: '1/2 spoon', amountUrdu: 'آدھا چمچ' } },
  },
  {
    label: 'دو چمچ روزانہ رات',
    schedule: { night: { amount: '2 spoons', amountUrdu: 'دو چمچ' } },
  },
  {
    label: '4چمچ روزانہ رات',
    schedule: { night: { amount: '4 spoons', amountUrdu: '4 چمچ' } },
  },
  {
    label: '20 منٹ کھانے سے پہلے',
    instructions: '20 minutes before meal',
    instructionsUrdu: '20 منٹ کھانے سے پہلے',
  },
  {
    label: '20 منٹ کھانے کے بعد',
    instructions: '20 minutes after meal',
    instructionsUrdu: '20 منٹ کھانے کے بعد',
  },
];

export const DOSAGE_OPTIONS: PrescriptionOption[] = DOSE_AMOUNT_OPTIONS.filter(option => option.en);

export const FREQUENCY_OPTIONS: PrescriptionOption[] = [
  { en: 'Once daily', ur: 'روزانہ ایک بار' },
  { en: 'Twice daily', ur: 'روزانہ دو بار' },
  { en: 'Three times daily', ur: 'روزانہ تین بار' },
  { en: 'Four times daily', ur: 'روزانہ چار بار' },
  { en: 'As needed', ur: 'ضرورت کے مطابق' },
  { en: 'Before meals', ur: 'کھانے سے پہلے' },
  { en: 'After meals', ur: 'کھانے کے بعد' },
  { en: 'At bedtime', ur: 'سونے سے پہلے' },
];

export const DURATION_OPTIONS: PrescriptionOption[] = [
  { en: '3 days', ur: 'تین دن' },
  { en: '5 days', ur: 'پانچ دن' },
  { en: '7 days', ur: 'سات دن' },
  { en: '10 days', ur: 'دس دن' },
  { en: '14 days', ur: 'چودہ دن' },
  { en: '1 month', ur: 'ایک ماہ' },
  { en: 'Ongoing', ur: 'جاری رکھیں' },
];

export const INSTRUCTION_OPTIONS: PrescriptionOption[] = TIMING_OPTIONS;

function optionUrdu(options: PrescriptionOption[], value?: string): string {
  return options.find(option => option.en === value)?.ur || '';
}

export function getDosageUrdu(value?: string): string {
  return optionUrdu(DOSE_AMOUNT_OPTIONS, value);
}

export function getFrequencyUrdu(value?: string): string {
  return optionUrdu(FREQUENCY_OPTIONS, value);
}

export function getDurationUrdu(value?: string): string {
  return optionUrdu(DURATION_OPTIONS, value);
}

export function getInstructionUrdu(value?: string): string {
  return optionUrdu(INSTRUCTION_OPTIONS, value);
}

function cleanSchedule(schedule?: DoseSchedule): DoseSchedule {
  const clean: DoseSchedule = {};
  for (const time of DOSE_TIME_OPTIONS) {
    const slot = schedule?.[time.key];
    if (!slot?.amount) continue;
    clean[time.key] = {
      amount: slot.amount,
      amountUrdu: slot.amountUrdu || getDosageUrdu(slot.amount) || slot.amount,
    };
  }
  return clean;
}

function activeScheduleEntries(schedule?: DoseSchedule) {
  const clean = cleanSchedule(schedule);
  return DOSE_TIME_OPTIONS
    .map(time => ({ ...time, slot: clean[time.key] }))
    .filter(entry => entry.slot?.amount);
}

function summarizeSchedule(schedule?: DoseSchedule) {
  const entries = activeScheduleEntries(schedule);
  if (!entries.length) return { en: '', ur: '', dosage: '', dosageUrdu: '', frequency: '', frequencyUrdu: '' };

  const firstSlot = entries[0].slot;
  const allSameDose = entries.every(entry => entry.slot?.amount === firstSlot?.amount);
  const dosage = allSameDose ? firstSlot?.amount || '' : 'As directed';
  const dosageUrdu = allSameDose ? firstSlot?.amountUrdu || getDosageUrdu(firstSlot?.amount) : 'ہدایت کے مطابق';
  const frequency = entries.length === 1 && entries[0].key === 'daily'
    ? 'Once daily'
    : entries.length === 1
      ? entries[0].en
      : entries.map(entry => entry.en).join(' + ');
  const frequencyUrdu = entries.length === 1 && entries[0].key === 'daily'
    ? 'روزانہ'
    : entries.map(entry => entry.ur).join(' ');

  if (allSameDose) {
    return {
      en: `${firstSlot?.amount || ''} ${frequency}`.trim(),
      ur: `${firstSlot?.amountUrdu || getDosageUrdu(firstSlot?.amount)} ${frequencyUrdu}`.trim(),
      dosage,
      dosageUrdu,
      frequency,
      frequencyUrdu,
    };
  }

  return {
    en: entries.map(entry => `${entry.en}: ${entry.slot?.amount}`).join(', '),
    ur: entries.map(entry => `${entry.ur}: ${entry.slot?.amountUrdu || getDosageUrdu(entry.slot?.amount)}`).join('، '),
    dosage,
    dosageUrdu,
    frequency,
    frequencyUrdu,
  };
}

export function createDefaultDoseSchedule(form?: string): DoseSchedule {
  return {
    morning: { amount: '1', amountUrdu: '1' },
    afternoon: { amount: '0', amountUrdu: '0' },
    night: { amount: '0', amountUrdu: '0' },
  };
}

export function updateDoseScheduleSlot(rx: PrescriptionScheduleFields, key: DoseSlotKey, amount: string): PrescriptionScheduleFields {
  const nextSchedule = cleanSchedule(rx.doseSchedule);
  if (!amount) {
    delete nextSchedule[key];
  } else {
    nextSchedule[key] = { amount, amountUrdu: getDosageUrdu(amount) };
  }
  return normalizePrescriptionForSave({ ...rx, doseSchedule: nextSchedule });
}

export function applyUrduPreset(rx: PrescriptionScheduleFields, presetLabel: string): PrescriptionScheduleFields {
  const preset = URDU_PRESET_OPTIONS.find(option => option.label === presetLabel);
  if (!preset) return rx;
  return normalizePrescriptionForSave({
    ...rx,
    doseSchedule: preset.schedule ? cleanSchedule(preset.schedule) : rx.doseSchedule,
    instructions: preset.instructions ?? rx.instructions,
    instructionsUrdu: preset.instructionsUrdu ?? preset.label,
  });
}

export function normalizePrescriptionForSave<T extends PrescriptionScheduleFields>(rx: T): T {
  const doseSchedule = cleanSchedule(rx.doseSchedule);
  const schedule = summarizeSchedule(doseSchedule);
  const instructionsUrdu = rx.instructionsUrdu || getInstructionUrdu(rx.instructions);

  return {
    ...rx,
    doseSchedule,
    scheduleText: schedule.en || rx.scheduleText || '',
    scheduleTextUrdu: schedule.ur || rx.scheduleTextUrdu || '',
    dosage: schedule.dosage || rx.dosage || '',
    dosageUrdu: schedule.dosageUrdu || rx.dosageUrdu || getDosageUrdu(rx.dosage),
    frequency: schedule.frequency || rx.frequency || '',
    frequencyUrdu: schedule.frequencyUrdu || rx.frequencyUrdu || getFrequencyUrdu(rx.frequency),
    durationUrdu: rx.durationUrdu || getDurationUrdu(rx.duration),
    instructionsUrdu,
  };
}

export function getPrescriptionEnglishLine(rx: PrescriptionScheduleFields): string {
  const normalized = normalizePrescriptionForSave(rx);
  return [
    normalized.scheduleText || [normalized.dosage, normalized.frequency].filter(Boolean).join(' '),
    normalized.duration,
    normalized.instructions,
  ].filter(Boolean).join(' - ');
}

export function getPrescriptionUrduLine(rx: PrescriptionScheduleFields & { nameUrdu?: string }): string {
  const normalized = normalizePrescriptionForSave(rx);
  return [
    normalized.nameUrdu,
    normalized.scheduleTextUrdu || [normalized.dosageUrdu, normalized.frequencyUrdu].filter(Boolean).join(' '),
    normalized.durationUrdu,
    normalized.instructionsUrdu,
  ].filter(Boolean).join(' - ');
}

export function getPrescriptionDoseCount(rx: PrescriptionScheduleFields): number {
  const entries = activeScheduleEntries(rx.doseSchedule);
  return entries.filter(entry => Number(entry.slot?.amount) > 0 || (!Number.isNaN(parseFloat(entry.slot?.amount || '')) && parseFloat(entry.slot?.amount || '') > 0)).length;
}

export function getDoseGridValue(rx: PrescriptionScheduleFields, key: Exclude<DoseSlotKey, 'daily' | 'evening'>): string {
  const normalized = normalizePrescriptionForSave(rx);
  const direct = normalized.doseSchedule?.[key]?.amount;
  if (direct !== undefined && direct !== null && direct !== '') return direct;

  const daily = normalized.doseSchedule?.daily?.amount;
  if (daily && key === 'morning') return daily;
  return '';
}

export function getPrescriptionDays(rx: PrescriptionScheduleFields): string {
  const duration = rx.duration || '';
  const match = duration.match(/\d+/);
  return match?.[0] || duration;
}

export function withPrescriptionUrdu<T extends PrescriptionScheduleFields>(rx: T): T {
  return normalizePrescriptionForSave(rx);
}

export function withPrescriptionListUrdu<T extends PrescriptionScheduleFields>(prescriptions: T[]): T[] {
  return prescriptions.map(rx => withPrescriptionUrdu(rx) as T);
}
