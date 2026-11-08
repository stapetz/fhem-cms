import { BACKUP_NAME, isValidName } from './fhem-client.js';

function requireToken(token) {
  if (typeof token !== 'string' || token.length !== 64 || /[^0-9a-f]/.test(token)) {
    throw new Error('Ungültige Vorschau-Bestätigung');
  }
}

function encodePlan(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    throw new Error('Ungültiger Migrationsplan');
  }
  const bytes = new TextEncoder().encode(JSON.stringify(plan));
  if (bytes.length > 1048576) throw new Error('Migrationsplan ist zu groß');
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export function createMigrationTransport(client) {
  if (!client || !isValidName(client.cmsDevice) || typeof client.command !== 'function'
    || typeof client.previewMigration !== 'function' || typeof client.previewMigrationRestore !== 'function') {
    throw new Error('Gültiger FHEM-Client erforderlich');
  }
  async function commit(action, token, payload) {
    requireToken(token);
    const text = await client.command(`set ${client.cmsDevice} migrationcommit ${action} ${token} ${payload}`);
    if (typeof text !== 'string') throw new Error('Ungültige Antwort auf Migrationsaktion');
    let result;
    try {
      result = JSON.parse(text);
    } catch {
      throw new Error(text || 'Migrationsaktion lieferte keine Bestätigung');
    }
    if (!result || typeof result !== 'object' || Array.isArray(result)
      || typeof result.backup !== 'string' || !BACKUP_NAME.test(result.backup)) {
      throw new Error('Ungültige Bestätigung der Migrationsaktion');
    }
    return result.backup;
  }
  return {
    previewMigration: (positions) => client.previewMigration(positions),
    previewRestore: (name) => client.previewMigrationRestore(name),
    migrate: async (positions, token) => commit('migrate', token, encodePlan(positions)),
    restore: async (name, token) => {
      if (typeof name !== 'string' || !BACKUP_NAME.test(name)) throw new Error('Ungültiger Backup-Name');
      return commit('restore', token, name);
    },
  };
}
