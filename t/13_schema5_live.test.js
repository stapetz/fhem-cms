import assert from 'node:assert/strict';
import { test } from 'node:test';

test('schema 5 live page refreshes, reconnects and ignores results after stop', async () => {
  const previous = {
    window: globalThis.window, document: globalThis.document,
    HTMLElement: globalThis.HTMLElement, customElements: globalThis.customElements,
    fetch: globalThis.fetch,
  };
  globalThis.window = { location: { href: 'https://example.test/' } };
  globalThis.document = {};
  globalThis.HTMLElement = class {};
  const registry = new Map();
  globalThis.customElements = {
    define(name, element) { registry.set(name, element); },
    get(name) { return registry.get(name); },
  };
  try {
    const { Schema5LivePage } = await import('../www/fhem-cms/js/fcui-schema5-live.js');
    let timerId = 0;
    const timeouts = new Map();
    const intervals = new Map();
    const timers = {
      setTimeout(fn, delay) { const id = ++timerId; timeouts.set(id, { fn, delay }); return id; },
      clearTimeout(id) { timeouts.delete(id); },
      setInterval(fn, delay) { const id = ++timerId; intervals.set(id, { fn, delay }); return id; },
      clearInterval(id) { intervals.delete(id); },
    };
    const fireTimeout = (delay) => {
      const entry = [...timeouts.entries()].find(([, timer]) => timer.delay === delay);
      assert.ok(entry, `expected timeout ${delay}`);
      timeouts.delete(entry[0]);
      entry[1].fn();
    };
    const requests = [];
    const subscriptions = [];
    let unsubscribed = 0;
    const client = {
      jsonlist(spec) {
        return new Promise((resolve, reject) => requests.push({ spec, resolve, reject }));
      },
      subscribe(names, event, state) { subscriptions.push({ names, event, state }); state('polling'); },
      unsubscribe() { unsubscribed += 1; },
    };
    const updates = [];
    const statuses = [];
    const widgets = [
      { type: 'fhem-value', device: 'Temp' },
      { type: 'text', html: '{{Temp:state}}' },
      { type: 'fhem-value', device: 'bad name' },
    ];
    let now = 100;
    const live = new Schema5LivePage(client, widgets,
      (data, stale) => updates.push({ data, stale }), (status) => statuses.push(status), timers, () => now);
    const initial = live.start();
    assert.deepEqual(subscriptions[0].names, ['Temp']);
    assert.equal(requests[0].spec, 'Temp,device=Temp');
    assert.equal([...intervals.values()][0].delay, 30000);
    assert.throws(() => live.start(), /bereits gestartet/);
    subscriptions[0].event();
    fireTimeout(300);
    assert.equal(requests.length, 1, 'overlapping refreshes are coalesced');
    requests[0].resolve([
      { name: 'Temp', readings: { state: 'old' } },
      { name: 'TempChannel', parent: 'Temp', readings: {} },
    ]);
    await initial;
    assert.deepEqual(subscriptions[1].names, ['Temp', 'TempChannel']);
    assert.equal(updates[0].data.get('Temp').length, 2);
    assert.equal(updates[0].stale, null);
    assert.equal(statuses.at(-1).lastSuccess, 100);
    subscriptions[0].event();
    assert.equal(timeouts.size, 1, 'old subscription cannot schedule a refresh');
    fireTimeout(0);
    assert.equal(requests.length, 2);
    requests[1].reject(new Error('Netzwerkfehler'));
    await live.inFlight;
    assert.equal(updates.at(-1).stale, 100);
    assert.equal(updates.at(-1).data.get('Temp')[0].readings.state, 'old');
    assert.equal(statuses.at(-1).error, 'Netzwerkfehler');
    subscriptions[1].state('live');
    assert.equal(statuses.at(-1).error, 'Netzwerkfehler', 'reconnection does not hide a failed refresh');
    fireTimeout(300);
    now = 200;
    requests[2].resolve([{ name: 'Temp', readings: { state: 'new' } }]);
    await live.inFlight;
    assert.equal(updates.at(-1).data.get('Temp')[0].readings.state, 'new');
    assert.equal(updates.at(-1).stale, null);
    assert.equal(statuses.at(-1).error, null);
    assert.equal(statuses.at(-1).lastSuccess, 200);
    assert.deepEqual(subscriptions[2].names, ['Temp'], 'removed channels are unsubscribed');
    [...intervals.values()][0].fn();
    fireTimeout(0);
    assert.equal(requests.length, 4);
    const late = live.inFlight;
    live.stop();
    live.stop();
    assert.equal(unsubscribed, 1);
    assert.equal(intervals.size, 0);
    assert.equal(timeouts.size, 0);
    const updateCount = updates.length;
    const statusCount = statuses.length;
    subscriptions[2].event();
    subscriptions[2].state('live');
    requests[3].resolve([{ name: 'Temp', readings: { state: 'late' } }]);
    await late;
    assert.equal(updates.length, updateCount);
    assert.equal(statuses.length, statusCount);
    assert.equal(timeouts.size, 0);
    assert.throws(() => live.refresh(), /nicht aktiv/);
    assert.throws(() => live.start(), /bereits gestartet/);

    const modalRequests = [];
    const modalSubscriptions = [];
    const modalUpdates = [];
    const modalClient = {
      jsonlist(spec) { return new Promise(resolve => modalRequests.push({ spec, resolve })); },
      subscribe(names) { modalSubscriptions.push(names); },
      unsubscribe() {},
    };
    const shared = new Schema5LivePage(modalClient, widgets, data => modalUpdates.push(data), () => {}, timers);
    const mainLoad = shared.start();
    const expansion = shared.setWidgets([...widgets, { type: 'fhem-value', device: 'Door' }]);
    modalRequests[0].resolve([{ name: 'Temp', readings: { state: 'old' } }]);
    await Promise.all([mainLoad, expansion]);
    assert.equal(modalUpdates.length, 0, 'old in-flight result cannot replace expanded snapshots');
    fireTimeout(0);
    assert.equal(modalRequests[1].spec, 'Door,device=Door,Temp,device=Temp');
    modalRequests[1].resolve([{ name: 'Door', readings: { state: 'open' } },
      { name: 'Temp', readings: { state: 'current' } }]);
    await shared.inFlight;
    assert.equal(modalUpdates.at(-1).get('Door')[0].readings.state, 'open');
    const contraction = shared.setWidgets(widgets);
    assert.deepEqual(modalSubscriptions.at(-1), ['Temp'], 'closing modal removes its devices');
    modalRequests[2].resolve([{ name: 'Temp', readings: { state: 'current' } }]);
    await contraction;
    assert.equal(modalUpdates.at(-1).has('Door'), false);
    shared.stop();
    assert.throws(() => shared.setWidgets(widgets), /nicht aktiv/);

    class Element {
      constructor(tag) {
        this.tag = tag; this.children = []; this.attributes = {};
        this.style = { setProperty(name, value) { this[name] = value; } };
      }
      append(child) { this.children.push(child); }
      replaceChildren(...children) { this.children = children; }
      setAttribute(name, value) { this.attributes[name] = value; }
      removeAttribute(name) { delete this.attributes[name]; }
    }
    globalThis.document.createElement = (tag) => new Element(tag);
    const { mountSchema5Widgets } = await import('../www/fhem-cms/js/fcui-schema5-widgets.js');
    const config = {
      schemaVersion: 5, settings: { layoutMode: 'grid', gridColumns: 12 },
      navigation: { grid: { col: 1, row: 1, w: 12, h: 1 } },
      pages: [{ id: 'one', widgets: [
        { id: 'value', type: 'fhem-value', device: 'Temp', grid: { col: 1, row: 2, w: 2, h: 1 } },
      ] }],
    };
    const root = new Element('grid');
    const grid = {
      items: [],
      getColumn() { return 12; },
      makeWidget(wrapper, item) { this.items.push({ ...item }); },
      save() { return this.items; },
      destroy() {},
    };
    const mounted = mountSchema5Widgets({ init: () => grid }, root, config, 'one',
      new Element('nav'), {}, new Map());
    const component = root.children[1].children[0].children[0];
    const integrationStatuses = [];
    const integration = new Schema5LivePage(client, config.pages[0].widgets,
      (data, stale) => mounted.update(data, stale), (status) => integrationStatuses.push(status), timers, () => 300);
    const loaded = integration.start();
    requests[4].resolve([{ name: 'Temp', readings: { state: 'bound' } }]);
    await loaded;
    assert.equal(component.data[0].readings.state, 'bound');
    assert.equal(component.stale, null);
    const failed = integration.refresh();
    requests[5].reject(new Error('offline'));
    await failed;
    assert.equal(component.data[0].readings.state, 'bound');
    assert.equal(component.stale, 300);
    assert.equal(integrationStatuses.at(-1).error, 'offline');
    integration.stop();
    mounted.destroy();

    const noDeviceStatuses = [];
    const noDevices = new Schema5LivePage(client, [{ type: 'fhem-clock' }],
      (data, stale) => { assert.equal(data.size, 0); assert.equal(stale, null); },
      (status) => noDeviceStatuses.push(status), timers, () => 400);
    const requestCount = requests.length;
    await noDevices.start();
    assert.equal(requests.length, requestCount, 'pages without devices do not issue jsonlist2');
    assert.equal(noDeviceStatuses.at(-1).error, null);
    noDevices.stop();

    const failedStatuses = [];
    const syncFailureClient = {
      jsonlist() { throw new Error('Synchroner Fehler'); },
      subscribe(names, event, state) { state('polling'); },
      unsubscribe() {},
    };
    const syncFailure = new Schema5LivePage(syncFailureClient, widgets, () => {},
      (status) => failedStatuses.push(status), timers, () => 500);
    await syncFailure.start();
    assert.equal(failedStatuses.at(-1).error, 'Synchroner Fehler');
    assert.equal(failedStatuses.at(-1).lastSuccess, null);
    syncFailure.stop();

    const fatalStatuses = [];
    let updateCalls = 0;
    const fatal = new Schema5LivePage({
      jsonlist: () => Promise.resolve([]),
      subscribe(names, event, state) { state('polling'); },
      unsubscribe() {},
    }, widgets, () => {
      updateCalls += 1;
      if (updateCalls > 1) throw new Error('Ansicht defekt');
    }, (status) => fatalStatuses.push(status), timers);
    await fatal.start();
    fatal.scheduleRefresh(0);
    fireTimeout(0);
    await assert.rejects(fatal.inFlight, /Ansicht defekt/);
    await Promise.resolve();
    assert.match(fatalStatuses.at(-1).error, /Live-Aktualisierung abgebrochen: Ansicht defekt/);
    assert.equal(fatal.stopped, true);
    assert.equal(intervals.size, 0);

    const { FhemClient } = await import('../www/fhem-cms/js/fhem-client.js');
    const commands = [];
    globalThis.window.clearTimeout = timers.clearTimeout;
    globalThis.fetch = async (url, options) => {
      if (!options.method) return new Response('', { headers: { 'X-FHEM-csrfToken': 'test-token' } });
      commands.push(options.body.get('cmd'));
      assert.equal(options.body.get('fwcsrf'), 'test-token');
      return new Response(JSON.stringify({ Results: [
        { Name: 'Temp', Readings: { state: { Value: 'real client' } } },
        { Name: 'TempChannel', Internals: { device: 'Temp' }, Readings: {} },
      ] }));
    };
    const realClient = new FhemClient('cms', 'https://example.test/fhem');
    let realData;
    const real = new Schema5LivePage(realClient, widgets, (data) => { realData = data; },
      () => {}, timers);
    await real.start();
    assert.deepEqual(commands, ['jsonlist2 Temp,device=Temp']);
    assert.equal(realData.get('Temp')[0].readings.state, 'real client');
    assert.equal(realData.get('Temp')[1].name, 'TempChannel');
    real.stop();
  } finally {
    globalThis.window = previous.window;
    globalThis.document = previous.document;
    globalThis.HTMLElement = previous.HTMLElement;
    globalThis.customElements = previous.customElements;
    globalThis.fetch = previous.fetch;
  }
});
