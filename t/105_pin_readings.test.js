import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { pinReadingFields, pinReadingValues, preservePinReadings, validatePinReadings } from '../www/fhem-cms/js/pin-readings.js';
import { PIN_TYPES, pinPresentation } from '../www/fhem-cms/js/pin-presentation.js';
import { remapBlueprintDevice } from '../www/fhem-cms/js/fcui-schema5-blueprints.js';
import { schema5GridItems } from '../www/fhem-cms/js/fcui-schema5-layout.js';

const snapshots = (readings = {}) => new Map([
  ['Demo', [{name: 'Demo', readings: {temperature: '-0.5', target: '22', state: 'on', ...readings}},
    {name: 'Channel', readings: {humidity: '54', valve: '150%'}}]],
]);
const value = {id: 'value', type: 'fhem-value', device: 'Demo', reading: 'temperature'};
const thermostat = {id: 'heat', type: 'thermostat', device: 'Demo',
  readings: {actual: 'temperature', target: 'target', valve: 'valve'}};

test('Pins use only configured icons and explicit units, including live icon mappings', () => {
  const services = {iconUrl: name => `/fhem/icons/${name}`};
  for (const type of Object.keys(PIN_TYPES)) {
    const widget = {...value,type};
    const before = JSON.stringify(widget);
    const presentation = pinPresentation(widget,false,snapshots(),services);
    assert.equal(presentation.icon,'',`${type}: no arbitrary type symbol`);
    assert.equal(presentation.iconUrl,'');
    assert.equal(JSON.stringify(widget),before,'presentation adds no config defaults');
  }
  const configured = {...value,icon:'temp_temperature',unit:'°C'};
  assert.equal(pinPresentation(configured,false,snapshots(),services).iconUrl,'/fhem/icons/temp_temperature');
  assert.deepEqual(pinPresentation(configured,false,snapshots(),services).values,[{value:'-0.5',unit:'°C'}]);
  assert.deepEqual(pinPresentation(value,false,snapshots(),services).values,[{value:'-0.5',unit:''}],
    'a temperature Reading name alone never invents Celsius');
  const toggle = {...value,type:'fhem-switch',reading:'state',on:'on',off:'off',icon:'general_an',iconOff:'general_aus'};
  assert.equal(pinPresentation(toggle,false,snapshots(),services).iconUrl,'/fhem/icons/general_an');
  assert.equal(pinPresentation(toggle,false,snapshots({state:'off'}),services).iconUrl,'/fhem/icons/general_aus');
  const mapped = {...value,type:'fhem-icon',reading:'state',states:[{value:'on',icon:'general_an'}]};
  assert.equal(pinPresentation(mapped,false,snapshots(),services).iconUrl,'/fhem/icons/general_an');
  assert.equal(pinPresentation(mapped,false,snapshots({state:'other'}),services).iconUrl,'');
  for (const icon of ['../secret','x");url(https://evil.test)','https://evil.test/icon',7,null]) {
    assert.throws(() => pinPresentation({...value,icon},false,snapshots(),services),/Pin-Icon/);
  }
});

test('Pin defaults show existing value/actual readings without mutating configuration', () => {
  for (const [widget, expected] of [[value, [{value: '-0.5', unit: ''}]],
    [{...value, unit: '°C'}, [{value: '-0.5', unit: '°C'}]],
    [thermostat, [{value: '-0.5', unit: '°C'}]]]) {
    const bytes = JSON.stringify(widget);
    assert.deepEqual(pinReadingValues(widget, snapshots()), expected);
    assert.equal(JSON.stringify(widget), bytes);
  }
  for (const type of Object.keys(PIN_TYPES).filter(type => !['fhem-value', 'thermostat'].includes(type))) {
    const widget = {...value, type};
    assert.deepEqual(pinReadingValues(widget, snapshots()), [], type);
  }
  assert.deepEqual(pinReadingValues({...value, showOnPin: {reading: false}}, snapshots()), []);
  assert.deepEqual(pinReadingValues({...thermostat, showOnPin: {'readings.target': true}},
    snapshots()), [{value: '-0.5', unit: '°C'}, {value: '22.0', unit: '°C'}]);
  assert.deepEqual(pinReadingValues({...thermostat, showOnPin: {'readings.valve': true}},
    snapshots()), [{value: '-0.5', unit: '°C'}, {value: '100', unit: '%'}]);
  assert.equal(pinPresentation({...value, type: 'fhem-switch', reading: 'state', on: 'on', off: 'off'},
    false, snapshots()).state, 'active');
  assert.equal(pinPresentation({...value, type: 'fhem-switch', reading: 'state', on: 'open', off: 'closed'},
    false, snapshots()).state, 'normal', 'no guessed status');
});

