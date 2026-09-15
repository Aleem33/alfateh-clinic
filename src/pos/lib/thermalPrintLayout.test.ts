import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('thermal printer safe width', () => {
  it('keeps direct and iframe receipts inside the same conservative print envelope', () => {
    const pageCss = readFileSync(resolve('src/index.css'), 'utf8');
    const iframePrint = readFileSync(resolve('src/pos/lib/nativeUtils.ts'), 'utf8');

    for (const source of [pageCss, iframePrint]) {
      expect(source).toContain('width: 70mm');
      expect(source).toContain('max-width: 70mm');
      expect(source).toContain('padding: 0 2mm 0 0');
      expect(source).toContain('td:last-child');
      expect(source).toContain('padding-right: 1mm');
    }
  });
});
