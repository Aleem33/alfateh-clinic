export type PrescriptionOption = {
  en: string;
  ur: string;
};

export const DOSAGE_OPTIONS: PrescriptionOption[] = [
  { en: '1 tablet', ur: 'ایک گولی' },
  { en: '1/2 tablet', ur: 'آدھی گولی' },
  { en: '2 tablets', ur: 'دو گولیاں' },
  { en: '1 capsule', ur: 'ایک کیپسول' },
  { en: '1 teaspoon', ur: 'ایک چائے کا چمچ' },
  { en: '5 ml', ur: 'پانچ ملی لیٹر' },
  { en: '10 ml', ur: 'دس ملی لیٹر' },
  { en: '2 drops', ur: 'دو قطرے' },
];

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

export const INSTRUCTION_OPTIONS: PrescriptionOption[] = [
  { en: '', ur: '' },
  { en: 'Before meal', ur: 'کھانے سے پہلے' },
  { en: 'After meal', ur: 'کھانے کے بعد' },
  { en: 'With meal', ur: 'کھانے کے ساتھ' },
  { en: 'Morning only', ur: 'صرف صبح' },
  { en: 'Night only', ur: 'صرف رات' },
  { en: 'Avoid milk', ur: 'دودھ سے پرہیز کریں' },
  { en: 'Take with water', ur: 'پانی کے ساتھ لیں' },
];

function optionUrdu(options: PrescriptionOption[], value?: string): string {
  return options.find(option => option.en === value)?.ur || '';
}

export function getDosageUrdu(value?: string): string {
  return optionUrdu(DOSAGE_OPTIONS, value);
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

export function withPrescriptionUrdu<T extends {
  dosage?: string;
  dosageUrdu?: string;
  frequency?: string;
  frequencyUrdu?: string;
  duration?: string;
  durationUrdu?: string;
  instructions?: string;
  instructionsUrdu?: string;
}>(rx: T): T {
  return {
    ...rx,
    dosageUrdu: rx.dosageUrdu || getDosageUrdu(rx.dosage),
    frequencyUrdu: rx.frequencyUrdu || getFrequencyUrdu(rx.frequency),
    durationUrdu: rx.durationUrdu || getDurationUrdu(rx.duration),
    instructionsUrdu: rx.instructionsUrdu || getInstructionUrdu(rx.instructions),
  };
}

export function withPrescriptionListUrdu<T extends Parameters<typeof withPrescriptionUrdu>[0]>(prescriptions: T[]): T[] {
  return prescriptions.map(rx => withPrescriptionUrdu(rx) as T);
}
