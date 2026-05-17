/**
 * Al-Fateh Clinic - Gemini Urdu transliteration helpers.
 * The Gemini API key is saved locally on this device only.
 */

const CACHE = new Map<string, string>();
const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_KEY_STORAGE = 'gemini_api_key';

function cleanUrdu(value: string): string {
  return value
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseJsonArray(text: string): string[] {
  const trimmed = text.trim();
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed.map(v => cleanUrdu(String(v || ''))) : [];
  } catch {
    const match = trimmed.match(/\[[\s\S]*\]/);
    if (!match) return [];
    try {
      const parsed = JSON.parse(match[0]);
      return Array.isArray(parsed) ? parsed.map(v => cleanUrdu(String(v || ''))) : [];
    } catch {
      return [];
    }
  }
}

export function getGeminiKey(): string {
  return localStorage.getItem(GEMINI_KEY_STORAGE) || '';
}

export function setGeminiKey(key: string) {
  localStorage.setItem(GEMINI_KEY_STORAGE, key.trim());
}

export async function transliterateMedicineNamesToUrdu(names: string[]): Promise<string[]> {
  const normalized = names.map(name => name.trim());
  const results = normalized.map(name => CACHE.get(name.toLowerCase()) || '');
  const missing = normalized
    .map((name, index) => ({ name, index }))
    .filter(item => item.name && !results[item.index]);

  const key = getGeminiKey();
  if (!key || missing.length === 0) return results;

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': key,
      },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [{
            text: `Transliterate these medicine or drug brand names into Urdu script.
Do not translate meaning. Preserve brand pronunciation as Urdu phonetics.
Return only a JSON array of strings in the same order, with no explanation.

Names:
${JSON.stringify(missing.map(item => item.name))}`,
          }],
        }],
        generationConfig: {
          temperature: 0,
          responseMimeType: 'application/json',
        },
      }),
    });

    if (!res.ok) return results;
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.map((part: any) => part.text || '').join('').trim() || '';
    const urduValues = parseJsonArray(text);

    missing.forEach((item, missingIndex) => {
      const urdu = cleanUrdu(urduValues[missingIndex] || '');
      if (!urdu) return;
      CACHE.set(item.name.toLowerCase(), urdu);
      results[item.index] = urdu;
    });
  } catch {
    return results;
  }

  return results;
}

export async function transliteratePrescriptionMedicineNames<T extends { name?: string; nameUrdu?: string } = any>(prescriptions: T[]): Promise<T[]> {
  const missing = prescriptions
    .map((rx, index) => ({ rx, index }))
    .filter(item => item.rx.name?.trim() && !item.rx.nameUrdu?.trim());

  if (!getGeminiKey() || missing.length === 0) return prescriptions;

  const urduNames = await transliterateMedicineNamesToUrdu(missing.map(item => item.rx.name || ''));
  return prescriptions.map((rx, index) => {
    const missingIndex = missing.findIndex(item => item.index === index);
    if (missingIndex === -1 || !urduNames[missingIndex]) return rx;
    return { ...rx, nameUrdu: urduNames[missingIndex] };
  });
}
