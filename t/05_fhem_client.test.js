import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { FhemClient } from '../www/fhem-cms/js/fhem-client.js';
import { createPreviewServices } from '../fcui/preview-services.js';

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

test('icon URLs remain same-origin when FHEMWEB is at the web root', () => {
  const root = new FhemClient('cms', 'https://fhem.example/');
  const nested = new FhemClient('cms', 'https://fhem.example/fhem/');
  assert.equal(root.iconUrl('light_on'), '/icons/light_on');
  assert.equal(nested.iconUrl('light_on'), '/fhem/icons/light_on');
  assert.equal(root.iconUrl('../invalid'), '');
});

test('preview services expose only reads and explicitly reject actions', async () => {
  const calls = [];
  const client = {
    iconUrl(name) { calls.push(['icon', name]); return '/fhem/icons/test'; },
    async history(...args) { calls.push(['history', ...args]); return { points: [] }; },
    setCommand() { throw new Error('write method must never be reached'); },
    setReading() { throw new Error('write method must never be reached'); },
  };
  const services = createPreviewServices(client);
  assert.equal(services.iconUrl('test'), '/fhem/icons/test');
  assert.deepEqual(await services.history('Temp', 'state', '24h', 'auto', 'auto'), { points: [] });
  assert.throws(() => services.setCommand('Lamp', 'on'), /Vorschau deaktiviert/);
  assert.throws(() => services.setTarget({}, 20), /Vorschau deaktiviert/);
  assert.equal(services.saveWidget, undefined);
  assert.equal(services.uploadMedia, undefined);
  assert.ok(Object.isFrozen(services));
  assert.deepEqual(calls, [['icon', 'test'], ['history', 'Temp', 'state', '24h', 'auto', 'auto']]);
  assert.throws(() => createPreviewServices({}), /nicht verfügbar/);
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

test('draft status accepts only an explicit boolean and rejects malformed responses', async () => {
  let answer = '{"draft":false}';
  const calls = [];
  globalThis.fetch = async (url, options) => {
    if (!options.method) return new Response('', { headers: { 'X-FHEM-csrfToken': 'token' } });
    calls.push(options.body.get('cmd'));
    return new Response(answer);
  };
  const client = new FhemClient('cms', 'https://fhem.example/fhem/');
  assert.equal(await client.hasDraft(), false);
  answer = '{"draft":true}';
  assert.equal(await client.hasDraft(), true);
  for (const invalid of ['{}', 'null', '[]', '{"draft":null}', '{"draft":"false"}', '{"draft":0}', 'true']) {
    answer = invalid;
    await assert.rejects(client.hasDraft(), /Unerwartete Antwort für den Entwurfsstatus/);
  }
  answer = 'Zugriff verweigert';
  await assert.rejects(client.hasDraft(), /Zugriff verweigert/);
  assert.ok(calls.every((command) => command === 'get cms status'));
});

test('jsonlist reports malformed responses instead of treating them as empty device lists', async () => {
  let answer = '{"Results":[]}';
  globalThis.fetch = async (url, options) => {
    if (!options.method) return new Response('', { headers: { 'X-FHEM-csrfToken': 'token' } });
    return new Response(answer);
  };
  const client = new FhemClient('cms', 'https://fhem.example/fhem/');
  assert.deepEqual(await client.jsonlist('Temp'), []);
  for (const invalid of ['null', '[]', '{}', '{"Results":null}', '{"Results":{}}']) {
    answer = invalid;
    await assert.rejects(client.jsonlist('Temp'), /ungültige Geräteliste/);
  }
  answer = 'not-json';
  await assert.rejects(client.jsonlist('Temp'), /keine gültigen Gerätedaten/);
});

test('versioned state uses a read-only command and checks the response shape', async () => {
  const calls = [];
  let answer = { live: { schemaVersion: 5 }, draft: null, token: 'a'.repeat(64) };
  globalThis.fetch = async (url, options) => {
    calls.push(options);
    if (!options.method) return new Response('', { headers: { 'X-FHEM-csrfToken': 'token' } });
    return new Response(JSON.stringify(answer));
  };
  const client = new FhemClient('cms', 'https://fhem.example/fhem/');
  assert.deepEqual(await client.getVersion5State(), answer);
  assert.equal(calls[1].body.get('cmd'), 'get cms version5state');
  assert.equal(calls[1].body.get('fwcsrf'), 'token');
  answer = { live: { schemaVersion: '05' }, draft: { schemaVersion: 5 }, token: 'b'.repeat(64) };
  assert.deepEqual(await client.getVersion5State(), answer);
  for (const invalid of [
    { live: { schemaVersion: 4 }, draft: null, token: 'a'.repeat(64) },
    { live: { schemaVersion: 5 }, draft: { schemaVersion: 4 }, token: 'a'.repeat(64) },
    { live: { schemaVersion: 5 }, token: 'a'.repeat(64) },
    { live: { schemaVersion: 5 }, draft: null, token: 'invalid' },
  ]) {
    answer = invalid;
    await assert.rejects(client.getVersion5State(), /Unerwartete Antwort/);
  }
});

test('migration restore preview validates backup name and response without writes', async () => {
  const calls = [];
  let answer = { live: { schemaVersion: 5 }, backup: { schemaVersion: 1 }, token: 'c'.repeat(64) };
  globalThis.fetch = async (url, options) => {
    calls.push(options);
    if (!options.method) return new Response('', { headers: { 'X-FHEM-csrfToken': 'token' } });
    return new Response(JSON.stringify(answer));
  };
  const client = new FhemClient('cms', 'https://fhem.example/fhem/');
  await assert.rejects(client.previewMigrationRestore('../config.json'), /Ungültiger Backup/);
  assert.equal(calls.length, 0);
  assert.deepEqual(await client.previewMigrationRestore('config.json.20000101-000000.bak'), answer);
  assert.equal(calls[1].body.get('cmd'), 'get cms migrationrestorepreview config.json.20000101-000000.bak');
  for (const invalid of [
    { live: { schemaVersion: 6 }, backup: { schemaVersion: 1 }, token: 'c'.repeat(64) },
    { live: { schemaVersion: 5 }, backup: null, token: 'c'.repeat(64) },
    { live: { schemaVersion: 5 }, backup: { schemaVersion: 1 }, token: 'bad' },
  ]) {
    answer = invalid;
    await assert.rejects(client.previewMigrationRestore('config.json.20000101-000000.bak'), /Unerwartete Antwort/);
  }
  answer = ['config.json.20000101-000000.bak'];
  assert.deepEqual(await client.getMigrationBackups(), answer);
  assert.equal(calls.at(-1).body.get('cmd'), 'get cms migrationbackups');
  answer = ['../config.json'];
  await assert.rejects(client.getMigrationBackups(), /Unerwartete Antwort/);
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
  sockets[0].emit('open');
  sockets[0].emit('message', { data: '["lamp","old"]' });
  sockets[0].emit('close');
  assert.deepEqual(states, ['live', 'polling'], 'events from old sockets are ignored');
  assert.deepEqual(events, ['lamp']);
  assert.equal(timers.size, 0, 'old socket does not schedule another reconnect');
  client.unsubscribe();
  sockets[1].emit('open');
  sockets[1].emit('message', { data: '["lamp","old"]' });
  assert.equal(timers.size, 0);
  assert.deepEqual(states, ['live', 'polling']);
  assert.deepEqual(events, ['lamp'], 'unsubscribed socket events are ignored');
});

test('unsubscribe inside polling callback does not schedule reconnection', () => {
  const timers = [];
  class Socket {
    constructor() { this.listeners = {}; }
    addEventListener(type, callback) { this.listeners[type] = callback; }
    close() { this.listeners.close?.(); }
  }
  globalThis.WebSocket = Socket;
  globalThis.window = {
    WebSocket: Socket,
    setTimeout(callback) { timers.push(callback); return timers.length; },
    clearTimeout() {},
  };
  const client = new FhemClient('cms', 'https://fhem.example/fhem/');
  client.subscribe(['lamp'], () => {}, (state) => { if (state === 'polling') client.unsubscribe(); });
  client.socket.listeners.close();
  assert.equal(client.subscription, null);
  assert.equal(timers.length, 0);
});

test('missing WebSocket reports polling without connecting', () => {
  globalThis.window = { clearTimeout() {} };
  const client = new FhemClient('cms', 'https://fhem.example/fhem/');
  const states = [];
  client.subscribe(['lamp'], () => {}, (state) => states.push(state));
  assert.deepEqual(states, ['polling']);
});
