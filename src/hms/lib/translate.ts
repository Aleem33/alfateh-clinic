/**
 * Al-Fateh Clinic — Auto-translate medicine names to Urdu
 * Uses Claude API (key stored in localStorage under 'anthropic_api_key')
 */

const CACHE = new Map<string, string>();

export function getAnthropicKey(): string {
  return localStorage.getItem('anthropic_api_key') || '';
}

export function setAnthropicKey(key: string) {
  localStorage.setItem('anthropic_api_key', key.trim());
}

export async function translateToUrdu(text: string): Promise<string> {
  if (!text.trim()) return '';

  const cacheKey = text.trim().toLowerCase();
  if (CACHE.has(cacheKey)) return CACHE.get(cacheKey)!;

  const key = getAnthropicKey();
  if (!key) return '';

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-client-side-allow-unsafe': 'true',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 60,
        messages: [{
          role: 'user',
          content: `Translate this medicine/drug name or medical instruction to Urdu script only. Return ONLY the Urdu translation, nothing else, no explanation, no romanization, no English.

Text: "${text}"`,
        }],
      }),
    });

    if (!res.ok) return '';
    const data = await res.json();
    const urdu = data.content?.[0]?.text?.trim() || '';
    if (urdu) CACHE.set(cacheKey, urdu);
    return urdu;
  } catch {
    return '';
  }
}

/** Translate multiple strings in parallel */
export async function translateBatch(texts: string[]): Promise<string[]> {
  return Promise.all(texts.map(t => translateToUrdu(t)));
}
