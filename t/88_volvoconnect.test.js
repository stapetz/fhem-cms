import assert from 'node:assert/strict';
import { test } from 'node:test';
import { volvoGroups, volvoModel, volvoImageUrl, volvoText, volvoValue } from '../www/fhem-cms/js/volvoconnect.js';
import { deviceWidgetSuggestions } from '../www/fhem-cms/js/device-widget-suggestions.js';
import { schema5WidgetSuggestions, createSchema5RoomPlan, buildSchema5SetupConfig } from '../www/fhem-cms/js/fcui-schema5-setup-wizard.js';

const model = (readings, extra = {}) => volvoModel([{ name: 'Car', readings, ...extra }], 'Car');
test('VolvoConnect groups actual module readings without inventing missing values', () => {
  const readings = Object.fromEntries(volvoGroups.map(([key]) => [`${key}_customValue`, 'value']));
  const result = model({ ...readings, state_batteryChargeLevel: '0',
    state_electricRange: '0', state_electricRange_unit: 'km',
    odometer_odometer: '1234', fuel_fuelAmount: '0',
    engine_engineStatus: 'STOPPED', brakes_brakeFluidLevelWarning: 'NO_WARNING',
    workshopDiagnostics_washerFluidLevelWarning: 'LOW',
    vehicle_images_exteriorImageUrl: 'https://example.invalid/car.png',
    lastUpdate: '2026-11-14 16:00:00', secretToken: 'not rendered',
    statistics_missing: 'ERROR_READING_PROPERTY', statistics_empty: '', statistics_null: null });
  assert.equal(result.groups.size, 14);
  assert.ok([...result.groups.values()].every(group => group.length));
  assert.equal(result.soc, 0);
  assert.equal(result.range, '0');
  assert.equal(result.images.length, 1);
  assert.ok(result.groups.get('statistics').some(row => row.reading === 'odometer_odometer'));
  assert.ok(result.groups.get('state').some(row => row.reading === 'fuel_fuelAmount'));
  assert.ok(result.groups.get('engineDiagnostics').some(row => row.reading === 'brakes_brakeFluidLevelWarning'));
  assert.ok(!result.groups.get('brakes').some(row => row.reading === 'brakes_brakeFluidLevelWarning'));
  assert.ok(result.groups.get('engineDiagnostics').some(row => row.reading === 'workshopDiagnostics_washerFluidLevelWarning'));
  assert.ok(!result.groups.get('workshopDiagnostics').some(row => row.reading === 'workshopDiagnostics_washerFluidLevelWarning'));
  assert.ok(![...result.groups.values()].flat().some(row => /secret|missing|empty|null|_unit$|ImageUrl/.test(row.reading)));
  assert.equal(model({}).soc, null);
  assert.equal(model({}).range, '');
  assert.ok([...model({}).groups.values()].every(rows => !rows.length));
  assert.equal(model({ state_batteryChargeLevel: '-1' }).soc, null);
  assert.equal(model({ state_batteryChargeLevel: '101' }).soc, null);
  assert.equal(model({ location_latitude: '91', location_longitude: '181' }).latitude, null);
  assert.equal(model({ location_latitude: '0', location_longitude: '0' }).longitude, 0);
});

test('VolvoConnect matches dashboard location grouping, labels and unit formatting', () => {
  const result = model({ location_road: 'Testweg', location_house_number: '1',
    location_postcode: '12345', location_city: 'Teststadt', location_address: 'duplicate',
    location_altitude: '10', location_heading: '45',
    capabilities_getEnergyState_chargingPower_isSupported: '0' });
  assert.deepEqual(result.groups.get('location').map(row => row.value), ['12345 Teststadt', 'Testweg 1']);
  assert.equal(result.groups.get('capabilities')[0].label, 'Ladeleistung unterstützt');
  assert.equal(volvoValue('state', 'chargingStatus', 'ONGOING'), 'Lädt');
  assert.equal(volvoValue('state', 'chargingStatus', 'STOPPED'), 'Gestoppt');
  assert.equal(volvoValue('state', 'batteryChargeLevel', '0', 'percentage'), '0%');
  assert.equal(volvoValue('state', 'time', '65', 'minutes'), '01:05 h');
  assert.equal(volvoValue('state', 'current', '16', 'ampere'), '16 A');
  assert.equal(volvoValue('capabilities', 'flag', '0'), 'Nein');
});

test('VolvoConnect rejects unsafe/missing source values and image URLs', () => {
  for (const value of [undefined, null, {}, [], '', Infinity, 'NaN', 'ERROR_READING_PROPERTY', 'not_supported', 'x\nz', 'x'.repeat(257)]) {
    assert.equal(volvoText(value), '');
  }
  for (const url of ['javascript:alert(1)', 'data:image/svg+xml,test', '//evil.invalid/test',
    'https://user:password@example.invalid/test.png', 'https://example.invalid/<x>', 'https://']) {
    assert.equal(volvoImageUrl(url), '');
  }
  assert.equal(volvoImageUrl('https://example.invalid/car.png?a=1&b=2'), 'https://example.invalid/car.png?a=1&b=2');
  const result = model({ state: 'authenticated' }, { sets: 'lock unlock climate:noArg charge_stop:noArg delete:noArg' });
  assert.deepEqual(result.actions.map(([name]) => name), ['lock', 'unlock', 'climate', 'charge_stop']);
  assert.deepEqual(model({}).actions, []);
});

test('VolvoConnect is available device-first and produces schema-5 setup without manual mappings', () => {
  const car = { name: 'Car', type: 'VolvoConnect', readings: { state_batteryChargeLevel: '83' } };
  assert.deepEqual(deviceWidgetSuggestions(car).get('fhem-volvoconnect'),
    { title: 'Car', device: 'Car', showGallery: true });
  assert.equal(deviceWidgetSuggestions({ ...car, type: 'dummy' }).has('fhem-volvoconnect'), false);
  assert.equal(schema5WidgetSuggestions(car)[0].type, 'fhem-volvoconnect');
  const plan = createSchema5RoomPlan('Auto', [car], new Set(['Car']));
  const initial = { schemaVersion: 5, theme: 'dark', settings: { layoutMode: 'grid', gridColumns: 12 },
    navigation: { grid: { col: 1, row: 1, w: 12, h: 1 } }, pages: [{ id: 'start', title: 'Start', widgets: [] }] };
  const result = buildSchema5SetupConfig(initial, [plan]);
  const widget = result.pages.flatMap(page => page.widgets).find(entry => entry.type === 'fhem-volvoconnect');
  assert.equal(widget.device, 'Car');
  assert.equal(widget.showGallery, true);
  assert.equal(widget.grid.w, 12);
  assert.equal(widget.readings, undefined);
  assert.equal(widget.reading, undefined);
});
