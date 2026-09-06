export function decodeValue(value) {
  if (!value) return null;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('stringValue' in value) return value.stringValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decodeValue);
  if ('mapValue' in value) return decodeFields(value.mapValue.fields);
  return null;
}

export function decodeFields(fields = {}) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeValue(value)]));
}

export function clientBlockers(clients, now = Date.now()) {
  if (!clients.length) return ['No registered devices were found.'];
  return clients.flatMap(client => {
    const reasons = [];
    const version = /^(\d+)\.(\d+)\.(\d+)$/.exec(client.appVersion || '');
    const supported = version && (Number(version[1]) > 3 || (Number(version[1]) === 3 &&
      (Number(version[2]) > 1 || (Number(version[2]) === 1 && Number(version[3]) >= 90))));
    if (!supported || client.protocolVersion !== 2) reasons.push('unsupported app/protocol');
    if (client.mirrorReady !== true) reasons.push('initial synchronization incomplete');
    const age = now - Date.parse(client.lastSeenAt || '');
    if (!Number.isFinite(age) || age > 24 * 60 * 60 * 1000 || age < -60_000) reasons.push('readiness report is stale or invalid');
    if (client.pendingChanges > 0 || client.syncError) reasons.push('pending or rejected changes');
    return reasons.map(reason => `${client.devicePrefix || client.id}: ${reason}`);
  });
}

export function operationalClients(clients, excludedTestDeviceIds = []) {
  if (excludedTestDeviceIds.some(id => !clients.some(client => client.id === id))) {
    throw new Error('An excluded test-device ID was not found; no ambiguous exclusions are allowed.');
  }
  return clients.filter(client => !excludedTestDeviceIds.includes(client.id));
}

export function activationFields({ control, clients, operatorConfirmed, rulesMatch, excludedTestDeviceIds = [], now = Date.now() }) {
  if (!operatorConfirmed) throw new Error('Explicit confirmation that ALL PCs have uploaded ALL pending entries is required.');
  if (!rulesMatch) throw new Error('Deployed rules do not match the locally tested rules.');
  if (control.resetInProgress === true) throw new Error('An admin reset is in progress.');
  const activeClients = operationalClients(clients, excludedTestDeviceIds);
  const blockers = clientBlockers(activeClients, now);
  if (blockers.length) throw new Error(blockers.join('\n'));
  const generation = control.datasetGeneration;
  if (!Number.isSafeInteger(generation) || generation < 1 || generation >= Number.MAX_SAFE_INTEGER) {
    throw new Error('Invalid dataset generation; administrator review is required.');
  }
  if (control.incrementalEnabled === true && control.rollbackToLegacy !== true) throw new Error('Incremental mode is already enabled.');
  return {
    datasetGeneration: generation + 1,
    protocolVersion: 2, minimumProtocolVersion: 2, rulesEnforcementVersion: 2,
    trackedWritesRequired: true, incrementalEnabled: true, rollbackToLegacy: false,
    confirmedDeviceIds: activeClients.map(client => client.id).sort(),
    excludedTestDeviceIds: [...new Set(excludedTestDeviceIds)].sort(),
    syncProtocolVersion: 2,
  };
}
