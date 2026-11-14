import assert from 'node:assert/strict';
import { test } from 'node:test';
import { solarEnergySuggestions, suggestedSolarSource, solarPowerReadings } from '../www/fhem-cms/js/solar-energy-suggestions.js';
import { deviceWidgetSuggestions } from '../www/fhem-cms/js/device-widget-suggestions.js';

const plant = { name: 'Plant', type: 'dummy', readings: {
  pv_total_power: '1200', home_power: '800', grid_feed_in_power: '100',
  battery_power: '300', battery_remain_capacity: '60', state: 'OK',
  EnergyRoof: '1000', statEnergyRoofHour: '1', statEnergyRoofDay: '4',
  statEnergyRoofMonth: '50', statEnergyRoofMonthLast: '100', statEnergyRoofYear: '500',
  EnergyShed: '200', statEnergyShedDay: '1',
  EnergyTotal: '1200', statEnergyTotalHour: '1.2', statEnergyTotalDay: '5',
  statEnergyTotalMonth: '60', statEnergyTotalYear: '600',
} };

test('ordinary dummy solar devices yield complete power, statistics and named-section suggestions', () => {
  const original = JSON.stringify(plant);
  const suggestion = solarEnergySuggestions([plant]);
  assert.equal(Object.keys(suggestion.readings).length, 11);
  assert.deepEqual(suggestion.readings.pv, { device: 'Plant', reading: 'pv_total_power' });
  assert.equal(suggestion.readings.hour.reading, 'statEnergyTotalHour');
  assert.deepEqual(suggestion.sections.map(section => section.label), ['Roof', 'Shed']);
  assert.equal(suggestion.sections[0].readings.previousMonth.reading, 'statEnergyRoofMonthLast');
  assert.equal(suggestion.sections[0].readings.total.reading, 'EnergyRoof');
  assert.equal(suggestion.sections[1].readings.day.reading, 'statEnergyShedDay');
  assert.equal(JSON.stringify(plant), original);
  const deviceFirst = deviceWidgetSuggestions(plant, [plant]).get('fhem-solar-energy');
  assert.deepEqual(deviceFirst.readings, suggestion.readings);
  assert.deepEqual(deviceFirst.sections, suggestion.sections);
});

test('statistics-only families work without lifetime counters and ignore previous-period summaries', () => {
  const candidate = { name: 'PV', readings: { pv_total_power: '1', statEnergyRoofDay: '2',
    statEnergyRoofMonthLast: '3', statEnergyRoofDayLast: '4', statEnergyRoofLast: 'Hour: 1 Day: 4' } };
  const suggestion = solarEnergySuggestions([candidate]);
  assert.equal(suggestion.sections.length, 1);
  assert.deepEqual(Object.keys(suggestion.sections[0].readings).sort(), ['day', 'previousMonth']);
  assert.equal(suggestedSolarSource(candidate, 'day', 'Roof').reading, 'statEnergyRoofDay');
});

test('unique external power sources complete an anchored installation without arbitrary device choices', () => {
  const pv = { name: 'PV', readings: { pv_total_power: '100' } };
  const meter = { name: 'Meter', readings: { home_power: '70', grid_feed_in_power: '30' } };
  const other = { name: 'Other', readings: { home_power: '1' } };
  const suggestion = solarEnergySuggestions([pv, meter]);
  assert.deepEqual(suggestion.readings.home, { device: 'Meter', reading: 'home_power' });
  assert.equal(solarEnergySuggestions([pv, meter, other]).readings.home, undefined);
  assert.equal(solarEnergySuggestions([plant, meter]).readings.home.device, 'Plant');
  const secondPV = { name: 'SecondPV', readings: { pvPower: '50' } };
  assert.deepEqual(solarEnergySuggestions([pv, secondPV]).readings, {});
  assert.equal(solarEnergySuggestions([pv, secondPV]).ambiguous, true);
  assert.equal(solarEnergySuggestions([pv, secondPV], 'SecondPV').readings.pv.device, 'SecondPV');
});

test('ambiguous aliases, unrelated power, unsafe names and unsupported units are never invented', () => {
  const device = { name: 'PV', readings: { pv_total_power: '1', pvPower: '2', power: '3',
    grid_power: '4', energy: '5', 'EnergyBad;Name': '6' } };
  const suggestion = solarEnergySuggestions([device]);
  assert.deepEqual(suggestion.readings, {});
  assert.deepEqual(suggestion.sections, []);
  assert.deepEqual(solarEnergySuggestions([{ ...plant, name: 'Bad;Name' }]).readings, {});
  assert.deepEqual(suggestedSolarSource({ name: 'Sensor', readings: { power: '10' } }, 'pv'),
    { device: 'Sensor', reading: 'power' });
  assert.equal(Object.hasOwn(solarEnergySuggestions([plant]), 'powerUnit'), false);
  const many = { name: 'PV', readings: { pv_total_power: '1',
    ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`EnergyRoof${i}`, '1'])) } };
  assert.equal(solarEnergySuggestions([many]).sections.length, 8);
});

test('meter readings become PV sources only after an explicit device choice, never during discovery', () => {
  for (const reading of ['power', 'powerActual', 'currentPower', 'activePower', 'active_power',
    'apower', 'act_power', 'ENERGY_Power', 'power_0', 'power1', 'channel_0_power',
    'relay_0_power', 'switch_0_apower', 'emeter_1_power']) {
    const meter = { name: 'Balcony', type: 'Unknown', readings: { [reading]: '0', energy: '12', voltage: '230' } };
    assert.deepEqual(solarPowerReadings(meter), [], reading);
    assert.deepEqual(solarEnergySuggestions([meter]).readings, {}, reading);
    assert.deepEqual(solarEnergySuggestions([meter], meter.name).readings.pv,
      { device: 'Balcony', reading }, reading);
    const choices = deviceWidgetSuggestions(meter);
    for (const type of ['fhem-solarflow', 'fhem-solar-energy']) {
      assert.deepEqual(choices.get(type).readings.pv, { device: 'Balcony', reading }, type);
      assert.equal(choices.get(type).deriveHome, false, 'a measuring plug does not prove a house load');
    }
  }
});

test('multiple meter channels remain selectable but are not assigned arbitrarily', () => {
  const meter = { name: 'Shelly', type: 'MQTT2_DEVICE', readings: {
    power_0: '100', power_1: '200', powerFactor: '0.9', voltage: '230', energy: '5' } };
  assert.equal(suggestedSolarSource(meter, 'pv'), null);
  for (const type of ['fhem-solarflow', 'fhem-solar-energy']) {
    assert.equal(deviceWidgetSuggestions(meter).has(type), true);
    assert.equal(deviceWidgetSuggestions(meter).get(type).readings.pv, undefined);
  }
  assert.deepEqual(suggestedSolarSource({ ...meter, readings: { ...meter.readings, pvPower: '250' } }, 'pv'),
    { device: 'Shelly', reading: 'pvPower' }, 'a specific PV reading takes precedence over meter channels');
  for (const reading of ['energy', 'current', 'voltage', 'powerFactor', 'powerLimit', 'consumption',
    'power;set', 'power\\n']) {
    const choices = deviceWidgetSuggestions({ name: 'NotPower', readings: { [reading]: '10' } });
    assert.equal(choices.has('fhem-solarflow'), false, reading);
    assert.equal(choices.has('fhem-solar-energy'), false, reading);
  }
  assert.equal(suggestedSolarSource({ name: 'Bad;Device', readings: { power: '1' } }, 'pv'), null);
});
