import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bindPinGesture, PIN_HOLD_MS, PIN_MOVE_LIMIT } from '../www/fhem-cms/js/pin-gesture.js';
import { PIN_BEHAVIOR, pinCommand } from '../www/fhem-cms/js/pin-behavior.js';
import { PIN_TYPES } from '../www/fhem-cms/js/pin-presentation.js';
import { FhemClient } from '../www/fhem-cms/js/fhem-client.js';

class Button extends EventTarget {
  captured = null;
  setPointerCapture(id) { this.captured = id; }
  hasPointerCapture(id) { return this.captured === id; }
  releasePointerCapture() { this.captured = null; }
  event(type, fields = {}) {
    const event = new Event(type, {cancelable: true});
    Object.assign(event, {isPrimary: true, button: 0, pointerId: 1, clientX: 100, clientY: 100, ...fields});
    this.dispatchEvent(event);
    return event;
  }
}

test('Pin gestures enforce the exact 400ms/6px boundary and never activate twice', t => {
  assert.equal(PIN_HOLD_MS, 400);
  assert.equal(PIN_MOVE_LIMIT, 6);
  t.mock.timers.enable({apis: ['setTimeout']});
  let now = 0;
  t.mock.method(performance, 'now', () => now);
  for (const duration of [0, 349, 350, 399, 400, 401, 1000]) {
    const button = new Button();
    let taps = 0, opens = 0;
    const stop = bindPinGesture(button, {tap: () => taps++, open: () => opens++, direct: () => true, enabled: () => true});
    button.event('pointerdown');
    now += duration;
    t.mock.timers.tick(duration);
    button.event('pointerup');
    assert.equal(button.event('click', {detail: 1}).defaultPrevented, true);
    t.mock.timers.tick(1000);
    assert.equal(taps, duration < 400 ? 1 : 0, `tap at ${duration}ms`);
    assert.equal(opens, duration >= 400 ? 1 : 0, `hold at ${duration}ms`);
    assert.equal(button.captured, null);
    stop();
  }
  for (const distance of [0, 6, 6.001, 7]) {
    const button = new Button();
    let taps = 0, opens = 0;
    const stop = bindPinGesture(button, {tap: () => taps++, open: () => opens++, direct: () => true, enabled: () => true});
    button.event('pointerdown');
    button.event('pointermove', {clientX: 100 + distance});
    now += 399;
    button.event('pointerup');
    button.event('click', {detail: 1});
    t.mock.timers.tick(1000);
    assert.equal(taps, distance <= 6 ? 1 : 0, `movement ${distance}px`);
    assert.equal(opens, 0);
    stop();
  }
  const button = new Button();
  let activated = 0;
  const stop = bindPinGesture(button, {tap: () => activated++, open: () => activated++, direct: () => true, enabled: () => true});
  button.event('pointerdown');
  button.event('pointerup', {clientY: 107});
  assert.equal(activated, 0, 'release position also enforces movement cancellation');
  stop();
});

test('Pin gestures cancel pending timers and preserve keyboard/assistive access', t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  let now = 0;
  t.mock.method(performance, 'now', () => now);
  for (const type of ['pointercancel', 'lostpointercapture', 'blur', 'keydown', 'disconnect', 'second-pointer']) {
    const button = new Button();
    let taps = 0, opens = 0;
    const stop = bindPinGesture(button, {tap: () => taps++, open: () => opens++, direct: () => true, enabled: () => true});
    button.event('pointerdown');
    if (type === 'disconnect') stop();
    else if (type === 'second-pointer') button.event('pointerdown', {pointerId: 2, isPrimary: false});
    else button.event(type, {key: 'Escape'});
    now += 1000; t.mock.timers.tick(1000);
    button.event('pointerup');
    button.event('click', {detail: 1});
    assert.equal(taps + opens, 0, type);
    stop();
  }
  const button = new Button();
  let taps = 0, opens = 0;
  let enabled = true, direct = true;
  const stop = bindPinGesture(button, {tap: () => taps++, open: () => opens++, direct: () => direct, enabled: () => enabled});
  button.event('pointerdown');
  now += 400;
  button.event('pointerup');
  assert.equal(opens, 1, 'delayed timer still treats 400ms as hold');
  assert.equal(taps, 0);
  button.event('click', {detail: 1});
  assert.equal(opens, 1);
  button.event('keydown', {key: 'Enter'});
  button.event('click', {detail: 0});
  assert.equal(opens, 2, 'keyboard/assistive click opens, never switches');
  direct = false;
  button.event('pointerdown');
  now += 500; t.mock.timers.tick(500);
  assert.equal(opens, 2, 'complex widget has no hold side effect');
  button.event('pointerup');
  button.event('click', {detail: 1});
  assert.equal(opens, 3, 'complex widget opens once on release');
  enabled = false;
  button.event('pointerdown');
  t.mock.timers.tick(1000);
  button.event('pointerup');
  button.event('click', {detail: 0});
  assert.equal(opens, 3);
  assert.equal(taps, 0);
  stop();
});

test('Pin registry uses only real configured binary actions and preserves the FHEMWEB command path', async () => {
  assert.deepEqual(Object.keys(PIN_BEHAVIOR), Object.keys(PIN_TYPES));
  const group = state => new Map([['Demo', [{name: 'Demo', readings: {state}}]]]);
  const widget = {type: 'fhem-switch', device: 'Demo', reading: 'state', on: 'open', off: 'close'};
  assert.deepEqual(pinCommand(widget, group('open')), {device: 'Demo', command: 'close'});
  assert.deepEqual(pinCommand(widget, group('close')), {device: 'Demo', command: 'open'});
  for (const state of ['on', '', null, undefined]) assert.equal(pinCommand(widget, group(state)), null);
  assert.equal(pinCommand(widget, new Map()), null);
  assert.deepEqual(pinCommand({type: 'fhem-button', device: 'Demo', command: 'press'}, new Map()),
    {device: 'Demo', command: 'press'});
  for (const type of Object.keys(PIN_TYPES).filter(type => !['fhem-switch', 'fhem-button'].includes(type))) {
    assert.equal(pinCommand({type}, group('open')), null, type);
  }
  assert.throws(() => pinCommand({type: 'constructor'}, new Map()), /Unbekannter/);
  for (const command of ['on;set Other off', 'on off', '{doSomething()}', '', null]) {
    assert.throws(() => pinCommand({type: 'fhem-button', device: 'Demo', command}, new Map()), /Schaltbefehl/);
  }
  const client = new FhemClient('CMS', new URL('http://localhost/fhem'));
  const calls = [];
  client.command = async command => { calls.push(command); return ''; };
  const action = pinCommand(widget, group('open'));
  await client.setCommand(action.device, action.command);
  assert.deepEqual(calls, ['set Demo close']);
  client.command = async () => 'Not authorized';
  await assert.rejects(client.setCommand(action.device, action.command), /Not authorized/);
});