test('Pin live projection handles stale, unavailable, zero, channels, dates and hostile text', () => {
  assert.deepEqual(pinPresentation(value, true, snapshots()).values, [{value: '-0.5', unit: ''}]);
  assert.equal(pinPresentation(value, true, snapshots()).stale, true);
  for (const temperature of [null, undefined, '', {}, [], true]) {
    assert.deepEqual(pinReadingValues({...value, unit: '°C'}, snapshots({temperature})), [{value: '–', unit: ''}]);
  }
  assert.deepEqual(pinReadingValues(value, new Map()), [{value: '–', unit: ''}]);
  assert.deepEqual(pinReadingValues(value, snapshots({temperature: '0'})), [{value: '0', unit: ''}]);
  assert.deepEqual(pinReadingValues({...value, reading: 'humidity'}, snapshots()), [{value: '54', unit: ''}]);
  assert.deepEqual(pinReadingValues(value, snapshots({temperature: '2026-11-24'})), [{value: '24.11.2026', unit: ''}]);
  assert.deepEqual(pinReadingValues(value, snapshots({temperature: '<img>\u0000\n'})), [{value: '<img>', unit: ''}]);
  assert.deepEqual(pinReadingValues({...thermostat, readings: {actual: 'humidity', target: 'target'}},
    snapshots()), [{value: '54.0', unit: '°C'}]);
  assert.deepEqual(pinReadingValues(thermostat, snapshots({temperature: 'off'})), [{value: 'off', unit: ''}]);
});

test('Pin source normalization covers table, both solar contracts, sections, slider and select', () => {
  const table = {type: 'fhem-table', rows: [
    {device: 'Demo', reading: 'temperature', unit: '°C'},
    {device: 'Demo', reading: 'humidity', unit: '%'},
  ], showOnPin: {'rows.0': true, 'rows.1': true}};
  assert.deepEqual(pinReadingValues(table, snapshots()), [{value: '-0.5', unit: '°C'}, {value: '54', unit: '%'}]);
  for (const sources of [{device: 'Demo', readings: {pv: 'power', soc: 'soc'}},
    {readings: {pv: {device: 'Demo', reading: 'power'}, soc: {device: 'Demo', reading: 'soc'}}}]) {
    const solar = {type: 'fhem-solarflow', ...sources, unit: 'kW',
      showOnPin: {'readings.pv': true, 'readings.soc': true}};
    assert.deepEqual(pinReadingValues(solar, snapshots({power: '1.234', soc: '55.6'})),
      [{value: '1234', unit: 'W'}, {value: '56', unit: '%'}]);
  }
  const solar = {type: 'fhem-solar-energy', powerUnit: 'kW', energyUnit: 'kWh',
    readings: {pv: {device: 'Demo', reading: 'power'}, day: {device: 'Demo', reading: 'yield'}},
    sections: [{label: 'Dach', readings: {month: {device: 'Demo', reading: 'month'}}}],
    showOnPin: {'readings.pv': true, 'readings.day': true, 'sections.0.month': true}};
  assert.equal(pinReadingFields(solar).length, 3);
  assert.deepEqual(pinReadingValues(solar, snapshots({power: '1.234', yield: '3.456', month: '50.23'})),
    [{value: '1234.0', unit: 'W'}, {value: '3.46', unit: 'kWh'}, {value: '50.2', unit: 'kWh'}]);
  assert.deepEqual(pinReadingValues({...value, type: 'fhem-slider', showOnPin: {reading: true}},
    snapshots({temperature: '52,0%'})), [{value: '52', unit: ''}]);
  assert.deepEqual(pinReadingValues({...value, type: 'fhem-select', labels: {on: 'Eingeschaltet'},
    showOnPin: {reading: true}}, snapshots({temperature: 'on'})), [{value: 'Eingeschaltet', unit: ''}]);
  assert.deepEqual(pinReadingValues({...value, type: 'fhem-select', reading: 'humidity',
    showOnPin: {reading: true}}, snapshots()), [{value: '–', unit: ''}], 'select does not read channel values');
});

