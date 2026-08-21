import { describe, expect, it } from 'vitest';
import { PHARMACY_RECEIPT_NAME, PHARMACY_RETURN_POLICY_URDU, receiptPolicyHtml } from './receiptBrand';

describe('pharmacy receipt branding', () => {
  it('uses the requested store name and all three Urdu policy lines', () => {
    expect(PHARMACY_RECEIPT_NAME).toBe('Sarwar Medical Store');
    expect(PHARMACY_RETURN_POLICY_URDU).toHaveLength(3);
    const html = receiptPolicyHtml();
    PHARMACY_RETURN_POLICY_URDU.forEach(line => expect(html).toContain(line));
    expect(html).toContain('dir="rtl"');
  });
});

