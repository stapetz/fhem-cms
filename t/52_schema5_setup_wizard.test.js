import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import {
  arrangeSchema5SetupPages,
  buildSchema5SetupConfig,
  createSchema5MagicPlan,
  createSchema5RoomPlan,
  groupSchema5DevicesByRoom,
  isSchema5InitialSetup,
  schema5ReadingSuggestions,
  schema5TemperatureChartSuggestion,
  schema5WidgetSuggestions,
  Schema5SetupWizard,
} from '../www/fhem-cms/js/fcui-schema5-setup-wizard.js';
import { schema5GridItems } from '../www/fhem-cms/js/fcui-schema5-layout.js';

const initialConfig = () => ({
  schemaVersion: 5, theme: 'dark', settings: { layoutMode: 'grid', gridColumns: 12 },
  navigation: { orientation: 'horizontal', grid: { col: 1, row: 1, w: 12, h: 1 } },
  pages: [{ id: 'start', title: 'Start', widgets: [] }],
});

test('setup wizard groups all rooms without changing legacy first-room semantics', () => {
  const grouped = groupSchema5DevicesByRoom([
    { name: 'LivingSensor', room: 'Living', rooms: ['Living', 'Kitchen', 'Living'] },
    { name: 'NoRoom', room: '', rooms: [] },
    { name: 'BadRoom', room: '', rooms: ['\n'] },
    { name: 'LivingSensor', room: 'Living', rooms: ['Living'] },
  ]);
  assert.deepEqual([...grouped.keys()], ['Kitchen', 'Living']);
  assert.deepEqual(grouped.get('Kitchen').map(({ name }) => name), ['LivingSensor']);
  assert.deepEqual(grouped.get('Living').map(({ name }) => name), ['LivingSensor']);
});

test('setup wizard suggests only allowlisted read-only readings', () => {
  assert.deepEqual(schema5ReadingSuggestions({
    name: 'LivingSensor',
    alias: 'Wohnzimmer',
    readings: {
      temperature: '21.4',
      'measured-temp': '21.3',
      state: 'on',
      desiredTemp: '22',
      command: 'set something',
    },
  }), [
    { device: 'LivingSensor', reading: 'temperature', label: 'Temperatur', title: 'Wohnzimmer — Temperatur', unit: '°C' },
    { device: 'LivingSensor', reading: 'state', label: 'Status', title: 'Wohnzimmer — Status', unit: '' },
  ]);
});

test('wizard omits temperature suggestions without a finite measured value', () => {
  for (const value of ['', ' ', 'unknown', '???', null, undefined, true, Infinity, NaN]) {
    const device = { name: 'Heat', readings: { temperature: value, 'desired-temp': '21' },
      sets: 'desired-temp:slider,5,0.5,30' };
    assert.ok(!schema5ReadingSuggestions(device).some(({ label }) => label === 'Temperatur'));
    assert.deepEqual(schema5TemperatureChartSuggestion(device, {
      source: 'dblog', readings: ['temperature'],
    }), []);
    assert.ok(!schema5WidgetSuggestions(device).some(({ type }) => type === 'thermostat'));
  }
  assert.ok(schema5ReadingSuggestions({ name: 'Zero', readings: { temperature: '0' } })
    .some(({ label }) => label === 'Temperatur'));
});

test('setup wizard includes only selected devices and labels unsupported devices in the preview plan', () => {
  const plan = createSchema5RoomPlan('Wohnzimmer', [
    { name: 'Temp', readings: { temperature: '21' } },
    { name: 'Unknown', readings: { customReading: 'value' } },
    { name: 'NotSelected', readings: { state: 'on' } },
  ], new Set(['Temp', 'Unknown']));
  assert.deepEqual(plan.widgets.map(({ device, reading }) => ({ device, reading })),
    [{ device: 'Temp', reading: 'temperature' }]);
  assert.deepEqual(plan.unsupported, ['Unknown']);
});

