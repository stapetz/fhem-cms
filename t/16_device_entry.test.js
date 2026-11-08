import assert from 'node:assert/strict';
import { test } from 'node:test';

test('device entry dispatches validated formats and displays format errors', async () => {
  const previous = {
    window: globalThis.window, document: globalThis.document,
    HTMLElement: globalThis.HTMLElement, customElements: globalThis.customElements,
    fetch: globalThis.fetch,
  };
  let onReady;
  const classes = new Set();
  const listeners = new Map();
  let reloads = 0;
  const card = {
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    textContent: '',
  };
  globalThis.window = {
    matchMedia: () => ({}),
    location: {
      search: '?mode=edit', href: 'https://example.test/fhem/fhem-cms/CMS/index.html',
      reload() { reloads += 1; },
    },
    addEventListener(name, callback) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(callback);
    },
    removeEventListener(name, callback) { listeners.get(name)?.delete(callback); },
    clearInterval() {},
    clearTimeout() {},
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
    const { CmsPage, startCmsDevice } = await import('../www/fhem-cms/js/fhem-cms.js');
    let started = 0;
    await startCmsDevice({ getLayoutFormat: async () => 4 }, async () => { started += 1; });
    assert.equal(started, 1);
    let started5 = 0;
    await startCmsDevice({ getLayoutFormat: async () => 5 }, () => { started += 1; },
      () => { started5 += 1; });
    assert.equal(started5, 1);
    for (const format of [5, 6]) {
      await assert.rejects(startCmsDevice({ getLayoutFormat: async () => format }, () => { started += 1; }),
        /Layoutformat .* nicht/);
    }
    await assert.rejects(startCmsDevice({ getLayoutFormat: async () => { throw new Error('offline'); } },
      () => { started += 1; }), /offline/);
    assert.equal(started, 1, 'failed format detection never starts the legacy editor');

    const commands = [];
    globalThis.fetch = async (url, options) => {
      if (!options.method) return new Response('', { headers: { 'X-FHEM-csrfToken': 'test-token' } });
      commands.push(options.body.get('cmd'));
      return new Response('{"schemaVersion":6}');
    };
    await onReady();
    assert.deepEqual(commands, ['get CMS layoutformat']);
    assert.match(card.textContent, /Unerwartete Antwort/);
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

    commands.length = 0;
    let resolveFormat;
    globalThis.fetch = async (url, options) => {
      if (!options.method) return new Response('');
      commands.push(options.body.get('cmd'));
      return new Promise((resolve) => { resolveFormat = resolve; });
    };
    const startup = onReady();
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (const listener of listeners.get('pagehide')) listener();
    resolveFormat(new Response('{"schemaVersion":4}'));
    await startup;
    assert.deepEqual(commands, ['get CMS layoutformat'], 'hidden startup does not load or edit a stale format');
    for (const listener of listeners.get('pageshow')) listener({ persisted: true });
    assert.equal(reloads, 1, 'restoring an interrupted startup reloads the format');
    listeners.clear();

    const legacy = Object.create(CmsPage.prototype);
    let resolveConfig;
    let draftReads = 0;
    legacy.loadConfig = () => new Promise((resolve) => { resolveConfig = resolve; });
    legacy.client = { hasDraft: () => { draftReads += 1; }, unsubscribe() {} };
    legacy.loadToken = 0;
    legacy.stopped = false;
    const loading = legacy.start();
    for (const listener of listeners.get('pagehide')) listener();
    resolveConfig({ schemaVersion: 4, pages: [] });
    await loading;
    assert.equal(draftReads, 0, 'a page hidden during configuration loading does not continue startup');
    for (const listener of listeners.get('pageshow')) listener({ persisted: true });
    assert.equal(reloads, 2, 'restoring the legacy page rechecks its format');
    listeners.clear();
    const waitingDraft = Object.create(CmsPage.prototype);
    let resolveDraft;
    waitingDraft.loadConfig = async () => ({ schemaVersion: 4, pages: [] });
    waitingDraft.client = {
      hasDraft: () => new Promise((resolve) => { resolveDraft = resolve; }),
      unsubscribe() {},
    };
    waitingDraft.loadToken = 0;
    waitingDraft.stopped = false;
    const loadingDraft = waitingDraft.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (const listener of listeners.get('pagehide')) listener();
    resolveDraft(false);
    await loadingDraft;
    assert.equal(waitingDraft.config, undefined, 'late draft status cannot start the hidden editor');
    assert.equal(listeners.has('hashchange'), false);

    const upgrading = Object.create(CmsPage.prototype);
    const upgradeCalls = [];
    let finishUpgrade;
    Object.assign(upgrading, {
      stopped: false, migrationButton: {}, upgradeMessage: {}, toolbar: {}, grid: {},
      flushLayout: async () => { upgradeCalls.push('layout'); },
      flushDraftWrites: async () => { upgradeCalls.push('draft'); },
      stop() { this.stopped = true; upgradeCalls.push('stop'); },
      client: { upgradeLayout: async () => {
        upgradeCalls.push('upgrade');
        await new Promise((resolve) => { finishUpgrade = resolve; });
      } },
    });
    const upgradingNow = upgrading.upgradeLayout();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await upgrading.upgradeLayout();
    assert.equal(upgrading.toolbar.inert, true, 'editing frozen during upgrade');
    assert.equal(upgrading.grid.inert, true);
    assert.deepEqual(upgradeCalls, ['layout', 'draft', 'stop', 'upgrade'], 'pending edits flushed before one write');
    finishUpgrade();
    await upgradingNow;
    assert.equal(reloads, 3, 'successful upgrade reloads into schema 5');
    const failedUpgrade = Object.create(CmsPage.prototype);
    Object.assign(failedUpgrade, {
      stopped: false, migrationButton: {}, upgradeMessage: {}, toolbar: {}, grid: {},
      flushLayout: async () => {}, flushDraftWrites: async () => {},
      stop() { this.stopped = true; },
      client: { upgradeLayout: async () => { throw new Error('lost answer'); } },
    });
    await failedUpgrade.upgradeLayout();
    assert.match(failedUpgrade.upgradeMessage.textContent, /lost answer.*neu laden/);
    assert.equal(failedUpgrade.migrationButton.disabled, true, 'uncertain upgrade stays blocked');
    assert.equal(reloads, 3, 'failed upgrade never reports success by reloading');
  } finally {
    Object.assign(globalThis, previous);
  }
});
