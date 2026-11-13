import { isValidName } from './fhem-client.js';
import { arrangeSchema5Widgets } from './fcui-schema5-layout.js';

const READING_PRESETS = [
  { names: ['temperature', 'measured-temp', 'measuredTemperature', 'temp'], label: 'Temperatur', unit: '°C' },
  { names: ['humidity', 'relativeHumidity'], label: 'Luftfeuchtigkeit', unit: '%' },
  { names: ['power', 'powerActual'], label: 'Leistung', unit: '' },
  { names: ['energy', 'energyCounter'], label: 'Energie', unit: '' },
  { names: ['batteryPercent', 'batteryLevel'], label: 'Batterie', unit: '%' },
  { names: ['state'], label: 'Status', unit: '' },
];
const MAGIC_DEVICE_TYPES = new Set(['CUL_HM', 'MAX', 'LaCrosse', 'Shelly', 'IT', 'MQTT2_DEVICE', 'MQTT_DEVICE', 'SolaxModbus']);
const MAGIC_MAX_ROOMS = 8;
const MAGIC_MAX_WIDGETS = 8;
const MAGIC_TECHNICAL_ROOMS = new Set([
  ...[...MAGIC_DEVICE_TYPES].map((type) => type.toLowerCase()),
  'at', 'dblog', 'filelog', 'fhem cms', 'fhem-cms', 'hidden', 'notify', 'unsorted',
]);

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
    if (label === 'Luftfeuchtigkeit') {
      const value = String(device.readings[reading]).trim();
      if (!/^\d+(?:\.\d+)?$/.test(value) || Number(value) > 100) return [];
    }
    const alias = typeof device.alias === 'string' && device.alias.trim()
      && !/[\x00-\x1f\x7f]/.test(device.alias)
      ? device.alias.trim()
      : device.name;
    const title = `${alias} — ${label}`;
    return [{ device: device.name, reading, label, title: title.slice(0, 64), unit }];
  });
}

function schema5BaseWidgetSuggestions(device) {
  if (!device || !isValidName(device.name) || !device.readings
    || typeof device.readings !== 'object' || Array.isArray(device.readings)) return [];
  const readings = device.readings;
  if (device.type === 'SolaxModbus' && Object.hasOwn(readings, 'pv_total_power')) {
    const alias = typeof device.alias === 'string' && device.alias.trim()
      && !/[\x00-\x1f\x7f]/.test(device.alias) ? device.alias.trim() : device.name;
    const fields = { pv: { device: device.name, reading: 'pv_total_power' } };
    for (const [field, reading] of [['battery', 'batteryPower'], ['soc', 'batterySOC']]) {
      if (Object.hasOwn(readings, reading)) fields[field] = { device: device.name, reading };
    }
    return [{ type: 'fhem-solarflow', device: device.name, title: alias.slice(0, 64),
      label: 'SolarFlow', readings: fields, deriveHome: false }];
  }
  const commands = typeof device.sets === 'string' ? device.sets.split(/\s+/) : [];
  const hasTemperatureCommand = (name) => commands.some((entry) =>
    entry.startsWith(`${name}:`) && entry.slice(name.length + 1).split(',')
      .some((value) => /^-?\d+(?:\.\d+)?$/.test(value)));
  const hasNoArg = (name) => commands.some((entry) => entry === name || entry === `${name}:noArg`);
  const alias = typeof device.alias === 'string' && device.alias.trim()
    && !/[\x00-\x1f\x7f]/.test(device.alias) ? device.alias.trim() : device.name;
  const title = alias.slice(0, 64);
  const actual = ['temperature', 'measured-temp'].find((name) => Object.hasOwn(readings, name));
  const target = ['desiredTemperature', 'desired-temp'].find((name) => Object.hasOwn(readings, name));
  if (actual && target && hasTemperatureCommand(target)) {
    const fields = { actual, target };
    for (const [field, names] of Object.entries({
      valve: ['valveposition', 'ValvePosition'],
      mode: ['mode', 'R-controlMode', 'controlMode'],
      battery: ['batteryPercent', 'battery', 'batteryState', 'batteryLevel'],
    })) {
      const name = names.find((entry) => Object.hasOwn(readings, entry));
      if (name) fields[field] = name;
    }
    return [{ type: 'thermostat', device: device.name, title, readings: fields, label: 'Thermostat' }];
  }
  if (Object.hasOwn(readings, 'state') && hasNoArg('on') && hasNoArg('off')) {
    const values = schema5ReadingSuggestions(device).filter(({ reading }) => reading !== 'state');
    const extra = values.length > 1
      ? [{ type: 'fhem-table', device: device.name, title, label: 'Messwerte',
        rows: values.map(({ device: name, reading, label, unit }) => ({
          device: name, reading, label, ...(unit ? { unit } : {}),
        })) }]
      : values.map((suggestion) => ({ ...suggestion, type: 'fhem-value' }));
    return [{ type: 'fhem-switch', device: device.name, title, reading: 'state',
      on: 'on', off: 'off', label: 'Schalter' }, ...extra];
  }
  if (actual && target) return [];
  const values = schema5ReadingSuggestions(device).filter(({ reading }) => reading !== 'state');
  if (values.length > 1) {
    return [{ type: 'fhem-table', device: device.name, title, label: 'Messwerte',
      rows: values.map(({ device: name, reading, label, unit }) => ({
        device: name, reading, label, ...(unit ? { unit } : {}),
      })) }];
  }
  const selected = values.length ? values : schema5ReadingSuggestions(device).slice(0, 1);
  return selected.map((suggestion) => ({ ...suggestion, type: 'fhem-value' }));
}

