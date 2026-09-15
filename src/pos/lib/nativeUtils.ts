const SLIP_STYLE = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  @page { size: 80mm auto; margin: 2mm 4mm 2mm 2mm; }
  html, body { width: 70mm; min-width: 70mm; background: white; }
  body {
    color: #000;
    font-family: "Courier New", monospace;
    font-size: 11px;
    line-height: 1.25;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .thermal-receipt {
    width: 70mm !important;
    max-width: 70mm !important;
    padding: 0 2mm 0 0 !important;
    overflow: visible !important;
    font-weight: 700 !important;
  }
  .thermal-receipt * { font-weight: inherit !important; }
  .thermal-receipt table { width: 100%; table-layout: fixed; border-collapse: collapse; }
  .thermal-receipt th, .thermal-receipt td { overflow-wrap: anywhere; vertical-align: top; }
  .thermal-receipt th:last-child, .thermal-receipt td:last-child { padding-right: 1mm !important; }
  .receipt-policy { font-family: "Noto Nastaliq Urdu", "Noto Naskh Arabic", "Segoe UI", Arial, sans-serif; direction: rtl; unicode-bidi: embed; }
`;

export async function printOrShare(slipHtml: string, _filename = 'slip.html'): Promise<void> {
  iframePrint(slipHtml);
}

export async function printPageOrShare(_pageTitle = 'Receipt'): Promise<void> {
  window.print();
}

export async function downloadOrShare(
  content: string,
  filename: string,
  mimeType = 'text/plain;charset=utf-8;'
): Promise<void> {
  const bom = mimeType.includes('csv') && !content.startsWith('\uFEFF') ? '\uFEFF' : '';
  const blob = new Blob([bom + content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function iframePrint(slipHtml: string) {
  const iframe = document.createElement('iframe');
  Object.assign(iframe.style, {
    position: 'fixed',
    right: '0',
    bottom: '0',
    width: '0',
    height: '0',
    border: '0',
  });
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow?.document;
  if (!doc) {
    iframe.remove();
    return;
  }
  let printed = false;
  const printWhenReady = () => {
    if (printed || !iframe.contentWindow) return;
    printed = true;
    iframe.contentWindow.focus();
    iframe.contentWindow.print();
  };
  iframe.addEventListener('load', () => window.setTimeout(printWhenReady, 100), { once: true });
  doc.open();
  doc.write(`<!DOCTYPE html><html><head><style>${SLIP_STYLE}</style></head><body>${slipHtml}</body></html>`);
  doc.close();
  window.setTimeout(printWhenReady, 250);
  window.setTimeout(() => iframe.remove(), 5000);
}
