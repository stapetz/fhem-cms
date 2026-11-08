import assert from 'node:assert/strict';
import { test } from 'node:test';

test('device entry starts only the validated legacy format and displays format errors', async () => {
  const previous = {
    window: globalThis.window, document: globalThis.document,
    HTMLElement: globalThis.HTMLElement, customElements: globalThis.customElements,
    fetch: globalThis.fetch,
  };
  let onReady;
  const classes = new Set();
  const card = {
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    textContent: '',
  };
  globalThis.window = {
    matchMedia: () => ({}),
    location: { search: '?mode=edit', href: 'https://example.test/fhem/fhem-cms/CMS/index.html' },
  };
  globalThis.document = {
    addEventListener(name, callback) { if (name === 'DOMContentLoaded') onReady = callback; },
    querySelector(selector) {
      if (selector === '.cms-status') return card;
      if (selector === '.cms-shell') return {};
      if (selector === 'meta[name="fhem-cms-device"]') return { content: 'CMS' };
      return null;
    },
    documentElement: { classList: { add(name) { classes.add(name); } } },
  };
  globalThis.HTMLElement = class {};
  const registry = new Map();
  globalThis.customElements = {
    define(name, element) { registry.set(name, element); },
    get(name) { return registry.get(name); },
  };
  try {
    const { startCmsDevice } = await import('../www/fhem-cms/js/fhem-cms.js');
    let started = 0;
    await startCmsDevice({ getLayoutFormat: async () => 4 }, async () => { started += 1; });
    assert.equal(started, 1);
    for (const format of [5, 6]) {
      await assert.rejects(startCmsDevice({ getLayoutFormat: async () => format }, () => { started += 1; }),
        /Layoutformat .* noch nicht/);
    }
    await assert.rejects(startCmsDevice({ getLayoutFormat: async () => { throw new Error('offline'); } },
      () => { started += 1; }), /offline/);
    assert.equal(started, 1, 'failed format detection never starts the legacy editor');

    const commands = [];
    globalThis.fetch = async (url, options) => {
      if (!options.method) return new Response('', { headers: { 'X-FHEM-csrfToken': 'test-token' } });
      commands.push(options.body.get('cmd'));
      return new Response('{"schemaVersion":5}');
    };
    await onReady();
    assert.deepEqual(commands, ['get CMS layoutformat']);
    assert.match(card.textContent, /Layoutformat 5/);
    assert.ok('data-error' in card.attributes);
    assert.ok(classes.has('cms-view'), 'initialization errors remain readable in edit mode');

    commands.length = 0;
    globalThis.fetch = async (url, options) => {
      if (!options.method) return new Response('');
      commands.push(options.body.get('cmd'));
      return new Response('Unknown argument layoutformat');
    };
    await onReady();
    assert.deepEqual(commands, ['get CMS layoutformat']);
    assert.match(card.textContent, /Unknown argument layoutformat/);
  } finally {
    Object.assign(globalThis, previous);
  }
});
