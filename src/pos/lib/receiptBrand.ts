export const PHARMACY_RECEIPT_NAME = 'Sarwar Medical Store';

export const PHARMACY_RETURN_POLICY_URDU = [
  '15 دن کے بعد ادویات تبدیل نہیں کی جائیں گی۔',
  'رسید کے بغیر ادویات تبدیل نہیں کی جائیں گی۔',
  'فریج والی اشیاء واپس یا تبدیل نہیں کی جائیں گی۔',
];

export function receiptPolicyHtml() {
  return `
    <div class="receipt-policy" dir="rtl" style="border-top:1px dashed #000;margin-top:10px;padding-top:7px;text-align:center;font-family:'Noto Nastaliq Urdu','Noto Naskh Arabic','Segoe UI',Arial,sans-serif;font-size:10px;line-height:1.7">
      ${PHARMACY_RETURN_POLICY_URDU.map(line => `<div>${line}</div>`).join('')}
    </div>
  `;
}

