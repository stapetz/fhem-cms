function encodeJson(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  if (bytes.length > 1048576) throw new Error('Konfiguration ist zu groß');
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function requireToken(token) {
  if (typeof token !== 'string' || token.length !== 64 || /[^0-9a-f]/.test(token)) {
    throw new Error('Ungültige Zustandskennung');
  }
}

export function createSchema5Transport(client) {
  if (!client || typeof client.getVersion5State !== 'function'
    || typeof client.command !== 'function'
    || typeof client.cmsDevice !== 'string' || client.cmsDevice.length < 1 || client.cmsDevice.length > 128
    || /[^A-Za-z0-9_.-]/.test(client.cmsDevice)
    || client.cmsDevice === '.' || client.cmsDevice === '..') {
    throw new Error('Gültiger FHEM-Client erforderlich');
  }
  async function change(action, token, config) {
    requireToken(token);
    let payload = '';
    if (action === 'save') {
      if (!config || typeof config !== 'object' || Array.isArray(config)) {
        throw new Error('Ungültige Konfiguration');
      }
      payload = ` ${encodeJson(config)}`;
    }
    const result = await client.command(`set ${client.cmsDevice} version5draft ${action} ${token}${payload}`);
    if (typeof result !== 'string') throw new Error('Ungültige Antwort auf Entwurfsaktion');
    if (result !== '') throw new Error(result);
  }
  return {
    read: () => client.getVersion5State(),
    save: (config, token) => change('save', token, config),
    publish: (token) => change('publish', token),
    discard: (token) => change('discard', token),
  };
}
