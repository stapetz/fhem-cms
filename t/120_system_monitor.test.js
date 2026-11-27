import assert from 'node:assert/strict';
import { test } from 'node:test';
import { systemMonitorSnapshot } from '../www/fhem-cms/js/system-monitor.js';

test('system monitor keeps FHEM system and log sources distinct', () => {
  const devices = [
    {name: 'Local', alias: 'Server', type: 'SYSMON', readings: {
      fhemuptime_text: '2 days', loadavg: '0.1 0.2 0.3', ram: 'Total: 1024 MB', cpu_temp: '0',
    }},
    {name: 'Remote', type: 'SYSMON', readings: {loadavg: '9'}},
    {name: 'Db', type: 'DbLog', readings: {state: 'connected', LastError: 'bad\nvalue'}},
    {name: 'File', type: 'FileLog', readings: {}},
    {name: 'Other', type: 'dummy', readings: {state: 'anything'}},
  ];
  const result = systemMonitorSnapshot(devices, 'Local');
  assert.equal(result.systems.length, 2);
  assert.equal(result.selected, 'Local');
  assert.equal(result.metrics.find(item => item.reading === 'loadavg').value, '0.1 0.2 0.3');
  assert.equal(result.metrics.find(item => item.reading === 'cpu_temp').value, '0');
  assert.equal(result.metrics.find(item => item.reading === 'uptime_text').value, null);
  assert.deepEqual(result.logs.map(item => item.name), ['Db', 'File']);
  assert.equal(result.logs[0].readings[1].value, 'bad value');
  assert.deepEqual(result.logs[1].readings, []);
});

test('no device is guessed and malformed input is explicit', () => {
  const noSelection = systemMonitorSnapshot([{name: 'Remote', type: 'SYSMON', readings: {loadavg: '9'}}]);
  assert.equal(noSelection.selected, null);
  assert.ok(noSelection.metrics.every(item => item.value === null));
  assert.equal(systemMonitorSnapshot([], 'Missing').selected, null);
  assert.throws(() => systemMonitorSnapshot(null), /Ungültige/);
});