test('setup wizard detects thermostats and switches only with corresponding available commands', () => {
  const thermostat = { name: 'Heat', type: 'MAX', readings: {
    temperature: '21', desiredTemperature: '22', valveposition: '10', battery: 'ok',
  }, sets: 'desiredTemperature:slider,5,0.5,30' };
  assert.deepEqual(schema5WidgetSuggestions(thermostat), [{
    type: 'thermostat', device: 'Heat', title: 'Heat', label: 'Thermostat',
    readings: { actual: 'temperature', target: 'desiredTemperature', valve: 'valveposition', battery: 'battery' },
  }]);
  assert.deepEqual(schema5WidgetSuggestions({
    name: 'Light', readings: { state: 'off', power: '1' }, sets: 'on:noArg off:noArg toggle:noArg',
  }), [
    { type: 'fhem-switch', device: 'Light', title: 'Light', reading: 'state',
      on: 'on', off: 'off', label: 'Schalter' },
    { type: 'fhem-value', device: 'Light', reading: 'power', label: 'Leistung',
      title: 'Light — Leistung', unit: '' },
  ]);
  assert.deepEqual(schema5WidgetSuggestions({ ...thermostat, sets: '' }), []);
  assert.deepEqual(schema5WidgetSuggestions({ ...thermostat, sets: 'desiredTemperature:noArg' }), []);
  assert.deepEqual(schema5WidgetSuggestions({ ...thermostat, sets: 'desiredTemperature:auto,off' }), []);
  assert.ok(schema5WidgetSuggestions({ name: 'Light', readings: { state: 'off' },
    sets: 'on:slider,0,1,100 off:noArg' }).every(({ type }) => type === 'fhem-value'));
  assert.deepEqual(schema5WidgetSuggestions({ name: 'Unknown', readings: { custom: 'x' } }), []);
});

test('wizard adds only logged temperature charts and prefers the detected source explicitly', () => {
  const device = { name: 'Thermometer', alias: 'Wohnzimmer', readings: { temperature: '21' } };
  assert.deepEqual(schema5TemperatureChartSuggestion(device, {
    source: 'dblog', readings: ['temperature'],
  }), [{
    type: 'fhem-chart', device: 'Thermometer', reading: 'temperature', source: 'dblog',
    title: 'Wohnzimmer — Temperaturverlauf', label: 'Temperaturverlauf', unit: '°C',
  }]);
  assert.deepEqual(schema5TemperatureChartSuggestion(device, {
    source: 'filelog', readings: ['temperature'],
  })[0].source, 'filelog');
  assert.deepEqual(schema5TemperatureChartSuggestion(device, {
    source: 'dblog', readings: ['state'],
  }), []);
  assert.deepEqual(schema5TemperatureChartSuggestion(device, null), []);

  const plan = createSchema5RoomPlan('Wohnzimmer', [device], new Set(['Thermometer']),
    new Map([['Thermometer', { source: 'filelog', readings: ['temperature'] }]]));
  const config = buildSchema5SetupConfig(initialConfig(), [plan], 'Wohnzimmer');
  const chart = config.pages[0].widgets[0];
  assert.deepEqual({ type: chart.type, device: chart.device, reading: chart.reading, source: chart.source, unit: chart.unit },
    { type: 'fhem-chart', device: 'Thermometer', reading: 'temperature', source: 'filelog', unit: '°C' });
  assert.deepEqual(chart.grid, { col: 1, row: 2, w: 12, h: 6 });
  const validation = spawnSync('perl', ['-e', `
    use strict; use warnings; use JSON::PP ();
    sub Log3 {}
    require './FHEM/01_FHEMCMS.pm';
    local $/;
    my $config = JSON::PP->new->utf8->decode(<STDIN>);
    my $error = FHEMCMS_ValidateConfig($config, 5);
    if (defined $error) { print STDERR $error; exit 1; }
  `], { input: JSON.stringify(config), encoding: 'utf8' });
  assert.equal(validation.status, 0, validation.stderr);
});

test('wizard groups multiple sensor readings into a valid table with enough space', () => {
  const device = { name: 'Sensor', readings: { temperature: '21', humidity: '40', state: 'ok' } };
  const plan = createSchema5RoomPlan('Wohnzimmer', [device], new Set(['Sensor']));
  assert.equal(plan.widgets.length, 1);
  assert.equal(plan.widgets[0].type, 'fhem-table');
  assert.deepEqual(plan.widgets[0].rows.map(({ reading }) => reading), ['temperature', 'humidity']);
  const config = buildSchema5SetupConfig(initialConfig(), [plan], 'Wohnzimmer');
  const widget = config.pages[0].widgets[0];
  assert.equal(widget.grid.h, 2);
  assert.equal(widget.device, undefined);
  const validation = spawnSync('perl', ['-e', `
    use strict; use warnings; use JSON::PP ();
    sub Log3 {}
    require './FHEM/01_FHEMCMS.pm';
    local $/;
    my $config = JSON::PP->new->utf8->decode(<STDIN>);
    my $error = FHEMCMS_ValidateConfig($config, 5);
    if (defined $error) { print STDERR $error; exit 1; }
  `], { input: JSON.stringify(config), encoding: 'utf8' });
  assert.equal(validation.status, 0, validation.stderr);
  assert.doesNotThrow(() => arrangeSchema5SetupPages(config));
});

