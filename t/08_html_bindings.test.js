import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatValue, lookupValue, substitute } from '../www/fhem-cms/js/freehtml.js';

test('map filters accept both separators without changing unmapped values or label punctuation', () => {
  assert.equal(formatValue('authenticated', 'map(authenticated:Verbunden,unauthenticated:Getrennt)'), 'Verbunden');
  assert.equal(formatValue('CHARGING', 'map(IDLE:Bereit,CHARGING:Lädt)'), 'Lädt');
  assert.equal(formatValue('on', 'map(on=An: aktiv,off=Aus)'), 'An: aktiv');
  assert.equal(formatValue('off', 'map(on:An,off:Aus)'), 'Aus');
  assert.equal(formatValue('unknown', 'map(on=An,off=Aus)'), 'unknown');
});

test('free HTML devices receive snapshots, channel readings and live subscriptions', async () => {
  const previous = {
    window: globalThis.window, document: globalThis.document,
    HTMLElement: globalThis.HTMLElement, customElements: globalThis.customElements,
  };
  globalThis.window = {
    matchMedia: () => ({}),
    location: { search: '', href: 'https://example.test/fhem/fhem-cms/CMS/index.html' },
    clearInterval() {},
    clearTimeout() {},
  };
  globalThis.document = { addEventListener() {} };
  globalThis.HTMLElement = class {};
  const registry = new Map();
  globalThis.customElements = {
    define(name, element) { registry.set(name, element); },
    get(name) { return registry.get(name); },
  };
  try {
    const { CmsPage } = await import('../www/fhem-cms/js/fhem-cms.js');
    const widget = {
      id: 'html', type: 'fhem-html', devices: ['Temp', 'Other'],
      html: '<div>{{Temp:temperature|round(1)}}<span device="Other" reading="state"></span></div>',
    };
    const page = Object.create(CmsPage.prototype);
    page.config = { pages: [{ id: 'start', widgets: [widget] }] };
    page.pageId = 'start';
    page.loadToken = 0;
    page.stopped = false;
    page.snapshots = new Map();
    page.elements = new Map([['html', {}]]);
    page.lastSuccess = null;
    page.live = false;
    page.subscribedKey = '';
    page.statusLine = { textContent: '' };
    const subscriptions = [];
    const requests = [];
    let reading = '21.35';
    page.client = {
      async jsonlist(spec) {
        requests.push(spec);
        return [
          { name: 'Temp', alias: 'Sensor', parent: '', readings: {} },
          { name: 'Temp_Weather', parent: 'Temp', readings: { temperature: reading } },
          { name: 'Other', parent: '', readings: { state: 'on' } },
        ];
      },
      subscribe(names) { subscriptions.push(names); },
    };
    await page.refresh();
    assert.deepEqual(requests, ['Temp,device=Temp,Other,device=Other']);
    assert.deepEqual(subscriptions, [['Other', 'Temp', 'Temp_Weather']]);
    const groups = page.elements.get('html').data;
    const lookup = (device, field) => lookupValue(groups, device, field);
    assert.equal(substitute('{{Temp:temperature|round(1)}}', lookup), '21.4');
    assert.equal(formatValue(lookup('Other', 'state'), 'upper'), 'ON');
    assert.equal(lookup('Temp', '@alias'), 'Sensor');
    reading = '19.9';
    await page.refresh();
    const next = page.elements.get('html').data;
    assert.equal(lookupValue(next, 'Temp', 'temperature'), '19.9');
    assert.equal(subscriptions.length, 1, 'unchanged subscriptions are not restarted');
    page.client.jsonlist = async () => { throw new Error('Verbindung verloren'); };
    const lastSuccess = page.lastSuccess;
    await page.refresh();
    assert.equal(lookupValue(page.elements.get('html').data, 'Temp', 'temperature'), '19.9');
    assert.equal(page.elements.get('html').stale, lastSuccess);
    assert.match(page.statusLine.textContent, /Verbindung verloren/);
    let resolve;
    page.client.jsonlist = () => new Promise((done) => { resolve = done; });
    page.client.unsubscribe = () => subscriptions.push('unsubscribed');
    const pending = page.refresh();
    page.stop();
    resolve([{ name: 'Temp', parent: '', readings: { temperature: '99' } }]);
    await pending;
    page.resubscribe();
    assert.equal(lookupValue(page.elements.get('html').data, 'Temp', 'temperature'), '19.9');
    assert.equal(subscriptions.at(-1), 'unsubscribed', 'late result cannot restart subscription');
  } finally {
    globalThis.window = previous.window;
    globalThis.document = previous.document;
    globalThis.HTMLElement = previous.HTMLElement;
    globalThis.customElements = previous.customElements;
  }
});

test('shared widget factory preserves legacy types, data and view mode', async () => {
  const previous = {
    window: globalThis.window, document: globalThis.document,
    HTMLElement: globalThis.HTMLElement, customElements: globalThis.customElements,
  };
  globalThis.window = { location: { href: 'https://example.test/' } };
  globalThis.document = {
    createElement(tag) {
      return { tag, attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } };
    },
  };
  globalThis.HTMLElement = class {};
  const registry = new Map();
  globalThis.customElements = {
    define(name, element) { registry.set(name, element); },
    get(name) { return registry.get(name); },
  };
  try {
    const { createWidgetElement, devicesOf } = await import('../www/fhem-cms/js/widget-factory.js');
    const services = {};
    const snapshots = new Map([['Temp', { name: 'Temp' }]]);
    const types = {
      thermostat: 'cms-thermostat', 'fhem-value': 'cms-value', 'fhem-switch': 'cms-switch',
      'fhem-button': 'cms-button', 'fhem-clock': 'cms-clock', 'fhem-icon': 'cms-icon',
      'fhem-table': 'cms-table', 'fhem-solarflow': 'cms-solarflow', 'fhem-chart': 'cms-chart',
      'fhem-slider': 'cms-slider', 'fhem-html': 'cms-html', text: 'cms-text',
    };
    const grouped = new Set(['fhem-table', 'fhem-solarflow', 'fhem-html', 'text']);
    const withoutData = new Set(['fhem-button', 'fhem-clock', 'fhem-chart']);
    for (const [type, tag] of Object.entries(types)) {
      const widget = {
        type, device: 'Temp', devices: ['Temp'], rows: [{ device: 'Temp' }],
        readings: { pv: { device: 'Temp', reading: 'state' } }, html: '{{Temp:state}}',
      };
      const element = createWidgetElement(widget, services, snapshots, true);
      assert.equal(element.tag, tag);
      assert.equal(element.services, services);
      assert.equal(element.config, widget);
      assert.deepEqual(element.attributes, { 'view-only': '' });
      if (withoutData.has(type)) assert.equal('data' in element, false, type);
      else if (grouped.has(type)) assert.equal(element.data.get('Temp'), snapshots.get('Temp'), type);
      else assert.equal(element.data, snapshots.get('Temp'), type);
      assert.ok(Array.isArray(devicesOf(widget)), type);
    }
    const unsupported = createWidgetElement({ type: 'toString' }, services, snapshots, false);
    assert.equal(unsupported.tag, 'p');
    assert.equal(unsupported.className, 'cms-unsupported');
    assert.deepEqual(unsupported.attributes, {});
  } finally {
    globalThis.window = previous.window;
    globalThis.document = previous.document;
    globalThis.HTMLElement = previous.HTMLElement;
    globalThis.customElements = previous.customElements;
  }
});
