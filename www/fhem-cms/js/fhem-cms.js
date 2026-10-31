import '../components/cms-device-card.js';
import '../components/cms-thermostat.js';
import '../components/cms-text.js';
import { FhemClient, isValidName } from './fhem-client.js';
import { cellFromPoint, moveWidget } from './layout.js';

const POLL_INTERVAL_MS = 30000;
const REFRESH_DEBOUNCE_MS = 300;
const DEVICE_TYPES = 'TYPE=MAX,TYPE=CUL_HM';

// ?mode=view zeigt nur die fertige Seite ohne Bearbeitungsknöpfe. Das ist keine Zugriffssperre.
const VIEW_MODE = new URLSearchParams(window.location.search).get('mode') === 'view';

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
    this.lastSuccess = null;
    this.pollTimer = null;
    this.stopped = false;

    this.pageId = null;
    this.loadToken = 0;

    this.nav = document.createElement('nav');
    this.nav.className = 'cms-nav';
    this.nav.setAttribute('aria-label', 'Seiten');

    this.toolbar = document.createElement('div');
    this.toolbar.className = 'cms-toolbar';
    this.pageButtons = [
      this.button('+ Seite', () => this.addPage()),
      this.button('Seite umbenennen', () => this.renamePage()),
      this.button('Seite löschen', () => this.deletePage()),
      this.button('Backups', () => this.showBackups()),
      this.button('Layout ändern', () => this.toggleLayout())
    ];
    this.layoutButton = this.pageButtons[4];
    this.layoutButton.classList.add('cms-layout-toggle');
    this.layoutButton.setAttribute('aria-pressed', 'false');
    this.layoutMode = false;
    this.overlays = new Map();
    this.layoutTimer = null;
    this.layoutSaving = Promise.resolve();

    this.menu = document.createElement('details');
    this.menu.className = 'cms-menu';
    const summary = document.createElement('summary');
    summary.className = 'cms-button';
    summary.textContent = '+ Widget';
    const items = document.createElement('div');
    items.className = 'cms-menu-items';
    items.setAttribute('role', 'group');
    items.setAttribute('aria-label', 'Widget-Typ');
    this.menuButtons = [
      this.button('Thermostat-Kachel', () => this.addWidget('thermostat')),
      this.button('Textbaustein', () => this.addWidget('text'))
    ];
    items.append(...this.menuButtons);
    this.menu.append(summary, items);
    this.toolbar.append(...this.pageButtons, this.menu);

    this.grid = document.createElement('section');
    this.grid.className = 'cms-grid';
    this.grid.setAttribute('aria-label', 'Widgets');
    this.grid.setAttribute('aria-live', 'polite');

    shell.append(this.nav, this.toolbar, this.grid);
  }

  button(label, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cms-button';
    button.textContent = label;
    button.addEventListener('click', () => {
      this.menu.open = false;
      onClick();
    });
    return button;
  }

  get page() {
    return this.config.pages.find((page) => page.id === this.pageId) || this.config.pages[0];
  }

  get pageIndex() {
    return this.config.pages.indexOf(this.page);
  }

  setControlsDisabled(disabled) {
    for (const button of [...this.pageButtons, ...this.menuButtons]) {
      button.disabled = disabled;
    }
    this.menu.classList.toggle('is-disabled', disabled);
  }

  setStatus(message) {
    this.card.status = message;
  }

  async start() {
    try {
      this.config = await this.client.getConfig();
    } catch (error) {
      this.card.setAttribute('data-error', '');
      this.setStatus(`Konfiguration konnte nicht geladen werden: ${error.message}`);
      this.setControlsDisabled(true);
      return;
    }
    window.addEventListener('hashchange', () => this.showPage(this.pageFromHash()));
    window.addEventListener('online', () => this.refresh());
    window.addEventListener('offline', () => this.markStale('Offline'));
    window.addEventListener('pagehide', () => this.stop());
    window.addEventListener('pageshow', (event) => {
      if (event.persisted) {
        this.startPolling();
        this.refresh();
      }
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        this.refresh();
      }
    });
    this.startPolling();
    await this.showPage(this.pageFromHash());
  }

  // Beendet Timer und Abonnements, damit nach dem Verlassen der Seite nichts weiterläuft.
  startPolling() {
    window.clearInterval(this.pollTimer);
    this.stopped = false;
    this.pollTimer = window.setInterval(() => {
      if (!document.hidden) {
        this.refresh();
      }
    }, POLL_INTERVAL_MS);
  }

  stop() {
    this.stopped = true;
    window.clearInterval(this.pollTimer);
    window.clearTimeout(this.refreshTimer);
    this.client.unsubscribe();
    this.subscribedKey = '';
  }

  pageFromHash() {
    const match = /^#\/([A-Za-z0-9_-]{1,64})$/.exec(window.location.hash);
    return match && this.config.pages.some((page) => page.id === match[1]) ? match[1] : this.config.pages[0].id;
  }

  async showPage(id) {
    this.flushLayout();
    this.pageId = id;
    this.loadToken += 1;
    this.snapshots = new Map();
    this.lastSuccess = null;
    this.renderNav();
    this.renderWidgets();
    this.subscribedKey = '';
    this.live = false;
    this.client.subscribe([], () => {}, () => {});
    this.setStatus('Seite wird geladen ...');
    await this.refresh();
    this.resubscribe();
  }

  renderNav() {
    this.nav.replaceChildren();
    for (const page of this.config.pages) {
      const link = document.createElement('a');
      link.className = 'cms-nav-link';
      link.href = `#/${page.id}`;
      link.textContent = page.title;
      if (page.id === this.page.id) {
        link.setAttribute('aria-current', 'page');
      }
      this.nav.append(link);
    }
    this.pageButtons[2].disabled = this.config.pages.length < 2;
  }

  uniqueId(prefix, existing) {
    let id = `${prefix}${Date.now().toString(36)}`;
    while (existing.has(id)) {
      id += 'x';
    }
    return id;
  }

  askTitle(message, initial) {
    return new Promise((resolve) => {
      const dialog = document.createElement('dialog');
      dialog.className = 'cms-dialog';
      dialog.setAttribute('aria-label', message);
      const form = document.createElement('form');
      form.method = 'dialog';
      const label = document.createElement('label');
      label.textContent = message;
      const input = document.createElement('input');
      input.maxLength = 64;
      input.value = initial;
      input.autocomplete = 'off';
      label.append(input);
      const error = document.createElement('p');
      error.className = 'cms-dialog-error';
      error.setAttribute('role', 'alert');
      const actions = document.createElement('div');
      actions.className = 'cms-dialog-actions';
      let done = false;
      const finish = (value) => {
        if (done) {
          return;
        }
        done = true;
        if (dialog.open) {
          dialog.close();
        }
        dialog.remove();
        resolve(value);
      };
      const cancel = this.button('Abbrechen', () => finish(null));
      const ok = document.createElement('button');
      ok.type = 'submit';
      ok.className = 'cms-button';
      ok.textContent = 'OK';
      actions.append(cancel, ok);
      form.append(label, error, actions);
      dialog.append(form);

      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const title = input.value.trim();
        if (title.length < 1 || title.length > 64 || /[\u0000-\u001f\u007f]/.test(title)) {
          error.textContent = 'Der Titel muss 1 bis 64 Zeichen ohne Steuerzeichen lang sein';
          return;
        }
        finish(title);
      });
      dialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        finish(null);
      });
      document.body.append(dialog);
      dialog.showModal();
      input.select();
    });
  }

  formatBackup(name) {
    const m = /\.(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/.exec(name);
    return m ? `${m[3]}.${m[2]}.${m[1]} ${m[4]}:${m[5]}:${m[6]}` : name;
  }

  async showBackups() {
    const dialog = document.createElement('dialog');
    dialog.className = 'cms-dialog';
    dialog.setAttribute('aria-label', 'Backups wiederherstellen');
    const form = document.createElement('form');
    form.method = 'dialog';
    const heading = document.createElement('p');
    heading.textContent = 'Backup wiederherstellen';
    const list = document.createElement('div');
    list.className = 'cms-backup-list';
    list.setAttribute('role', 'group');
    list.setAttribute('aria-label', 'Verfügbare Backups');
    const error = document.createElement('p');
    error.className = 'cms-dialog-error';
    error.setAttribute('role', 'alert');
    const actions = document.createElement('div');
    actions.className = 'cms-dialog-actions';
    const close = () => {
      if (dialog.open) {
        dialog.close();
      }
      dialog.remove();
    };
    actions.append(this.button('Schließen', close));
    form.append(heading, list, error, actions);
    dialog.append(form);
    form.addEventListener('submit', (event) => event.preventDefault());
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      close();
    });
    document.body.append(dialog);
    dialog.showModal();

    let names;
    try {
      names = await this.client.getBackups();
    } catch (failure) {
      error.textContent = `Backups konnten nicht geladen werden: ${failure.message}`;
      return;
    }
    if (names.length === 0) {
      list.textContent = 'Es gibt noch keine Backups.';
      return;
    }
    for (const name of [...names].sort().reverse()) {
      const label = this.formatBackup(name);
      list.append(this.button(label, async () => {
        if (!window.confirm(`Konfiguration vom ${label} wiederherstellen? Der aktuelle Stand wird zuvor gesichert.`)) {
          return;
        }
        try {
          await this.client.restoreBackup(name);
          this.config = await this.client.getConfig();
        } catch (failure) {
          error.textContent = `Wiederherstellen fehlgeschlagen: ${failure.message}`;
          return;
        }
        close();
        const target = this.config.pages.some((page) => page.id === this.pageId)
          ? this.pageId
          : this.config.pages[0].id;
        if (window.location.hash === `#/${target}`) {
          await this.showPage(target);
        } else {
          window.location.hash = `#/${target}`;
        }
      }));
    }
  }

  async changePages(mutate, targetId) {
    const next = structuredClone(this.config);
    mutate(next);
    try {
      await this.persist(next);
    } catch (error) {
      this.setStatus(`Speichern fehlgeschlagen: ${error.message}`);
      return;
    }
    if (window.location.hash === `#/${targetId}`) {
      await this.showPage(targetId);
    } else {
      window.location.hash = `#/${targetId}`;
    }
  }

  async addPage() {
    const title = await this.askTitle('Titel der neuen Seite', '');
    if (title === null) {
      return;
    }
    const id = this.uniqueId('p', new Set(this.config.pages.map((page) => page.id)));
    await this.changePages((next) => next.pages.push({ id, title, widgets: [] }), id);
  }

  async renamePage() {
    const title = await this.askTitle('Neuer Titel der Seite', this.page.title);
    if (title === null) {
      return;
    }
    const id = this.page.id;
    await this.changePages((next) => {
      next.pages.find((page) => page.id === id).title = title;
    }, id);
  }

  async deletePage() {
    if (this.config.pages.length < 2) {
      return;
    }
    const { id, title, widgets } = this.page;
    if (!window.confirm(`Seite „${title}“ mit ${widgets.length} Widget(s) wirklich löschen?`)) {
      return;
    }
    const fallback = this.config.pages.find((page) => page.id !== id).id;
    await this.changePages((next) => {
      next.pages = next.pages.filter((page) => page.id !== id);
    }, fallback);
  }

  devices() {
    return [...new Set(this.page.widgets.map((widget) => widget.device).filter(isValidName))];
  }

  services() {
    return {
      listDevices: () => this.listDevices(),
      setTarget: (widget, value, device) => this.client.setReading(device || widget.device, widget.readings.target, value),
      listMedia: () => this.client.listMedia(),
      uploadMedia: (bytes) => this.client.uploadMedia(bytes),
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
    this.overlays.clear();
    for (const widget of this.page.widgets) {
      this.grid.append(this.createElementFor(widget));
    }
    this.syncOverlays();
  }

  toggleLayout(force) {
    this.layoutMode = typeof force === 'boolean' ? force : !this.layoutMode;
    this.layoutButton.setAttribute('aria-pressed', String(this.layoutMode));
    this.layoutButton.textContent = this.layoutMode ? 'Layout fertig' : 'Layout ändern';
    this.grid.classList.toggle('is-layout', this.layoutMode);
    if (!this.layoutMode) {
      this.flushLayout();
    }
    this.syncOverlays();
  }

  // Im Layout-Modus liegt über jeder Kachel ein Griff zum Ziehen (Maus, Touch) und für die Pfeiltasten.
  syncOverlays() {
    for (const overlay of this.overlays.values()) {
      overlay.remove();
    }
    this.overlays.clear();
    if (!this.layoutMode) {
      return;
    }
    for (const widget of this.page.widgets) {
      const overlay = document.createElement('div');
      overlay.className = 'cms-drag-handle';
      overlay.tabIndex = 0;
      overlay.setAttribute('role', 'button');
      overlay.setAttribute('aria-label',
        `Kachel ${widget.title || widget.device || widget.id} verschieben: ziehen oder Pfeiltasten verwenden`);
      overlay.textContent = '⠿ verschieben';
      this.place(overlay, widget);
      this.attachDrag(overlay, widget.id);
      this.overlays.set(widget.id, overlay);
      this.grid.append(overlay);
    }
  }

  currentLayout() {
    return new Map(this.page.widgets.map((widget) => [widget.id, { ...widget.grid }]));
  }

  previewLayout(layout) {
    this.pendingLayout = layout;
    for (const widget of this.page.widgets) {
      const grid = layout.get(widget.id);
      const element = this.elements.get(widget.id);
      const overlay = this.overlays.get(widget.id);
      if (grid && element) {
        this.place(element, { grid });
        if (overlay) {
          this.place(overlay, { grid });
        }
      }
    }
  }

  attachDrag(overlay, id) {
    overlay.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      this.flushLayout();
      const widget = this.page.widgets.find((item) => item.id === id);
      const start = cellFromPoint(this.grid, event.clientX, event.clientY);
      const offset = { col: start.col - widget.grid.col, row: start.row - widget.grid.row };
      overlay.setPointerCapture(event.pointerId);
      overlay.classList.add('is-dragging');
      let last = null;

      const move = (moveEvent) => {
        const cell = cellFromPoint(this.grid, moveEvent.clientX, moveEvent.clientY);
        const layout = moveWidget(this.page.widgets, id, cell.col - offset.col, cell.row - offset.row);
        const key = layout && JSON.stringify([...layout]);
        if (layout && key !== last) {
          last = key;
          this.previewLayout(layout);
        }
      };
      const finish = (commit) => {
        overlay.removeEventListener('pointermove', move);
        overlay.removeEventListener('pointerup', up);
        overlay.removeEventListener('pointercancel', cancel);
        overlay.classList.remove('is-dragging');
        if (commit && last) {
          this.commitLayout(this.pendingLayout);
        } else {
          this.previewLayout(this.currentLayout());
        }
      };
      const up = () => finish(true);
      const cancel = () => finish(false);
      overlay.addEventListener('pointermove', move);
      overlay.addEventListener('pointerup', up);
      overlay.addEventListener('pointercancel', cancel);
    });

    overlay.addEventListener('keydown', (event) => {
      const steps = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      const step = steps[event.key];
      if (!step) {
        return;
      }
      event.preventDefault();
      const base = (this.pendingLayout && this.pendingLayout.get(id)) || this.page.widgets.find((item) => item.id === id).grid;
      const working = this.page.widgets.map((widget) => ({ ...widget, grid: (this.pendingLayout && this.pendingLayout.get(widget.id)) || widget.grid }));
      const layout = moveWidget(working, id, base.col + step[0], base.row + step[1]);
      if (!layout) {
        return;
      }
      this.previewLayout(layout);
      window.clearTimeout(this.layoutTimer);
      this.layoutTimer = window.setTimeout(() => this.flushLayout(), 700);
    });
    overlay.addEventListener('blur', () => this.flushLayout());
  }

  flushLayout() {
    window.clearTimeout(this.layoutTimer);
    const layout = this.pendingLayout;
    this.pendingLayout = null;
    if (layout) {
      this.commitLayout(layout);
    }
  }

  commitLayout(layout) {
    this.pendingLayout = null;
    const changed = this.page.widgets.some((widget) => {
      const grid = layout.get(widget.id);
      return grid && (grid.col !== widget.grid.col || grid.row !== widget.grid.row);
    });
    if (!changed) {
      return this.layoutSaving;
    }
    const pageId = this.page.id;
    this.layoutSaving = this.layoutSaving.then(async () => {
      const next = structuredClone(this.config);
      for (const widget of next.pages.find((page) => page.id === pageId).widgets) {
        const grid = layout.get(widget.id);
        if (grid) {
          widget.grid = { col: grid.col, row: grid.row, w: grid.w, h: grid.h };
        }
      }
      try {
        await this.persist(next);
        this.setStatus('Layout gespeichert');
      } catch (error) {
        this.setStatus(`Layout konnte nicht gespeichert werden: ${error.message}`);
      }
      if (this.pageId === pageId) {
        this.previewLayout(this.currentLayout());
      }
    });
    return this.layoutSaving;
  }

  createElementFor(widget) {
    let element;
    if (widget.type === 'thermostat') {
      element = document.createElement('cms-thermostat');
      element.services = this.services();
      element.config = widget;
      element.data = this.snapshots.get(widget.device) || null;
    } else if (widget.type === 'text') {
      element = document.createElement('cms-text');
      element.services = this.services();
      element.config = widget;
    } else {
      element = document.createElement('p');
      element.className = 'cms-unsupported';
      element.textContent = `Widget-Typ „${widget.type}“ wird noch nicht angezeigt.`;
    }
    if (VIEW_MODE) {
      element.setAttribute('view-only', '');
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

  addWidget(type) {
    const id = this.uniqueId(type === 'text' ? 'x' : 't', new Set(this.page.widgets.map((widget) => widget.id)));
    const grid = { col: 1, row: this.nextFreeRow(), w: type === 'text' ? 6 : 4, h: 2 };
    const widget = type === 'text'
      ? { id, type, html: '', grid }
      : { id, type, device: '', readings: { actual: '', target: '' }, grid };
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
    const widgets = next.pages[this.pageIndex].widgets;
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
    const target = next.pages[this.pageIndex];
    target.widgets = target.widgets.filter((item) => item.id !== id);
    await this.persist(next);
    const element = this.elements.get(id);
    if (element) {
      element.remove();
      this.elements.delete(id);
    }
    this.resubscribe();
  }

  async refresh() {
    if (this.stopped) {
      return;
    }
    const token = this.loadToken;
    const devices = this.devices();
    if (devices.length === 0) {
      this.snapshots = new Map();
      this.lastSuccess = null;
      this.updateStatus(this.page.widgets.length === 0 ? 'Die Seite ist noch leer' : undefined);
      this.resubscribe();
      return;
    }

    let failure = null;
    try {
      const specs = devices.flatMap((name) => [name, `device=${name}`]);
      const results = await this.client.jsonlist(specs.join(','));
      if (token !== this.loadToken) {
        return;
      }
      this.snapshots = this.groupSnapshots(devices, results);
      this.lastSuccess = Date.now();
    } catch (error) {
      if (token !== this.loadToken) {
        return;
      }
      failure = error.message || 'unbekannter Fehler';
    }

    // Bei einem Fehler bleiben die letzten Werte sichtbar, werden aber als veraltet gekennzeichnet.
    for (const widget of this.page.widgets) {
      const element = this.elements.get(widget.id);
      if (element && widget.type === 'thermostat') {
        element.data = this.snapshots.get(widget.device) || null;
        element.stale = failure !== null && this.lastSuccess !== null ? this.lastSuccess : null;
      }
    }
    if (failure !== null) {
      this.markStale(`Daten nicht verfügbar: ${failure}`);
    } else {
      this.updateStatus();
    }
    this.resubscribe();
  }

  markStale(reason) {
    const since = this.lastSuccess
      ? ` · Anzeige veraltet seit ${new Date(this.lastSuccess).toLocaleTimeString('de-DE')}`
      : '';
    this.setStatus(`${reason}${since}`);
    for (const widget of this.page.widgets) {
      const element = this.elements.get(widget.id);
      if (element && widget.type === 'thermostat' && this.lastSuccess !== null) {
        element.stale = this.lastSuccess;
      }
    }
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
        const reconnected = state === 'live' && !this.live && this.lastSuccess !== null;
        this.live = state === 'live';
        this.updateStatus();
        if (reconnected) {
          this.scheduleRefresh();
        }
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
  if (VIEW_MODE) {
    document.documentElement.classList.add('cms-view');
  }
  if (!isValidName(cmsDevice)) {
    card.setAttribute('data-error', '');
    card.status = 'Ungültiger CMS-Device-Name';
    return;
  }

  card.status = 'Konfiguration wird geladen ...';
  new CmsPage(cmsDevice, shell, card).start();
});