export function schema5TemperatureChartSuggestion(device, logInfo) {
  if (!device || !isValidName(device.name) || !device.readings
    || typeof device.readings !== 'object' || Array.isArray(device.readings)
    || !logInfo || !Array.isArray(logInfo.readings)
    || !/^(?:dblog|filelog)$/.test(logInfo.source)) return [];
  const reading = ['temperature', 'measured-temp', 'measuredTemperature', 'temp']
    .find((name) => Object.hasOwn(device.readings, name) && logInfo.readings.includes(name));
  if (!reading) return [];
  const alias = typeof device.alias === 'string' && device.alias.trim()
    && !/[\x00-\x1f\x7f]/.test(device.alias) ? device.alias.trim() : device.name;
  return [{
    type: 'fhem-chart', device: device.name, reading, source: logInfo.source,
    title: `${alias} — Temperaturverlauf`.slice(0, 64), label: 'Temperaturverlauf', unit: '°C',
  }];
}

export function schema5WidgetSuggestions(device, logInfo) {
  return [
    ...schema5BaseWidgetSuggestions(device),
    ...schema5TemperatureChartSuggestion(device, logInfo),
  ];
}

export function createSchema5MagicPlan(devices, loggedReadingsByDevice = new Map()) {
  const grouped = groupSchema5DevicesByRoom(devices);
  const childrenByParent = new Map();
  for (const device of devices) {
    if (!device?.parent) continue;
    if (!childrenByParent.has(device.parent)) childrenByParent.set(device.parent, []);
    childrenByParent.get(device.parent).push(device);
  }
  const roomPriority = (room) => /^(wohnzimmer|living(?:room)?)$/i.test(room) ? 0
    : /^(küche|kueche|kitchen)$/i.test(room) ? 1 : 2;
  const candidates = [...grouped].filter(([room]) => !MAGIC_TECHNICAL_ROOMS.has(room.toLowerCase()))
    .map(([room, entries]) => {
    const resolved = new Map();
    for (const device of entries.filter((entry) => MAGIC_DEVICE_TYPES.has(entry.type))) {
      const child = (childrenByParent.get(device.name) || []).find((entry) =>
        schema5WidgetSuggestions(entry).some(({ type }) => type === 'thermostat'));
      const selected = child || device;
      resolved.set(selected.name, selected);
    }
    const suggestions = [...resolved.values()].flatMap((device) =>
      schema5WidgetSuggestions(device, loggedReadingsByDevice.get(device.name)));
    const temperatures = suggestions.filter((widget) =>
      widget.type === 'fhem-value' && widget.label === 'Temperatur');
    if (temperatures.length > 1) {
      for (let index = 0; index < temperatures.length; index += 8) {
        const group = temperatures.slice(index, index + 8);
        if (group.length === 1) continue;
        suggestions.push({
          type: 'fhem-table', device: group[0].device, title: 'Temperaturen', label: 'Messwerte',
          rows: group.map(({ device, reading, title, unit }) => ({
            device, reading, label: title.replace(/ — Temperatur$/, '').slice(0, 32), unit,
          })),
        });
        for (const widget of group) suggestions.splice(suggestions.indexOf(widget), 1);
      }
    }
    const widgets = suggestions
      .sort((a, b) => {
        const rank = (widget) => widget.type === 'fhem-solarflow' ? 0 : widget.type === 'thermostat' ? 1
          : widget.type === 'fhem-switch' ? 2 : widget.type === 'fhem-chart' ? 3
            : widget.type === 'fhem-table' ? 4 : 5;
        return rank(a) - rank(b) || a.device.localeCompare(b.device, 'de');
      }).slice(0, MAGIC_MAX_WIDGETS).map((widget) => ({ ...widget, included: true }));
    return { room, title: room, included: true, widgets, unsupported: [] };
  }).filter((page) => page.widgets.length)
    .sort((a, b) => roomPriority(a.room) - roomPriority(b.room) || a.room.localeCompare(b.room, 'de'))
    .slice(0, MAGIC_MAX_ROOMS);
  if (!candidates.length) throw new Error('Keine geeigneten Räume und unterstützten Geräte für Magic gefunden.');
  const titles = new Set(['start']);
  for (const page of candidates.slice(1)) {
    let title = page.title;
    let suffix = 2;
    while (titles.has(title.toLocaleLowerCase())) {
      const ending = ` (${suffix++})`;
      title = `${page.room.slice(0, 128 - ending.length)}${ending}`;
    }
    page.title = title;
    titles.add(title.toLocaleLowerCase());
  }
  return { pages: candidates, startRoom: candidates[0].room };
}

