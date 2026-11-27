export function createPreviewServices(client) {
  if (!client || typeof client.iconUrl !== 'function' || typeof client.history !== 'function') {
    throw new Error('Lesende Vorschau-Dienste sind nicht verfügbar');
  }
  const denyWrite = () => { throw new Error('Aktionen sind in dieser Vorschau deaktiviert'); };
  return Object.freeze({
    iconUrl: (name) => client.iconUrl(name),
    history: (...args) => client.history(...args),
    systemMonitorDevices: () => {
      if (typeof client.jsonlist !== 'function') throw new Error('Systemmonitor-Vorschau ist nicht verfügbar');
      return client.jsonlist('TYPE=SYSMON,TYPE=DbLog,TYPE=FileLog');
    },
    systemLogSizes: () => client.systemLogSizes(),
    logReadings: (...args) => client.logReadings(...args),
    setCommand: denyWrite,
    setTarget: denyWrite,
  });
}
