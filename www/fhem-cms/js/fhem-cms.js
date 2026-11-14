import { createWidgetElement, dataFor, devicesOf, groupSnapshots, isLiveWidget } from './widget-factory.js';
import { FhemClient, isValidName } from './fhem-client.js';
import { createCmsAdminMenuLinks } from './cms-admin-link.js';
import { DevicePreview } from './device-preview.js';
import { createSchema5WidgetServices, createWidgetServices } from './widget-services.js';
import { listenForSettingsPreview } from './fcui-schema5-settings-preview.js';
import {
  GRID_COLUMNS, GRID_COLUMN_CHOICES, LAYOUT_MODES, cellFromPoint, configureLayout, effectiveLayout, flowLayout,
  layoutMode, layoutStep, moveWidget, normalizeLayout, resizeWidget
} from './layout.js';

const POLL_INTERVAL_MS = 30000;
const REFRESH_DEBOUNCE_MS = 300;
const DEVICE_TYPES = 'TYPE=MAX,TYPE=CUL_HM';
const NAV_ID = '__nav';
const LAYOUT_INFO = {
  grid: {
    title: 'Raster',
    text: 'Widgets sitzen auf festen Rasterzellen. Überlappende Widgets rutschen nach unten. Volle Kontrolle über jede Position.'
  },
  flow: {
    title: 'Fluss',
    text: 'Widgets reihen sich in Reihenfolge von links nach rechts und brechen automatisch um. Passt sich jeder Breite an.'
  },
  masonry: {
    title: 'Spalten (Masonry)',
    text: 'Widgets füllen die Spalten lückenlos von oben nach unten, wie Kacheln bei Pinterest. Ohne Leerräume.'
  },
  free: {
    title: 'Frei',
    text: 'Widgets stehen genau dort, wo Sie sie ablegen, und dürfen sich überlappen. Feinste Auflösung, keine Verdrängung.'
  }
};

// Kleine Vorschau: dieselben Beispiel-Widgets, angeordnet nach dem jeweiligen Modus.
function layoutPreview(mode, columns) {
  const samples = [
    { id: 'a', grid: { col: 1, row: 1, w: 24, h: 4 } },
    { id: 'b', grid: { col: 25, row: 1, w: 12, h: 4 } },
    { id: 'c', grid: { col: 37, row: 1, w: 12, h: 7 } },
    { id: 'd', grid: { col: 1, row: 5, w: 12, h: 3 } },
    { id: 'e', grid: { col: 13, row: 5, w: 24, h: 3 } },
    { id: 'f', grid: { col: 1, row: 8, w: 24, h: 3 } }
  ];
  let placed = new Map(samples.map((item) => [item.id, item.grid]));
  if (mode === 'flow' || mode === 'masonry') {
    const shuffled = [samples[0], samples[1], samples[2], samples[3], samples[4], samples[5]]
      .map((item, index) => ({ ...item, grid: { ...item.grid, h: [3, 5, 3, 4, 3, 4][index], w: [20, 16, 12, 20, 24, 16][index] } }));
    placed = flowLayout(shuffled, mode);
  } else if (mode === 'free') {
    placed = new Map([
      ['a', { col: 1, row: 1, w: 24, h: 5 }], ['b', { col: 18, row: 3, w: 16, h: 5 }],
      ['c', { col: 38, row: 1, w: 11, h: 4 }], ['d', { col: 5, row: 8, w: 16, h: 3 }],
      ['e', { col: 24, row: 8, w: 20, h: 3 }], ['f', { col: 30, row: 5, w: 12, h: 3 }]
    ]);
  }
  const preview = document.createElement('div');
  preview.className = `cms-lm-preview is-${mode}`;
  preview.setAttribute('aria-hidden', 'true');
  if (mode === 'grid') {
    const step = 48 / columns;
    preview.style.backgroundSize = `calc(100% / ${columns}) 100%`;
    preview.dataset.step = String(step);
  }
  const rows = Math.max(...[...placed.values()].map((grid) => grid.row + grid.h - 1));
  preview.style.gridTemplateRows = `repeat(${rows}, 4px)`;
  for (const grid of placed.values()) {
    const tile = document.createElement('span');
    tile.style.gridColumn = `${grid.col} / span ${grid.w}`;
    tile.style.gridRow = `${grid.row} / span ${grid.h}`;
    preview.append(tile);
  }
  return preview;
}

const THEMES = [['dark', 'Forest Green'], ['light', 'Hell']];
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)');
const GUIDE_KEY = 'fhem-cms-show-grid';
const DEFAULT_NAV_GRID = { col: 1, row: 1, w: 48, h: 1 };

// Ohne Parameter zeigt die Seite nur die fertige Homepage. ?mode=edit startet die Bearbeitung.
// Das ist keine Zugriffssperre.
const MODE = new URLSearchParams(window.location.search).get('mode');
const VIEW_MODE = MODE !== 'edit';
// ?mode=preview zeigt den Entwurf wie die fertige Seite (nur Ansicht).
const PREVIEW_MODE = MODE === 'preview';
const SETTINGS_PREVIEW = PREVIEW_MODE && window.parent !== window
  && new URLSearchParams(window.location.search).get('cms-page-settings-preview') === '1';

