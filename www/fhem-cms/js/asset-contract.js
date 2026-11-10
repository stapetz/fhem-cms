export const ASSET_IMAGE = /^media\/[0-9a-f]{32}\.(?:png|jpg|gif)$/;
export const ASSET_DOCUMENT = /^\.\.\/\.\.\/fhemcms-assets\/[A-Za-z0-9_.-]{1,128}\/[0-9a-f]{32}$/;
export const ASSET_BLOCKED = /^(?:html?|xhtml|svgz?|xml|js|mjs|cjs|jsx|ts|tsx|css|php\d*|phtml|pl|pm|py|rb|sh|bash|zsh|bat|cmd|ps1|exe|dll|com|msi|jar|wasm|vbs|vbe|wsf|hta|lnk|url|swf|shtml|cgi|asp|aspx|jsp|docm|xlsm|pptm)$/;
const ID = /^[0-9a-f]{32}$/;

export function validateAssetState(state) {
  if (!state || typeof state !== 'object' || !/^[0-9a-f]{64}$/.test(state.token)
    || !Array.isArray(state.folders) || state.folders.length > 200
    || !Array.isArray(state.assets) || state.assets.length > 2000
    || !state.policy || !state.policy.types || typeof state.policy.types !== 'object'
    || Array.isArray(state.policy.types) || Object.entries(state.policy.types).some(([type, enabled]) =>
      !/^[a-z][a-z0-9]{0,9}$/.test(type) || typeof enabled !== 'boolean')) {
    throw new Error('Ungültiger Assetkatalog');
  }
  for (const key of ['imageBytes', 'documentBytes', 'totalBytes']) {
    if (!Number.isSafeInteger(state.policy[key]) || state.policy[key] < 1
      || state.policy[key] > (key === 'totalBytes' ? 2147483648 : 52428800)) {
      throw new Error('Ungültige Asset-Speichergrenze');
    }
  }
  const folders = new Set(['root']);
  for (const folder of state.folders) {
    if (!folder || !ID.test(folder.id) || folders.has(folder.id) || typeof folder.name !== 'string'
      || typeof folder.parent !== 'string') throw new Error('Ungültiger Assetordner');
    folders.add(folder.id);
  }
  const parents = new Map(state.folders.map(folder => [folder.id, folder.parent]));
  for (const folder of state.folders) {
    let id = folder.id;
    let depth = 0;
    while (id !== 'root') {
      if (++depth > 10 || !folders.has(id)) throw new Error('Ungültiger Assetordnerbaum');
      id = parents.get(id);
    }
  }
  const ids = new Set();
  for (const asset of state.assets) {
    if (!asset || !ID.test(asset.id) || ids.has(asset.id) || !folders.has(asset.folder)
      || typeof asset.name !== 'string' || typeof asset.image !== 'boolean'
      || !Number.isSafeInteger(asset.bytes) || asset.bytes < 0
      || typeof asset.href !== 'string' || !(asset.image ? ASSET_IMAGE : ASSET_DOCUMENT).test(asset.href)) {
      throw new Error('Ungültiger Asseteintrag');
    }
    ids.add(asset.id);
  }
  if (!Number.isSafeInteger(state.totalBytes) || state.totalBytes !== state.assets.reduce((sum, asset) => sum + asset.bytes, 0)) {
    throw new Error('Ungültige Asset-Speichersumme');
  }
  return state;
}