test('magic excludes technical rooms and resolves thermostat commands on Homematic channels', () => {
  const devices = [
    { name: 'Heat', type: 'CUL_HM', rooms: ['Wohnzimmer', 'CUL_HM'],
      readings: { 'measured-temp': '21', 'desired-temp': '20', batteryLevel: '2.5' }, sets: '' },
    { name: 'Heat_Climate', parent: 'Heat', type: 'CUL_HM', rooms: ['CUL_HM'],
      readings: { 'measured-temp': '21', 'desired-temp': '20', ValvePosition: '4' },
      sets: 'desired-temp:on,off,5.0,5.5,20.0,30.0' },
    { name: 'Unresolved', type: 'CUL_HM', rooms: ['Wohnzimmer'],
      readings: { 'measured-temp': '20', 'desired-temp': '21', batteryLevel: '3' }, sets: '' },
  ];
  const { pages } = createSchema5MagicPlan(devices);
  assert.deepEqual(pages.map(({ room }) => room), ['Wohnzimmer']);
  assert.deepEqual(pages[0].widgets.map(({ type, device }) => ({ type, device })),
    [{ type: 'thermostat', device: 'Heat_Climate' }]);
  assert.equal(pages[0].widgets[0].readings.actual, 'measured-temp');
  assert.equal(pages[0].widgets[0].readings.target, 'desired-temp');
  assert.equal(pages[0].widgets[0].readings.battery, undefined);
});

test('wizard maps SolaxModbus total PV and battery without guessing unknown grid direction', () => {
  const solar = { name: 'Solar', type: 'SolaxModbus', rooms: ['Garten'],
    readings: { pv_total_power: '1200 W', pv1Power: '600', pv2Power: '600',
      batteryPower: '200', batterySOC: '60', gridMeterPower: '-100' } };
  const plan = createSchema5MagicPlan([solar]);
  const config = buildSchema5SetupConfig(initialConfig(), plan.pages, plan.startRoom);
  const widget = config.pages[0].widgets[0];
  assert.equal(widget.type, 'fhem-solarflow');
  assert.deepEqual(widget.readings, {
    pv: { device: 'Solar', reading: 'pv_total_power' },
    battery: { device: 'Solar', reading: 'batteryPower' },
    soc: { device: 'Solar', reading: 'batterySOC' },
  });

  assert.equal(widget.deriveHome, false);
  assert.equal(widget.grid.h, 4);
  assert.deepEqual(schema5WidgetSuggestions({ ...solar, readings: { pv1Power: '600' } }), []);
  const validation = spawnSync('perl', ['-e', `
    use strict; use warnings; use JSON::PP ();
    sub Log3 {}
    require './FHEM/01_FHEMCMS.pm';
    local $/;
    my $config = JSON::PP->new->utf8->decode(<STDIN>);
    my $error = FHEMCMS_ValidateConfig($config, 5);
    if (defined $error) { print STDERR $error; exit 1; }
  `], { input: JSON.stringify(config), encoding: 'utf8' });
  assert.equal(validation.status, 0, validation.stderr);
  assert.doesNotThrow(() => arrangeSchema5SetupPages(config));
});

test('wizard recognizes explicit PV capability across device types but never reinterprets ordinary meters', () => {
  for (const type of ['dummy', 'Shelly', 'MQTT2_DEVICE', 'Unknown']) {
    const pv = { name: 'Balcony', type, readings: { pvPower: '120', battery_power: '10', battery_soc: '50' } };
    const widget = schema5WidgetSuggestions(pv).find(entry => entry.type === 'fhem-solarflow');
    assert.deepEqual(widget.readings.pv, { device: 'Balcony', reading: 'pvPower' });
    assert.equal(widget.readings.battery.reading, 'battery_power');
    assert.equal(widget.readings.soc.reading, 'battery_soc');
    assert.equal(schema5WidgetSuggestions({ ...pv, readings: { power: '120' } })
      .some(entry => entry.type === 'fhem-solarflow'), false);
  }
});

