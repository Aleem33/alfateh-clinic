const dgram = require('dgram');
const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');

const DISCOVERY_PORT = 45873;
const MULTICAST_ADDRESS = '239.255.42.99';
const PROTOCOL = 'alfateh-lan-v1';
const HEARTBEAT_MS = 1500;
const LEASE_MS = 5000;
const ELECTION_MS = 900;

function selectLanPrimaryCandidate(candidateIds) {
  return [...new Set(candidateIds)].sort()[0] || null;
}

function deviceName() {
  return os.hostname() || 'Clinic device';
}

function loadDeviceId(userDataPath) {
  const filePath = path.join(userDataPath, 'lan-device.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (parsed && typeof parsed.id === 'string') return parsed.id;
  } catch {
    // Create the installation identity below.
  }

  const id = `device-${crypto.randomUUID()}`;
  try {
    fs.writeFileSync(filePath, JSON.stringify({ id, name: deviceName() }, null, 2));
  } catch {
    // The in-memory ID still protects this running session.
  }
  return id;
}

function loadKnownPeers(userDataPath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(userDataPath, 'lan-known-peers.json'), 'utf8'));
    return new Map((Array.isArray(parsed) ? parsed : []).filter(peer => peer?.deviceId).map(peer => [peer.deviceId, peer]));
  } catch {
    return new Map();
  }
}

function safeActivity(activity) {
  const source = activity && typeof activity === 'object' ? activity : {};
  return {
    id: String(source.id || crypto.randomUUID()),
    action: String(source.action || 'write').slice(0, 40),
    collection: String(source.collection || 'records').slice(0, 80),
    recordId: String(source.recordId || '').slice(0, 160),
    label: String(source.label || '').slice(0, 240),
    summary: String(source.summary || '').slice(0, 500),
    createdAt: String(source.createdAt || new Date().toISOString()),
  };
}

