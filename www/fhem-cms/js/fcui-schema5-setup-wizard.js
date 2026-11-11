import { isValidName } from './fhem-client.js';

const READING_PRESETS = [
  { names: ['temperature', 'measured-temp', 'measuredTemperature', 'temp'], label: 'Temperatur', unit: '°C' },
  { names: ['humidity', 'relativeHumidity'], label: 'Luftfeuchtigkeit', unit: '%' },
  { names: ['power', 'powerActual'], label: 'Leistung', unit: '' },
  { names: ['energy', 'energyCounter'], label: 'Energie', unit: '' },
  { names: ['batteryPercent', 'batteryLevel'], label: 'Batterie', unit: '%' },
  { names: ['state'], label: 'Status', unit: '' },
];

function element(tag, text) {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  return result;
}

function button(text, onClick, className = 'cms-button') {
  const result = element('button', text);
  result.type = 'button';
  result.className = className;
  result.addEventListener('click', onClick);
  return result;
}

function checkbox(text, checked, onChange) {
  const label = element('label');
  label.className = 'cms-setup-wizard-choice';
  const input = element('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  label.append(input, element('span', text));
  return label;
}

function safeRoomName(value) {
  return typeof value === 'string' && value.trim().length > 0
    && value.trim().length <= 128 && !/[\x00-\x1f\x7f]/.test(value)
    ? value.trim()
    : '';
}

export function groupSchema5DevicesByRoom(devices) {
  if (!Array.isArray(devices)) throw new Error('Ungültige Geräteliste');
  const rooms = new Map();
  for (const device of devices) {
    if (!device || !isValidName(device.name)) continue;
    const sourceRooms = Array.isArray(device.rooms) ? device.rooms : [device.room];
    for (const room of new Set(sourceRooms.map(safeRoomName).filter(Boolean))) {
      if (!rooms.has(room)) rooms.set(room, new Map());
      rooms.get(room).set(device.name, device);
    }
  }
  return new Map([...rooms.entries()]
    .sort(([left], [right]) => left.localeCompare(right, 'de'))
    .map(([room, entries]) => [room, [...entries.values()].sort((left, right) =>
      left.name.localeCompare(right.name, 'de'))]));
}

export function schema5ReadingSuggestions(device) {
  if (!device || !isValidName(device.name)
    || !device.readings || typeof device.readings !== 'object' || Array.isArray(device.readings)) return [];
  return READING_PRESETS.flatMap(({ names, label, unit }) => {
    const reading = names.find((name) => Object.hasOwn(device.readings, name));
    if (!reading) return [];
    const alias = typeof device.alias === 'string' && device.alias.trim()
      && !/[\x00-\x1f\x7f]/.test(device.alias)
      ? device.alias.trim()
      : device.name;
    const title = `${alias} — ${label}`;
    return [{ device: device.name, reading, label, title: title.slice(0, 64), unit }];
  });
}

export function createSchema5RoomPlan(room, devices, selectedNames) {
  const selected = devices.filter(({ name }) => selectedNames.has(name));
  const widgets = selected.flatMap(schema5ReadingSuggestions)
    .map((suggestion) => ({ ...suggestion, included: true }));
  const supportedDevices = new Set(widgets.map(({ device }) => device));
  return {
    room,
    title: room,
    included: true,
    widgets,
    unsupported: selected.filter(({ name }) => !supportedDevices.has(name)).map(({ name }) => name),
  };
}

export function isSchema5InitialSetup(config) {
  if (!config || config.schemaVersion !== 5 || config.theme !== 'dark'
    || config.settings?.layoutMode !== 'grid' || config.settings.gridColumns !== 12
    || config.navigation?.orientation !== 'horizontal'
    || config.navigation.grid?.col !== 1 || config.navigation.grid?.row !== 1
    || config.navigation.grid?.w !== 12 || config.navigation.grid?.h !== 1
    || (config.navigation.items && config.navigation.items.length)
    || !Array.isArray(config.pages) || config.pages.length !== 1) return false;
  const [page] = config.pages;
  return page?.id === 'start' && page.title === 'Start'
    && Array.isArray(page.widgets) && page.widgets.length === 0;
}

function uniqueId(prefix, used) {
  let suffix = 1;
  let id = prefix;
  while (used.has(id)) id = `${prefix}-${suffix++}`;
  used.add(id);
  return id;
}

function firstFreeRow(config, page) {
  return Math.max(
    Number(config.navigation.grid.row) + Number(config.navigation.grid.h),
    ...page.widgets.map(({ grid }) => Number(grid.row) + Number(grid.h)),
  );
}

export function buildSchema5SetupConfig(source, plans) {
  const pages = Array.isArray(plans) ? plans.filter(({ included }) => included) : [];
  if (!source || !Array.isArray(source.pages) || !Array.isArray(pages) || !pages.length) {
    throw new Error('Bitte mindestens eine Seite für die Vorschau aktivieren.');
  }
  if (source.pages.length + pages.length > 50) throw new Error('Die Konfiguration darf höchstens 50 Seiten enthalten.');
  const titles = new Set(source.pages.map(({ title }) => title.trim().toLocaleLowerCase()));
  for (const page of pages) {
    if (typeof page.title !== 'string' || !page.title.trim() || page.title.length > 128
      || /[\x00-\x1f\x7f]/.test(page.title)) {
      throw new Error(`Ungültiger Seitentitel für „${page.room}“.`);
    }
    const normalized = page.title.trim().toLocaleLowerCase();
    if (titles.has(normalized)) {
      throw new Error(`Der Seitentitel „${page.title}“ ist bereits vergeben. Bitte umbenennen oder Seite abwählen.`);
    }
    titles.add(normalized);
    if (page.widgets.filter(({ included }) => included).length > 200) {
      throw new Error(`Die Seite „${page.title}“ überschreitet das Limit von 200 Widgets.`);
    }
  }

  const config = structuredClone(source);
  const pageIds = new Set(config.pages.map(({ id }) => id));
  const widgetIds = new Set(config.pages.flatMap(({ widgets }) => widgets.map(({ id }) => id)));
  const columns = Number(config.settings.gridColumns);
  const widgetsPerRow = columns / 4;
  const widgetWidth = columns / widgetsPerRow;
  const firstRow = firstFreeRow(config, { widgets: [] });
  pages.forEach((plan, pageIndex) => {
    const pageId = uniqueId(`setup-${Date.now().toString(36)}-${pageIndex + 1}`, pageIds);
    const page = { id: pageId, title: plan.title.trim(), widgets: [] };
    plan.widgets.filter(({ included }) => included).forEach((suggestion, index) => {
      const widget = {
        id: uniqueId(`setup-${pageIndex + 1}-${index + 1}`, widgetIds),
        type: 'fhem-value',
        device: suggestion.device,
        reading: suggestion.reading,
        title: suggestion.title,
        grid: {
          col: (index % widgetsPerRow) * widgetWidth + 1,
          row: firstRow + Math.floor(index / widgetsPerRow) * 2,
          w: widgetWidth,
          h: 2,
        },
      };
      if (suggestion.unit) widget.unit = suggestion.unit;
      page.widgets.push(widget);
    });
    config.pages.push(page);
    if (Array.isArray(config.navigation.items)) config.navigation.items.push({ page: pageId });
  });
  return config;
}

export class Schema5SetupWizard {
  #root;
  #controller;
  #client;
  #state;
  #onClose;
  #onComplete;
  #onDismiss;
  #status;
  #rooms = new Map();
  #selectedRooms = new Set();
  #selectedDevices = new Map();
  #roomNames = [];
  #roomIndex = 0;
  #pages = [];
  #busy = false;
  #saving = false;
  #closed = false;
  #suspended = false;
  #requiresReload = false;
  #applyButton = null;

  constructor({ root, controller, client, onClose, onComplete, onDismiss }) {
    if (!root || root.children.length || !controller || typeof controller.snapshot !== 'function'
      || !client || typeof client.jsonlist !== 'function' || typeof onClose !== 'function') {
      throw new Error('Dienste und leerer Container für den Einrichtungsassistenten erforderlich');
    }
    this.#root = root;
    this.#controller = controller;
    this.#client = client;
    this.#state = controller.snapshot();
    this.#onClose = onClose;
    this.#onComplete = onComplete;
    this.#onDismiss = onDismiss;
    this.#status = element('p');
    this.#status.className = 'cms-status';
    this.#status.setAttribute('role', 'status');
    this.#renderWelcome();
  }

  #render(title, description, content, actions) {
    if (this.#closed || this.#suspended) return;
    this.#status.removeAttribute('data-error');
    this.#status.textContent = '';
    const heading = element('h2', title);
    const intro = element('p', description);
    const footer = element('div');
    footer.className = 'cms-panel-footer';
    footer.append(...actions);
    this.#root.replaceChildren(heading, intro, this.#status, content, footer);
  }

  #renderWelcome() {
    const content = element('div');
    content.className = 'cms-setup-wizard-content';
    content.append(
      element('p', 'Der Assistent erstellt eine erste Oberfläche aus FHEM-Räumen und ausgewählten Geräten. Vorhandene Seiten und Widgets bleiben erhalten.'),
      element('p', 'Es werden nur bekannte Readings als nicht schreibende Wertanzeigen vorgeschlagen. Die Änderungen werden erst nach deiner Bestätigung als Entwurf gespeichert.'),
    );
    this.#render('Einrichtungsassistent', 'FHEM-Räume und Geräte auswählen', content, [
      button('Mit leerer Startseite fortfahren', () => {
        this.#onComplete?.();
        this.#finish({ saved: false });
      }),
      button('Räume und Geräte auswählen', () => this.#loadDevices()),
      button('Abbrechen', () => this.#cancel(), 'cms-button cms-panel-close'),
    ]);
  }

  async #loadDevices() {
    if (this.#busy || this.#closed) return;
    this.#busy = true;
    this.#status.textContent = 'FHEM-Geräte werden geladen …';
    try {
      const devices = await this.#client.jsonlist('.*');
      if (this.#suspended || this.#closed) return;
      this.#rooms = groupSchema5DevicesByRoom(devices);
      this.#selectedRooms = new Set(this.#rooms.keys());
      this.#selectedDevices = new Map([...this.#rooms].map(([room, entries]) =>
        [room, new Set(entries.map(({ name }) => name))]));
      this.#renderRooms();
    } catch (error) {
      if (this.#suspended || this.#closed) return;
      this.#status.setAttribute('data-error', '');
      this.#status.textContent = `Geräte konnten nicht geladen werden: ${error.message || String(error)}`;
    } finally {
      this.#busy = false;
    }
  }

  #renderRooms() {
    const content = element('div');
    content.className = 'cms-setup-wizard-list';
    if (!this.#rooms.size) {
      content.append(element('p', 'Es wurden keine Geräte mit einem gültigen FHEM-Raum gefunden. Du kannst abbrechen oder mit der leeren Startseite fortfahren.'));
    } else {
      for (const [room, devices] of this.#rooms) {
        content.append(checkbox(`${room} (${devices.length} Geräte)`, this.#selectedRooms.has(room), (checked) => {
          if (checked) this.#selectedRooms.add(room);
          else this.#selectedRooms.delete(room);
        }));
      }
    }
    this.#render('Räume auswählen', 'Für jeden ausgewählten Raum wird eine eigene Seite vorbereitet.', content, [
      button('Alle auswählen', () => {
        this.#selectedRooms = new Set(this.#rooms.keys());
        this.#renderRooms();
      }),
      button('Keine auswählen', () => {
        this.#selectedRooms.clear();
        this.#renderRooms();
      }),
      button('Zurück', () => this.#renderWelcome()),
      this.#rooms.size
        ? button('Weiter', () => this.#continueRooms(), 'cms-button cms-panel-save')
        : button('Mit leerer Startseite fortfahren', () => {
          this.#onComplete?.();
          this.#finish({ saved: false });
        }, 'cms-button cms-panel-save'),
      button('Abbrechen', () => this.#cancel(), 'cms-button cms-panel-close'),
    ]);
  }

  #continueRooms() {
    this.#roomNames = [...this.#selectedRooms].sort((left, right) => left.localeCompare(right, 'de'));
    if (!this.#roomNames.length) {
      this.#status.setAttribute('data-error', '');
      this.#status.textContent = 'Bitte mindestens einen Raum auswählen.';
      return;
    }
    this.#roomIndex = 0;
    this.#renderDevices();
  }

  #renderDevices() {
    const room = this.#roomNames[this.#roomIndex];
    const devices = this.#rooms.get(room) || [];
    const selected = this.#selectedDevices.get(room);
    const content = element('div');
    content.className = 'cms-setup-wizard-list';
    content.append(element('p', `Raum ${this.#roomIndex + 1} von ${this.#roomNames.length}`));
    if (!devices.length) content.append(element('p', 'In diesem Raum wurden keine Geräte gefunden.'));
    for (const device of devices) {
      const name = device.alias && device.alias !== device.name
        ? `${device.alias} (${device.name})`
        : device.name;
      const details = [device.type, device.parent ? `Kanal von ${device.parent}` : ''].filter(Boolean).join(' · ');
      content.append(checkbox(details ? `${name} — ${details}` : name, selected.has(device.name), (checked) => {
        if (checked) selected.add(device.name);
        else selected.delete(device.name);
      }));
    }
    const actions = [
      button('Alle auswählen', () => {
        this.#selectedDevices.set(room, new Set(devices.map(({ name }) => name)));
        this.#renderDevices();
      }),
      button('Keine auswählen', () => {
        this.#selectedDevices.set(room, new Set());
        this.#renderDevices();
      }),
    ];
    if (this.#roomIndex > 0) {
      actions.push(button('Vorheriger Raum', () => {
        this.#roomIndex -= 1;
        this.#renderDevices();
      }));
    } else {
      actions.push(button('Zurück zu den Räumen', () => this.#renderRooms()));
    }
    actions.push(button(this.#roomIndex + 1 < this.#roomNames.length ? 'Nächster Raum' : 'Vorschau',
      () => {
        if (this.#roomIndex + 1 < this.#roomNames.length) {
          this.#roomIndex += 1;
          this.#renderDevices();
        } else {
          this.#createPreview();
        }
      }, 'cms-button cms-panel-save'));
    actions.push(button('Abbrechen', () => this.#cancel(), 'cms-button cms-panel-close'));
    this.#render(`Geräte in „${room}“ auswählen`, 'Nicht ausgewählte Geräte werden nicht in die Vorschau aufgenommen.', content, actions);
  }

  #createPreview() {
    this.#pages = this.#roomNames.map((room) =>
      createSchema5RoomPlan(room, this.#rooms.get(room) || [], this.#selectedDevices.get(room)));
    this.#renderPreview();
  }

  #titleConflict(page) {
    if (!page.title.trim()) return 'Bitte einen Seitentitel eingeben.';
    if (page.title.length > 128 || /[\x00-\x1f\x7f]/.test(page.title)) return 'Ungültiger Seitentitel.';
    const normalized = page.title.trim().toLocaleLowerCase();
    const config = this.#state.draft || this.#state.live;
    if (config.pages.some(({ title }) => title.trim().toLocaleLowerCase() === normalized)) {
      return 'Dieser Seitentitel ist bereits vergeben.';
    }
    if (this.#pages.some((other) => other !== page && other.included
      && other.title.trim().toLocaleLowerCase() === normalized)) {
      return 'Dieser Seitentitel wird bereits für eine andere ausgewählte Seite verwendet.';
    }
    return '';
  }

  #renderPreview() {
    const content = element('div');
    content.className = 'cms-setup-wizard-preview';
    const updateConflicts = [];
    for (const page of this.#pages) {
      const section = element('section');
      section.className = 'cms-setup-wizard-page';
      section.append(checkbox(`Seite für „${page.room}“ anlegen`, page.included, (checked) => {
        page.included = checked;
        updateConflicts.forEach((update) => update());
      }));
      const titleLabel = element('label', 'Seitentitel');
      const title = element('input');
      title.type = 'text';
      title.maxLength = 128;
      title.value = page.title;
      title.addEventListener('input', () => {
        page.title = title.value;
        updateConflicts.forEach((update) => update());
      });
      titleLabel.append(title);
      const conflict = element('p');
      conflict.className = 'cms-status';
      const updateConflict = () => {
        const message = page.included ? this.#titleConflict(page) : '';
        conflict.textContent = message;
        if (message) conflict.setAttribute('data-error', '');
        else conflict.removeAttribute('data-error');
      };
      updateConflicts.push(updateConflict);
      section.append(titleLabel, conflict);
      for (const device of page.unsupported) {
        section.append(element('p', `${device} — keine passende Vorlage`));
      }
      const suggestions = element('div');
      suggestions.className = 'cms-setup-wizard-list';
      if (!page.widgets.length) {
        suggestions.append(element('p', page.unsupported.length
          ? 'Keine unterstützten Readings gefunden; die Seite bleibt leer.'
          : 'Keine Geräte ausgewählt; die Seite bleibt leer.'));
      }
      for (const widget of page.widgets) {
        suggestions.append(checkbox(`${widget.title} (${widget.device}:${widget.reading})`, widget.included, (checked) => {
          widget.included = checked;
        }));
      }
      section.append(suggestions);
      content.append(section);
    }
    updateConflicts.forEach((update) => update());
    this.#render('Vorschau', 'Seiten und Wertanzeigen prüfen. Bestehende Seiten werden nicht verändert.', content, [
      button('Zurück', () => {
        this.#roomIndex = this.#roomNames.length - 1;
        this.#renderDevices();
      }),
      this.#applyButton = button('Als Entwurf übernehmen', () => this.#apply(), 'cms-button cms-panel-save'),
      button('Abbrechen', () => this.#cancel(), 'cms-button cms-panel-close'),
    ]);
  }

  async #apply() {
    if (this.#busy || this.#closed) return;
    let saveStarted = false;
    try {
      const state = this.#controller.snapshot();
      if (state.token !== this.#state.token) throw new Error('Der Konfigurationsstand hat sich geändert. Bitte Assistent erneut öffnen.');
      const source = state.draft || state.live;
      const config = buildSchema5SetupConfig(source, this.#pages);
      this.#busy = true;
      this.#saving = true;
      saveStarted = true;
      this.#status.removeAttribute('data-error');
      this.#status.textContent = 'Entwurf wird gespeichert …';
      const result = await this.#controller.saveDraft(config, state.token);
      if (this.#suspended || this.#closed) return;
      this.#onComplete?.();
      this.#finish({ saved: true, state: result });
    } catch (error) {
      if (this.#suspended || this.#closed) return;
      this.#status.setAttribute('data-error', '');
      if (saveStarted) {
        this.#requiresReload = true;
        if (this.#applyButton) this.#applyButton.disabled = true;
        this.#status.textContent = `Speichern nicht bestätigt: ${error.message || String(error)}. Bitte abbrechen und den Zustand erneut laden.`;
      } else {
        this.#status.textContent = `Entwurf konnte nicht vorbereitet werden: ${error.message || String(error)}`;
      }
    } finally {
      this.#busy = false;
      this.#saving = false;
    }
  }

  #cancel() {
    if (this.#saving || this.#closed) return;
    if (!this.#requiresReload) this.#onDismiss?.();
    this.#finish({ saved: false, requiresReload: this.#requiresReload });
  }

  #finish(outcome) {
    if (this.#closed) return;
    this.#closed = true;
    if (typeof this.#root.close === 'function' && this.#root.open) this.#root.close();
    this.#root.remove();
    this.#onClose(outcome);
  }

  suspend() {
    if (this.#closed || this.#suspended) return;
    this.#suspended = true;
    this.#root.hidden = true;
    if (!this.#busy) this.close();
  }

  close() {
    if (this.#closed) return;
    this.#closed = true;
    if (typeof this.#root.close === 'function' && this.#root.open) this.#root.close();
    this.#root.replaceChildren();
  }
}