test('wizard ignores invalid humidity rather than interpreting battery-coded sensor values as humidity', () => {
  for (const humidity of ['106', '-1', 'battery low', '']) {
    const readings = schema5ReadingSuggestions({ name: 'Sensor', readings: {
      temperature: '21', humidity, batteryLevel: '2.5',
    } });
    assert.ok(!readings.some(({ reading }) => reading === 'humidity'));
    assert.ok(readings.some(({ reading }) => reading === 'batteryLevel'));
  }
  assert.ok(schema5ReadingSuggestions({ name: 'Sensor', readings: { humidity: '51.2' } })
    .some(({ reading }) => reading === 'humidity'));
});

test('magic groups equivalent individual thermometers and sizes tables by row count', () => {
  const devices = Array.from({ length: 4 }, (_, index) => ({
    name: `Thermometer${index}`, type: 'LaCrosse', rooms: ['Wohnzimmer'],
    readings: { temperature: '21' }, sets: '',
  }));
  const plan = createSchema5MagicPlan(devices);
  assert.equal(plan.pages[0].widgets.length, 1);
  assert.deepEqual(plan.pages[0].widgets[0].rows.map(({ device, reading }) => [device, reading]),
    devices.map(({ name }) => [name, 'temperature']));
  const config = buildSchema5SetupConfig(initialConfig(), plan.pages, plan.startRoom);
  assert.equal(config.pages[0].widgets[0].grid.h, 3);
  assert.doesNotThrow(() => arrangeSchema5SetupPages(config));
  const many = Array.from({ length: 41 }, (_, index) => ({
    name: `Thermometer${index}`, type: 'LaCrosse', rooms: ['Wohnzimmer'],
    readings: { temperature: '21' }, sets: '',
  }));
  const limited = createSchema5MagicPlan(many);
  assert.ok(limited.pages[0].widgets.filter(({ rows }) => rows).every(({ rows }) => rows.length <= 8));
  assert.equal(limited.pages[0].widgets.flatMap((widget) => widget.rows || [widget]).length, 41);
  assert.doesNotThrow(() => arrangeSchema5SetupPages(
    buildSchema5SetupConfig(initialConfig(), limited.pages, limited.startRoom)));
});

test('magic limits rooms and widgets, prioritizes living room and excludes technical and unknown types', () => {
  const devices = Array.from({ length: 10 }, (_, room) =>
    Array.from({ length: 12 }, (_, index) => ({
      name: `D${room}_${String(index).padStart(2, '0')}`,
      type: 'Shelly', rooms: [room === 9 ? 'Wohnzimmer' : `Raum ${room}`],
      readings: { temperature: '21', humidity: '40' },
    }))).flat();
  devices.push(
    { name: 'Notify', type: 'notify', rooms: ['Wohnzimmer'], readings: { state: 'on' }, sets: 'on:noArg off:noArg' },
    { name: 'At', type: 'at', rooms: ['Wohnzimmer'], readings: { state: 'on' }, sets: 'on:noArg off:noArg' },
    { name: 'Unknown', type: 'Unknown', rooms: ['Wohnzimmer'], readings: { state: 'on' }, sets: 'on:noArg off:noArg' },
  );
  const { pages, startRoom } = createSchema5MagicPlan(devices);
  assert.equal(startRoom, 'Wohnzimmer');
  assert.equal(pages.length, 8);
  assert.ok(pages.every((page) => page.widgets.length === 8));
  assert.ok(pages.flatMap((page) => page.widgets).every(({ type }) => type === 'fhem-table'));
  const config = buildSchema5SetupConfig(initialConfig(), pages, startRoom);
  assert.equal(config.pages.length, 8);
  assert.doesNotThrow(() => arrangeSchema5SetupPages(config));
  assert.throws(() => createSchema5MagicPlan(devices.slice(-3)), /Keine geeigneten/);
});

test('magic avoids conflicts between Start and case-insensitive room titles', () => {
  const devices = ['Wohnzimmer', 'Start', 'start', 'START (2)'].map((room, index) => ({
    name: `D${index}`, type: 'Shelly', rooms: [room], readings: { temperature: '20' },
  }));
  const { pages, startRoom } = createSchema5MagicPlan(devices);
  assert.doesNotThrow(() => buildSchema5SetupConfig(initialConfig(), pages, startRoom));
});

