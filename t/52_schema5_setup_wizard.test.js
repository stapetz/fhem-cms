import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import {
  arrangeSchema5SetupPages,
  buildSchema5SetupConfig,
  createSchema5RoomPlan,
  groupSchema5DevicesByRoom,
  isSchema5InitialSetup,
  schema5ReadingSuggestions,
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
  }), [{ type: 'fhem-switch', device: 'Light', title: 'Light', reading: 'state',
    on: 'on', off: 'off', label: 'Schalter' }]);
  assert.ok(schema5WidgetSuggestions({ ...thermostat, sets: '' })
    .every(({ type }) => type === 'fhem-value'));
  assert.ok(schema5WidgetSuggestions({ ...thermostat, sets: 'desiredTemperature:noArg' })
    .every(({ type }) => type === 'fhem-value'));
  assert.ok(schema5WidgetSuggestions({ ...thermostat, sets: 'desiredTemperature:auto,off' })
    .every(({ type }) => type === 'fhem-value'));
  assert.ok(schema5WidgetSuggestions({ name: 'Light', readings: { state: 'off' },
    sets: 'on:slider,0,1,100 off:noArg' }).every(({ type }) => type === 'fhem-value'));
  assert.deepEqual(schema5WidgetSuggestions({ name: 'Unknown', readings: { custom: 'x' } }), []);
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
    new Schema5SetupWizard({ root, controller, client: { jsonlist: async () => devices },
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
    action('Vorschau');
    assert.equal(saved, undefined);
    const preview = root.children[3];
    const select = preview.children[0].children[0];
    assert.deepEqual(select.children.map((option) => option.value), ['Bad', 'Wohnzimmer']);
    select.value = 'Wohnzimmer';
    select.fire('change');
    const text = (node) => [node.textContent || '', ...node.children.flatMap(text)];
    assert.ok(text(preview).some((entry) => entry.includes('Thermostat')));
    assert.ok(text(preview).some((entry) => entry.includes('Schalter')));
    assert.equal(preview.children[3].children[1].children[0].disabled, true, 'selected start title is fixed');
    await action('Als Entwurf übernehmen');
    assert.equal(fitted, 1);
    assert.equal(saved.navigation.orientation, 'vertical');
    assert.equal(saved.pages[0].id, 'start');
    assert.equal(saved.pages[0].widgets[0].type, 'thermostat');
    assert.equal(saved.pages[1].widgets[0].type, 'fhem-switch');
    assert.equal(outcome.saved, true);
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