export class CmsPage {
  constructor(cmsDevice, shell, statusLine, adminMenuEnabled = false) {
    this.client = new FhemClient(cmsDevice);
    this.client.adminMenuEnabled = adminMenuEnabled === true;
    this.statusLine = statusLine;
    if (!VIEW_MODE) {
      this.statusBox = document.createElement('div');
      this.statusBox.className = 'cms-status-box';
      this.statusBox.setAttribute('role', 'status');
      this.statusBox.hidden = true;
      document.body.append(this.statusBox);
      statusLine.setAttribute('role', 'button');
      statusLine.addEventListener('click', (event) => {
        event.stopPropagation();
        this.statusBox.hidden = !this.statusBox.hidden;
      });
      statusLine.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          this.statusBox.hidden = !this.statusBox.hidden;
        } else if (event.key === 'Escape') {
          this.statusBox.hidden = true;
        }
      });
      document.addEventListener('click', (event) => {
        if (!this.statusBox.contains(event.target)) {
          this.statusBox.hidden = true;
        }
      });
    }
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
    this.navButton = this.button('Navigation bearbeiten …', () => this.editNavigation());
    this.previewButton = this.button('Vorschau', () => this.preview());
    this.publishButton = this.button('Veröffentlichen', () => this.publish());
    this.discardButton = this.button('Entwurf verwerfen', () => this.discard());
    this.backupsButton = this.button('Backups …', () => this.showBackups());
    this.migrationButton = this.button('Jetzt umstellen', () => this.upgradeLayout());
    this.upgradeNotice = document.createElement('section');
    this.upgradeNotice.hidden = VIEW_MODE;
    this.upgradeMessage = document.createElement('p');
    this.upgradeMessage.setAttribute('role', 'status');
    this.upgradeMessage.textContent = 'Neues 12-Spalten-Layout: Widgets und Einstellungen bleiben erhalten. '
      + 'Live und Entwurf werden getrennt gesichert und umgestellt; Positionen danach manuell anpassen.';
    this.upgradeNotice.append(this.upgradeMessage, this.migrationButton);
    this.purgeButton = this.button('Daten löschen …', () => this.showPurgeDialog());
    this.showGrid = !VIEW_MODE && window.localStorage.getItem(GUIDE_KEY) === '1';
    this.gridButton = this.button('Raster anzeigen', () => this.toggleGuides());
    this.gridButton.classList.add('cms-grid-toggle');
    this.gridButton.setAttribute('aria-pressed', String(this.showGrid));
    this.setupButton = this.button('Seite einrichten …', () => this.showSetupDialog());
    this.pageButtons = [this.setupButton, this.navButton, this.previewButton, this.publishButton, this.discardButton, this.backupsButton, this.purgeButton, this.gridButton];
    this.publishButton.classList.add('cms-publish');
    this.hasDraft = false;
    this.statusText = '';
    // Im Bearbeitungsmodus sind die Kacheln immer verschiebbar.
    this.layoutMode = !VIEW_MODE;
    this.overlays = new Map();
    this.layoutTimer = null;
    this.layoutSaving = Promise.resolve();
    this.draftSaving = Promise.resolve();
    this.draftSaveError = null;

    this.menuButtons = [
      this.button('Thermostat-Kachel', () => this.addWidget('thermostat')),
      this.button('Wert-Anzeige', () => this.addWidget('fhem-value')),
      this.button('Schalter', () => this.addWidget('fhem-switch')),
      this.button('Taster', () => this.addWidget('fhem-button')),
      this.button('Freies HTML', () => this.addWidget('fhem-html')),
      this.button('Uhr / Datum', () => this.addWidget('fhem-clock')),
      this.button('Status-Symbol', () => this.addWidget('fhem-icon')),
      this.button('Tabelle', () => this.addWidget('fhem-table')),
      this.button('Schieberegler', () => this.addWidget('fhem-slider')),
      this.button('Wert auswählen', () => this.addWidget('fhem-select')),
      this.button('Diagramm', () => this.addWidget('fhem-chart')),
      this.button('SolarFlow', () => this.addWidget('fhem-solarflow')),
      this.button('Textbaustein', () => this.addWidget('text'))
    ];
    // Menüs wie in klassischen Programmen: Datei, Bearbeiten, Einfügen, Ansicht.
    this.menus = [];
    const makeMenu = (label, buttons, ...sections) => {
      const menu = document.createElement('details');
      menu.className = 'cms-menu';
      const summary = document.createElement('summary');
      summary.className = 'cms-button';
      summary.textContent = label;
      const items = document.createElement('div');
      items.className = 'cms-menu-items';
      items.setAttribute('role', 'group');
      items.setAttribute('aria-label', label);
      items.append(...buttons);
      menu.append(summary, items);
      menu.addEventListener('toggle', () => {
        if (menu.open) {
          this.closeMenus(menu);
        }
      });
      // Maus: Menü öffnet beim Überfahren (leicht verzögertes Schließen); Touch/Tastatur: per Klick.
      let closeTimer = null;
      menu.addEventListener('pointerenter', (event) => {
        if (event.pointerType === 'mouse') {
          clearTimeout(closeTimer);
          menu.open = true;
        }
      });
      menu.addEventListener('pointerleave', (event) => {
        if (event.pointerType === 'mouse') {
          closeTimer = setTimeout(() => { menu.open = false; }, 250);
        }
      });
      summary.addEventListener('click', (event) => {
        if (event.pointerType === 'mouse' || (event.detail > 0 && menu.open && menu.matches(':hover'))) {
          event.preventDefault();
          menu.open = true;
        }
      });
      this.menus.push(menu);
      return menu;
    };
    const fileMenu = makeMenu('Datei', [this.setupButton, this.previewButton, this.publishButton, this.discardButton, this.backupsButton, this.purgeButton, ...createCmsAdminMenuLinks(this.client)]);
    const editMenu = makeMenu('Bearbeiten', [this.navButton]);
    this.menu = makeMenu('Einfügen', this.menuButtons);
    const viewMenu = makeMenu('Ansicht', [this.gridButton]);
    document.addEventListener('click', (event) => {
      if (!this.toolbar.contains(event.target)) {
        this.closeMenus();
      }
    });
    this.toolbar.setAttribute('role', 'toolbar');
    this.toolbar.setAttribute('aria-label', 'Bearbeiten');
    this.toolbar.append(fileMenu, editMenu, this.menu, viewMenu);

    this.grid = document.createElement('section');
    this.grid.className = 'cms-grid';
    this.grid.setAttribute('aria-label', 'Widgets');
    this.grid.setAttribute('aria-live', 'polite');

    shell.append(this.upgradeNotice, this.toolbar, this.grid);
  }

  button(label, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cms-button';
    button.textContent = label;
    button.addEventListener('click', () => {
      this.closeMenus();
      onClick();
    });
    return button;
  }

  closeMenus(except) {
    for (const menu of this.menus || []) {
      if (menu !== except) {
        menu.open = false;
      }
    }
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
  }

  // Im Bearbeitungsmodus öffnet das rote Ausrufezeichen oben rechts per Klick eine Box mit den Meldungen.
  setStatus(message) {
    this.statusText = String(message);
    this.statusLine.textContent = this.statusText;
    this.updateIndicator();
  }

  updateIndicator() {
    if (VIEW_MODE) {
      return;
    }
    const lines = [this.statusText];
    if (this.hasDraft) {
      lines.push('Entwurf: Änderungen sind noch nicht veröffentlicht. „Zeige Homepage“ zeigt weiterhin den Live-Stand.');
    }
    const text = lines.filter(Boolean).join('\n');
    this.statusBox.textContent = text;
    this.statusLine.tabIndex = 0;
    this.statusLine.setAttribute('aria-label', text);
    this.statusLine.hidden = !text;
  }

  preview() {
    const url = new URL(window.location.href);
    url.search = '?mode=preview';
    url.hash = window.location.hash;
    window.open(url.href, '_blank', 'noopener');
  }

  // Konfigurationen ohne Navigation erhalten die Standardnavigation oben; die Kacheln rücken darunter.
  async loadConfig(source) {
    const config = await this.client.getConfig(source);
    if (!['dark', 'light'].includes(config.theme)) {
      config.theme = 'dark';
    }
    if (!config.navigation) {
      config.navigation = { orientation: 'horizontal', grid: { ...DEFAULT_NAV_GRID } };
      for (const page of config.pages) {
        for (const widget of page.widgets) {
          widget.grid.row = Math.min(widget.grid.row + DEFAULT_NAV_GRID.h, 1000);
        }
      }
    }
    return config;
  }

  async start() {
    window.addEventListener('pagehide', () => this.stop());
    window.addEventListener('pageshow', (event) => {
      if (event.persisted) window.location.reload();
    });
    try {
      const config = await this.loadConfig(VIEW_MODE && !PREVIEW_MODE ? 'config' : 'draft');
      if (this.stopped) return;
      const hasDraft = VIEW_MODE ? false : await this.client.hasDraft();
      if (this.stopped) return;
      this.config = config;
      this.hasDraft = hasDraft;
    } catch (error) {
      if (this.stopped) return;
      this.statusLine.setAttribute('data-error', '');
      this.setStatus(`Konfiguration konnte nicht geladen werden: ${error.message}`);
      this.setControlsDisabled(true);
      return;
    }
    this.applyTheme();
    window.addEventListener('hashchange', () => this.showPage(this.pageFromHash()));
    window.addEventListener('online', () => this.refresh());
    window.addEventListener('offline', () => this.markStale('Offline'));
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        this.refresh();
      }
    });
    if (!VIEW_MODE) {
      this.devicePreview = new DevicePreview({
        getUrl: () => {
          const url = new URL(window.location.href);
          url.search = '?mode=preview';
          url.hash = window.location.hash;
          return url.href;
        },
        beforeOpen: async () => {
          await this.flushLayout();
          await this.flushDraftWrites();
        }
      });
    }
    this.setDraft(this.hasDraft);
    this.startPolling();
    await this.showPage(this.pageFromHash());
  }

  applyTheme() {
    const theme = this.config?.theme === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.cmsTheme = theme;
    document.documentElement.dataset.cmsFrames = this.config?.settings?.showFrames === false ? 'off' : 'on';
    document.documentElement.style.setProperty('--cms-widget-title-align', this.config?.settings?.titleAlign || 'left');
    configureLayout(this.config?.settings);
  }

  // Seitenübergreifende Einstellungen (gelten für alle Seiten).
  showSetupDialog() {
    const { dialog, body, actions, finish } = this.dialogShell('Seite einrichten');
    const error = document.createElement('p');
    error.className = 'cms-dialog-error';
    error.setAttribute('role', 'alert');
    dialog.classList.add('cms-setup');
    const section = (title, description) => {
      const box = document.createElement('section');
      box.className = 'cms-setup-section';
      const heading = document.createElement('h4');
      heading.textContent = title;
      const intro = document.createElement('p');
      intro.className = 'cms-dialog-hint';
      intro.textContent = description;
      box.append(heading, intro);
      return box;
    };
    const field = (title, description, control) => {
      const row = document.createElement('label');
      row.className = 'cms-setup-field';
      const text = document.createElement('span');
      text.className = 'cms-setup-text';
      const name = document.createElement('strong');
      name.textContent = title;
      const hint = document.createElement('span');
      hint.className = 'cms-dialog-hint';
      hint.textContent = description;
      text.append(name, hint);
      row.append(text, control);
      return row;
    };
    const theme = document.createElement('select');
    for (const [value, text] of THEMES) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      theme.append(option);
    }
    theme.value = this.config.theme;
    const frames = document.createElement('input');
    frames.type = 'checkbox';
    frames.checked = this.config.settings?.showFrames !== false;
    const titleAlign = document.createElement('select');
    for (const [value, text] of [['left', 'Links'], ['center', 'Zentriert'], ['right', 'Rechts']]) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      titleAlign.append(option);
    }
    titleAlign.value = this.config.settings?.titleAlign || 'left';
    const modeValue = { current: LAYOUT_MODES.includes(this.config.settings?.layoutMode) ? this.config.settings.layoutMode : 'grid' };
    const columns = document.createElement('select');
    for (const count of GRID_COLUMN_CHOICES) {
      const option = document.createElement('option');
      option.value = String(count);
      option.textContent = { 12: '12 Spalten (grob)', 24: '24 Spalten (mittel)', 48: '48 Spalten (fein)' }[count];
      columns.append(option);
    }
    columns.value = String(GRID_COLUMN_CHOICES.includes(this.config.settings?.gridColumns) ? this.config.settings.gridColumns : 48);
    const cards = document.createElement('div');
    cards.className = 'cms-lm-cards';
    cards.setAttribute('role', 'radiogroup');
    cards.setAttribute('aria-label', 'Positionierung');
    const previews = new Map();
    const refreshCards = () => {
      for (const [mode, card] of previews) {
        card.classList.toggle('is-selected', mode === modeValue.current);
        card.querySelector('input').checked = mode === modeValue.current;
        card.querySelector('.cms-lm-preview').replaceWith(layoutPreview(mode, Number(columns.value)));
      }
      columns.disabled = modeValue.current === 'free';
    };
    for (const [mode, info] of Object.entries(LAYOUT_INFO)) {
      const card = document.createElement('label');
      card.className = 'cms-lm-card';
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'layoutMode';
      radio.value = mode;
      radio.addEventListener('change', () => {
        modeValue.current = mode;
        refreshCards();
      });
      const name = document.createElement('strong');
      name.textContent = info.title;
      const hint = document.createElement('span');
      hint.className = 'cms-dialog-hint';
      hint.textContent = info.text;
      const preview = document.createElement('div');
      preview.className = 'cms-lm-preview';
      card.append(preview, radio, name, hint);
      previews.set(mode, card);
      cards.append(card);
    }
    columns.addEventListener('change', refreshCards);
    refreshCards();
    const arrangement = section('Positionierung', 'Wie Widgets auf der Seite angeordnet werden (alle Seiten). Vorhandene Layouts werden beim Wechsel umgerechnet.');
    arrangement.append(cards, field('Rastergröße', 'Feinheit beim Verschieben und Skalieren (nicht bei „Frei“, dort immer fein)', columns));
    const look = section('Darstellung', 'Gilt für alle Seiten.');
    look.append(field('Theme', 'Farbschema der Seite', theme));
    const widgets = section('Widgets', 'Allgemeine Einstellungen für alle Widgets.');
    widgets.append(field('Rahmen anzeigen', 'Zeichnet einen Rahmen um jedes Widget', frames));
    widgets.append(field('Widgettitel ausrichten', 'Gilt für alle Widgets auf allen Seiten', titleAlign));
    body.append(look, arrangement, widgets, error);
    actions.append(this.button('Abbrechen', () => finish(null)), this.button('Speichern', async () => {
      const next = structuredClone(this.config);
      next.theme = theme.value;
      next.settings = {
        ...next.settings,
        showFrames: frames.checked,
        titleAlign: titleAlign.value,
        layoutMode: modeValue.current,
        gridColumns: Number(columns.value)
      };
      const layoutChanged = next.settings.layoutMode !== layoutMode()
        || next.settings.gridColumns !== (this.config.settings?.gridColumns || 48);
      try {
        if (layoutChanged) {
          this.convertLayouts(next);
        }
        await this.persist(next);
      } catch (failure) {
        error.textContent = `Speichern fehlgeschlagen: ${failure.message}`;
        return;
      }
      finish(true);
      this.renderWidgets();
      this.setStatus('Seiteneinstellungen gespeichert');
    }));
    document.body.append(dialog);
    dialog.showModal();
  }

  // Rechnet die Positionen aller Seiten auf Modus und Rastergröße der neuen Einstellungen um.
  convertLayouts(next) {
    const previous = this.config.settings;
    configureLayout(next.settings);
    try {
      const navLayout = normalizeLayout([{ id: NAV_ID, grid: next.navigation.grid }]);
      next.navigation.grid = { ...navLayout.get(NAV_ID) };
      for (const page of next.pages) {
        const layout = normalizeLayout([{ id: NAV_ID, grid: next.navigation.grid }, ...page.widgets]);
        if (!layout) {
          throw new Error(`Kein Platz im Raster (Seite ${page.title})`);
        }
        for (const widget of page.widgets) {
          const { col, row, w, h } = layout.get(widget.id);
          widget.grid = { col, row, w, h };
        }
      }
    } catch (failure) {
      configureLayout(previous);
      throw failure;
    }
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
    this.loadToken += 1;
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
    this.nav.classList.toggle('is-vertical', this.config.navigation.orientation === 'vertical');
    for (const page of this.config.pages) {
      const link = document.createElement('a');
      link.className = 'cms-nav-link';
      link.href = `#/${page.id}`;
      link.textContent = this.navItem(page.id).label || page.title;
      if (page.id === this.page.id) {
        link.setAttribute('aria-current', 'page');
      }
      this.nav.append(link);
    }
    this.sizeNav();
  }

  navItem(pageId) {
    return (this.config.navigation.items || []).find((item) => item.page === pageId) || {};
  }

  // Standardgröße: alle Einträge ohne eigene Maße übernehmen die Größe des größten Eintrags.
  sizeNav() {
    const links = [...this.nav.querySelectorAll('.cms-nav-link')];
    for (const link of links) {
      link.style.width = '';
      link.style.height = '';
    }
    if (!this.nav.isConnected) {
      return;
    }
    let width = 0;
    let height = 0;
    for (const link of links) {
      const rect = link.getBoundingClientRect();
      width = Math.max(width, Math.ceil(rect.width));
      height = Math.max(height, Math.ceil(rect.height));
    }
    this.config.pages.forEach((page, index) => {
      const item = this.navItem(page.id);
      links[index].style.width = `${item.width || width}px`;
      links[index].style.height = `${item.height || height}px`;
    });
  }

  askNavItem(page, item) {
    return new Promise((resolve) => {
      const dialog = document.createElement('dialog');
      dialog.className = 'cms-dialog';
      dialog.setAttribute('aria-label', 'Navigationseintrag');
      const form = document.createElement('form');
      form.method = 'dialog';
      const inputs = {};
      const labelled = (text, key, type, attrs) => {
        const label = document.createElement('label');
        label.textContent = text;
        const input = document.createElement('input');
        input.type = type;
        Object.assign(input, attrs);
        input.autocomplete = 'off';
        inputs[key] = input;
        label.append(input);
        return label;
      };
      const error = document.createElement('p');
      error.className = 'cms-dialog-error';
      error.setAttribute('role', 'alert');
      const actions = document.createElement('div');
      actions.className = 'cms-dialog-actions';
      const finish = (value) => {
        if (dialog.open) {
          dialog.close();
        }
        dialog.remove();
        resolve(value);
      };
      const ok = document.createElement('button');
      ok.type = 'submit';
      ok.className = 'cms-button';
      ok.textContent = 'OK';
      actions.append(this.button('Abbrechen', () => finish(null)), ok);
      form.append(
        labelled(`Beschriftung (leer = „${page.title}“)`, 'label', 'text', { maxLength: 64, value: item.label || '' }),
        labelled('Breite in Pixel (leer = Standard)', 'width', 'number', { min: 40, max: 600, value: item.width || '' }),
        labelled('Höhe in Pixel (leer = Standard)', 'height', 'number', { min: 24, max: 200, value: item.height || '' }),
        error,
        actions
      );
      dialog.append(form);
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const label = inputs.label.value.trim();
        const result = {};
        if (label) {
          if (/[\u0000-\u001f\u007f]/.test(label)) {
            error.textContent = 'Die Beschriftung darf keine Steuerzeichen enthalten';
            return;
          }
          result.label = label;
        }
        for (const [key, min, max] of [['width', 40, 600], ['height', 24, 200]]) {
          const raw = inputs[key].value.trim();
          if (raw) {
            const number = Number(raw);
            if (!Number.isInteger(number) || number < min || number > max) {
              error.textContent = `${key === 'width' ? 'Breite' : 'Höhe'}: ganze Zahl von ${min} bis ${max}`;
              return;
            }
            result[key] = number;
          }
        }
        finish(result);
      });
      dialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        finish(null);
      });
      document.body.append(dialog);
      dialog.showModal();
      inputs.label.focus();
    });
  }

  uniqueId(prefix, existing) {
    let id = `${prefix}${Date.now().toString(36)}`;
    while (existing.has(id)) {
      id += 'x';
    }
    return id;
  }

  widgetName(widget) {
    return `${widget.title || widget.device || widget.id} (${widget.type})`;
  }

  // Hängt Widgets unten an eine Zielseite an; IDs sind global eindeutig und bleiben erhalten.
  appendWidgets(page, widgets) {
    let row = page.widgets.reduce((max, widget) => Math.max(max, widget.grid.row + widget.grid.h), 1);
    for (const widget of widgets) {
      widget.grid = { ...widget.grid, col: 1, row };
      row += widget.grid.h;
      page.widgets.push(widget);
    }
  }

  dialogShell(message) {
    const dialog = document.createElement('dialog');
    dialog.className = 'cms-dialog';
    dialog.setAttribute('aria-label', message);
    const form = document.createElement('form');
    form.method = 'dialog';
    const heading = document.createElement('h3');
    heading.textContent = message;
    const body = document.createElement('div');
    body.className = 'cms-move-body';
    const actions = document.createElement('div');
    actions.className = 'cms-dialog-actions';
    form.append(heading, body, actions);
    dialog.append(form);
    form.addEventListener('submit', (event) => event.preventDefault());
    let finishFn = () => {};
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
      finishFn(value);
    };
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      finish(null);
    });
    const result = new Promise((resolve) => {
      finishFn = resolve;
    });
    return { dialog, body, actions, finish, result };
  }

  pageSelect(pages, noneLabel) {
    const select = document.createElement('select');
    if (noneLabel) {
      const none = document.createElement('option');
      none.value = '';
      none.textContent = noneLabel;
      select.append(none);
    }
    for (const page of pages) {
      const option = document.createElement('option');
      option.value = page.id;
      option.textContent = page.title;
      select.append(option);
    }
    return select;
  }

  // Liefert die ID der Zielseite oder null bei Abbruch.
  askTargetPage(widget, pages) {
    const { dialog, body, actions, finish, result } = this.dialogShell('Widget auf andere Seite verschieben');
    const label = document.createElement('label');
    label.textContent = `Zielseite für ${this.widgetName(widget)}`;
    const select = this.pageSelect(pages);
    label.append(select);
    body.append(label);
    actions.append(this.button('Abbrechen', () => finish(null)), this.button('Verschieben', () => finish(select.value)));
    document.body.append(dialog);
    dialog.showModal();
    select.focus();
    return result;
  }

  // Liefert null (abbrechen) oder { moves: Map(widgetId -> pageId) }; Widgets ohne Eintrag werden gelöscht.
  askDeletePage(page, others) {
    const { dialog, body, actions, finish, result } = this.dialogShell(`Seite „${page.title}“ löschen`);
    const intro = document.createElement('p');
    intro.textContent = `Die Seite enthält ${page.widgets.length} Widget(s). Möchten Sie die Widgets vor dem Löschen der Seite verschieben?`;
    const choice = document.createElement('fieldset');
    choice.className = 'cms-move-choice';
    const radios = {};
    for (const [value, text] of [['yes', 'Ja, Widgets verschieben'], ['no', 'Nein, alle Widgets mit der Seite löschen']]) {
      const label = document.createElement('label');
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'move';
      radio.value = value;
      radio.checked = value === 'yes';
      radios[value] = radio;
      label.append(radio, ` ${text}`);
      choice.append(label);
    }
    const list = document.createElement('div');
    list.className = 'cms-move-list';
    const selects = new Map();
    for (const widget of page.widgets) {
      const label = document.createElement('label');
      label.textContent = this.widgetName(widget);
      const select = this.pageSelect(others, '– löschen –');
      selects.set(widget.id, select);
      label.append(select);
      list.append(label);
    }
    const hint = document.createElement('p');
    hint.className = 'cms-dialog-hint';
    hint.textContent = 'Widgets ohne neue Zielseite werden gelöscht.';
    list.append(hint);
    const sync = () => {
      list.hidden = !radios.yes.checked;
    };
    radios.yes.addEventListener('change', sync);
    radios.no.addEventListener('change', sync);
    sync();
    body.append(intro, choice, list);
    actions.append(this.button('Abbrechen', () => finish(null)), this.button('Seite löschen', () => {
      const moves = new Map();
      if (radios.yes.checked) {
        for (const [id, select] of selects) {
          if (select.value) {
            moves.set(id, select.value);
          }
        }
      }
      finish({ moves });
    }));
    document.body.append(dialog);
    dialog.showModal();
    return result;
  }

  async moveWidgetToPage(id) {
    const others = this.config.pages.filter((page) => page.id !== this.page.id);
    if (!others.length) {
      this.setStatus('Zum Verschieben wird eine weitere Seite benötigt');
      return;
    }
    const widget = this.page.widgets.find((item) => item.id === id);
    if (!widget) {
      return;
    }
    const targetId = await this.askTargetPage(widget, others);
    if (!targetId) {
      return;
    }
    try {
      await this.flushLayout();
      const next = structuredClone(this.config);
      const source = next.pages[this.pageIndex];
      const target = next.pages.find((page) => page.id === targetId);
      if (target.widgets.length >= 200) {
        this.setStatus(`Die Seite „${target.title}“ ist voll (200 Widgets)`);
        return;
      }
      const [moved] = source.widgets.splice(source.widgets.findIndex((item) => item.id === id), 1);
      this.appendWidgets(target, [moved]);
      await this.persist(next);
      this.elements.get(id)?.remove();
      this.elements.delete(id);
      this.syncOverlays();
      this.previewLayout(this.currentLayout());
      this.resubscribe();
      await this.refresh();
      this.setStatus(`Widget nach „${target.title}“ verschoben`);
    } catch (error) {
      this.setStatus(`Verschieben fehlgeschlagen: ${error.message}`);
    }
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
        if (!window.confirm(`Live-Stand vom ${label} wiederherstellen? Der aktuelle Live-Stand wird zuvor gesichert.`)) {
          return;
        }
        try {
          await this.client.restoreBackup(name);
          // Restore betrifft nur den Live-Stand; ein vorhandener Entwurf bleibt unveraendert.
          if (!this.hasDraft) {
            this.config = await this.loadConfig('draft');
          }
        } catch (failure) {
          error.textContent = `Wiederherstellen fehlgeschlagen: ${failure.message}`;
          return;
        }
        close();
        this.setStatus(this.hasDraft
          ? 'Live-Stand wiederhergestellt. Der Entwurf ist unverändert.'
          : 'Live-Stand wiederhergestellt');
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

  showPurgeDialog() {
    const dialog = document.createElement('dialog');
    dialog.className = 'cms-dialog';
    dialog.setAttribute('aria-label', 'CMS-Daten löschen');
    const form = document.createElement('form');
    form.method = 'dialog';
    const heading = document.createElement('h2');
    heading.textContent = 'CMS-Daten endgültig löschen?';
    const description = document.createElement('p');
    description.textContent = 'Konfiguration, Entwurf, Backups, Medien und die CMS-Startseite dieses Devices werden dauerhaft gelöscht:';
    const paths = document.createElement('ul');
    const device = this.client.cmsDevice;
    for (const path of [`<modpath>/fhem-cms-data/${device}/`, `<modpath>/www/fhem-cms/${device}/`]) {
      const item = document.createElement('li');
      const code = document.createElement('code');
      code.textContent = path;
      item.append(code);
      paths.append(item);
    }
    const note = document.createElement('p');
    note.textContent = `Anschließend ist das CMS-Device ${device} bis zum Löschen des FHEM-Devices oder einem FHEM-Neustart gesperrt.`;
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
    const remove = this.button('Daten endgültig löschen', async () => {
      remove.disabled = true;
      error.textContent = '';
      try {
        await this.flushLayout();
        await this.flushDraftWrites();
        await this.client.purgeData();
        close();
        this.stop();
        this.setControlsDisabled(true);
        this.setDraft(false);
        this.setStatus(`Daten gelöscht. Das FHEM-Device ${device} kann jetzt gelöscht werden.`);
      } catch (failure) {
        remove.disabled = false;
        error.textContent = `Löschen fehlgeschlagen: ${failure.message}`;
      }
    });
    remove.classList.add('cms-purge-confirm');
    const keep = this.button('Behalten', () => {
      close();
      this.setStatus('CMS-Daten wurden beibehalten');
    });
    const cancel = this.button('Abbrechen', close);
    actions.append(remove, keep, cancel);
    form.append(heading, description, paths, note, error, actions);
    form.addEventListener('submit', (event) => event.preventDefault());
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      close();
    });
    dialog.append(form);
    document.body.append(dialog);
    dialog.showModal();
  }

  // Verschiebt Kacheln aller Seiten, die mit der Navigation überlappen, nach unten.
  arrangeAround(config, exceptPageId) {
    const nav = { id: NAV_ID, grid: config.navigation.grid };
    for (const page of config.pages) {
      if (page.id === exceptPageId) {
        continue;
      }
      const layout = moveWidget([nav, ...page.widgets], NAV_ID, nav.grid.col, nav.grid.row);
      if (!layout) {
        throw new Error('Kein Platz im Raster');
      }
      for (const widget of page.widgets) {
        const grid = layout.get(widget.id);
        widget.grid = { col: grid.col, row: grid.row, w: grid.w, h: grid.h };
      }
    }
  }

  editNavigation() {
    const dialog = document.createElement('dialog');
    dialog.className = 'cms-dialog cms-nav-dialog';
    dialog.setAttribute('aria-label', 'Navigation bearbeiten');
    const form = document.createElement('form');
    form.method = 'dialog';
    const heading = document.createElement('p');
    heading.textContent = 'Navigation';
    const orientationLabel = document.createElement('label');
    orientationLabel.textContent = 'Ausrichtung';
    const orientation = document.createElement('select');
    for (const [value, text] of [['horizontal', 'Horizontal'], ['vertical', 'Vertikal']]) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      orientation.append(option);
    }
    orientationLabel.append(orientation);
    const list = document.createElement('div');
    list.className = 'cms-nav-list';
    list.setAttribute('role', 'group');
    list.setAttribute('aria-label', 'Seiten');
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

    // Alle Änderungen gelten zunächst nur für eine Arbeitskopie und werden erst mit „Speichern“ übernommen.
    const work = structuredClone(this.config);
    const itemOf = (pageId) => (work.navigation.items || []).find((entry) => entry.page === pageId) || {};
    const run = (mutate) => {
      error.textContent = '';
      mutate(work);
      fill();
    };
    const rowButton = (label, title, onClick, disabled) => {
      const item = this.button(label, onClick);
      item.title = title;
      item.setAttribute('aria-label', title);
      item.disabled = disabled;
      return item;
    };
    const startDrag = (event, row) => {
      if (event.button !== undefined && event.button !== 0) {
        return;
      }
      event.preventDefault();
      row.classList.add('is-dragging');
      const move = (moveEvent) => {
        const over = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY)?.closest('.cms-nav-row');
        if (!over || over === row || over.parentElement !== list) {
          return;
        }
        const rect = over.getBoundingClientRect();
        if (moveEvent.clientY < rect.top + rect.height / 2) {
          list.insertBefore(row, over);
        } else {
          over.after(row);
        }
      };
      const end = () => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', end);
        document.removeEventListener('pointercancel', end);
        row.classList.remove('is-dragging');
        const order = [...list.querySelectorAll('.cms-nav-row')].map((entry) => entry.dataset.page);
        work.pages = order.map((id) => work.pages.find((page) => page.id === id));
        fill();
      };
      // Das Verschieben der Zeile im DOM beendet ein Pointer-Capture, daher am Dokument lauschen.
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', end);
      document.addEventListener('pointercancel', end);
    };
    const fill = () => {
      list.replaceChildren();
      const pages = work.pages;
      pages.forEach((page, index) => {
        const row = document.createElement('div');
        row.className = 'cms-nav-row';
        row.dataset.page = page.id;
        const grip = document.createElement('span');
        grip.className = 'cms-nav-grip';
        grip.textContent = '☰';
        grip.title = `„${page.title}“ verschieben`;
        grip.setAttribute('role', 'img');
        grip.setAttribute('aria-label', `„${page.title}“ per Ziehen verschieben`);
        grip.addEventListener('pointerdown', (event) => startDrag(event, row));
        const name = document.createElement('span');
        name.className = 'cms-nav-name';
        const label = itemOf(page.id).label;
        name.textContent = label ? `${page.title} → ${label}` : page.title;
        row.append(
          grip,
          name,
          rowButton('✎', `„${page.title}“ umbenennen`, async () => {
            const title = await this.askTitle('Neuer Titel der Seite', page.title);
            if (title !== null) {
              run((next) => {
                next.pages[index].title = title;
              });
            }
          }, false),
          rowButton('⚙', `„${page.title}“: Beschriftung und Größe`, async () => {
            const result = await this.askNavItem(page, itemOf(page.id));
            if (result !== null) {
              run((next) => {
                const items = (next.navigation.items || []).filter((entry) => entry.page !== page.id);
                if (Object.keys(result).length) {
                  items.push({ page: page.id, ...result });
                }
                next.navigation.items = items;
                if (!items.length) {
                  delete next.navigation.items;
                }
              });
            }
          }, false),
          rowButton('✕', `„${page.title}“ löschen`, async () => {
            const others = work.pages.filter((entry) => entry.id !== page.id);
            let moves = new Map();
            if (page.widgets.length) {
              const answer = await this.askDeletePage(page, others);
              if (!answer) {
                return;
              }
              moves = answer.moves;
              const full = others.find((entry) => entry.widgets.length
                + [...moves.values()].filter((target) => target === entry.id).length > 200);
              if (full) {
                error.textContent = `Die Seite „${full.title}“ würde mehr als 200 Widgets enthalten.`;
                return;
              }
            } else if (!window.confirm(`Seite „${page.title}“ wirklich löschen?`)) {
              return;
            }
            run((next) => {
              for (const target of next.pages) {
                const incoming = next.pages[index].widgets.filter((widget) => moves.get(widget.id) === target.id);
                if (incoming.length) {
                  this.appendWidgets(target, incoming);
                }
              }
              next.pages.splice(index, 1);
              if (next.navigation.items) {
                next.navigation.items = next.navigation.items.filter((entry) => entry.page !== page.id);
                if (!next.navigation.items.length) {
                  delete next.navigation.items;
                }
              }
            });
          }, pages.length < 2)
        );
        list.append(row);
      });
    };

    orientation.value = work.navigation.orientation;
    orientation.addEventListener('change', () => run((next) => {
      const grid = next.navigation.grid;
      next.navigation.orientation = orientation.value;
      next.navigation.grid = orientation.value === 'vertical'
        ? { ...grid, w: Math.min(3, 13 - grid.col), h: Math.max(grid.h, 3) }
        : { ...grid, col: 1, w: 48, h: 1 };
    }));
    const add = this.button('+ Seite', async () => {
      const title = await this.askTitle('Titel der neuen Seite', '');
      if (title !== null) {
        const id = this.uniqueId('p', new Set(work.pages.map((page) => page.id)));
        run((next) => next.pages.push({ id, title, widgets: [] }));
      }
    });
    const save = this.button('Speichern', async () => {
      error.textContent = '';
      const next = structuredClone(work);
      try {
        this.arrangeAround(next);
        await this.persist(next);
      } catch (failure) {
        error.textContent = `Speichern fehlgeschlagen: ${failure.message}`;
        return;
      }
      close();
      if (!this.config.pages.some((page) => page.id === this.pageId)) {
        window.location.hash = `#/${this.config.pages[0].id}`;
      }
      this.renderNav();
      this.previewLayout(this.currentLayout());
    });
    actions.append(add, this.button('Abbrechen', close), save);
    form.append(heading, orientationLabel, list, error, actions);
    dialog.append(form);
    form.addEventListener('submit', (event) => event.preventDefault());
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      close();
    });
    fill();
    document.body.append(dialog);
    dialog.showModal();
  }

  devices() {
    return [...new Set(this.page.widgets.flatMap(devicesOf).filter(isValidName))];
  }

  services() {
    return createWidgetServices({
      client: this.client,
      listDevices: () => this.listDevices(),
      listAllDevices: () => this.listAllDevices(),
      listIcons: () => this.listIcons(),
      saveWidget: (widget) => this.saveWidget(widget),
      deleteWidget: (id) => this.deleteWidget(id)
    });
  }

  async listDevices() {
    if (!this.deviceCache) {
      this.deviceCache = await this.client.jsonlist(DEVICE_TYPES);
    }
    return this.deviceCache;
  }

  async listAllDevices() {
    if (!this.allDeviceCache) {
      this.allDeviceCache = await this.client.jsonlist('.*');
    }
    return this.allDeviceCache;
  }

  async listIcons() {
    if (!this.iconCache) {
      this.iconCache = await this.client.listIcons();
    }
    return this.iconCache;
  }

  renderWidgets() {
    this.grid.replaceChildren();
    this.elements.clear();
    this.overlays.clear();
    this.elements.set(NAV_ID, this.nav);
    this.place(this.nav, { grid: this.effectiveGrid(NAV_ID) });
    this.grid.append(this.nav);
    this.sizeNav();
    for (const widget of this.page.widgets) {
      this.grid.append(this.createElementFor(widget));
    }
    this.syncOverlays();
  }

  toggleGuides() {
    this.showGrid = !this.showGrid;
    window.localStorage.setItem(GUIDE_KEY, this.showGrid ? '1' : '0');
    this.gridButton.setAttribute('aria-pressed', String(this.showGrid));
    this.syncGuides();
  }

  // Zeilen, die nur die waagerechte Navigation (Höhe 1) enthalten, passen sich ihrem Inhalt an.
  syncRowHeights(layout) {
    const items = this.layoutItems();
    const gridOf = (item) => (layout && layout.get(item.id)) || item.grid;
    const rows = items.reduce((max, item) => Math.max(max, gridOf(item).row + gridOf(item).h - 1), 1) + 2;
    const tracks = [];
    for (let row = 1; row <= rows; row += 1) {
      const inRow = items.filter((item) => gridOf(item).row <= row && row < gridOf(item).row + gridOf(item).h);
      const navOnly = inRow.length > 0 && inRow.every((item) => item.id === NAV_ID && gridOf(item).h === 1)
        && this.config.navigation.orientation !== 'vertical';
      tracks.push(navOnly ? 'auto' : 'minmax(var(--cms-row-h), auto)');
    }
    const template = tracks.join(' ');
    if (this.grid.style.gridTemplateRows !== template) {
      this.grid.style.gridTemplateRows = template;
    }
  }

  // Gitternetzlinien: eine leere Zelle je Rasterfeld, mindestens bis zwei Zeilen unter dem Inhalt.
  syncGuides(layout) {
    this.syncRowHeights(layout);
    if (VIEW_MODE || !this.showGrid) {
      this.guides?.remove();
      this.guides = null;
      this.guidesKey = '';
      return;
    }
    const items = this.layoutItems();
    const rows = items.reduce((max, item) => {
      const grid = (layout && layout.get(item.id)) || item.grid;
      return Math.max(max, grid.row + grid.h - 1);
    }, 1) + 2;
    // Beim Ziehen ändert sich meist nur die Position, nicht die Zeilenzahl: Linien dann nicht neu aufbauen.
    const key = `${rows}/${layoutStep()}`;
    if (this.guides?.isConnected && this.guidesKey === key) {
      return;
    }
    this.guides?.remove();
    this.guidesKey = key;
    const guides = document.createElement('div');
    guides.className = 'cms-guides';
    guides.setAttribute('aria-hidden', 'true');
    guides.style.gridRow = `1 / span ${rows}`;
    for (let row = 1; row <= rows; row += 1) {
      for (let col = 1; col <= GRID_COLUMNS; col += layoutStep()) {
        const cell = document.createElement('span');
        cell.style.gridColumn = `${col} / span ${layoutStep()}`;
        cell.style.gridRow = String(row);
        guides.append(cell);
      }
    }
    this.guides = guides;
    this.grid.prepend(guides);
  }

  // Im Bearbeitungsmodus liegt an jeder Kachel ein unauffälliger Griff zum Ziehen (Maus, Touch, Pfeiltasten)
  // und unten rechts ein Griff für die Größe. Die Kachel selbst bleibt bedienbar.
  syncOverlays() {
    for (const overlay of this.overlays.values()) {
      overlay.remove();
    }
    this.overlays.clear();
    this.syncGuides();
    if (!this.layoutMode) {
      return;
    }
    for (const widget of this.layoutItems()) {
      const overlay = document.createElement('div');
      overlay.className = 'cms-drag-layer';
      const handle = document.createElement('div');
      handle.className = widget.id === NAV_ID ? 'cms-drag-handle is-nav' : 'cms-drag-handle';
      handle.tabIndex = 0;
      handle.setAttribute('role', 'button');
      handle.setAttribute('aria-label',
        `${widget.id === NAV_ID ? 'Navigation' : `Kachel ${widget.title || widget.device || widget.id}`} verschieben: ziehen oder Pfeiltasten verwenden`);
      handle.title = widget.id === NAV_ID ? 'Navigation verschieben' : 'Widget auf dieser Seite verschieben';
      handle.textContent = '⠿';
      const grip = document.createElement('span');
      grip.className = 'cms-resize-grip';
      grip.setAttribute('aria-hidden', 'true');
      grip.title = 'Größe ändern (Umschalt+Pfeiltasten am Griff)';
      overlay.append(handle, grip);
      if (widget.id !== NAV_ID) {
        const move = document.createElement('button');
        move.type = 'button';
        move.className = 'cms-move-button';
        move.textContent = '⇄';
        move.title = 'Widget auf andere Seite verschieben';
        move.setAttribute('aria-label', `${this.widgetName(widget)} auf andere Seite verschieben`);
        move.disabled = this.config.pages.length < 2;
        move.addEventListener('click', () => this.moveWidgetToPage(widget.id));
        overlay.append(move);
      }
      this.place(overlay, widget);
      this.attachDrag(handle, widget.id);
      this.attachResize(handle, grip, widget.id);
      this.overlays.set(widget.id, overlay);
      this.grid.append(overlay);
    }
  }

  currentLayout() {
    return new Map(this.layoutItems().map((widget) => [widget.id, { ...widget.grid }]));
  }

  previewLayout(layout) {
    this.pendingLayout = layout;
    if (this.showGrid) {
      this.syncGuides(layout);
    }
    const moving = [];
    const before = new Map();
    for (const widget of this.layoutItems()) {
      const grid = layout.get(widget.id);
      const element = this.elements.get(widget.id);
      if (grid && element && !this.dragging?.has(widget.id) && !REDUCED_MOTION.matches) {
        before.set(widget.id, element.getBoundingClientRect());
      }
      moving.push([widget.id, grid, element, this.overlays.get(widget.id)]);
    }
    for (const [, grid, element, overlay] of moving) {
      if (grid && element) {
        this.place(element, { grid });
        if (overlay) {
          this.place(overlay, { grid });
        }
      }
    }
    // Verdrängte Kacheln gleiten an ihren neuen Platz (FLIP) statt zu springen.
    for (const [id, from] of before) {
      const targets = [this.elements.get(id), this.overlays.get(id)].filter(Boolean);
      const to = targets[0].getBoundingClientRect();
      const dx = from.left - to.left;
      const dy = from.top - to.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
        continue;
      }
      for (const target of targets) {
        target.animate(
          [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
          { duration: 160, easing: 'ease-out' }
        );
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
      const widget = this.layoutItems().find((item) => item.id === id);
      const start = cellFromPoint(this.grid, event.clientX, event.clientY);
      const offset = { col: start.col - widget.grid.col, row: start.row - widget.grid.row };
      overlay.setPointerCapture(event.pointerId);
      overlay.classList.add('is-dragging');
      let last = null;

      this.dragging = new Set([id]);
      let frame = 0;
      let pointer = null;
      const update = () => {
        frame = 0;
        const cell = cellFromPoint(this.grid, pointer.x, pointer.y);
        // Nur neu berechnen, wenn der Zeiger eine andere Rasterzelle erreicht.
        const cellKey = `${cell.col}/${cell.row}`;
        if (cellKey === lastCell) {
          return;
        }
        lastCell = cellKey;
        const layout = moveWidget(items, id, cell.col - offset.col, cell.row - offset.row);
        const key = layout && JSON.stringify([...layout]);
        if (layout && key !== last) {
          last = key;
          this.previewLayout(layout);
        }
      };
      let lastCell = '';
      const items = this.layoutItems();
      const move = (moveEvent) => {
        pointer = { x: moveEvent.clientX, y: moveEvent.clientY };
        if (!frame) {
          frame = window.requestAnimationFrame(update);
        }
      };
      const finish = (commit) => {
        overlay.removeEventListener('pointermove', move);
        overlay.removeEventListener('pointerup', up);
        overlay.removeEventListener('pointercancel', cancel);
        overlay.classList.remove('is-dragging');
        if (frame) {
          window.cancelAnimationFrame(frame);
          update();
        }
        this.dragging = null;
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
      if (!step || event.shiftKey) {
        return;
      }
      event.preventDefault();
      const base = (this.pendingLayout && this.pendingLayout.get(id)) || this.layoutItems().find((item) => item.id === id).grid;
      const working = this.layoutItems().map((widget) => ({ ...widget, grid: (this.pendingLayout && this.pendingLayout.get(widget.id)) || widget.grid }));
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

  // Größe ändern: Griff unten rechts ziehen oder Umschalt+Pfeiltasten am Kachel-Griff.
  attachResize(overlay, grip, id) {
    grip.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      this.flushLayout();
      const widget = this.layoutItems().find((item) => item.id === id);
      grip.setPointerCapture(event.pointerId);
      overlay.classList.add('is-dragging');
      let last = null;

      this.dragging = new Set([id]);
      let frame = 0;
      let pointer = null;
      let lastCell = '';
      const items = this.layoutItems();
      const update = () => {
        frame = 0;
        const cell = cellFromPoint(this.grid, pointer.x, pointer.y);
        const cellKey = `${cell.col}/${cell.row}`;
        if (cellKey === lastCell) {
          return;
        }
        lastCell = cellKey;
        const layout = resizeWidget(items, id, cell.col - widget.grid.col + 1, cell.row - widget.grid.row + 1);
        const key = layout && JSON.stringify([...layout]);
        if (layout && key !== last) {
          last = key;
          this.previewLayout(layout);
        }
      };
      const move = (moveEvent) => {
        pointer = { x: moveEvent.clientX, y: moveEvent.clientY };
        if (!frame) {
          frame = window.requestAnimationFrame(update);
        }
      };
      const finish = (commit) => {
        grip.removeEventListener('pointermove', move);
        grip.removeEventListener('pointerup', up);
        grip.removeEventListener('pointercancel', cancel);
        overlay.classList.remove('is-dragging');
        if (frame) {
          window.cancelAnimationFrame(frame);
          update();
        }
        this.dragging = null;
        if (commit && last) {
          this.commitLayout(this.pendingLayout);
        } else {
          this.previewLayout(this.currentLayout());
        }
      };
      const up = () => finish(true);
      const cancel = () => finish(false);
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', up);
      grip.addEventListener('pointercancel', cancel);
    });

    overlay.addEventListener('keydown', (event) => {
      const steps = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      const step = steps[event.key];
      if (!step || !event.shiftKey) {
        return;
      }
      event.preventDefault();
      const base = (this.pendingLayout && this.pendingLayout.get(id)) || this.layoutItems().find((item) => item.id === id).grid;
      const working = this.layoutItems().map((widget) => ({ ...widget, grid: (this.pendingLayout && this.pendingLayout.get(widget.id)) || widget.grid }));
      const layout = resizeWidget(working, id, base.w + step[0], base.h + step[1]);
      if (!layout) {
        return;
      }
      this.previewLayout(layout);
      window.clearTimeout(this.layoutTimer);
      this.layoutTimer = window.setTimeout(() => this.flushLayout(), 700);
    });
  }

  flushLayout() {
    window.clearTimeout(this.layoutTimer);
    const layout = this.pendingLayout;
    this.pendingLayout = null;
    if (layout) {
      return this.commitLayout(layout);
    }
    return this.layoutSaving;
  }

  commitLayout(layout) {
    this.pendingLayout = null;
    const changed = this.layoutItems().some((widget) => {
      const grid = layout.get(widget.id);
      return grid && (grid.col !== widget.grid.col || grid.row !== widget.grid.row
        || grid.w !== widget.grid.w || grid.h !== widget.grid.h);
    });
    if (!changed) {
      return this.layoutSaving;
    }
    const pageId = this.page.id;
    this.layoutSaving = this.layoutSaving.then(async () => {
      const next = structuredClone(this.config);
      const copy = (grid) => ({ col: grid.col, row: grid.row, w: grid.w, h: grid.h });
      if (layout.get(NAV_ID)) {
        next.navigation.grid = copy(layout.get(NAV_ID));
      }
      for (const widget of next.pages.find((page) => page.id === pageId).widgets) {
        const grid = layout.get(widget.id);
        if (grid) {
          widget.grid = copy(grid);
        }
      }
      try {
        this.arrangeAround(next, pageId);
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

  // Positionen, wie sie im aktuellen Positionierungsmodus angezeigt werden.
  layoutItems() {
    const items = [{ id: NAV_ID, grid: this.config.navigation.grid }, ...this.page.widgets];
    const shown = effectiveLayout(items);
    return items.map((item) => ({ ...item, grid: shown.get(item.id) || item.grid }));
  }

  effectiveGrid(id) {
    return this.layoutItems().find((item) => item.id === id)?.grid;
  }

  createElementFor(widget) {
    const element = createWidgetElement(widget, this.services(), this.snapshots, VIEW_MODE);
    this.place(element, { grid: this.effectiveGrid(widget.id) || widget.grid });
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
    const prefix = { text: 'x', 'fhem-value': 'v', 'fhem-switch': 's', 'fhem-slider': 'l', 'fhem-select': 'q', 'fhem-button': 'b', 'fhem-html': 'h', 'fhem-clock': 'c', 'fhem-icon': 'i', 'fhem-table': 'r', 'fhem-chart': 'g', 'fhem-solarflow': 'f' }[type] || 't';
    const id = this.uniqueId(prefix, new Set(this.page.widgets.map((widget) => widget.id)));
    const size = { text: { w: 24, h: 2 }, 'fhem-value': { w: 12, h: 2 }, 'fhem-switch': { w: 12, h: 2 }, 'fhem-button': { w: 12, h: 2 }, 'fhem-html': { w: 16, h: 3 }, 'fhem-clock': { w: 12, h: 4 }, 'fhem-icon': { w: 6, h: 4 }, 'fhem-table': { w: 24, h: 8 }, 'fhem-slider': { w: 16, h: 6 }, 'fhem-select': { w: 16, h: 5 }, 'fhem-chart': { w: 24, h: 10 }, 'fhem-solarflow': { w: 20, h: 14 } }[type] || { w: 16, h: 2 };
    const grid = { col: 1, row: this.nextFreeRow(), ...size };
    let widget = { id, type, device: '', readings: { actual: '', target: '' }, grid };
    if (type === 'text') {
      widget = { id, type, html: '', grid };
    } else if (type === 'fhem-value') {
      widget = { id, type, device: '', reading: '', grid };
    } else if (type === 'fhem-switch') {
      widget = { id, type, device: '', reading: 'state', on: 'on', off: 'off', grid };
    } else if (type === 'fhem-button') {
      widget = { id, type, device: '', command: '', grid };
    } else if (type === 'fhem-html') {
      widget = { id, type, html: '', devices: [], grid };
    } else if (type === 'fhem-clock') {
      widget = { id, type, style: 'digital', showSeconds: false, showDate: false, showWeekday: false, grid };
    } else if (type === 'fhem-icon') {
      widget = { id, type, device: '', reading: '', states: [], grid };
    } else if (type === 'fhem-table') {
      widget = { id, type, rows: [], grid };
    } else if (type === 'fhem-slider') {
      widget = { id, type, device: '', command: '', reading: '', grid };
    } else if (type === 'fhem-select') {
      widget = { id, type, device: '', command: '', reading: '', mode: 'dropdown', grid };
    } else if (type === 'fhem-solarflow') {
      widget = { id, type, readings: {}, grid };
    } else if (type === 'fhem-chart') {
      widget = { id, type, device: '', reading: '', grid };
    }
    const element = this.createElementFor(widget);
    element.addEventListener('cms-widget-cancel', () => {
      element.remove();
      this.elements.delete(id);
    }, { once: true });
    this.grid.append(element);
    element.openConfig({ isNew: true });
  }

  async persist(config) {
    const saving = this.draftSaving.then(() => this.client.saveDraft(config));
    this.draftSaving = saving.then(
      () => {
        this.draftSaveError = null;
      },
      (error) => {
        this.draftSaveError = error;
      }
    );
    await saving;
    this.config = config;
    this.applyTheme();
    this.setDraft(true);
  }

  async flushDraftWrites() {
    await this.draftSaving;
    if (this.draftSaveError) {
      throw this.draftSaveError;
    }
  }

  async upgradeLayout() {
    if (this.upgrading || this.stopped) return;
    this.upgrading = true;
    this.migrationButton.disabled = true;
    this.toolbar.inert = true;
    this.grid.inert = true;
    this.upgradeMessage.textContent = 'Live und Entwurf werden gesichert und umgestellt …';
    try {
      await this.flushLayout();
      await this.flushDraftWrites();
      if (this.stopped) return;
      this.stop();
      await this.client.upgradeLayout();
      window.location.reload();
    } catch (error) {
      this.stop();
      this.upgradeMessage.textContent = `Umstellung nicht bestätigt: ${error.message}. `
        + 'Zustand und Sicherungen prüfen, dann Seite neu laden. Die Bearbeitung bleibt gesperrt.';
    }
  }

  setDraft(value) {
    this.hasDraft = value;
    this.publishButton.disabled = !value;
    this.discardButton.disabled = !value;
    this.updateIndicator();
  }

  async publish() {
    if (!window.confirm('Den Entwurf jetzt veröffentlichen? Der bisherige Live-Stand wird als Version gesichert und ist über „Backups“ wiederherstellbar.')) {
      return;
    }
    try {
      await this.flushLayout();
      await this.flushDraftWrites();
      await this.client.publishDraft();
    } catch (error) {
      this.setStatus(`Veröffentlichen fehlgeschlagen: ${error.message}`);
      return;
    }
    this.setDraft(false);
    this.setStatus('Entwurf veröffentlicht');
  }

  async discard() {
    if (!window.confirm('Den Entwurf verwerfen? Alle unveröffentlichten Änderungen gehen verloren; die Bearbeitung beginnt wieder beim Live-Stand.')) {
      return;
    }
    try {
      await this.flushLayout();
      await this.flushDraftWrites();
      await this.client.discardDraft();
      this.config = await this.loadConfig('draft');
    } catch (error) {
      this.setStatus(`Verwerfen fehlgeschlagen: ${error.message}`);
      return;
    }
    this.applyTheme();
    this.setDraft(false);
    const target = this.config.pages.some((page) => page.id === this.pageId) ? this.pageId : this.config.pages[0].id;
    if (window.location.hash === `#/${target}`) {
      await this.showPage(target);
    } else {
      window.location.hash = `#/${target}`;
    }
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
      element.data = dataFor(widget, this.snapshots);
      this.place(element, { grid: this.effectiveGrid(widget.id) || widget.grid });
    }
    this.syncOverlays();
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
    this.syncOverlays();
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
      if (element && isLiveWidget(widget)) {
        element.data = dataFor(widget, this.snapshots);
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
      if (element && isLiveWidget(widget) && this.lastSuccess !== null) {
        element.stale = this.lastSuccess;
      }
    }
  }

  // Je Hauptdevice: [Hauptdevice, Kanäle ...]; die Kachel sucht Readings in dieser Reihenfolge.
  groupSnapshots(mains, results) {
    return groupSnapshots(mains, results);
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
    if (this.stopped) {
      return;
    }
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

export async function startCmsDevice(client, startLegacy, startSchema5) {
  const format = await client.getLayoutFormat();
  if (format === 4) return startLegacy();
  if (format === 5 && typeof startSchema5 === 'function') return startSchema5();
  throw new Error(`Layoutformat ${format} kann hier nicht bearbeitet oder angezeigt werden`);
}

async function startSchema5Device(client, shell, card, isSuspended) {
  const [runtime, editorModule, viewModule] = await Promise.all([
    import('./fcui-runtime.js'), import('./fcui-schema5-editor.js'), import('./fcui-schema5-view.js'),
  ]);
  if (isSuspended()) return;
  const liveClient = new FhemClient(client.cmsDevice, client.endpoint);
  if (!VIEW_MODE) {
    const root = document.createElement('section');
    shell.append(root);
    const editor = editorModule.createSchema5Editor({
      GridStack: runtime.GridStack, root, draftClient: client, liveClient,
    });
    await editor.start();
    if (!isSuspended()) card.hidden = true;
    return;
  }
  const state = await client.getVersion5State();
  if (isSuspended()) return;
  const config = PREVIEW_MODE && state.draft ? state.draft : state.live;
  document.documentElement.setAttribute('data-cms-theme', config.theme || 'dark');
  document.documentElement.setAttribute('data-cms-frames', config.settings?.showFrames === false ? 'off' : 'on');
  document.documentElement.style.setProperty('--cms-widget-title-align', config.settings?.titleAlign || 'left');
  const grid = document.createElement('div');
  grid.className = 'grid-stack cms-schema5-grid';
  const workspace = document.createElement('div');
  workspace.className = 'cms-schema5-workspace';
  workspace.append(grid);
  shell.append(workspace);
  const services = createSchema5WidgetServices(client);
  if (SETTINGS_PREVIEW) {
    services.setCommand = services.setTarget = async () => { throw new Error('Geräteaktionen sind in der Vorschau deaktiviert'); };
  }
  const view = new viewModule.Schema5View({
    GridStack: runtime.GridStack, root: grid, status: card, config, client: liveClient,
    services,
  });
  await view.start();
  if (SETTINGS_PREVIEW && !isSuspended()) listenForSettingsPreview({ view });
}

document.addEventListener('DOMContentLoaded', async function () {
  const card = document.querySelector('.cms-status');
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
    card.textContent = 'Ungültiger CMS-Device-Name';
    return;
  }

  card.textContent = 'Konfiguration wird geladen ...';
  let suspended = false;
  const onPageHide = () => { suspended = true; };
  const onPageShow = (event) => {
    if (suspended && event.persisted) window.location.reload();
  };
  const removeStartupListeners = () => {
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('pageshow', onPageShow);
  };
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('pageshow', onPageShow);
  try {
    const client = new FhemClient(cmsDevice);
    await startCmsDevice(client, () => {
      if (suspended) return;
      const page = new CmsPage(cmsDevice, shell, card, client.adminMenuEnabled);
      const started = page.start();
      removeStartupListeners();
      return started;
    }, async () => {
      if (suspended) return;
      await startSchema5Device(client, shell, card, () => suspended);
      if (!suspended) removeStartupListeners();
    });
  } catch (error) {
    if (suspended) return;
    removeStartupListeners();
    document.documentElement.classList.add('cms-view');
    card.hidden = false;
    card.setAttribute('data-error', '');
    card.textContent = `Konfiguration konnte nicht geladen werden: ${error.message || String(error)}`;
  }
});
