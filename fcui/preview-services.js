export function createPreviewServices(client) {
  if (!client || typeof client.iconUrl !== 'function' || typeof client.history !== 'function') {
    throw new Error('Lesende Vorschau-Dienste sind nicht verfügbar');
  }
  const denyWrite = () => { throw new Error('Aktionen sind in dieser Vorschau deaktiviert'); };
  return Object.freeze({
    iconUrl: (name) => client.iconUrl(name),
    history: (...args) => client.history(...args),
    setCommand: denyWrite,
    setTarget: denyWrite,
  });
}
