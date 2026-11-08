import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { FhemClient } from '../www/fhem-cms/js/fhem-client.js';

const original = {
  fetch: globalThis.fetch,
  window: globalThis.window,
  WebSocket: globalThis.WebSocket,
};

afterEach(() => {
  globalThis.fetch = original.fetch;
  globalThis.window = original.window;
  globalThis.WebSocket = original.WebSocket;
});

test('commands use same-origin credentials and renew a rejected CSRF token once', async () => {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), ...options });
    if (!options.method) {
      const token = calls.length === 1 ? 'old-token' : 'new-token';
      return new Response('', { headers: { 'X-FHEM-csrfToken': token } });
    }
    if (calls.length === 2) {
      return new Response('CSRF token invalid', { status: 403 });
    }
    return new Response('');
  };
  const client = new FhemClient('cms', 'https://fhem.example/fhem/');
  await client.setCommand('lamp', 'on');
  assert.equal(calls.length, 4);
  assert.ok(calls.every((call) => call.credentials === 'same-origin' && call.cache === 'no-store'));
  assert.equal(calls[1].body.get('cmd'), 'set lamp on');
  assert.equal(calls[1].body.get('fwcsrf'), 'old-token');
  assert.equal(calls[3].body.get('fwcsrf'), 'new-token');
});

test('invalid device and command inputs never reach FHEMWEB', async () => {
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    throw new Error('unexpected network request');
  };
  const client = new FhemClient('cms', 'https://fhem.example/fhem/');
  await assert.rejects(client.setCommand('lamp;set all on', 'on'), /Ungültiger Befehl/);
  await assert.rejects(client.setCommand('lamp', 'on', 'on;shutdown'), /Ungültiger Befehl/);
  await assert.rejects(client.setReading('lamp', 'pct', '5;shutdown'), /Ungültiger Sollwert/);
  assert.equal(requests, 0);
});

test('migration preview sends a read-only encoded plan and validates the reply', async () => {
  const plan = { navigation: { col: 1, row: 1, w: 12, h: 1 }, pages: [] };
  const calls = [];
  let answer = { config: { schemaVersion: 5 }, source: { schemaVersion: 4 }, token: 'a'.repeat(64) };
  globalThis.fetch = async (url, options) => {
    calls.push(options);
    if (!options.method) return new Response('', { headers: { 'X-FHEM-csrfToken': 'token' } });
    return new Response(JSON.stringify(answer));
  };
  const client = new FhemClient('cms', 'https://fhem.example/fhem/');
  assert.deepEqual(await client.previewMigration(plan), answer);
  const command = calls[1].body.get('cmd');
  assert.match(command, /^get cms migrationpreview [A-Za-z0-9+/]+=*$/);
  assert.deepEqual(JSON.parse(atob(command.split(' ')[3])), plan);
  assert.equal(calls[1].body.get('fwcsrf'), 'token');
  answer = { config: { schemaVersion: 4 }, source: { schemaVersion: 4 }, token: 'a'.repeat(64) };
  await assert.rejects(client.previewMigration(plan), /Unerwartete Antwort/);
  answer = { config: { schemaVersion: 5 }, source: { schemaVersion: 4 }, token: 'invalid' };
  await assert.rejects(client.previewMigration(plan), /Unerwartete Antwort/);
});

test('subscriptions filter names, reconnect after close, and stop after unsubscribe', () => {
  const sockets = [];
  const timers = new Map();
  let nextTimer = 0;
  class Socket {
    constructor(url) {
      this.url = url;
      this.listeners = {};
      sockets.push(this);
    }
    addEventListener(type, callback) {
      this.listeners[type] = callback;
    }
    emit(type, value = {}) {
      this.listeners[type]?.(value);
    }
    close() {
      this.emit('close');
    }
  }
  globalThis.WebSocket = Socket;
  globalThis.window = {
    WebSocket: Socket,
    setTimeout(callback, delay) {
      const id = ++nextTimer;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
  };
  const client = new FhemClient('cms', 'https://fhem.example/fhem/');
  const states = [];
  const events = [];
  client.subscribe(['lamp', 'lamp', 'bad;name'], (name) => events.push(name), (state) => states.push(state));
  const url = sockets[0].url;
  assert.equal(url.protocol, 'wss:');
  assert.match(url.searchParams.get('inform'), /filter=NAME=lamp;/);
  sockets[0].emit('open');
  sockets[0].emit('message', { data: '["lamp","on"]\n["other","on"]\ninvalid' });
  assert.deepEqual(states, ['live']);
  assert.deepEqual(events, ['lamp']);
  sockets[0].emit('close');
  assert.deepEqual(states, ['live', 'polling']);
  const timer = [...timers.values()][0];
  assert.equal(timer.delay, 1000);
  timers.clear();
  timer.callback();
  assert.equal(sockets.length, 2);
  client.unsubscribe();
  assert.equal(timers.size, 0);
  assert.deepEqual(states, ['live', 'polling']);
});

test('missing WebSocket reports polling without connecting', () => {
  globalThis.window = { clearTimeout() {} };
  const client = new FhemClient('cms', 'https://fhem.example/fhem/');
  const states = [];
  client.subscribe(['lamp'], () => {}, (state) => states.push(state));
  assert.deepEqual(states, ['polling']);
});
