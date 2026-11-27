import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EVENT_LIMIT, EventMonitorBuffer, parseInformEvent } from '../www/fhem-cms/js/event-monitor.js';

test('Inform readings resolve the longest device prefix and keep reading names intact', () => {
  const devices = ['lamp', 'lamp-switch'];
  assert.deepEqual(parseInformEvent(['lamp-switch-target-temp', '21', '21'], devices, 123), {
    timestamp: 123,
    device: 'lamp-switch',
    reading: 'target-temp',
    value: '21',
  });
  assert.deepEqual(parseInformEvent(['lamp-switch', 'on', '<div>on</div>'], devices, 124), {
    timestamp: 124,
    device: 'lamp-switch',
    reading: 'state',
    value: 'on',
  });
});

test('Inform metadata, FHEMWEB events, and malformed payloads are ignored', () => {
  const devices = ['sensor'];
  assert.equal(parseInformEvent(['sensor-temperature-ts', '2026-11-27 20:00:00', ''], devices), null);
  assert.equal(parseInformEvent(['#FHEMWEB:WEB', 'value', ''], devices), null);
  assert.equal(parseInformEvent(['sensor-temperature'], devices, Number.NaN), null);
  assert.equal(parseInformEvent(['sensor-temperature'], devices), null);
  assert.equal(parseInformEvent('not-an-array', devices), null);
});

test('unknown device events remain visible without guessing their device name', () => {
  assert.deepEqual(parseInformEvent(['new-device-reading', 'value'], ['sensor'], 125), {
    timestamp: 125,
    device: '',
    reading: 'new-device-reading',
    value: 'value',
  });
});

test('very long event values are bounded for the monitor view', () => {
  const event = parseInformEvent(['sensor-value', 'x'.repeat(5000)], ['sensor'], 125);
  assert.equal(event.value.length, 4098);
  assert.ok(event.value.endsWith(' …'));
});

test('event buffer is bounded, reports discarded events, and filters without mutating data', () => {
  const buffer = new EventMonitorBuffer(2);
  const first = { timestamp: 1, device: 'lamp', reading: 'state', value: 'off' };
  const second = { timestamp: 2, device: 'sensor', reading: 'temperature', value: '20' };
  const third = { timestamp: 3, device: 'sensor', reading: 'temperature', value: '21' };
  buffer.add(first);
  buffer.add(second);
  buffer.add(third);

  assert.equal(EVENT_LIMIT, 1000);
  assert.equal(buffer.events.length, 2);
  assert.equal(buffer.dropped, 1);
  assert.deepEqual(buffer.matching('sensor'), [second, third]);
  assert.deepEqual(buffer.matching('off'), []);
  assert.deepEqual(buffer.events, [second, third]);
  buffer.clear();
  assert.equal(buffer.events.length, 0);
  assert.equal(buffer.dropped, 0);
});
