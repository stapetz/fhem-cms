import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatValue, lookupValue, substitute } from '../www/fhem-cms/js/freehtml.js';

test('free HTML devices receive snapshots, channel readings and live subscriptions', async () => {
  const previous = {
    window: globalThis.window, document: globalThis.document,
    HTMLElement: globalThis.HTMLElement, customElements: globalThis.customElements,
  };
  globalThis.window = {
    matchMedia: () => ({}),
    location: { search: '', href: 'https://example.test/fhem/fhem-cms/CMS/index.html' },
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
  } finally {
    globalThis.window = previous.window;
    globalThis.document = previous.document;
    globalThis.HTMLElement = previous.HTMLElement;
    globalThis.customElements = previous.customElements;
  }
});
