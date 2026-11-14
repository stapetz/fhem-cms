import assert from 'node:assert/strict';
import { test } from 'node:test';

globalThis.HTMLElement = class {};
globalThis.customElements = { get() { return true; } };
const { validateSolarEnergy, solarEnergyDevices, solarEnergyModel, solarNumber } = await import('../www/fhem-cms/js/solar-energy.js');
const source = (device, reading) => ({ device, reading });
const config = { readings: { pv: source('PV', 'power'), home: source('Home', 'load'),
  grid: source('Grid', 'power'), battery: source('Battery', 'power'), soc: source('Battery', 'soc') },
sections: [{ label: 'Roof', readings: { day: source('Meter', 'day') } }] };
const data = values => new Map(Object.entries(values).map(([name, readings]) => [name, [{ name, readings }]]));
test('solar energy validates and subscribes to all cross-device sources including yield cards', () => {
  validateSolarEnergy(config);
  assert.deepEqual(solarEnergyDevices(config), ['PV', 'Home', 'Grid', 'Battery', 'Meter']);
  const copy = structuredClone(config);
  copy.sections[0].readings.day.device = 'Bad;set';
  assert.throws(() => validateSolarEnergy(copy), /Ungültig/);
  assert.throws(() => validateSolarEnergy({ ...config, sections: Array(9).fill(config.sections[0]) }), /8/);
  assert.throws(() => validateSolarEnergy({ ...config, sections: [{ label: 'Blank', readings: {} }] }), /mindestens/);
  assert.throws(() => validateSolarEnergy({ ...config, threshold: 1.5 }), /Schwellwert/);
});
test('solar energy uses real power directions and never invents activity for missing or malformed readings', () => {
  const snapshot = data({ PV: { power: '2500' }, Home: { load: '1000' },
    Grid: { power: '1000' }, Battery: { power: '500', soc: '65' } });
  const original = JSON.stringify(config);
  const model = solarEnergyModel(config, snapshot);
  assert.deepEqual(model.flows, { 'pv>home': 1000, 'pv>bat': 500, 'pv>grid': 1000 });
  assert.equal(model.soc, 65);
  snapshot.get('PV')[0].readings.power = '0';
  snapshot.get('Grid')[0].readings.power = '-800';
  snapshot.get('Battery')[0].readings.power = '-200';
  assert.deepEqual(solarEnergyModel(config, snapshot).flows, { 'bat>home': 200, 'grid>home': 800 });
  snapshot.delete('Grid');
  assert.deepEqual(solarEnergyModel(config, snapshot).flows, {});
  assert.equal(solarEnergyModel(config, snapshot).values.grid, null);
  const derived = structuredClone(config);
  delete derived.readings.home;
  assert.equal(solarEnergyModel(derived, snapshot).values.home, null);
  for (const value of ['', 'NaN', 'Infinity', '12watts', '<script>', '0x10']) {
    assert.equal(solarNumber(source('PV', 'power'), data({ PV: { power: value } })), null);
  }
  assert.equal(solarNumber(source('PV', 'power'), data({ PV: { power: '1,25' } })), 1.25);
  assert.equal(JSON.stringify(config), original);
});
test('solar energy handles kW, explicit home calculation, thresholds and clamped SoC', () => {
  const candidate = { readings: { pv: source('PV', 'power'), soc: source('PV', 'soc') }, sections: [],
    powerUnit: 'kW' };
  const snapshot = data({ PV: { power: '1.5', soc: '150' } });
  assert.equal(solarEnergyModel(candidate, snapshot).values.pv, 1500);
  assert.equal(solarEnergyModel(candidate, snapshot).values.home, 1500);
  assert.equal(solarEnergyModel(candidate, snapshot).soc, 100);
  assert.equal(solarEnergyModel({ ...candidate, deriveHome: false }, snapshot).values.home, null);
});
test('solar energy does not derive flows from power values that overflow during conversion', () => {
  for (const key of ['grid', 'battery']) {
    const candidate = { readings: { pv: source('PV', 'power'), [key]: source('Meter', 'power') },
      sections: [], powerUnit: 'kW' };
    const snapshot = data({ PV: { power: '1' }, Meter: { power: '1e308' } });
    const model = solarEnergyModel(candidate, snapshot);
    assert.equal(model.values.home, null);
    assert.deepEqual(model.flows, {});
  }
  const candidate = { readings: { pv: source('PV', 'power'), grid: source('Grid', 'power') }, sections: [] };
  const model = solarEnergyModel(candidate, data({ PV: { power: '1e308' }, Grid: { power: '-1e308' } }));
  assert.equal(model.values.home, null);
  assert.deepEqual(model.flows, {});
});