test('Pin choices are strictly optional booleans on configured fields in JS and Perl, including blueprints', () => {
  const candidates = [
    [value, {reading: false}], [thermostat, {'readings.actual': false, 'readings.target': true}],
    [{id: 'table', type: 'fhem-table', rows: [{device: 'Demo', reading: 'temperature'}]}, {'rows.0': true}],
    [{id: 'flow', type: 'fhem-solarflow', device: 'Demo', readings: {pv: 'power'}}, {'readings.pv': true}],
    [{id: 'solar', type: 'fhem-solar-energy', readings: {pv: {device: 'Demo', reading: 'power'}},
      sections: [{label: 'Dach', readings: {day: {device: 'Demo', reading: 'yield'}}}]}, {'sections.0.day': true}],
  ];
  for (const schema of [5, 6]) for (const [widget, choices] of candidates) {
    const config = {schemaVersion: schema, settings: {layoutMode: 'grid', gridColumns: 12},
      navigation: {orientation: 'horizontal', grid: {col: 1, row: 1, w: 12, h: 1}},
      pages: [{id: 'home', title: 'Start', ...(schema === 6 ? {
        layoutMode: 'freeform', canvas: {width: 800, height: 600}, renderAsPins: true} : {}),
      widgets: [{...widget, showOnPin: choices, ...(schema === 6 ? {rect: {x: 0, y: 0, w: 200, h: 100}}
        : {grid: {col: 1, row: 2, w: 4, h: 2}})}]}]};
    const before = JSON.stringify(config);
    schema5GridItems(config, 'home');
    assert.equal(JSON.stringify(config), before);
    const badChoices = [null, [], false, 'true', {unknown: true},
      {[Object.keys(choices)[0]]: 1}, {[Object.keys(choices)[0]]: 'false'}];
    for (const showOnPin of badChoices) {
      assert.throws(() => validatePinReadings({...widget, showOnPin}), /showOnPin/);
    }
    const backend = spawnSync('perl', ['-MJSON::PP', '-e', `
      use strict; use warnings; require './FHEM/01_FHEMCMS.pm';
      local $/; my $data = decode_json(<STDIN>); my ($config, $bad) = @$data;
      my $error = FHEMCMS_ValidateConfig($config, $config->{schemaVersion});
      die $error if defined $error;
      my $widget = $config->{pages}[0]{widgets}[0];
      if ($config->{schemaVersion} == 5) {
        my $error = FHEMCMS_ValidateBlueprints([{name => 'Pin', widget => $widget}]);
        die $error if defined $error;
      }
      for my $choices (@$bad) {
        $widget->{showOnPin} = $choices;
        my $error = FHEMCMS_ValidateConfig($config, $config->{schemaVersion});
        die "Accepted invalid showOnPin" unless defined($error) && $error =~ /showOnPin/;
      }
    `], {input: JSON.stringify([config, badChoices]), encoding: 'utf8'});
    assert.equal(backend.status, 0, backend.stderr);
    const blueprint = remapBlueprintDevice({...widget, showOnPin: choices}, 'Demo', 'Other');
    assert.deepEqual(blueprint.showOnPin, choices);
    assert.equal(JSON.stringify(blueprint).includes('"Demo"'), false);
  }
  assert.deepEqual(preservePinReadings({...value}, {...value, showOnPin: {reading: false}}).showOnPin,
    {reading: false});
  assert.deepEqual(preservePinReadings({...thermostat, readings: {actual: 'temperature', target: 'target'}},
    {...thermostat, showOnPin: {'readings.actual': false, 'readings.valve': true}}).showOnPin, {'readings.actual': false});
});