test('setup wizard makes the selected room the existing empty start page and generates widget schemas', () => {
  const config = initialConfig();
  const living = createSchema5RoomPlan('Wohnzimmer', [
    { name: 'Heat', readings: { temperature: '21', desiredTemperature: '22' }, sets: 'desiredTemperature:slider,5,0.5,30' },
    { name: 'Light', readings: { state: 'off' }, sets: 'on:noArg off:noArg' },
  ], new Set(['Heat', 'Light']));
  const kitchen = createSchema5RoomPlan('Küche', [], new Set());
  const result = buildSchema5SetupConfig(config, [kitchen, living], 'Wohnzimmer');
  assert.deepEqual(config, initialConfig(), 'source remains unchanged');
  assert.equal(result.navigation.orientation, 'vertical');
  assert.equal(result.pages.length, 2);
  assert.equal(result.pages[0].id, 'start');
  assert.equal(result.pages[0].title, 'Start');
  assert.deepEqual(result.pages[0].widgets.map(({ type }) => type), ['thermostat', 'fhem-switch']);
  assert.deepEqual(result.pages[0].widgets[0].readings, { actual: 'temperature', target: 'desiredTemperature' });
  assert.deepEqual({ ...result.pages[0].widgets[1], id: 'id', grid: null }, {
    id: 'id', type: 'fhem-switch', device: 'Light', title: 'Light', reading: 'state',
    on: 'on', off: 'off', grid: null,
  });
  assert.doesNotThrow(() => schema5GridItems(result, 'start'));
  const validation = spawnSync('perl', ['-e', `
    use strict;
    use warnings;
    use JSON::PP ();
    sub Log3 {}
    require './FHEM/01_FHEMCMS.pm';
    local $/;
    my $config = JSON::PP->new->utf8->decode(<STDIN>);
    my $error = FHEMCMS_ValidateConfig($config, 5);
    if (defined $error) { print STDERR $error; exit 1; }
  `], { input: JSON.stringify(result), encoding: 'utf8' });
  assert.equal(validation.status, 0, validation.stderr);
});

test('manual setup keeps an existing populated start page and makes the chosen new room the home', () => {
  const config = initialConfig();
  config.pages[0].widgets.push({ id: 'old', type: 'fhem-value', device: 'Old', reading: 'state',
    grid: { col: 1, row: 2, w: 4, h: 2 } });
  const old = structuredClone(config.pages[0]);
  const result = buildSchema5SetupConfig(config, [
    createSchema5RoomPlan('Küche', [], new Set()),
  ], 'Küche');
  assert.equal(result.pages[0].title, 'Küche');
  assert.deepEqual(result.pages[1], old);
  assert.deepEqual(result.navigation.items, [
    { page: 'start', label: 'Start (bisher)' },
    { page: result.pages[0].id, label: 'Start' },
  ]);
  assert.deepEqual(config.pages[0], old);
  assert.throws(() => buildSchema5SetupConfig(config, [
    { room: 'Küche', title: 'Küche', included: false, widgets: [] },
    { room: 'Bad', title: 'Bad', included: true, widgets: [] },
  ], 'Küche'), /ausgewählten Raum/);
});

test('generated widget geometry scales with the configured grid resolution', () => {
  const config = initialConfig();
  config.settings.gridColumns = 48;
  config.navigation.grid.w = 48;
  config.navigation.grid.h = 4;
  const plan = createSchema5RoomPlan('Raum', [
    { name: 'Lamp', readings: { state: 'off' }, sets: 'on:noArg off:noArg' },
  ], new Set(['Lamp']));
  const result = buildSchema5SetupConfig(config, [plan], 'Raum');
  assert.deepEqual(result.pages[0].widgets[0].grid, { col: 1, row: 5, w: 16, h: 8 });
  assert.doesNotThrow(() => schema5GridItems(result, 'start'));
});

