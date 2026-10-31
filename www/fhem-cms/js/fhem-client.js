const NAME_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/;

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
const BACKUP_NAME = /^config\.json\.\d{8}-\d{6}(?:-\d+)?\.bak$/;

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
    const results = Array.isArray(data.Results) ? data.Results : [];
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
        const owner = item.Internals && typeof item.Internals.device === 'string' ? item.Internals.device : '';
        const parent = isValidName(owner) && owner !== item.Name ? owner : '';
        const sets = typeof item.PossibleSets === 'string' ? item.PossibleSets : '';
        return { name: item.Name, alias, type, room, parent, readings, sets };
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

  async saveDraft(config) {
    const result = await this.command(`set ${this.cmsDevice} draft ${toBase64(JSON.stringify(config))}`);
    if (result) {
      throw new Error(result);
    }
  }

  async hasDraft() {
    const text = await this.command(`get ${this.cmsDevice} status`);
    try {
      return JSON.parse(text).draft === true;
    } catch (error) {
      throw new Error(text || 'Der Entwurfsstatus konnte nicht gelesen werden');
    }
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

  iconUrl(name) {
    return ICON_NAME.test(name)
      ? `${this.endpoint.pathname}/icons/${name.split('/').map(encodeURIComponent).join('/')}`
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

  // Setzt einen Wert oder eine Betriebsart (z. B. controlMode auto), analog zum Thermostat-Dashboard.
  async setCommand(device, command, value) {
    if (!isValidName(device) || !isValidName(command) || !/^[A-Za-z0-9_.+-]{1,32}$/.test(value)) {
      throw new Error('Ungültiger Befehl');
    }
    const result = await this.command(`set ${device} ${command} ${value}`);
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
      subscription.attempt = 0;
      subscription.onState('live');
    });

    socket.addEventListener('message', (event) => {
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
      if (this.subscription !== subscription) {
        return;
      }
      subscription.onState('polling');
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
