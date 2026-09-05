import { createServer } from 'vite';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Run this script inside firebase emulators:exec.');
const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
const projectId = 'demo-alfateh-renderer-smoke';
const environment = await initializeTestEnvironment({ projectId, firestore: {
  host, port: Number(port), rules: await readFile('firestore.rules', 'utf8'),
} });
await environment.clearFirestore();
await environment.withSecurityRulesDisabled(async context => {
  const database = context.firestore();
  await setDoc(doc(database, 'users', 'smoke-admin'), { role: 'admin', active: true });
  await setDoc(doc(database, 'medicines', 'smoke-med'), {
    name: 'Smoke Medicine', category: 'Injection', unitsPerBox: 1, stock: 20,
    costPrice: 60, retailPrice: 100, unitPrice: 100, batchNo: 'SMOKE',
    supplierId: 'smoke-supplier', supplierName: 'Smoke Supplier', expiryDate: '2030-12-31',
  });
  await setDoc(doc(database, 'suppliers', 'smoke-supplier'), { name: 'Smoke Supplier', phone: '', address: '' });
});
const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'isolated-emulator-smoke', enforce: 'pre',
  transform(source, id) {
    if (id.replaceAll('\\', '/').endsWith('/src/pos/lib/nativeUtils.ts')) {
      return source.replace('iframePrint(slipHtml);', 'void slipHtml;');
    }
    if (!id.replaceAll('\\', '/').endsWith('/src/firebase.ts')) return;
    return source.replace("import firebaseConfig from '../firebase-applet-config.json';",
      `import { connectFirestoreEmulator } from 'firebase/firestore';\nconst firebaseConfig = ${JSON.stringify({ apiKey: 'demo-key', projectId, appId: 'demo-app', authDomain: 'localhost' })};`)
      .replace('export const storage = getStorage(app);',
        `connectFirestoreEmulator(db, ${JSON.stringify(host)}, ${Number(port)}, { mockUserToken: { sub: 'smoke-admin' } });\nexport const storage = getStorage(app);`);
  },
}] });
try {
  await server.listen();
  const address = server.httpServer.address();
  const url = `http://127.0.0.1:${address.port}/scripts/renderer-smoke.html`;
  const require = createRequire(import.meta.url);
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(process.env.SMOKE_ELECTRON_PATH || require('electron'), ['scripts/renderer-smoke-electron.cjs', url], { stdio: 'inherit', env, windowsHide: true });
    child.on('error', reject); child.on('exit', resolve);
  });
  if (exitCode !== 0) throw new Error(`Renderer smoke failed (${exitCode}).`);
} finally {
  await server.close();
  await environment.cleanup();
}
