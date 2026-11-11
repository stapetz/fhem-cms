import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildSchema5SetupConfig,
  createSchema5RoomPlan,
  groupSchema5DevicesByRoom,
  isSchema5InitialSetup,
  schema5ReadingSuggestions,
} from '../www/fhem-cms/js/fcui-schema5-setup-wizard.js';

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