export function createSchema5RoomPlan(room, devices, selectedNames, loggedReadingsByDevice = new Map()) {
  const selected = devices.filter(({ name }) => selectedNames.has(name));
  const widgets = selected.flatMap((device) =>
    schema5WidgetSuggestions(device, loggedReadingsByDevice.get(device.name)))
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

export function arrangeSchema5SetupPages(config) {
  let result = config;
  for (const page of config.pages) result = arrangeSchema5Widgets(result, page.id);
  return result;
}

export function buildSchema5SetupConfig(source, plans, startRoom = '') {
  const pages = Array.isArray(plans) ? plans.filter(({ included }) => included) : [];
  if (!source || !Array.isArray(source.pages) || !Array.isArray(pages) || !pages.length) {
    throw new Error('Bitte mindestens eine Seite für die Vorschau aktivieren.');
  }
  const startPlan = startRoom ? pages.find(({ room }) => room === startRoom) : null;
  if (startRoom && !startPlan) throw new Error('Bitte einen ausgewählten Raum als Startseite wählen.');
  const initialPage = source.pages.find(({ id }) => id === 'start');
  const reuseStart = Boolean(startPlan && initialPage && initialPage.title === 'Start'
    && initialPage.widgets.length === 0);
  if (source.pages.length + pages.length - (reuseStart ? 1 : 0) > 50) {
    throw new Error('Die Konfiguration darf höchstens 50 Seiten enthalten.');
  }
  const titles = new Set(source.pages.map(({ title }) => title.trim().toLocaleLowerCase()));
  for (const page of pages) {
    if (typeof page.title !== 'string' || !page.title.trim() || page.title.length > 128
      || /[\x00-\x1f\x7f]/.test(page.title)) {
      throw new Error(`Ungültiger Seitentitel für „${page.room}“.`);
    }
    const normalized = (reuseStart && page === startPlan ? 'Start' : page.title.trim()).toLocaleLowerCase();
    if (!(reuseStart && page === startPlan) && titles.has(normalized)) {
      throw new Error(`Der Seitentitel „${page.title}“ ist bereits vergeben. Bitte umbenennen oder Seite abwählen.`);
    }
    titles.add(normalized);
    if (page.widgets.filter(({ included }) => included).length > 200) {
      throw new Error(`Die Seite „${page.title}“ überschreitet das Limit von 200 Widgets.`);
    }
  }

  const config = structuredClone(source);
  config.navigation.orientation = 'vertical';
  const pageIds = new Set(config.pages.map(({ id }) => id));
  const widgetIds = new Set(config.pages.flatMap(({ widgets }) => widgets.map(({ id }) => id)));
  const columns = Number(config.settings.gridColumns);
  const scale = columns / 12;
  const widgetWidth = 4 * scale;
  const widgetHeight = 2 * scale;
  const firstRow = firstFreeRow(config, { widgets: [] });
  pages.forEach((plan, pageIndex) => {
    const page = reuseStart && plan === startPlan
      ? config.pages.find(({ id }) => id === 'start')
      : { id: uniqueId(`setup-${Date.now().toString(36)}-${pageIndex + 1}`, pageIds),
        title: plan.title.trim(), widgets: [] };
    const included = plan.widgets.filter(({ included }) => included);
    let row = firstRow;
    let col = 1;
    let rowHeight = 0;
    included.forEach((suggestion, index) => {
      const width = suggestion.type === 'fhem-chart' ? columns : widgetWidth;
      const height = suggestion.type === 'fhem-chart' ? 6 * scale
        : suggestion.type === 'fhem-table'
          ? Math.max(2, Math.ceil((suggestion.rows.length + 2) / 2)) * scale
          : suggestion.type === 'fhem-solarflow' ? 4 * scale : widgetHeight;
      if (col > 1 && col + width - 1 > columns) {
        row += rowHeight;
        col = 1;
        rowHeight = 0;
      }
      rowHeight = Math.max(rowHeight, height);
      const widget = {
        id: uniqueId(`setup-${pageIndex + 1}-${index + 1}`, widgetIds),
        type: suggestion.type || 'fhem-value',
        title: suggestion.title,
        grid: {
          col,
          row,
          w: width,
          h: height,
        },
      };
      if (widget.type === 'fhem-table') widget.rows = structuredClone(suggestion.rows);
      else if (widget.type === 'fhem-solarflow') {
        widget.readings = structuredClone(suggestion.readings);
        widget.deriveHome = false;
      }
      else {
        widget.device = suggestion.device;
        if (widget.type === 'thermostat') widget.readings = { ...suggestion.readings };
        else {
          widget.reading = suggestion.reading;
          if (widget.type === 'fhem-chart') {
            widget.source = suggestion.source;
            if (suggestion.unit) widget.unit = suggestion.unit;
          }
          else if (widget.type === 'fhem-switch') {
            widget.on = suggestion.on;
            widget.off = suggestion.off;
          } else if (suggestion.unit) widget.unit = suggestion.unit;
        }
      }
      page.widgets.push(widget);
      col += width;
      if (col > columns) {
        row += rowHeight;
        col = 1;
        rowHeight = 0;
      }
    });
    if (!(reuseStart && plan === startPlan)) {
      config.pages.push(page);
      if (Array.isArray(config.navigation.items)) config.navigation.items.push({ page: page.id });
    }
    if (plan === startPlan) {
      config.pages.splice(config.pages.indexOf(page), 1);
      config.pages.unshift(page);
      if (!reuseStart) {
        config.navigation.items ||= [];
        const oldStart = config.pages.find((entry) => entry !== page && entry.title === 'Start');
        if (oldStart) {
          let oldItem = config.navigation.items.find((item) => item.page === oldStart.id);
          if (!oldItem) {
            oldItem = { page: oldStart.id };
            config.navigation.items.push(oldItem);
          }
          if (!oldItem.label || oldItem.label === 'Start') oldItem.label = 'Start (bisher)';
        }
        let item = config.navigation.items.find((entry) => entry.page === page.id);
        if (!item) {
          item = { page: page.id };
          config.navigation.items.push(item);
        }
        item.label = 'Start';
      }
    }
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
  #fitNavigation;
  #status;
  #rooms = new Map();
  #selectedRooms = new Set();
  #selectedDevices = new Map();
  #roomNames = [];
  #roomIndex = 0;
  #pages = [];
  #startRoom = '';
  #loggedReadings = new Map();
  #temperatureWarnings = [];
  #temperatureFailures = [];
  #busy = false;
  #saving = false;
  #closed = false;
  #suspended = false;
  #requiresReload = false;

  constructor({ root, controller, client, onClose, onComplete, onDismiss, fitNavigation }) {
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
    this.#fitNavigation = fitNavigation;
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
    const config = this.#state.draft || this.#state.live;
    content.append(
      element('p', 'Der Assistent erstellt eine erste Oberfläche aus FHEM-Räumen und ausgewählten Geräten. Vorhandene Seiten und Widgets bleiben erhalten.'),
      element('p', 'Für unterstützte Geräte werden passende Widgets vorgeschlagen. Schalter und Thermostate können Geräte steuern. Magic erstellt nach einem Klick automatisch einen Entwurf; eine Veröffentlichung erfolgt nicht.'),
      element('p', 'Magic berücksichtigt höchstens acht Räume mit je acht Widgets und nur ausgewählte Gerätetypen. Weitere Räume und Geräte können später manuell hinzugefügt werden.'),
    );
    this.#render('Einrichtungsassistent', 'FHEM-Räume und Geräte auswählen', content, [
      button(isSchema5InitialSetup(config) ? 'Mit leerer Startseite fortfahren' : 'Ohne Änderungen fortfahren', () => {
        this.#onComplete?.();
        this.#finish({ saved: false });
      }),
      button('Räume und Geräte auswählen', () => this.#loadDevices()),
      button('Magic - auf gut Glück', () => this.#magic()),
    ]);
  }

  async #magic() {
    if (this.#busy || this.#closed) return;
    this.#busy = true;
    this.#status.removeAttribute('data-error');
    this.#status.textContent = 'FHEM-Geräte werden für Magic analysiert …';
    try {
      const devices = await this.#client.jsonlist('.*');
      if (this.#suspended || this.#closed) return;
      const logs = await this.#loadTemperatureReadings(devices.filter(({ type }) => MAGIC_DEVICE_TYPES.has(type)));
      if (this.#suspended || this.#closed) return;
      if (logs.failures.length) {
        throw new Error(logs.failures.join(' '));
      }
      this.#loggedReadings = logs.readings;
      this.#temperatureWarnings = logs.warnings;
      const plan = createSchema5MagicPlan(devices, this.#loggedReadings);
      this.#pages = plan.pages;
      this.#startRoom = plan.startRoom;
    } catch (error) {
      if (!this.#suspended && !this.#closed) {
        this.#status.setAttribute('data-error', '');
        this.#status.textContent = `Magic konnte nicht vorbereitet werden: ${error.message || String(error)}`;
      }
      return;
    } finally {
      this.#busy = false;
    }
    if (!this.#suspended && !this.#closed) await this.#apply();
  }

  async #loadTemperatureReadings(devices) {
    const candidates = [...new Map(devices.flatMap((device) => {
      if (!device || !isValidName(device.name) || !device.readings
        || typeof device.readings !== 'object' || Array.isArray(device.readings)) return [];
      const reading = ['temperature', 'measured-temp', 'measuredTemperature', 'temp']
        .find((name) => Object.hasOwn(device.readings, name));
      return reading ? [[device.name, { device, reading }]] : [];
    })).values()];
    const readings = new Map();
    const warnings = [];
    const failures = [];
    if (!candidates.length) return { readings, warnings, failures };
    if (typeof this.#client.logReadings !== 'function') {
      failures.push('Die geloggten Temperatur-Readings konnten mit diesem FHEM-Client nicht geprüft werden.');
      return { readings, warnings, failures };
    }

    for (let offset = 0; offset < candidates.length; offset += 4) {
      const batch = candidates.slice(offset, offset + 4);
      this.#status.textContent = `Temperaturverläufe werden geprüft (${Math.min(offset + batch.length, candidates.length)}/${candidates.length}) …`;
      const results = await Promise.all(batch.map(async ({ device, reading }) => {
        try {
          const result = await this.#client.logReadings(device.name);
          if (!result || !/^(?:dblog|filelog)$/.test(result.source)
            || !Array.isArray(result.readings)) {
            throw new Error('FHEM lieferte eine ungültige Reading-Liste.');
          }
          return { device, reading, result };
        } catch (error) {
          return { device, reading, error };
        }
      }));
      if (this.#suspended || this.#closed) return { readings, warnings, failures };
      for (const { device, reading, result, error } of results) {
        if (error) {
          const message = error.message || String(error);
          const detail = /Kein DbLog-Device|Kein DbLog- oder FileLog-Device/.test(message)
            ? `${device.name}: keine DbLog-/FileLog-Quelle vorhanden; kein Temperaturverlauf ergänzt.`
            : `${device.name}: Temperaturverlauf konnte nicht geprüft werden (${message}).`;
          (detail.includes('keine DbLog-') ? warnings : failures).push(detail);
          continue;
        }
        readings.set(device.name, result);
        if (!result.readings.includes(reading)) {
          warnings.push(`${device.name}: ${reading} ist nicht geloggt; kein Temperaturverlauf ergänzt.`);
        }
      }
    }
    return { readings, warnings, failures };
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
          return this.#createPreview();
        }
      }, 'cms-button cms-panel-save'));
    actions.push(button('Abbrechen', () => this.#cancel(), 'cms-button cms-panel-close'));
    this.#render(`Geräte in „${room}“ auswählen`, 'Nicht ausgewählte Geräte werden nicht in die Vorschau aufgenommen.', content, actions);
  }

  async #createPreview() {
    if (this.#busy || this.#closed) return;
    this.#busy = true;
    try {
      const selectedNames = new Set(this.#roomNames.flatMap((room) =>
        [...(this.#selectedDevices.get(room) || [])]));
      const selectedDevices = [...new Map([...this.#rooms.values()].flat()
        .filter(({ name }) => selectedNames.has(name)).map((device) => [device.name, device])).values()];
      const logs = await this.#loadTemperatureReadings(selectedDevices);
      if (this.#suspended || this.#closed) return;
      this.#loggedReadings = logs.readings;
      this.#temperatureWarnings = logs.warnings;
      this.#temperatureFailures = logs.failures;
      this.#pages = this.#roomNames.map((room) =>
        createSchema5RoomPlan(room, this.#rooms.get(room) || [], this.#selectedDevices.get(room), this.#loggedReadings));
      this.#startRoom = this.#pages[0]?.room || '';
      this.#renderPreview();
    } finally {
      this.#busy = false;
    }
  }

  #titleConflict(page) {
    if (!page.title.trim()) return 'Bitte einen Seitentitel eingeben.';
    if (page.title.length > 128 || /[\x00-\x1f\x7f]/.test(page.title)) return 'Ungültiger Seitentitel.';
    const config = this.#state.draft || this.#state.live;
    const reusableStart = config.pages.some((entry) => entry.id === 'start'
      && entry.title === 'Start' && !entry.widgets.length);
    const effectiveTitle = (entry) => reusableStart && entry.room === this.#startRoom
      ? 'start' : entry.title.trim().toLocaleLowerCase();
    const normalized = effectiveTitle(page);
    if (config.pages.some((entry) => !(reusableStart && page.room === this.#startRoom && entry.id === 'start')
      && entry.title.trim().toLocaleLowerCase() === normalized)) {
      return 'Dieser Seitentitel ist bereits vergeben.';
    }
    if (this.#pages.some((other) => other !== page && other.included
      && effectiveTitle(other) === normalized)) {
      return 'Dieser Seitentitel wird bereits für eine andere ausgewählte Seite verwendet.';
    }
    return '';
  }

  #renderPreview() {
    const content = element('div');
    content.className = 'cms-setup-wizard-preview';
    const updateConflicts = [];
    const startLabel = element('label', 'Raum für die Startseite ');
    const startSelect = element('select');
    const updateStartOptions = () => {
      const selected = this.#pages.filter((page) => page.included);
      if (!selected.some((page) => page.room === this.#startRoom)) {
        this.#startRoom = selected[0]?.room || '';
      }
      startSelect.replaceChildren();
      for (const page of selected) {
        const option = element('option', page.title || page.room);
        option.value = page.room;
        startSelect.append(option);
      }
      startSelect.value = this.#startRoom;
    };
    startSelect.addEventListener('change', () => {
      this.#startRoom = startSelect.value;
      updateConflicts.forEach((update) => update());
    });
    startLabel.append(startSelect);
    content.append(startLabel, element('p', 'Die Navigation wird vertikal angeordnet. Widgets auf allen Seiten werden automatisch angeordnet; dabei können sich auch vorhandene Widgetpositionen ändern.'));
    for (const message of [...this.#temperatureWarnings, ...this.#temperatureFailures]) {
      const warning = element('p', message);
      warning.className = 'cms-status';
      if (this.#temperatureFailures.includes(message)) warning.setAttribute('data-error', '');
      content.append(warning);
    }
    for (const page of this.#pages) {
      const section = element('section');
      section.className = 'cms-setup-wizard-page';
      section.append(checkbox(`Seite für „${page.room}“ anlegen`, page.included, (checked) => {
        page.included = checked;
        updateStartOptions();
        updateConflicts.forEach((update) => update());
      }));
      const titleLabel = element('label', 'Seitentitel');
      const title = element('input');
      title.type = 'text';
      title.maxLength = 128;
      title.value = page.title;
      title.addEventListener('input', () => {
        page.title = title.value;
        updateStartOptions();
        updateConflicts.forEach((update) => update());
      });
      titleLabel.append(title);
      const conflict = element('p');
      conflict.className = 'cms-status';
      const updateConflict = () => {
        const config = this.#state.draft || this.#state.live;
        const usesStart = page.room === this.#startRoom
          && config.pages.some((entry) => entry.id === 'start' && entry.title === 'Start' && !entry.widgets.length);
        title.disabled = usesStart;
        if (usesStart) title.value = 'Start';
        else if (title.value === 'Start' && page.title !== 'Start') title.value = page.title;
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
        const detail = widget.type === 'thermostat' ? 'Thermostat'
          : widget.type === 'fhem-switch' ? 'Schalter'
            : widget.type === 'fhem-table' ? 'Messwerte'
                : widget.type === 'fhem-solarflow' ? 'SolarFlow'
                  : widget.type === 'fhem-chart' ? 'Temperaturverlauf' : `Wert: ${widget.reading}`;
        suggestions.append(checkbox(`${widget.title} (${widget.device} · ${detail})`, widget.included, (checked) => {
          widget.included = checked;
        }));
      }
      section.append(suggestions);
      content.append(section);
    }
    updateStartOptions();
    updateConflicts.forEach((update) => update());
    this.#render('Vorschau', 'Seiten und Widget-Vorschläge prüfen. Bestehende Inhalte bleiben erhalten.', content, [
      button('Zurück', () => {
        this.#roomIndex = this.#roomNames.length - 1;
        this.#renderDevices();
      }),
      button('Als Entwurf übernehmen', () => this.#apply(), 'cms-button cms-panel-save'),
      button('Abbrechen', () => this.#cancel(), 'cms-button cms-panel-close'),
    ]);
  }

  async #apply() {
    if (this.#busy || this.#closed) return;
    let saveStarted = false;
    try {
      const state = this.#controller.snapshot();
      if (state.token !== this.#state.token) throw new Error('Der Konfigurationsstand hat sich geändert. Bitte die Seite neu laden.');
      const source = state.draft || state.live;
      let config = buildSchema5SetupConfig(source, this.#pages, this.#startRoom);
      if (typeof this.#fitNavigation === 'function') config = this.#fitNavigation(config);
      config = arrangeSchema5SetupPages(config);
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
        this.#root.children[4].replaceChildren(button('Abbrechen und Zustand erneut laden', () => this.#cancel()));
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
