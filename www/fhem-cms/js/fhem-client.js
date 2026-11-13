import { validateAssetState } from './asset-contract.js';

const NAME_PATTERN = /^[A-Za-z0-9_.-]{1,128}(?![\s\S])/;

export const ICON_NAME = /^(?!.*\.\.)[A-Za-z0-9_][A-Za-z0-9_./-]{0,79}$/;

export function isValidName(value) {
  return typeof value === 'string' && NAME_PATTERN.test(value) && value !== '.' && value !== '..';
}

function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

// Dünner Client für FHEMWEB. Anmeldung, Rechte und CSRF-Schutz bleiben bei FHEMWEB.
export const BACKUP_NAME = /^config\.json\.\d{8}-\d{6}(?:-\d+)?\.bak(?![\s\S])/;
const STATE_TOKEN = /^[0-9a-f]{64}(?![\s\S])/;

export class FhemClient {
  constructor(cmsDevice, baseUrl = new URL('../../', window.location.href)) {
    if (!isValidName(cmsDevice)) {
      throw new Error('Ungültiger CMS-Device-Name');
    }
    this.cmsDevice = cmsDevice;
    this.endpoint = new URL(baseUrl);
    this.endpoint.pathname = this.endpoint.pathname.replace(/\/+$/, '');
    this.endpoint.search = '';
    this.endpoint.hash = '';
    this.csrfToken = '';
    this.socket = null;
    this.reconnectTimer = null;
    this.subscription = null;
  }

  async token() {
    if (!this.csrfToken) {
      const url = new URL(this.endpoint);
      url.searchParams.set('XHR', '1');
      const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
      this.csrfToken = response.headers.get('X-FHEM-csrfToken') || '';
    }
    return this.csrfToken;
  }

  async command(cmd, allowRetry = true) {
    const body = new URLSearchParams({ cmd, XHR: '1' });
    const token = await this.token();
    if (token) {
      body.set('fwcsrf', token);
    }

    const response = await fetch(this.endpoint, {
      method: 'POST',
      body,
      credentials: 'same-origin',
      cache: 'no-store'
    });
    const text = await response.text();

    if (allowRetry && /csrf/i.test(text) && !response.ok) {
      this.csrfToken = '';
      return this.command(cmd, false);
    }
    if (!response.ok) {
      throw new Error(`FHEMWEB antwortete mit HTTP ${response.status}`);
    }
    return text.trim();
  }

