import assert from 'node:assert/strict';
import { test } from 'node:test';

test('schema 5 view routes pages and cleans up old requests and subscriptions', async () => {
  const previous = {
    window: globalThis.window, document: globalThis.document,
    HTMLElement: globalThis.HTMLElement, customElements: globalThis.customElements,
  };
  class Element {
    constructor(tag) {
      this.tag = tag;
      this.children = [];
      this.attributes = {};
      this.style = {};
      this.classList = { toggle() {} };
    }
    append(child) { this.children.push(child); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(name, value) { this.attributes[name] = value; }
    removeAttribute(name) { delete this.attributes[name]; }
    toggleAttribute(name) {
      if (name in this.attributes) { delete this.attributes[name]; return false; }
      this.attributes[name] = ''; return true;
    }
    addEventListener(name, callback) { (this.listeners ||= {})[name] = callback; }
  }
  globalThis.window = { location: { href: 'https://example.test/' } };
  globalThis.document = { createElement: (tag) => new Element(tag) };
  globalThis.HTMLElement = class {};
  const registry = new Map();
  globalThis.customElements = {
    define(name, element) { registry.set(name, element); },
    get(name) { return registry.get(name); },
  };
  try {
    const { Schema5View } = await import('../www/fhem-cms/js/fcui-schema5-view.js');
    const config = {
      schemaVersion: 5, settings: { layoutMode: 'grid', gridColumns: 12 },
      navigation: {
        orientation: 'vertical', grid: { col: 1, row: 1, w: 12, h: 1 },
        items: [{ page: 'second', label: 'Zwei', width: 90 }],
      },
      pages: [
        { id: 'first', title: 'Eins', widgets: [
          { id: 'a', type: 'fhem-value', device: 'Temp', grid: { col: 1, row: 2, w: 2, h: 1 } },
        ] },
        { id: 'second', title: 'Andere', widgets: [
          { id: 'b', type: 'fhem-value', device: 'Other', grid: { col: 1, row: 2, w: 2, h: 1 } },
        ] },
      ],
    };
    const listeners = new Map();
    let reloads = 0;
    const browser = {
      location: { hash: '#/first', reload() { reloads += 1; } },
      addEventListener(name, callback) { listeners.set(name, callback); },
      removeEventListener(name, callback) {
        assert.equal(listeners.get(name), callback);
        listeners.delete(name);
      },
    };
    const grids = [];
    let failMount = false;
    const GridStack = { init() {
      const grid = {
        items: [], destroyed: 0,
        getColumn() { return 12; },
        makeWidget(wrapper, item) {
          if (failMount) throw new Error('Raster defekt');
          this.items.push({ ...item });
        },
        save() { return this.items; },
        destroy() { this.destroyed += 1; },
      };
      grids.push(grid);
      return grid;
    } };
    const requests = [];
    const subscriptions = [];
    let unsubscribed = 0;
    const client = {
      jsonlist(spec) { return new Promise((resolve, reject) => requests.push({ spec, resolve, reject })); },
      subscribe(names, event, state) { subscriptions.push({ names, event, state }); state('polling'); },
      unsubscribe() { unsubscribed += 1; },
    };
    const root = new Element('grid');
    const status = new Element('status');
    const view = new Schema5View({ GridStack, root, status, config, client, services: {}, browser });
    const first = view.start();
    assert.equal(requests[0].spec, 'Temp,device=Temp');
    const firstNav = root.children[0].children[0].children[0];
    assert.equal(firstNav.children[0].className, 'cms-nav-burger');
    assert.equal(firstNav.children[1].href, '#/first');
    assert.equal(firstNav.children[1].attributes['aria-current'], 'page');
    assert.equal(firstNav.children[2].textContent, 'Zwei');
    assert.equal(firstNav.children[2].style.width, 'min(90px, 100%)');
    browser.location.hash = '#/second';
    listeners.get('hashchange')();
    assert.equal(requests[1].spec, 'Other,device=Other');
    assert.equal(grids[0].destroyed, 1);
    assert.equal(unsubscribed, 1);
    const secondComponent = root.children[1].children[0].children[0];
    const secondNav = root.children[0].children[0].children[0];
    assert.equal(secondNav.children[2].attributes['aria-current'], 'page');
    requests[1].resolve([{ name: 'Other', readings: { state: 'neu' } }]);
    await view.live.inFlight;
    assert.equal(secondComponent.data[0].readings.state, 'neu');
    const currentStatus = status.textContent;
    requests[0].resolve([{ name: 'Temp', readings: { state: 'alt' } }]);
    await first;
    assert.equal(secondComponent.data[0].readings.state, 'neu');
    assert.equal(status.textContent, currentStatus);
    subscriptions[0].state('live');
    assert.equal(status.textContent, currentStatus);
    const failed = view.live.refresh();
    requests[2].reject(new Error('offline'));
    await failed;
    assert.match(status.textContent, /Daten nicht verfügbar: offline/);
    assert.ok('data-error' in status.attributes);
    assert.equal(secondComponent.data[0].readings.state, 'neu');
    const retry = view.live.refresh();
    requests[3].resolve([{ name: 'Other', readings: { state: 'wieder online' } }]);
    await retry;
    assert.equal(secondComponent.data[0].readings.state, 'wieder online');
    assert.equal('data-error' in status.attributes, false);
    await assert.rejects(view.showPage('unknown'), /Unbekannte Seite/);
    assert.equal(view.current, 'second');
    browser.location.hash = '#/unknown';
    assert.equal(view.pageFromHash(), 'first');
    const pending = view.live.refresh();
    view.stop();
    view.stop();
    requests[4].resolve([{ name: 'Other', readings: { state: 'spät' } }]);
    await pending;
    assert.equal(secondComponent.data[0].readings.state, 'wieder online');
    assert.equal(root.children.length, 0);
    assert.equal(grids[1].destroyed, 1);
    assert.equal(unsubscribed, 2);
    assert.equal(listeners.size, 0);
    await assert.rejects(view.showPage('first'), /nicht aktiv/);
    browser.location.hash = '#/first';
    failMount = true;
    await assert.rejects(view.start(), /Raster defekt/);
    assert.equal(root.children.length, 0);
    assert.equal(grids[2].destroyed, 1);
    assert.equal(listeners.size, 0);
    failMount = false;
    const restarted = view.start();
    requests[5].resolve([{ name: 'Temp', readings: { state: 'erneut' } }]);
    await restarted;
    const restartedComponent = root.children[1].children[0].children[0];
    assert.equal(restartedComponent.data[0].readings.state, 'erneut');
    const beforeHide = view.live.refresh();
    listeners.get('pagehide')();
    assert.equal(root.children.length, 0);
    assert.equal(grids[3].destroyed, 1);
    requests[6].resolve([{ name: 'Temp', readings: { state: 'nach pagehide' } }]);
    await beforeHide;
    assert.equal(restartedComponent.data[0].readings.state, 'erneut');
    browser.location.hash = '#/second';
    listeners.get('hashchange')();
    assert.equal(requests.length, 7, 'hidden page cannot start another request');
    listeners.get('pageshow')({ persisted: false });
    assert.equal(reloads, 0);
    listeners.get('pageshow')({ persisted: true });
    assert.equal(reloads, 1, 'restored page reloads the versioned state');
    assert.equal(root.children.length, 0);
    await assert.rejects(view.showPage('first'), /nicht aktiv/);
    view.stop();
    assert.equal(listeners.size, 0);
    const invalid = structuredClone(config);
    invalid.schemaVersion = 4;
    const invalidView = new Schema5View({ GridStack, root, status, config: invalid, client, services: {}, browser });
    await assert.rejects(invalidView.start(), /Schema 5/);
    assert.equal(listeners.size, 0);
  } finally {
    globalThis.window = previous.window;
    globalThis.document = previous.document;
    globalThis.HTMLElement = previous.HTMLElement;
    globalThis.customElements = previous.customElements;
  }
});
