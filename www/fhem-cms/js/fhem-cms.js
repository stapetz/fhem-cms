import '../components/cms-device-card.js';
import '../components/cms-thermostat.js';
import { FhemClient, isValidName } from './fhem-client.js';

const POLL_INTERVAL_MS = 30000;
const REFRESH_DEBOUNCE_MS = 300;
const DEVICE_TYPES = 'TYPE=MAX,TYPE=CUL_HM';

class CmsPage {
  constructor(cmsDevice, shell, card) {
    this.client = new FhemClient(cmsDevice);
    this.card = card;
    this.config = null;
    this.snapshots = new Map();
    this.elements = new Map();
    this.refreshTimer = null;
    this.live = false;
    this.deviceCache = null;
    this.subscribedKey = '';

    this.toolbar = document.createElement('div');
    this.toolbar.className = 'cms-toolbar';
    this.addButton = document.createElement('button');
    this.addButton.type = 'button';
    this.addButton.className = 'cms-button';
    this.addButton.textContent = '+ Thermostat-Kachel';
    this.addButton.addEventListener('click', () => this.addThermostat());
    this.toolbar.append(this.addButton);

    this.grid = document.createElement('section');
    this.grid.className = 'cms-grid';
    this.grid.setAttribute('aria-label', 'Widgets');

    shell.append(this.toolbar, this.grid);
  }

  get page() {
    return this.config.pages[0];
  }

  setStatus(message) {
    this.card.status = message;
  }

  async start() {
    try {
      this.config = await this.client.getConfig();
    } catch (error) {
      this.setStatus(`Konfiguration konnte nicht geladen werden: ${error.message}`);
      this.addButton.disabled = true;
      return;
    }
    this.renderWidgets();
    await this.refresh();
    this.resubscribe();
    window.setInterval(() => this.refresh(), POLL_INTERVAL_MS);
  }

  devices() {
    return [...new Set(this.page.widgets.map((widget) => widget.device).filter(isValidName))];
  }

  services() {
    return {
      listDevices: () => this.listDevices(),
      setTarget: (widget, value, device) => this.client.setReading(device || widget.device, widget.readings.target, value),
      saveWidget: (widget) => this.saveWidget(widget),
      deleteWidget: (id) => this.deleteWidget(id)
    };
  }

  async listDevices() {
    if (!this.deviceCache) {
      this.deviceCache = await this.client.jsonlist(DEVICE_TYPES);
    }
    return this.deviceCache;
  }

  renderWidgets() {
    this.grid.replaceChildren();
    this.elements.clear();
    for (const widget of this.page.widgets) {
      this.grid.append(this.createElementFor(widget));
    }
  }

  createElementFor(widget) {
    let element;
    if (widget.type === 'thermostat') {
      element = document.createElement('cms-thermostat');
      element.services = this.services();
      element.config = widget;
      element.data = this.snapshots.get(widget.device) || null;
    } else {
      element = document.createElement('p');
      element.className = 'cms-unsupported';
      element.textContent = `Widget-Typ „${widget.type}“ wird noch nicht angezeigt.`;
    }
    this.place(element, widget);
    this.elements.set(widget.id, element);
    return element;
  }

  place(element, widget) {
    element.style.gridColumn = `${widget.grid.col} / span ${widget.grid.w}`;
    element.style.gridRow = `${widget.grid.row} / span ${widget.grid.h}`;
  }

  nextFreeRow() {
    return this.page.widgets.reduce((row, widget) => Math.max(row, widget.grid.row + widget.grid.h), 1);
  }

  addThermostat() {
    const existing = new Set(this.page.widgets.map((widget) => widget.id));
    let id = `t${Date.now().toString(36)}`;
    while (existing.has(id)) {
      id += 'x';
    }

    const widget = {
      id,
      type: 'thermostat',
      device: '',
      readings: { actual: '', target: '' },
      grid: { col: 1, row: this.nextFreeRow(), w: 4, h: 2 }
    };
    const element = this.createElementFor(widget);
    element.addEventListener('cms-widget-cancel', () => {
      element.remove();
      this.elements.delete(id);
    }, { once: true });
    this.grid.append(element);
    element.openConfig({ isNew: true });
  }