  async jsonlist(devspec) {
    const text = await this.command(`jsonlist2 ${devspec}`);
    let data;
    try {
      data = JSON.parse(text);
    } catch (error) {
      throw new Error('FHEM lieferte keine gültigen Gerätedaten');
    }
    if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.Results)) {
      throw new Error('FHEM lieferte eine ungültige Geräteliste');
    }
    const results = data.Results;
    return results
      .filter((item) => item && isValidName(item.Name))
      .map((item) => {
        const readings = {};
        for (const [key, entry] of Object.entries(item.Readings || {})) {
          readings[key] = entry && entry.Value !== undefined ? String(entry.Value) : '';
        }
        const alias = item.Attributes && typeof item.Attributes.alias === 'string'
          ? item.Attributes.alias
          : '';
        const type = item.Internals && typeof item.Internals.TYPE === 'string' ? item.Internals.TYPE : '';
        const attributes = item.Attributes || {};
        const room = typeof attributes.room === 'string' ? attributes.room.split(',')[0].trim() : '';
        const rooms = typeof attributes.room === 'string'
          ? [...new Set(attributes.room.split(',').map((value) => value.trim()).filter(Boolean))]
          : [];
        const owner = item.Internals && typeof item.Internals.device === 'string' ? item.Internals.device : '';
        const parent = isValidName(owner) && owner !== item.Name ? owner : '';
        const sets = typeof item.PossibleSets === 'string' ? item.PossibleSets : '';
        return { name: item.Name, alias, type, room, rooms, parent, readings, sets };
      });
  }

  async getConfig(source = 'config') {
    const text = await this.command(`get ${this.cmsDevice} ${source === 'draft' ? 'draft' : 'config'}`);
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new Error(text || 'Die Konfiguration konnte nicht gelesen werden');
    }
  }

  async getLayoutFormat() {
    const text = await this.command(`get ${this.cmsDevice} layoutformat`);
    const result = await this.parseJsonResult(text, 'Das Layoutformat konnte nicht gelesen werden');
    if (!result || typeof result !== 'object' || Array.isArray(result)
      || (result.schemaVersion !== 4 && result.schemaVersion !== 5)) {
      throw new Error('Unerwartete Antwort für das Layoutformat');
    }
    this.adminMenuEnabled = result.adminMenuEnabled === true;
    return result.schemaVersion;
  }

  async upgradeLayout() {
    const text = await this.command(`set ${this.cmsDevice} layoutupgrade`);
    const result = await this.parseJsonResult(text, 'Die Umstellung wurde nicht bestätigt');
    if (!result || typeof result !== 'object' || Array.isArray(result) || result.schemaVersion !== 5
      || ![result.backup, result.draftBackup].every((name) => name === null
        || (typeof name === 'string' && BACKUP_NAME.test(name)))) {
      throw new Error('Ungültige Bestätigung der Umstellung; Zustand und Sicherungen prüfen');
    }
    await this.getVersion5State();
    return result;
  }

  async getMigrationSource() {
    const text = await this.command(`get ${this.cmsDevice} migrationstate`);
    const source = await this.parseJsonResult(text, 'Die Migrationsquelle konnte nicht gelesen werden');
    if (!source || typeof source !== 'object' || Array.isArray(source)
      || !/^[0-9]{1,6}$/.test(String(source.schemaVersion)) || Number(source.schemaVersion) !== 4
      || !Array.isArray(source.pages)) {
      throw new Error('Unerwartete Antwort für die Migrationsquelle');
    }
    return source;
  }

  async previewMigration(positions) {
    const text = await this.command(
      `get ${this.cmsDevice} migrationpreview ${toBase64(JSON.stringify(positions))}`);
    const result = await this.parseJsonResult(text, 'Die Migrationsvorschau konnte nicht geprüft werden');
    if (!result || typeof result !== 'object' || !result.config || !result.source
      || result.config.schemaVersion !== 5 || Number(result.source.schemaVersion) !== 4
      || typeof result.token !== 'string'
      || !STATE_TOKEN.test(result.token)) {
      throw new Error('Unerwartete Antwort für die Migrationsvorschau');
    }
    return result;
  }

  async getVersion5State() {
    const text = await this.command(`get ${this.cmsDevice} version5state`);
    const state = await this.parseJsonResult(text, 'Der versionierte Zustand konnte nicht gelesen werden');
    const isVersion5 = (config) => config && typeof config === 'object' && !Array.isArray(config)
      && /^[0-9]{1,6}$/.test(String(config.schemaVersion)) && Number(config.schemaVersion) === 5;
    if (!state || typeof state !== 'object' || Array.isArray(state)
      || !isVersion5(state.live) || (state.draft !== null && !isVersion5(state.draft))
      || typeof state.token !== 'string' || !STATE_TOKEN.test(state.token)
      || (state.setupIdentity !== undefined
        && (typeof state.setupIdentity !== 'string' || !STATE_TOKEN.test(state.setupIdentity)))) {
      throw new Error('Unerwartete Antwort für den versionierten Zustand');
    }
    return state;
  }

  async getBlueprints() {
    const text = await this.command(`get ${this.cmsDevice} version5blueprints`);
    const result = await this.parseJsonResult(text, 'Die Widget-Vorlagen konnten nicht gelesen werden');
    if (!result || typeof result !== 'object' || Array.isArray(result)
      || !Array.isArray(result.items) || result.items.length > 100
      || typeof result.token !== 'string' || !STATE_TOKEN.test(result.token)
      || result.items.some((item) => !item || typeof item !== 'object' || Array.isArray(item)
        || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 64
        || !item.widget || typeof item.widget !== 'object' || Array.isArray(item.widget))) {
      throw new Error('FHEM lieferte eine ungültige Vorlagenliste');
    }
    return result;
  }

  async saveBlueprints(items, token) {
    if (!Array.isArray(items) || items.length > 100 || typeof token !== 'string' || !STATE_TOKEN.test(token)) {
      throw new Error('Ungültige Vorlagenänderung');
    }
    const result = await this.parseJsonResult(
      await this.command(`set ${this.cmsDevice} version5blueprints ${token} ${toBase64(JSON.stringify(items))}`),
      'Die Widget-Vorlagen konnten nicht gespeichert werden',
    );
    if (!result || typeof result !== 'object' || Array.isArray(result)
      || typeof result.token !== 'string' || !STATE_TOKEN.test(result.token)) {
      throw new Error('FHEM bestätigte die Vorlagenänderung nicht');
    }
    return result;
  }

  async saveDraft(config) {
    const result = await this.command(`set ${this.cmsDevice} draft ${toBase64(JSON.stringify(config))}`);
    if (result) {
      throw new Error(result);
    }
  }

  async hasDraft() {
    const text = await this.command(`get ${this.cmsDevice} status`);
    const result = await this.parseJsonResult(text, 'Der Entwurfsstatus konnte nicht gelesen werden');
    if (!result || typeof result !== 'object' || Array.isArray(result) || typeof result.draft !== 'boolean') {
      throw new Error('Unerwartete Antwort für den Entwurfsstatus');
    }
    return result.draft;
  }

  async publishDraft() {
    const result = await this.command(`set ${this.cmsDevice} publish`);
    if (result) {
      throw new Error(result);
    }
  }

  async discardDraft() {
    const result = await this.command(`set ${this.cmsDevice} discard`);
    if (result) {
      throw new Error(result);
    }
  }

  async purgeData() {
    const result = await this.command(`set ${this.cmsDevice} purge ${this.cmsDevice}`);
    if (result) {
      throw new Error(result);
    }
  }

  async getBackups() {
    const text = await this.command(`get ${this.cmsDevice} backups`);
    let list;
    try {
      list = JSON.parse(text);
    } catch (error) {
      throw new Error(text || 'Die Backups konnten nicht gelesen werden');
    }
    if (!Array.isArray(list)) {
      throw new Error('Unerwartete Antwort für die Backup-Liste');
    }
    return list.filter((name) => typeof name === 'string' && BACKUP_NAME.test(name));
  }

  async previewMigrationRestore(name) {
    if (typeof name !== 'string' || !BACKUP_NAME.test(name)) {
      throw new Error('Ungültiger Backup-Name');
    }
    const text = await this.command(`get ${this.cmsDevice} migrationrestorepreview ${name}`);
    const result = await this.parseJsonResult(text, 'Die Wiederherstellungsvorschau konnte nicht gelesen werden');
    const isSupported = (config) => config && typeof config === 'object' && !Array.isArray(config)
      && /^[0-9]{1,6}$/.test(String(config.schemaVersion))
      && Number(config.schemaVersion) >= 1 && Number(config.schemaVersion) <= 5;
    if (!result || typeof result !== 'object' || Array.isArray(result)
      || !isSupported(result.live) || !isSupported(result.backup)
      || typeof result.token !== 'string' || !STATE_TOKEN.test(result.token)) {
      throw new Error('Unerwartete Antwort für die Wiederherstellungsvorschau');
    }
    return result;
  }

  async getMigrationBackups() {
    const text = await this.command(`get ${this.cmsDevice} migrationbackups`);
    const list = await this.parseJsonResult(text, 'Die Backup-Liste konnte nicht gelesen werden');
    if (!Array.isArray(list) || list.some((name) => typeof name !== 'string' || !BACKUP_NAME.test(name))) {
      throw new Error('Unerwartete Antwort für die Backup-Liste');
    }
    return list;
  }

  async restoreBackup(name) {
    if (!BACKUP_NAME.test(name)) {
      throw new Error('Ungültiger Backup-Name');
    }
    const result = await this.command(`set ${this.cmsDevice} restore ${name}`);
    if (result) {
      throw new Error(result);
    }
  }

  async listIcons() {
    const text = await this.command(`get ${this.cmsDevice} icons`);
    let list;
    try {
      list = JSON.parse(text);
    } catch (error) {
      throw new Error(text || 'Die Icons konnten nicht gelesen werden');
    }
    return Array.isArray(list) ? list.filter((name) => ICON_NAME.test(name)) : [];
  }

  async parseJsonResult(text, fallback) {
    let result;
    try {
      result = JSON.parse(text);
    } catch (error) {
      throw new Error(text || fallback);
    }
    return result;
  }

  async logReadings(device, source = 'auto') {
    if (!isValidName(device) || !/^(?:auto|dblog|filelog)$/.test(source)) {
      throw new Error('Ungültiges Device');
    }
    const command = `get ${this.cmsDevice} logreadings ${device} ${source}`;
    const deadline = Date.now() + 25000;
    let result;
    while (true) {
      result = await this.parseJsonResult(await this.command(command),
        'Die geloggten Readings konnten nicht gelesen werden');
      if (result?.status !== 'pending') break;
      if (Date.now() >= deadline) {
        throw new Error('Zeitüberschreitung beim Ermitteln der geloggten Readings');
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (result?.status === 'error') {
      throw new Error(result.message || 'Die geloggten Readings konnten nicht gelesen werden');
    }
    if (!result || typeof result !== 'object' || Array.isArray(result)
      || !/^(?:dblog|filelog)$/.test(result.source) || !Array.isArray(result.readings)) {
      throw new Error('FHEM lieferte eine ungültige Reading-Liste');
    }
    return {
      source: result.source,
      readings: result.readings.filter(isValidName)
    };
  }

  async history(device, reading, range = '24h', granularity = 'auto', source = 'auto') {
    if (!isValidName(device) || !isValidName(reading) || !/^(?:24h|7d|30d|365d)$/.test(range)
      || !/^(?:auto|raw|15m|1h|1d)$/.test(granularity) || !/^(?:auto|dblog|filelog)$/.test(source)) {
      throw new Error('Ungültige Verlaufsabfrage');
    }
    const command = `get ${this.cmsDevice} history ${device} ${reading} ${range} ${granularity} ${source}`;
    const deadline = Date.now() + 25000;
    while (true) {
      const result = await this.parseJsonResult(await this.command(command), 'Der Verlauf konnte nicht gelesen werden');
      if (result?.status !== 'pending') {
        if (result?.status === 'error') {
          throw new Error(result.message || 'Der Verlauf konnte nicht geladen werden');
        }
        const points = Array.isArray(result?.points)
          ? result.points.filter((p) => Array.isArray(p) && p.length >= 2
            && p.slice(0, 4).every((n) => typeof n === 'number' && Number.isFinite(n)))
          : [];
        return { ...result, points };
      }
      if (Date.now() >= deadline) {
        throw new Error('Zeitüberschreitung beim Laden des Verlaufs');
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  iconUrl(name) {
    return ICON_NAME.test(name)
      ? `${this.endpoint.pathname.replace(/\/+$/, '')}/icons/${name.split('/').map(encodeURIComponent).join('/')}`
      : '';
  }

  async listMedia() {
    const text = await this.command(`get ${this.cmsDevice} media`);
    let list;
    try {
      list = JSON.parse(text);
    } catch (error) {
      throw new Error(text || 'Die Bilder konnten nicht gelesen werden');
    }
    return Array.isArray(list)
      ? list.filter((name) => typeof name === 'string' && /^[0-9a-f]{32}\.(png|jpg|gif)$/.test(name)).map((name) => `media/${name}`)
      : [];
  }

  async assetAction(request) {
    const text = request.op === 'list'
      ? await this.command(`get ${this.cmsDevice} assets`)
      : await this.command(`set ${this.cmsDevice} assets ${toBase64(JSON.stringify(request))}`);
    const result = await this.parseJsonResult(text, 'Asset-Aktion lieferte keine gültige Antwort');
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Ungültige Assetantwort');
    if (result.error) {
      const error = new Error(result.error);
      error.usage = result.usage;
      throw error;
    }
    if (request.op === 'list') validateAssetState(result);
    if (result.state) validateAssetState(result.state);
    return result;
  }

  async uploadAsset(file, folder, token, { signal, onProgress = () => {}, variantOf } = {}) {
    const started = await this.assetAction({ op: 'begin', token, folder, name: file.name, size: file.size,
      ...(variantOf === undefined ? {} : { variantOf }) });
    if (!/^[0-9a-f]{32}$/.test(started.upload) || started.chunkBytes !== 65536) throw new Error('Ungültige Uploadantwort');
    let finished = false;
    try {
      for (let offset = 0; offset < file.size; offset += started.chunkBytes) {
        if (signal?.aborted) throw new Error('Upload abgebrochen');
        const bytes = new Uint8Array(await file.slice(offset, offset + started.chunkBytes).arrayBuffer());
        let binary = '';
        for (let index = 0; index < bytes.length; index += 0x8000) {
          binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
        }
        const reply = await this.assetAction({ op: 'chunk', upload: started.upload, offset, data: btoa(binary) });
        if (reply.received !== offset + bytes.length) throw new Error('Uploadblock wurde nicht bestätigt');
        onProgress(reply.received, file.size);
      }
      if (signal?.aborted) throw new Error('Upload abgebrochen');
      const reply = await this.assetAction({ op: 'finish', token, upload: started.upload });
      if (!reply.state || typeof reply.selected !== 'string') throw new Error('Upload wurde nicht bestätigt');
      finished = true;
      return reply;
    } catch (error) {
      if (!finished) {
        try { await this.assetAction({ op: 'cancel', upload: started.upload }); }
        catch (cleanupError) { throw new Error(`${error.message}; Uploadbereinigung: ${cleanupError.message}`); }
      }
      throw error;
    }
  }

  async uploadMagicBackground() {
    const response = await fetch(new URL('../images/parachute.jpg', import.meta.url),
      { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`Magic-Hintergrund: HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 3 * 1024 * 1024) throw new Error('Ungültige Größe des Magic-Hintergrundbilds');
    return this.uploadMedia(bytes);
  }

  async uploadMedia(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    const result = await this.command(`set ${this.cmsDevice} media ${btoa(binary)}`);
    if (!/^media\/[0-9a-f]{32}\.(png|jpg|gif)$/.test(result)) {
      throw new Error(result || 'Der Bild-Upload ist fehlgeschlagen');
    }
    return result;
  }

  async setReading(device, command, value) {
    if (!isValidName(device) || !isValidName(command) || !/^-?[0-9]{1,3}(\.[0-9])?$/.test(value)) {
      throw new Error('Ungültiger Sollwert');
    }
    const result = await this.command(`set ${device} ${command} ${value}`);
    if (result) {
      throw new Error(result);
    }
  }

  // Setzt einen Wert oder eine Betriebsart (z. B. controlMode auto) oder sendet einen Befehl ohne Wert (z. B. on), analog zum Thermostat-Dashboard.
  async setCommand(device, command, value) {
    const hasValue = value !== undefined && value !== null && value !== '';
    if (!isValidName(device) || !isValidName(command) || (hasValue && !/^[A-Za-z0-9_.+-]{1,32}$/.test(value))) {
      throw new Error('Ungültiger Befehl');
    }
    const result = await this.command(hasValue ? `set ${device} ${command} ${value}` : `set ${device} ${command}`);
    if (result) {
      throw new Error(result);
    }
  }

  // Live-Hinweise per WebSocket; die Werte selbst werden anschließend neu gelesen.
  subscribe(devices, onEvent, onState) {
    this.unsubscribe();
    const names = new Set(devices.filter(isValidName));
    if (names.size === 0 || !('WebSocket' in window)) {
      onState('polling');
      return;
    }

    this.subscription = { names, onEvent, onState, attempt: 0 };
    this.connect();
  }

  connect() {
    const subscription = this.subscription;
    if (!subscription) {
      return;
    }

    const url = new URL(this.endpoint);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.search = new URLSearchParams({
      XHR: '1',
      inform: `type=status;filter=NAME=${[...subscription.names].join('|')};fmt=JSON`,
      fw_id: `cms-${Math.random().toString(36).slice(2, 10)}`,
      timestamp: String(Date.now())
    }).toString();

    let socket;
    try {
      socket = new WebSocket(url);
    } catch (error) {
      subscription.onState('polling');
      return;
    }
    this.socket = socket;

    socket.addEventListener('open', () => {
      if (this.subscription !== subscription || this.socket !== socket) return;
      subscription.attempt = 0;
      subscription.onState('live');
    });

    socket.addEventListener('message', (event) => {
      if (this.subscription !== subscription || this.socket !== socket) return;
      for (const line of String(event.data).split('\n')) {
        if (!line) {
          continue;
        }
        let data;
        try {
          data = JSON.parse(line);
        } catch (error) {
          continue;
        }
        if (Array.isArray(data) && typeof data[0] === 'string' && subscription.names.has(data[0])) {
          subscription.onEvent(data[0]);
        }
      }
    });

    socket.addEventListener('close', () => {
      if (this.subscription !== subscription || this.socket !== socket) {
        return;
      }
      this.socket = null;
      subscription.onState('polling');
      if (this.subscription !== subscription) return;
      const delay = Math.min(30000, 1000 * 2 ** subscription.attempt);
      subscription.attempt += 1;
      this.reconnectTimer = window.setTimeout(() => this.connect(), delay);
    });
  }

  unsubscribe() {
    this.subscription = null;
    window.clearTimeout(this.reconnectTimer);
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }
}
