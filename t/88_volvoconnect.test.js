import assert from 'node:assert/strict';
import { test } from 'node:test';
import { volvoGroups, volvoCards, volvoModel, volvoImageUrl, volvoText, volvoValue,
  volvoGroupOrder, validateVolvoGroups, volvoStatusSymbol, volvoLabel } from '../www/fhem-cms/js/volvoconnect.js';
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
  for (const value of [undefined, null, {}, [], '', Infinity, 'NaN', 'ERROR_READING_PROPERTY',
    'PROPERTY_NOT_FOUND', 'property_not_supported', 'not_supported', 'x\nz', 'x'.repeat(257)]) {
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
  assert.equal(widget.grid.w, 4);
  assert.equal(widget.grid.h, 4);
  assert.equal(widget.readings, undefined);
  assert.equal(widget.reading, undefined);
});

test('VolvoConnect group settings are optional, partial, unique and restricted to module groups', () => {
  const keys = volvoCards.map(([key]) => key);
  assert.deepEqual(volvoGroupOrder(), keys);
  const config = { groupOrder: ['location', 'doors'], hiddenGroups: ['state'] };
  const original = JSON.stringify(config);
  assert.equal(validateVolvoGroups(config), null);
  assert.deepEqual(volvoGroupOrder(config), ['location', 'doors', ...keys.filter(key => !['location', 'doors'].includes(key))]);
  assert.equal(JSON.stringify(config), original);
  assert.equal(validateVolvoGroups({ hiddenGroups: volvoGroups.map(([key]) => key) }), null);
  assert.equal(validateVolvoGroups({ groupOrder: keys }), null);
  assert.match(validateVolvoGroups({ hiddenGroups:['gallery'] }), /Ungültige/);
  assert.equal(volvoGroupOrder({groupOrder:volvoGroups.map(([key]) => key)}).indexOf('gallery'), 3);
  for (const field of ['groupOrder', 'hiddenGroups']) {
    for (const value of [null, {}, 'state', ['unknown'], ['doors', 'doors'], ['state\n'], [null], Array(16).fill('doors')]) {
      assert.match(validateVolvoGroups({ [field]: value }), /Ungültige/);
    }
    assert.equal(validateVolvoGroups({ [field]: [] }), null);
  }
});

test('VolvoConnect omits unsupported properties before formatting units in every group', () => {
  for (const marker of ['PROPERTY_NOT_FOUND','property_not_supported','ERROR_READING_PROPERTY']) {
    const readings = Object.fromEntries(volvoGroups.flatMap(([group]) =>
      [[`${group}_unavailable`,marker], [`${group}_unavailable_unit`,'watts']]));
    assert.ok([...model(readings).groups.values()].every(rows => !rows.length));
    assert.equal(volvoValue('state','chargingPower',marker,'watts'), '');
  }
});

test('VolvoConnect status symbols match module semantics without turning normal numeric zero into a status', () => {
  for (const [group, key, value, icon, tone] of [
    ['warnings', 'lowBeamLeftWarning', 'NO_WARNING', '✓', 'good'],
    ['warnings', 'lowBeamLeftWarning', 'WARNING', '⚠', 'warning'],
    ['tyres', 'frontLeft', 'LOW_PRESSURE', '⚠', 'warning'],
    ['doors', 'centralLock', 'LOCKED', '🔒', 'good'],
    ['doors', 'frontLeftDoor', 'OPEN', '🔓', 'warning'],
    ['state', 'chargerConnectionStatus', 'CONNECTED', '🔌', 'good'],
    ['state', 'chargerConnectionStatus', 'DISCONNECTED', '🔌̸', 'neutral'],
    ['state', 'chargingStatus', 'ONGOING', '⚡', 'good'],
    ['capabilities', 'feature_isSupported', '0', '−', 'neutral'],
  ]) assert.deepEqual(volvoStatusSymbol(group, key, value), { icon, tone });
  assert.equal(volvoStatusSymbol('statistics', 'tripMeterManual', '0'), null);
  assert.equal(volvoStatusSymbol('engineDiagnostics', 'engineStatus', 'UNKNOWN'), null);
  const rows = model({doors_centralLock: 'LOCKED', state_batteryChargeLevel:'0'}).groups;
  assert.equal(rows.get('doors')[0].icon, '🔒');
  assert.equal(rows.get('doors')[0].status.icon, '🔒');
  assert.equal(rows.get('state')[0].icon, '🔋');
});

test('VolvoConnect uses short German labels and an empty charging-type marker', () => {
  for (const [key,label] of [
    ['averageEnergyConsumption','Ø Energieverbrauch'], ['averageFuelConsumption','Ø Verbrauch'],
    ['averageSpeed','Ø Geschwindigkeit'], ['averageSpeedAutomatic','Ø Geschwindigkeit automatisch'],
    ['vin','VIN'], ['specifications_numberOfSeats','Sitzplätze'],
    ['specifications_numberOfDoors','Türenanzahl'], ['specifications_gearbox','Getriebe'],
    ['specifications_driveType','Antriebsart'], ['specifications_enginePowerKw','Motorleistung (kW)'],
    ['specifications_firstRegistrationDate','Erstzulassung'],
    ['specifications_grossWeightKg','Zulässiges Gesamtgewicht (kg)'],
    ['charge_isSupported','Laden unterstützt'], ['climate_isSupported','Klimatisierung unterstützt'],
  ]) assert.equal(volvoLabel(key),label);
  for (const value of ['',null,'PROPERTY_NOT_FOUND','PROPERTY_NOT_SUPPORTED']) {
    const rows = model({state_chargingType:value,state_chargingPower:'PROPERTY_NOT_FOUND'}).groups.get('state');
    assert.equal(rows.length,1);
    assert.equal(rows[0].value,'−');
  }
  assert.equal(model({state_batteryChargeLevel:'0'}).groups.get('state')
    .find(row=>row.key==='chargingType').value,'−');
  assert.deepEqual(volvoStatusSymbol('engineDiagnostics','engineStatus','STOPPED'),{icon:'⏻',tone:'neutral'});
  assert.deepEqual(volvoStatusSymbol('engineDiagnostics','engineStatus','RUNNING'),{icon:'▶',tone:'neutral'});
});
