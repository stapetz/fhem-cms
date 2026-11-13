import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deviceWidgetSuggestions } from '../www/fhem-cms/js/device-widget-suggestions.js';
import { sliderCommands } from '../www/fhem-cms/js/slider-commands.js';

test('device-first suggestions require actual capabilities rather than a device type allowlist', () => {
  const thermometer = { name: 'Sensor', type: 'Unknown', readings: { temperature: '21.5' }, sets: '' };
  const choices = deviceWidgetSuggestions(thermometer);
  assert.deepEqual([...choices.keys()], ['fhem-value', 'fhem-icon', 'fhem-table', 'text', 'fhem-html']);
  assert.equal(choices.get('fhem-value').reading, 'temperature');
  assert.equal(choices.get('text').html, '<p>{{Sensor:temperature}}</p>');
  assert.deepEqual(choices.get('fhem-html').devices, ['Sensor']);
  for (const type of ['thermostat', 'fhem-solarflow', 'fhem-slider', 'fhem-switch', 'fhem-chart', 'fhem-clock', 'fhem-link']) {
    assert.equal(choices.has(type), false, `${type} is not a thermometer capability`);
  }
  assert.equal(thermometer.readings.temperature, '21.5');
});

test('all devices offer text and HTML; unsafe devices and readings are not embedded', () => {
  assert.deepEqual([...deviceWidgetSuggestions({ name: 'Empty', readings: {} }).keys()], ['text', 'fhem-html']);
  const choices = deviceWidgetSuggestions({ name: 'Safe', alias: '<b>Label</b>', readings: { 'bad;reading': '1' } });
  assert.equal(choices.get('text').html, '');
  assert.throws(() => deviceWidgetSuggestions({ name: 'bad;name' }), /Ungültig/);
});

test('commands, logged numeric readings and specific device capabilities seed standard dialogs', () => {
  const device = { name: 'Light', readings: { state: 'off', pct: '50', temperature: '20' },
    sets: 'on:noArg off:noArg toggle:noArg pct:slider,0,1,100' };
  const choices = deviceWidgetSuggestions(device, [], { source: 'dblog', readings: ['temperature', 'state'] });
  assert.equal(choices.get('fhem-button').command, 'toggle');
  assert.equal(choices.get('fhem-switch').on, 'on');
  assert.equal(choices.get('fhem-slider').command, 'pct');
  assert.equal(choices.get('fhem-slider').reading, 'pct');
  assert.equal(choices.get('fhem-chart').reading, 'temperature');
  assert.equal(choices.get('fhem-chart').source, 'dblog');
  assert.equal(deviceWidgetSuggestions(device, [], { source: 'filelog', readings: ['state'] }).has('fhem-chart'), false);
  assert.equal(deviceWidgetSuggestions({ name: 'Calls', type: 'FB_CALLLIST' }).has('fhem-calllist'), true);
  assert.equal(deviceWidgetSuggestions({ name: 'Other', type: 'notify' }).has('fhem-calllist'), false);
});

test('thermostat channels and PV readings reuse existing wizard capability recognition', () => {
  const parent = { name: 'Heating', readings: {} };
  const channel = { name: 'Heating_Climate', parent: 'Heating', readings: { temperature: '21', 'desired-temp': '22' },
    sets: 'desired-temp:slider,4.5,0.5,30' };
  const choices = deviceWidgetSuggestions(parent, [parent, channel]);
  assert.equal(choices.get('thermostat').device, channel.name);
  assert.equal(choices.get('thermostat').readings.target, 'desired-temp');
  assert.equal(deviceWidgetSuggestions({ ...channel, sets: '' }).has('thermostat'), false);
  const solar = deviceWidgetSuggestions({ name: 'PV', type: 'SolaxModbus',
    readings: { pv_total_power: '1200', batterySOC: '60' } }).get('fhem-solarflow');
  assert.deepEqual(solar.readings.pv, { device: 'PV', reading: 'pv_total_power' });
  assert.equal(solar.deriveHome, false);
});

test('shared slider detection preserves signed ranges and rejects malformed or unsafe commands', () => {
  assert.deepEqual(sliderCommands('level:slider,-5,0.5,5'), [{ command: 'level', min: -5, step: 0.5, max: 5 }]);
  for (const sets of [null, 'bad;cmd:slider,0,1,100', 'level:slider,0,0,100', 'level:slider,0,1,10001']) {
    assert.deepEqual(sliderCommands(sets), []);
  }
});

test('discrete set lists offer selection controls without inventing slider capabilities', () => {
  const choices = deviceWidgetSuggestions({ name: 'Mode', readings: { mode: 'eco' },
    sets: 'mode:auto,eco,boost desired:slider,5,0.5,30' });
  assert.deepEqual(choices.get('fhem-select'),
    { title: 'Mode', device: 'Mode', command: 'mode', reading: 'mode', mode: 'dropdown' });
  assert.equal(deviceWidgetSuggestions({ name: 'Mode', sets: 'on:noArg level:slider,0,1,100' }).has('fhem-select'), false);
  assert.equal(deviceWidgetSuggestions({ name: 'Mode', sets: 'mode:auto,eco;bad' }).has('fhem-select'), false);
});

test('sensor maintenance and generic set syntax are not everyday actuator capabilities', () => {
  for (const sets of ['replaceBatteryForSec', 'wakeUp:noArg factoryReset:noArg',
    'getConfig:noArg clear:noArg regSet:foo,bar maintenance:slider,0,1,100']) {
    const choices = deviceWidgetSuggestions({ name: 'Sensor', type: 'LaCrosse',
      readings: { temperature: '6.3', humidity: '90', state: 'T: 6.3 H: 90' }, sets });
    for (const type of ['fhem-button', 'fhem-switch', 'fhem-slider', 'fhem-select', 'thermostat']) {
      assert.equal(choices.has(type), false, `${sets} must not suggest ${type}`);
    }
  }
  const choices = deviceWidgetSuggestions({ name: 'Sensor', readings: { temperature: '20', state: 'T: 20' },
    sets: 'on:noArg off:noArg' });
  assert.equal(choices.has('fhem-switch'), false, 'measurement state is not a switch state');
  assert.equal(deviceWidgetSuggestions({ name: 'Blind', readings: { pct: '40' },
    sets: 'up:noArg down:noArg stop:noArg pct:slider,0,1,100' }).has('fhem-slider'), true);
  assert.equal(deviceWidgetSuggestions({ name: 'Light', readings: { state: 'on' },
    sets: 'on off toggle' }).has('fhem-switch'), true);
  assert.equal(deviceWidgetSuggestions({ name: 'Light', readings: { pct: '40' },
    sets: 'maintenance:slider,0,1,100' }).has('fhem-slider'), false);
  assert.equal(deviceWidgetSuggestions({ name: 'Light', readings: { pct: '40' },
    sets: 'dim:slider,0,1,100' }).get('fhem-slider').reading, 'pct');
});