test('wizard auto-arranges every page using the editor algorithm and keeps live content intact', () => {
  const config = initialConfig();
  config.navigation.grid = { col: 1, row: 1, w: 3, h: 6 };
  const widget = (id, row) => ({ id, type: 'fhem-value', device: 'Lamp', reading: 'state',
    grid: { col: 5, row, w: 4, h: 2 } });
  config.pages[0].widgets = [widget('first', 10)];
  config.pages.push({ id: 'existing', title: 'Bestehend', widgets: [widget('other', 20)] });
  const original = structuredClone(config);
  const arranged = arrangeSchema5SetupPages(config);
  assert.deepEqual(config, original);
  assert.deepEqual(arranged.pages.map((page) => page.widgets[0].grid), [
    { col: 4, row: 1, w: 4, h: 2 }, { col: 4, row: 1, w: 4, h: 2 },
  ]);
  assert.deepEqual(arranged.pages.map((page) => page.widgets[0].device), ['Lamp', 'Lamp']);
  assert.deepEqual(arranged.navigation, config.navigation);
});

test('wizard preview selects a start room, shows widget types and saves only after confirmation', async () => {
  class Element {
    constructor(tag) {
      this.tag = tag;
      this.children = [];
      this.listeners = {};
      this.attributes = {};
      this.value = '';
    }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    remove() { this.removed = true; }
    setAttribute(name, value) { this.attributes[name] = value; }
    removeAttribute(name) { delete this.attributes[name]; }
    addEventListener(name, fn) { this.listeners[name] = fn; }
    fire(name) { return this.listeners[name]?.(); }
  }
  const previous = globalThis.document;
  globalThis.document = { createElement: (tag) => new Element(tag) };
  try {
    const root = new Element('dialog');
    let saved;
    let fitted = 0;
    let outcome;
    const config = initialConfig();
    const controller = {
      snapshot: () => ({ live: config, draft: null, token: 'token' }),
      saveDraft: async (draft, token) => {
        assert.equal(token, 'token');
        saved = draft;
        return { draft };
      },
    };
    const devices = [
      { name: 'Light', rooms: ['Bad'], readings: { state: 'off' }, sets: 'on:noArg off:noArg' },
      { name: 'Heat', rooms: ['Wohnzimmer'], readings: { temperature: '21', desiredTemperature: '22' },
        sets: 'desiredTemperature:slider,5,0.5,30' },
    ];
    new Schema5SetupWizard({ root, controller, client: {
      jsonlist: async () => devices,
      logReadings: async () => ({ source: 'dblog', readings: ['temperature'] }),
      history: async () => { throw new Error('Wizard must not download historical series'); },
    },
      fitNavigation: (candidate) => { fitted += 1; return candidate; },
      onClose: (value) => { outcome = value; } });
    const action = (label) => {
      const found = root.children[4].children.find((node) => node.textContent === label);
      assert.ok(found, `missing action ${label}`);
      return found.fire('click');
    };
    assert.equal(root.children[4].children.some((node) => node.textContent === 'Abbrechen'), false);
    await action('Räume und Geräte auswählen');
    action('Weiter');
    action('Nächster Raum');
    await action('Zusammenfassung');
    assert.equal(saved, undefined);
    const preview = root.children[3];
    const select = preview.children[0].children[0];
    assert.deepEqual(select.children.map((option) => option.value), ['Bad', 'Wohnzimmer']);
    select.value = 'Wohnzimmer';
    select.fire('change');
    const text = (node) => [node.textContent || '', ...node.children.flatMap(text)];
    assert.ok(text(preview).some((entry) => entry.includes('Thermostat')));
    assert.ok(text(preview).some((entry) => entry.includes('Schalter')));
    assert.ok(text(preview).some((entry) => entry.includes('Temperaturverlauf')));
    assert.equal(preview.children[3].children[1].children[0].disabled, true, 'selected start title is fixed');
    await action('Als Entwurf übernehmen');
    assert.equal(fitted, 1);
    assert.equal(saved.navigation.orientation, 'vertical');
    assert.equal(saved.pages[0].id, 'start');
    assert.equal(saved.pages[0].widgets[0].type, 'thermostat');
    assert.equal(saved.pages[0].widgets[1].type, 'fhem-chart');
    assert.equal(saved.pages[0].widgets[1].source, 'dblog');
    assert.equal(saved.pages[1].widgets[0].type, 'fhem-switch');
    assert.ok(saved.pages.every((page) => page.background === undefined),
      'guided setup does not assign a background');
    assert.equal(outcome.saved, true);
  } finally {
    globalThis.document = previous;
  }
});

