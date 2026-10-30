import { spawnSync } from 'node:child_process';
if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Run within firebase emulators:exec.');
for (const role of ['admin', 'cashier', 'pharmacist', 'doctor', 'nurse', 'receptionist', 'accountant', 'lab', 'lab_technician']) {
  const result = spawnSync(process.execPath, ['scripts/renderer-smoke.mjs', '--incremental', `--role=${role}`, '--role-audit'], {
    stdio: 'inherit', env: process.env, windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Role ${role} UI audit failed (${result.status})`);
}
console.log('ROLE_MATRIX_SMOKE_PASS: all supported roles, online and offline');
