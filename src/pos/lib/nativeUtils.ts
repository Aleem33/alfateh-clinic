const SLIP_STYLE = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: white; font-family: monospace; }
  @page { size: 80mm auto; margin: 4mm; }
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
  doc.open();
  doc.write(`<!DOCTYPE html><html><head><style>${SLIP_STYLE}</style></head><body>${slipHtml}</body></html>`);
  doc.close();
  iframe.contentWindow?.focus();
  iframe.contentWindow?.print();
  window.setTimeout(() => iframe.remove(), 2000);
}