  async persist(config) {
    await this.client.saveConfig(config);
    this.config = config;
  }

  async saveWidget(widget) {
    const next = structuredClone(this.config);
    const widgets = next.pages[0].widgets;
    const index = widgets.findIndex((item) => item.id === widget.id);
    if (index >= 0) {
      widgets[index] = widget;
    } else {
      widgets.push(widget);
    }

    await this.persist(next);
    const element = this.elements.get(widget.id);
    if (element) {
      element.config = widget;
      element.data = this.snapshots.get(widget.device) || null;
      this.place(element, widget);
    }
    await this.refresh();
    this.resubscribe();
  }

  async deleteWidget(id) {
    const next = structuredClone(this.config);
    next.pages[0].widgets = next.pages[0].widgets.filter((item) => item.id !== id);
    await this.persist(next);
    const element = this.elements.get(id);
    if (element) {
      element.remove();
      this.elements.delete(id);
    }
    this.resubscribe();
  }

  async refresh() {
    const devices = this.devices();
    if (devices.length === 0) {
      this.updateStatus('Keine Widgets konfiguriert');
      return;
    }

    try {
      const specs = devices.flatMap((name) => [name, `device=${name}`]);
      const results = await this.client.jsonlist(specs.join(','));
      this.snapshots = this.groupSnapshots(devices, results);
    } catch (error) {
      this.snapshots = new Map();
      this.updateStatus(`Daten nicht verfügbar: ${error.message}`);
    }

    for (const widget of this.page.widgets) {
      const element = this.elements.get(widget.id);
      if (element && widget.type === 'thermostat') {
        element.data = this.snapshots.get(widget.device) || null;
      }
    }
    if (this.snapshots.size > 0) {
      this.updateStatus();
    }
    this.resubscribe();
  }

  // Je Hauptdevice: [Hauptdevice, Kanäle ...]; die Kachel sucht Readings in dieser Reihenfolge.
  groupSnapshots(mains, results) {
    const byName = new Map(results.map((item) => [item.name, item]));
    const groups = new Map();
    for (const name of mains) {
      const main = byName.get(name);
      if (!main) {
        continue;
      }
      const channels = results
        .filter((item) => item.parent === name)
        .sort((a, b) => a.name.localeCompare(b.name));
      groups.set(name, [main, ...channels]);
    }
    return groups;
  }

  watchedNames() {
    const names = new Set(this.devices());
    for (const group of this.snapshots.values()) {
      for (const item of group) {
        names.add(item.name);
      }
    }
    return [...names].sort();
  }

  updateStatus(message) {
    this.setStatus(message || `Konfiguration geladen · ${this.live ? 'Live-Updates aktiv' : 'Aktualisierung alle 30 s'}`);
  }

  scheduleRefresh() {
    window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => this.refresh(), REFRESH_DEBOUNCE_MS);
  }

  resubscribe() {
    const names = this.watchedNames();
    const key = names.join('|');
    if (key === this.subscribedKey) {
      return;
    }
    this.subscribedKey = key;
    this.client.subscribe(
      names,
      () => this.scheduleRefresh(),
      (state) => {
        this.live = state === 'live';
        this.updateStatus();
      }
    );
  }
}

document.addEventListener('DOMContentLoaded', function () {
  const card = document.querySelector('cms-device-card');
  const shell = document.querySelector('.cms-shell');
  const meta = document.querySelector('meta[name="fhem-cms-device"]');
  const cmsDevice = meta ? meta.content : '';

  if (!card || !shell) {
    return;
  }
  if (!isValidName(cmsDevice)) {
    card.status = 'Ungültiger CMS-Device-Name';
    return;
  }

  card.status = 'Konfiguration wird geladen ...';
  new CmsPage(cmsDevice, shell, card).start();
});