function createLanCoordinator({ userDataPath, sendToRenderer }) {
  const id = loadDeviceId(userDataPath);
  const name = deviceName();
  const peers = new Map();
  const knownPeers = loadKnownPeers(userDataPath);
  const candidates = new Set();
  const acknowledgements = new Set();
  const activities = [];
  let socket = null;
  let online = false;
  let role = 'ready';
  let primary = null;
  let primaryLeaseUntil = 0;
  let heartbeatTimer = null;
  let monitorTimer = null;
  let reachabilityTimer = null;
  let electionPromise = null;

  const rememberPeer = peer => {
    if (knownPeers.has(peer.deviceId)) return;
    knownPeers.set(peer.deviceId, { deviceId: peer.deviceId, deviceName: peer.deviceName, firstSeenAt: new Date().toISOString() });
    try {
      fs.writeFileSync(path.join(userDataPath, 'lan-known-peers.json'), JSON.stringify([...knownPeers.values()], null, 2));
    } catch {
      // Discovery remains available for this session even if persistence fails.
    }
  };

  const currentStatus = () => ({
    deviceId: id,
    deviceName: name,
    online,
    role,
    primary,
    peers: [...peers.values()]
      .filter(peer => Date.now() - peer.lastSeen < 12_000)
      .map(({ lastSeen, ...peer }) => ({ ...peer, lastSeen })),
    activities: activities.slice(0, 50),
  });

  const notify = () => sendToRenderer('lan:status', currentStatus());

  const broadcast = payload => {
    if (!socket) return;
    const packet = Buffer.from(JSON.stringify({ protocol: PROTOCOL, deviceId: id, deviceName: name, ...payload }));
    if (packet.length > 60_000) return;
    socket.send(packet, 0, packet.length, DISCOVERY_PORT, MULTICAST_ADDRESS, () => {});
    socket.send(packet, 0, packet.length, DISCOVERY_PORT, '255.255.255.255', () => {});
  };

  const stopHeartbeat = () => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  };

  const releasePrimary = () => {
    if (role === 'primary') broadcast({ type: 'RELEASE' });
    stopHeartbeat();
    primary = null;
    primaryLeaseUntil = 0;
    role = online ? 'online' : 'ready';
    notify();
  };

  const becomePrimary = () => {
    primary = { deviceId: id, deviceName: name };
    primaryLeaseUntil = Date.now() + LEASE_MS;
    role = 'primary';
    const announce = () => broadcast({ type: 'PRIMARY', leaseUntil: Date.now() + LEASE_MS });
    announce();
    stopHeartbeat();
    heartbeatTimer = setInterval(announce, HEARTBEAT_MS);
    notify();
  };

  const becomeViewer = candidate => {
    stopHeartbeat();
    primary = candidate;
    primaryLeaseUntil = Date.now() + LEASE_MS;
    role = 'viewer';
    notify();
  };

  const receive = message => {
    if (!message || message.protocol !== PROTOCOL || message.deviceId === id) return;
    const peer = {
      deviceId: message.deviceId,
      deviceName: message.deviceName || 'Clinic device',
      role: message.role || (message.type === 'PRIMARY' ? 'primary' : 'connected'),
      lastSeen: Date.now(),
    };
    peers.set(message.deviceId, peer);
    rememberPeer(peer);

    if (message.type === 'HELLO') {
      if (role === 'primary') broadcast({ type: 'PRIMARY', leaseUntil: Date.now() + LEASE_MS });
      notify();
      return;
    }
    if (message.type === 'CLAIM') {
      candidates.add(message.deviceId);
      broadcast({ type: 'ACK', forDevice: message.deviceId, candidateDeviceId: role === 'candidate' ? id : '' });
      if (role === 'primary') broadcast({ type: 'PRIMARY', leaseUntil: Date.now() + LEASE_MS });
      return;
    }
    if (message.type === 'ACK' && message.forDevice === id) {
      acknowledgements.add(message.deviceId);
      if (message.candidateDeviceId) candidates.add(message.candidateDeviceId);
      return;
    }
    if (message.type === 'PRIMARY' && !online) {
      const candidate = { deviceId: message.deviceId, deviceName: message.deviceName || 'Clinic device' };
      primaryLeaseUntil = Number(message.leaseUntil || Date.now() + LEASE_MS);
      if (message.deviceId !== id) becomeViewer(candidate);
      return;
    }
    if (message.type === 'RELEASE' && primary?.deviceId === message.deviceId && !online) {
      primary = null;
      primaryLeaseUntil = 0;
      role = 'ready';
      notify();
      return;
    }
    if (message.type === 'SYNC_COMPLETE' && primary?.deviceId === message.deviceId) {
      primary = null;
      primaryLeaseUntil = 0;
      role = online ? 'online' : 'ready';
      notify();
      return;
    }
    if (message.type === 'ACTIVITY' && !online) {
      const activity = { ...safeActivity(message.activity), deviceName: message.deviceName || 'Clinic device' };
      if (!activities.some(item => item.id === activity.id)) activities.unshift(activity);
      activities.splice(100);
      sendToRenderer('lan:activity', activity);
      notify();
    }
  };

  const start = () => {
    if (socket) return;
    socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    socket.on('error', () => {
      try { socket?.close(); } catch { /* ignore */ }
      socket = null;
      notify();
    });
    socket.on('message', packet => {
      try { receive(JSON.parse(packet.toString('utf8'))); } catch { /* ignore unrelated LAN packets */ }
    });
    socket.bind(DISCOVERY_PORT, '0.0.0.0', () => {
      try {
        socket.setBroadcast(true);
        socket.setMulticastTTL(1);
        socket.setMulticastLoopback(true);
        socket.addMembership(MULTICAST_ADDRESS);
      } catch { /* handled through status */ }
      broadcast({ type: 'HELLO', role });
    });
    monitorTimer = setInterval(() => {
      const now = Date.now();
      for (const [peerId, peer] of peers) if (now - peer.lastSeen > 30_000) peers.delete(peerId);
      if (!online && role === 'viewer' && primaryLeaseUntil < now) {
        primary = null;
        role = 'ready';
        notify();
      }
      broadcast({ type: 'HELLO', role });
    }, 3000);
  };

  const setConnectivity = isOnline => {
    const wasOnline = online;
    online = Boolean(isOnline);
    candidates.clear();
    if (online) {
      stopHeartbeat();
      if (!wasOnline && role === 'primary') {
        role = 'syncing-primary';
        notify();
      } else if (!wasOnline && role === 'viewer') {
        role = 'sync-wait';
        notify();
      } else if (role !== 'syncing-primary' && role !== 'sync-wait') {
        primary = null;
        primaryLeaseUntil = 0;
        role = 'online';
        notify();
      }
    }
    else {
      role = primary && primaryLeaseUntil > Date.now() ? 'viewer' : 'ready';
      broadcast({ type: 'HELLO', role });
      notify();
    }
    return currentStatus();
  };

  const completeCloudSync = () => {
    if (role !== 'syncing-primary') return currentStatus();
    const announceComplete = () => broadcast({ type: 'SYNC_COMPLETE' });
    announceComplete();
    setTimeout(announceComplete, 400);
    setTimeout(announceComplete, 1200);
    primary = null;
    primaryLeaseUntil = 0;
    role = 'online';
    notify();
    return currentStatus();
  };

  const checkCloudReachability = () => new Promise(resolve => {
    const request = https.request({
      method: 'HEAD',
      hostname: 'firestore.googleapis.com',
      path: '/',
      timeout: 3500,
    }, response => {
      response.resume();
      resolve(true);
    });
    request.on('timeout', () => { request.destroy(); resolve(false); });
    request.on('error', () => resolve(false));
    request.end();
  });

  const refreshCloudReachability = async () => {
    const reachable = await checkCloudReachability();
    if (reachable !== online) setConnectivity(reachable);
  };

  const acquireWriteAccess = async () => {
    if (online) return { allowed: true, status: currentStatus() };
    if (role === 'primary') return { allowed: true, status: currentStatus() };
    if (primary && primaryLeaseUntil > Date.now()) {
      becomeViewer(primary);
      return { allowed: false, reason: `${primary.deviceName} is the active offline device.`, status: currentStatus() };
    }
    if (electionPromise) return electionPromise;

    electionPromise = new Promise(resolve => {
      candidates.clear();
      acknowledgements.clear();
      candidates.add(id);
      acknowledgements.add(id);
      role = 'candidate';
      broadcast({ type: 'CLAIM' });
      setTimeout(() => broadcast({ type: 'CLAIM' }), 250);
      setTimeout(() => broadcast({ type: 'CLAIM' }), 500);
      setTimeout(() => {
        if (primary && primaryLeaseUntil > Date.now() && primary.deviceId !== id) {
          becomeViewer(primary);
          resolve({ allowed: false, reason: `${primary.deviceName} is the active offline device.`, status: currentStatus() });
        } else {
          const winner = selectLanPrimaryCandidate(candidates);
          const recentlyKnownPeers = [...knownPeers.keys()];
          const missingAcknowledgement = recentlyKnownPeers.some(peerId => !acknowledgements.has(peerId));
          if (missingAcknowledgement) {
            role = 'ready';
            const missingNames = recentlyKnownPeers
              .filter(peerId => !acknowledgements.has(peerId))
              .map(peerId => knownPeers.get(peerId)?.deviceName || 'clinic device')
              .join(', ');
            notify();
            resolve({ allowed: false, reason: `Offline write access was not granted because ${missingNames} could not confirm the LAN election. Check that all devices are on the same non-guest Wi-Fi.`, status: currentStatus() });
          } else if (winner === id) {
            becomePrimary();
            resolve({ allowed: true, status: currentStatus() });
          } else {
            const peer = peers.get(winner);
            becomeViewer({ deviceId: winner, deviceName: peer?.deviceName || 'Another clinic device' });
            resolve({ allowed: false, reason: `${peer?.deviceName || 'Another clinic device'} became the active offline device.`, status: currentStatus() });
          }
        }
        electionPromise = null;
      }, ELECTION_MS);
    });
    return electionPromise;
  };

  const publishActivity = input => {
    if (online || role !== 'primary') return false;
    const activity = { ...safeActivity(input), deviceName: name };
    if (!activities.some(item => item.id === activity.id)) activities.unshift(activity);
    activities.splice(100);
    broadcast({ type: 'ACTIVITY', activity });
    sendToRenderer('lan:activity', activity);
    notify();
    return true;
  };

  const stop = () => {
    releasePrimary();
    if (monitorTimer) clearInterval(monitorTimer);
    monitorTimer = null;
    if (reachabilityTimer) clearInterval(reachabilityTimer);
    reachabilityTimer = null;
    try { socket?.close(); } catch { /* ignore */ }
    socket = null;
  };

  start();
  const initialReachability = refreshCloudReachability();
  reachabilityTimer = setInterval(refreshCloudReachability, 5000);
  return {
    acquireWriteAccess,
    completeCloudSync,
    currentStatus,
    publishActivity,
    setConnectivity,
    start,
    stop,
    whenConnectivityKnown: () => initialReachability,
  };
}

module.exports = { createLanCoordinator, selectLanPrimaryCandidate };