test('magic saves exactly one draft without preview or publication and handles failure explicitly', async () => {
  class Element {
    constructor() { this.children = []; this.listeners = {}; this.attributes = {}; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    remove() {}
    setAttribute(name, value) { this.attributes[name] = value; }
    removeAttribute(name) { delete this.attributes[name]; }
    addEventListener(name, fn) { this.listeners[name] = fn; }
    fire(name) { return this.listeners[name]?.(); }
  }
  const previous = globalThis.document;
  globalThis.document = { createElement: () => new Element() };
  try {
    const config = initialConfig();
    const devices = [{ name: 'Lamp', type: 'Shelly', rooms: ['Wohnzimmer'],
      readings: { state: 'off' }, sets: 'on:noArg off:noArg' }];
    let saves = 0;
    let uploads = 0;
    const background = `media/${'a'.repeat(32)}.jpg`;
    let outcome;
    let fail = false;
    let snapshot = { live: config, draft: null, token: 'token' };
    const controller = {
      snapshot: () => snapshot,
      saveDraft: async (draft, token) => {
        assert.equal(token, 'token');
        saves += 1;
        if (fail) throw new Error('Antwort verloren');
        return { draft };
      },
    };
    const launch = (client = { jsonlist: async () => devices }) => {
      const root = new Element();
      new Schema5SetupWizard({ root, controller, client: {
        uploadMagicBackground: async () => { uploads += 1; return background; },
        ...client,
      }, onClose: (value) => { outcome = value; } });
      return root;
    };
    const action = (root, label) => root.children[4].children.find((node) => node.textContent === label).fire('click');
    let root;
    let resolveDevices;
    root = launch({ jsonlist: () => new Promise((resolve) => { resolveDevices = resolve; }) });
    const magic = action(root, 'Magic - auf gut Glück');
    assert.equal(root.children[2].textContent, 'Erstelle die Oberfläche …');
    assert.equal(root.children[2].attributes['data-loading'], '');
    assert.equal(root.children[2].attributes['aria-busy'], 'true');
    resolveDevices(devices);
    await magic;
    assert.equal(saves, 1);
    assert.equal(outcome.saved, true);
    assert.equal(outcome.state.draft.pages[0].widgets[0].type, 'fhem-switch');
    assert.ok(outcome.state.draft.pages.every((page) => page.background === background));
    assert.equal(uploads, 1, 'one image upload serves all Magic pages');
    assert.deepEqual(config, initialConfig());

    root = launch({ jsonlist: async () => devices,
      uploadMagicBackground: async () => { throw new Error('Hintergrund konnte nicht geladen werden'); } });
    await action(root, 'Magic - auf gut Glück');
    assert.match(root.children[2].textContent, /Entwurf konnte nicht vorbereitet werden.*Hintergrund/);
    assert.equal(saves, 1, 'failed background preparation does not save a draft');

    root = launch({ jsonlist: async () => [] });
    await action(root, 'Magic - auf gut Glück');
    assert.match(root.children[2].textContent, /Keine geeigneten/);
    assert.equal(saves, 1);

    root = launch({ jsonlist: async () => { throw new Error('Zugriff verweigert'); } });
    await action(root, 'Magic - auf gut Glück');
    assert.match(root.children[2].textContent, /Zugriff verweigert/);
    assert.equal(saves, 1);

    fail = true;
    root = launch();
    await action(root, 'Magic - auf gut Glück');
    assert.match(root.children[2].textContent, /Speichern nicht bestätigt/);
    assert.deepEqual(root.children[4].children.map((node) => node.textContent), ['Abbrechen und Zustand erneut laden']);
    action(root, 'Abbrechen und Zustand erneut laden');
    assert.equal(outcome.requiresReload, true);
    assert.equal(saves, 2);

    fail = false;
    root = launch({ jsonlist: async () => {
      snapshot = { ...snapshot, token: 'changed' };
      return devices;
    } });
    await action(root, 'Magic - auf gut Glück');
    assert.match(root.children[2].textContent, /Konfigurationsstand hat sich geändert/);
    assert.equal(saves, 2);

    snapshot = { ...snapshot, token: 'token' };
    const checked = [];
    const temperatureDevices = [
      { name: 'Valid', type: 'CUL_HM', rooms: ['Wohnzimmer', 'Küche'], readings: { temperature: '21' } },
      { name: 'Empty', type: 'CUL_HM', rooms: ['Wohnzimmer'], readings: { temperature: '' } },
      { name: 'Missing', type: 'CUL_HM', rooms: ['Wohnzimmer'], readings: { 'desired-temp': '21' } },
    ];
    const probeClient = {
      jsonlist: async () => temperatureDevices,
      logReadings: async name => {
        checked.push(name);
        return { source: 'dblog', readings: [] };
      },
      history: async () => { throw new Error('No series downloads permitted'); },
    };
    root = launch(probeClient);
    await action(root, 'Magic - auf gut Glück');
    assert.deepEqual(checked, ['Valid'], 'one query per numeric device, even in multiple rooms');
    assert.equal(saves, 3);
    assert.ok(outcome.state.draft.pages.every(page =>
      page.widgets.every(widget => widget.type !== 'fhem-chart')),
    'no chart for a device without stored temperature records');

    root = launch({ ...probeClient,
      logReadings: async () => { throw new Error('DbLog-Zeitlimit'); } });
    await action(root, 'Magic - auf gut Glück');
    assert.match(root.children[2].textContent, /Magic konnte nicht vorbereitet werden.*DbLog-Zeitlimit/);
    assert.equal(saves, 3, 'real query errors still prevent automatic save');
  } finally {
    globalThis.document = previous;
  }
});

test('setup wizard only offers automatic startup for the untouched initial configuration', () => {
  const config = {
    schemaVersion: 5,
    theme: 'dark',
    settings: { layoutMode: 'grid', gridColumns: 12 },
    navigation: { orientation: 'horizontal', grid: { col: 1, row: 1, w: 12, h: 1 } },
    pages: [{ id: 'start', title: 'Start', widgets: [] }],
  };
  assert.equal(isSchema5InitialSetup(config), true);
  assert.equal(isSchema5InitialSetup({ ...config, theme: 'liquid-glass' }), true);
  assert.equal(isSchema5InitialSetup({ ...config, theme: 'liquid-glass',
    pages: [{ ...config.pages[0], widgets: [{ id: 'x' }] }] }), false);
  assert.equal(isSchema5InitialSetup({ ...config, pages: [{ ...config.pages[0], widgets: [{ id: 'x' }] }] }), false);
  assert.equal(isSchema5InitialSetup({ ...config, theme: 'light' }), false);
});

test('setup wizard appends pages, read-only widgets and explicit navigation entries without changing existing content', () => {
  const config = {
    schemaVersion: 5,
    theme: 'dark',
    settings: { layoutMode: 'grid', gridColumns: 12 },
    navigation: {
      orientation: 'horizontal',
      grid: { col: 1, row: 1, w: 12, h: 1 },
      items: [{ page: 'start', label: 'Home' }],
    },
    pages: [{ id: 'start', title: 'Start', widgets: [] }],
  };
  const result = buildSchema5SetupConfig(config, [{
    room: 'Wohnzimmer',
    title: 'Wohnzimmer',
    included: true,
    widgets: [{
      device: 'LivingSensor',
      reading: 'temperature',
      title: 'LivingSensor — Temperatur',
      unit: '°C',
      included: true,
    }],
  }]);
  assert.equal(config.pages.length, 1, 'source config remains unchanged');
  assert.deepEqual(result.pages[0], config.pages[0], 'existing page remains unchanged');
  assert.equal(result.pages[1].title, 'Wohnzimmer');
  assert.deepEqual(result.pages[1].widgets[0], {
    id: result.pages[1].widgets[0].id,
    type: 'fhem-value',
    device: 'LivingSensor',
    reading: 'temperature',
    title: 'LivingSensor — Temperatur',
    unit: '°C',
    grid: { col: 1, row: 2, w: 4, h: 2 },
  });
  assert.deepEqual(result.navigation.items, [
    { page: 'start', label: 'Home' },
    { page: result.pages[1].id },
  ]);
});

test('setup wizard rejects unresolved names and leaves skipped pages out', () => {
  const config = {
    settings: { gridColumns: 12 },
    navigation: { grid: { row: 1, h: 1 } },
    pages: [{ id: 'start', title: 'Start', widgets: [] }],
  };
  const plan = (title, included = true) => ({ room: title, title, included, widgets: [] });
  assert.throws(() => buildSchema5SetupConfig(config, [plan('start')]), /bereits vergeben/);
  assert.throws(() => buildSchema5SetupConfig(config, [plan('   ')]), /Seitentitel/);
  const result = buildSchema5SetupConfig(config, [plan('Ausgelassen', false), plan('Wohnzimmer')]);
  assert.equal(result.pages.length, 2);
  assert.equal(result.pages[1].title, 'Wohnzimmer');
});
