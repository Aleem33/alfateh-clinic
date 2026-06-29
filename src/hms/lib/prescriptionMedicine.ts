const MEDICINE_FORM_PREFIXES: Record<string, string> = {
  tablet: 'Tab.',
  tab: 'Tab.',
  capsule: 'Cap.',
  cap: 'Cap.',
  syrup: 'Syp.',
  syp: 'Syp.',
  injection: 'Inj.',
  inj: 'Inj.',
  drops: 'Drops',
  drop: 'Drops',
  'cream/ointment': 'Cr.',
  cream: 'Cr.',
  ointment: 'Oint.',
  powder: 'Pwd.',
  sachet: 'Sachet',
  sachets: 'Sachet',
  inhaler: 'Inh.',
  'iv fluid': 'IV',
};

function normalizeForm(form?: string): string {
  return (form || '').trim().toLowerCase();
}

export function getMedicineFormPrefix(form?: string): string {
  return MEDICINE_FORM_PREFIXES[normalizeForm(form)] || '';
}

export function formatMedicineNameWithForm(name?: string, form?: string): string {
  const cleanName = (name || '').trim();
  const prefix = getMedicineFormPrefix(form);
  if (!cleanName || !prefix) return cleanName;

  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`^${escapedPrefix}\\s+`, 'i').test(cleanName)) return cleanName;
  return `${prefix} ${cleanName}`;
}
