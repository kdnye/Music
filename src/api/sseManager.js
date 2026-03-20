let connectedClients = new Set();

const systemState = {
  dax88: {},
  stream: {
    title: 'Unknown',
    artist: 'Unknown',
    album: 'Unknown',
    source: 'cache',
    fetchedAt: null
  },
  hardware: {
    up2stream: { offline: false, failures: 0, lastError: null, recoveredAt: null },
    dax88: { offline: false, failures: 0, lastError: null, recoveredAt: null }
  }
};

function addClient(res) {
  connectedClients.add(res);
}

function removeClient(res) {
  connectedClients.delete(res);
}

function broadcastState() {
  const payload = `data: ${JSON.stringify(systemState)}\n\n`;
  for (const client of connectedClients) {
    try {
      client.write(payload);
    } catch (_error) {
      connectedClients.delete(client);
    }
  }
}

function updateDax88State(zoneId, data) {
  systemState.dax88[zoneId] = {
    ...(systemState.dax88[zoneId] || {}),
    ...(data || {})
  };
  broadcastState();
}

function updateAllDax88States(zoneStates = {}) {
  systemState.dax88 = { ...zoneStates };
  broadcastState();
}

function updateStreamState(data) {
  systemState.stream = {
    ...systemState.stream,
    ...(data || {})
  };
  broadcastState();
}

function updateHardwareState(device, healthState = {}) {
  if (!device || !systemState.hardware[device]) {
    return;
  }

  systemState.hardware[device] = {
    ...systemState.hardware[device],
    ...healthState
  };
  broadcastState();
}

function getSystemState() {
  return systemState;
}

module.exports = {
  addClient,
  removeClient,
  broadcastState,
  updateDax88State,
  updateAllDax88States,
  updateStreamState,
  updateHardwareState,
  getSystemState
};
