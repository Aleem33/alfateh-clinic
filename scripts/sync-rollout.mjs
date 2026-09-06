// Read-only by default. Only explicit --activate or --rollback changes ONE
// control document. This tool never reads/writes historical business records.
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { activationFields, clientBlockers, decodeFields, operationalClients } from './sync-rollout-policy.mjs';

const args = process.argv.slice(2);
const project = args[args.indexOf('--project') + 1];
if (!args.includes('--project') || !/^[a-z][a-z0-9-]+$/.test(project || '')) throw new Error('Specify --project <firebase-project-id>.');
const activate = args.includes('--activate');
const rollback = args.includes('--rollback');
const excludeIndex = args.indexOf('--exclude-test-devices');
const excludedTestDeviceIds = excludeIndex < 0 ? [] : (args[excludeIndex + 1] || '').split(',').filter(Boolean);
if (excludeIndex >= 0 && (!excludedTestDeviceIds.length || excludedTestDeviceIds.some(id => id.startsWith('--')))) {
  throw new Error('Provide exact comma-separated device IDs after --exclude-test-devices.');
}
if (activate && rollback) throw new Error('Choose activation OR rollback.');
if (!process.env.FIREBASE_TOOLS_PATH) throw new Error('Set FIREBASE_TOOLS_PATH to the installed firebase-tools package directory.');
const require = createRequire(import.meta.url);
const cliAuth = require(resolve(process.env.FIREBASE_TOOLS_PATH, 'lib/auth.js'));
const account = cliAuth.getProjectDefaultAccount(process.cwd());
if (!account) throw new Error('Log in with the Firebase CLI first.');
const token = await cliAuth.getAccessToken(account.tokens.refresh_token, ['https://www.googleapis.com/auth/cloud-platform']);
const database = `projects/${project}/databases/(default)`;
const documentsUrl = `https://firestore.googleapis.com/v1/${database}/documents`;
async function request(url, body) {
  const response = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Sync-control API request failed (${response.status}); no automatic retry of mutations.`);
  return response.json();
}
const controlDoc = await request(`${documentsUrl}/syncControl/current`);
const control = decodeFields(controlDoc.fields);
const clients = [];
let cursor = '';
do {
  const page = await request(`${documentsUrl}/syncClients?pageSize=100${cursor ? `&pageToken=${encodeURIComponent(cursor)}` : ''}`);
  clients.push(...(page.documents || []).map(record => ({ id: record.name.split('/').at(-1), ...decodeFields(record.fields) })));
  cursor = page.nextPageToken || '';
} while (cursor);
const hash = source => createHash('sha256').update(source.replace(/\r\n/g, '\n')).digest('hex');
const localRulesHash = hash(await readFile(new URL('../firestore.rules', import.meta.url), 'utf8'));
const release = await request(`https://firebaserules.googleapis.com/v1/projects/${project}/releases/cloud.firestore`);
const ruleset = await request(`https://firebaserules.googleapis.com/v1/${release.rulesetName}`);
const rulesMatch = (ruleset.source?.files || []).some(file => hash(file.content || '') === localRulesHash);
const blockers = clientBlockers(operationalClients(clients, excludedTestDeviceIds));
console.log(JSON.stringify({ project, incrementalEnabled: control.incrementalEnabled === true,
  trackedWritesRequired: control.trackedWritesRequired === true, datasetGeneration: control.datasetGeneration,
  rulesMatch, rulesHash: localRulesHash, excludedTestDeviceIds,
  clients: clients.map(({ id, devicePrefix, appVersion, protocolVersion, mirrorReady, lastSeenAt }) =>
    ({ id, devicePrefix, appVersion, protocolVersion, mirrorReady, lastSeenAt })), blockers,
}, null, 2));

if (activate || rollback) {
  const values = activate ? activationFields({ control, clients, rulesMatch, excludedTestDeviceIds,
    operatorConfirmed: args.includes('--confirm-all-devices-ready'),
  }) : { incrementalEnabled: false, rollbackToLegacy: true, syncProtocolVersion: 2 };
  const encode = value => typeof value === 'boolean' ? { booleanValue: value }
    : typeof value === 'number' ? { integerValue: String(value) }
      : Array.isArray(value) ? { arrayValue: { values: value.map(encode) } } : { stringValue: String(value) };
  if (activate) values.activationRulesHash = localRulesHash;
  const result = await request(`${documentsUrl}:commit`, { writes: [{
    update: { name: controlDoc.name, fields: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, encode(value)])) },
    updateMask: { fieldPaths: Object.keys(values) },
    currentDocument: { updateTime: controlDoc.updateTime },
    updateTransforms: ['syncUpdatedAt', ...(activate ? ['activationVerifiedAt'] : ['rollbackAt'])]
      .map(fieldPath => ({ fieldPath, setToServerValue: 'REQUEST_TIME' })),
  }] });
  console.log(JSON.stringify({ action: activate ? 'activated' : 'rolled back', commitTime: result.commitTime }));
} else {
  console.log('AUDIT ONLY: no control flags or business documents changed.');
}
