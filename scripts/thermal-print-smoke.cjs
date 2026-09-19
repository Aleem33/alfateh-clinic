const { app, BrowserWindow } = require('electron');
const { readFileSync, readdirSync, mkdtempSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const assert = require('node:assert/strict');

app.setPath('userData', mkdtempSync(join(tmpdir(), 'receipt-print-smoke-')));
app.commandLine.appendSwitch('disable-gpu');
app.whenReady().then(async () => {
  try {
    const css = readdirSync('dist/assets').filter(name => name.endsWith('.css'))
      .map(name => readFileSync(join('dist/assets', name), 'utf8')).join('\n');
    const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
    await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`
      <style>${css}</style><div id="root">
      <div class="thermal-receipt hidden print:block"><h2>Sarwar Medicine Store</h2>
      <p>Receipt SALE-TEST-1</p><table><tr><td>Lysovit</td><td>Rs 298</td></tr></table>
      <div>Total: Rs 290</div><p dir="rtl">رسید کے بغیر ادویات تبدیل نہیں کی جائیں گی۔</p></div>
      <div id="toast" class="fixed" style="top:0;left:0;width:300px;height:250px;background:white;z-index:60">Sale recorded successfully</div>
      <div id="dialog" class="fixed" style="inset:0;background:white;z-index:50">Sale details</div></div>`));
    const displays = () => window.webContents.executeJavaScript(`['toast','dialog'].map(id => getComputedStyle(document.getElementById(id)).display)`);
    assert.deepEqual(await displays(), ['block', 'block'], 'Notifications must remain visible on screen');
    window.webContents.debugger.attach('1.3');
    await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { media: 'print' });
    assert.deepEqual(await displays(), ['none', 'none'], 'Print must exclude both toasts and dialogs');
    const receipt = await window.webContents.executeJavaScript(`(() => {
      const node = document.querySelector('.thermal-receipt');
      const box = node.getBoundingClientRect();
      return { display: getComputedStyle(node).display, width: box.width,
        unobscured: node.contains(document.elementFromPoint(box.x + 20, box.y + 10)) };
    })()`);
    assert.equal(receipt.display, 'block');
    assert.ok(receipt.width < 265 && receipt.width > 264, 'Receipt retains the 70mm envelope');
    assert.ok(receipt.unobscured, 'Receipt header must not be covered');
    const pdf = await window.webContents.printToPDF({ pageSize: { width: 3.1496, height: 8 }, printBackground: false });
    assert.ok(pdf.length > 1000);
    console.log('THERMAL_PRINT_SMOKE_PASS: screen overlays visible; print overlays hidden; receipt unobscured; PDF generated');
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
