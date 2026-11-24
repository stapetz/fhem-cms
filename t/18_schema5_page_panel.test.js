import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Schema5DraftController } from '../www/fhem-cms/js/fcui-schema5-draft.js';
import { Schema5PagePanel } from '../www/fhem-cms/js/fcui-schema5-page-panel.js';
import { resizeFreeformPage } from '../www/fhem-cms/js/fcui-freeform-layout.js';
import { schema5PageBackground } from '../www/fhem-cms/js/fcui-schema5-appearance.js';

class Element {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.value = '';
    this.checked = false;
    this.style = { setProperty(name, value) { this[name] = value; } };
  }
  append(...children) {
    this.children.push(...children);
    if (this.tag === 'select' && !this.value && this.children.length) this.value = this.children[0].value;
  }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this.attributes[name] = value; }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  fire(name) { return this.listeners[name]({ preventDefault() {} }); }
  get valueAsNumber() { return this.value === '' ? NaN : Number(this.value); }
}

function fixture() {
  const live = {
    schemaVersion: 5, theme: 'dark', settings: { layoutMode: 'grid', gridColumns: 12, showFrames: true },
    navigation: { grid: { col: 1, row: 1, w: 12, h: 1 } },
    pages: [
      { id: 'a', title: 'A', widgets: [
        { id: 'text', type: 'text', html: '{{Temp:state}}', grid: { col: 1, row: 2, w: 4, h: 2 } },
        { id: 'html', type: 'fhem-html', html: '<span device="Temp" reading="state"></span>',
          grid: { col: 5, row: 2, w: 4, h: 2 } },
      ] },
      { id: 'b', title: 'B', widgets: [
        { id: 'other', type: 'text', html: 'B', grid: { col: 1, row: 5, w: 2, h: 1 } },
      ] },
    ],
  };
  let state = { live, draft: null, token: 'a'.repeat(64) };
  let writes = 0;
  let release;
  let error;
  const controller = new Schema5DraftController({
    read: async () => structuredClone(state),
    save: async (draft, token) => {
      writes += 1;
      assert.equal(token, state.token);
      if (release) await new Promise((resolve) => { release.resolve = resolve; });
      if (error) throw new Error(error);
      state = { live, draft, token: 'b'.repeat(64) };
    },
    publish: async () => {},
    discard: async () => {},
  });
  return {
    controller, live, get writes() { return writes; },
    delay() { release = {}; return release; },
    fail(message) { error = message; },
  };
}

test('Freeform background dimming previews per page, cancels and saves only into the draft', async () => {
  const original = globalThis.document;
  globalThis.document = {createElement: tag => new Element(tag)};
  const all = node => [node, ...node.children.flatMap(all)];
  try {
    const f = fixture();
    f.live.schemaVersion = 6;
    Object.assign(f.live.pages[0], {
      layoutMode: 'freeform', canvas: {width: 1280, height: 800},
      background: `media/${'a'.repeat(32)}.png`,
    });
    for (const [i, widget] of f.live.pages[0].widgets.entries()) {
      widget.rect = {x: 100 + i*400, y: 100, w: 300, h: 200};
    }
    const bytes = JSON.stringify(f.live);
    await f.controller.reload();
    let preview;
    const root = new Element('section');
    const open = pageId => new Schema5PagePanel({root, controller: f.controller, pageId,
      token: f.controller.snapshot().token, freeformSupported: true,
      browser: {confirm: () => true}, onClose: () => {},
      services: {createSettingsPreview: () => ({
        element: new Element('section'), update: config => {preview = config;}, close() {},
      })},
    });
    let panel = open('a');
    let dim = all(root).find(node => Object.hasOwn(node.attributes, 'data-background-dim'));
    let pins = all(root).find(node => Object.hasOwn(node.attributes, 'data-render-as-pins'));
    assert.equal(pins.checked, false);
    assert.equal(dim.value, '0');
    assert.equal(all(root).find(node => node.children.includes(dim)).hidden, false);
    dim.value = '25';
    dim.fire('input');
    pins.checked = true;
    pins.fire('change');
    assert.equal(preview.pages[0].backgroundDim, .25);
    assert.equal(preview.pages[0].renderAsPins, true);
    assert.equal(Object.hasOwn(preview.pages[1], 'backgroundDim'), false);
    assert.equal(f.writes, 0);
    assert.equal(JSON.stringify(f.controller.snapshot().live), bytes);
    all(root).find(node => node.className?.split(' ').includes('cms-panel-close')).fire('click');
    assert.equal(f.controller.snapshot().draft, null);
    panel = open('a');
    dim = all(root).find(node => Object.hasOwn(node.attributes, 'data-background-dim'));
    pins = all(root).find(node => Object.hasOwn(node.attributes, 'data-render-as-pins'));
    assert.equal(pins.checked, false, 'cancel leaves Pin opt-in unchanged');
    assert.equal(dim.value, '0', 'cancel does not retain the unsaved value');
    dim.value = '50';
    dim.fire('input');
    pins.checked = true;
    pins.fire('change');
    await all(root).find(node => node.className?.split(' ').includes('cms-panel-save')).fire('click');
    assert.equal(f.controller.snapshot().draft.pages[0].backgroundDim, .5);
    assert.equal(f.controller.snapshot().draft.pages[0].renderAsPins, true);
    assert.deepEqual(f.controller.snapshot().draft.pages[0].widgets, f.live.pages[0].widgets,
      'opting into Pins never changes normal widget geometry');
    assert.equal(JSON.stringify(f.controller.snapshot().live), bytes);
    panel = open('a');
    dim = all(root).find(node => Object.hasOwn(node.attributes, 'data-background-dim'));
    assert.equal(dim.value, '50', 'draft value is reloaded');
    const mode = all(root).find(node => node.className === 'cms-freeform-mode').children[0];
    mode.value = 'grid';
    mode.fire('change');
    assert.equal(all(root).find(node => node.children.includes(dim)).hidden, true);
    await all(root).find(node => node.className?.split(' ').includes('cms-panel-save')).fire('click');
    assert.equal(Object.hasOwn(f.controller.snapshot().draft.pages[0], 'backgroundDim'), false);
    assert.equal(Object.hasOwn(f.controller.snapshot().draft.pages[0], 'renderAsPins'), false);
    panel = open('b');
    dim = all(root).find(node => Object.hasOwn(node.attributes, 'data-background-dim'));
    assert.equal(all(root).find(node => node.children.includes(dim)).hidden, true, 'Grid hides Freeform dimming');
    panel.close();
  } finally { globalThis.document = original; }
});

test('background label follows the asset catalog and reports missing entries or errors', async () => {
  const original = globalThis.document;
  globalThis.document = { createElement: (tag) => new Element(tag) };
  try {
    const f = fixture();
    const first = `media/${'a'.repeat(32)}.png`;
    const second = `media/${'b'.repeat(32)}.jpg`;
    f.live.pages[0].background = first;
    const parent = 'c'.repeat(32);
    const child = 'd'.repeat(32);
    const catalog = {
      token: 'e'.repeat(64), totalBytes: 2,
      policy: { types: { png: true }, imageBytes: 10, documentBytes: 10, totalBytes: 10 },
      folders: [{ id: parent, parent: 'root', name: 'Haus' }, { id: child, parent, name: 'Zimmer' }],
      assets: [
        { id: 'a'.repeat(32), folder: child, name: 'Wand.png', href: first, image: true, bytes: 1 },
        { id: 'b'.repeat(32), folder: 'root', name: 'Neu.jpg', href: second, image: true, bytes: 1 },
      ],
    };
    let response = async () => structuredClone(catalog);
    let selected = null;
    const services = { assetAction: () => response(), pickAsset: async () => selected };
    await f.controller.reload();
    const root = new Element('section');
    const open = () => new Schema5PagePanel({ root, controller: f.controller, pageId: 'a',
      token: f.controller.snapshot().token, services, browser: { confirm: () => true }, onClose: () => {} });
    const settle = () => new Promise(resolve => setImmediate(resolve));
    let panel = open();
    let background = root.children[3].children[4];
    await settle();
    assert.equal(background.children[3].children[0].textContent, 'Stammordner / Haus / Zimmer / Wand.png');
    catalog.folders[1].name = 'Büro';
    catalog.assets[0].name = 'Umbenannt.png';
    await background.children[0].fire('click');
    assert.equal(background.children[3].children[0].textContent, 'Stammordner / Haus / Büro / Umbenannt.png');
    catalog.assets[0].folder = 'root';
    panel.close();
    panel = open();
    background = root.children[3].children[4];
    await settle();
    assert.equal(background.children[3].children[0].textContent, 'Stammordner / Umbenannt.png');
    selected = { href: second, name: 'veralteter Name' };
    await background.children[0].fire('click');
    assert.equal(background.children[3].children[0].textContent, 'Stammordner / Neu.jpg');
    selected = null;
    catalog.assets.pop();
    catalog.totalBytes = 1;
    await background.children[0].fire('click');
    assert.match(background.children[3].children[0].textContent, /nicht im Assetmanager gefunden/);
    response = async () => { throw new Error('Verbindung fehlgeschlagen'); };
    await background.children[0].fire('click');
    assert.match(background.children[3].children[0].textContent, /Bildname nicht verfügbar: Verbindung fehlgeschlagen/);
    background.children[2].fire('click');
    assert.equal(background.children[3].children[0].textContent, 'Kein Bild ausgewählt');
    panel.close();
  } finally {
    globalThis.document = original;
  }
});

test('late catalog responses cannot overwrite a removed background', async () => {
  const original = globalThis.document;
  globalThis.document = { createElement: (tag) => new Element(tag) };
  try {
    const f = fixture();
    f.live.pages[0].background = `media/${'a'.repeat(32)}.png`;
    await f.controller.reload();
    let resolve;
    const root = new Element('section');
    new Schema5PagePanel({ root, controller: f.controller, pageId: 'a', token: f.controller.snapshot().token,
      services: { assetAction: () => new Promise(done => { resolve = done; }) },
      browser: { confirm: () => true }, onClose: () => {} });
    const background = root.children[3].children[4];
    background.children[2].fire('click');
    resolve({ invalid: true });
    await new Promise(done => setImmediate(done));
    assert.equal(background.children[3].children[0].textContent, 'Kein Bild ausgewählt');
  } finally {
    globalThis.document = original;
  }
});

test('new themes are selectable and saved without modifying widget layout', async () => {
  const original = globalThis.document;
  globalThis.document = { createElement: (tag) => new Element(tag) };
  try {
    for (const value of ['oled-black', 'catppuccin-mocha']) {
      const f = fixture();
      const state = await f.controller.reload();
      const root = new Element('section');
      new Schema5PagePanel({ root, controller: f.controller, pageId: 'a', token: state.token,
        browser: { confirm: () => true }, onClose: () => {} });
      const theme = root.children[3].children[0].children[0];
      assert.ok(theme.children.some(option => option.value === value));
      theme.value = value;
      theme.fire('change');
      assert.equal(root.children[3].children[4].children[5].hidden, true);
      await root.children[4].children[1].fire('click');
      assert.equal(f.controller.snapshot().draft.theme, value);
      assert.deepEqual(f.controller.snapshot().draft.pages, f.live.pages);
    }
  } finally {
    globalThis.document = original;
  }
});

test('settings preview receives isolated candidates and closes without saving on cancel', async () => {
  const original = globalThis.document;
  globalThis.document = { createElement: (tag) => new Element(tag) };
  try {
    const f = fixture();
    const state = await f.controller.reload();
    const root = new Element('section');
    let preview;
    const services = { createSettingsPreview: ({ pageId }) => {
      assert.equal(pageId, 'a');
      preview = { element: new Element('section'), updates: [], closed: false,
        update(value) { this.updates.push(value); },
        close() { this.closed = true; } };
      return preview;
    } };
    new Schema5PagePanel({ root, controller: f.controller, pageId: 'a', token: state.token,
      services, browser: { confirm: () => true }, onClose: () => {} });
    const form = root.children[3];
    const theme = form.children[0].children[0];
    assert.equal(theme.children[0].textContent, 'Forest Green');
    assert.equal(theme.children[0].value, 'dark');
    theme.value = 'liquid-glass';
    theme.fire('change');
    form.children[1].children[0].checked = false;
    form.children[1].children[0].fire('change');
    form.children[3].children[0].value = 'right';
    form.children[3].children[0].fire('change');
    const controls = form.children[4].children[5];
    controls.children[1].children[0].value = '65';
    controls.children[1].children[0].fire('input');
    form.children[2].children[0].value = '24';
    form.children[2].children[0].fire('change');
    const candidate = preview.updates.at(-1);
    assert.equal(candidate.theme, 'liquid-glass');
    assert.equal(candidate.settings.showFrames, false);
    assert.equal(candidate.settings.titleAlign, 'right');
    assert.equal(candidate.settings.liquidTransparency, 65);
    assert.equal(candidate.settings.gridColumns, 24);
    assert.equal(f.controller.snapshot().draft, null);
    assert.equal(f.live.settings.gridColumns, 12);
    root.children[4].children[0].fire('click');
    assert.equal(preview.closed, true);
    assert.equal(f.writes, 0);
  } finally {
    globalThis.document = original;
  }
});

test('page panel only exposes look and feel, protects cancel and preserves widget positions', async () => {
  const original = globalThis.document;
  globalThis.document = { createElement: (tag) => new Element(tag) };
  try {
    const f = fixture();
    const state = await f.controller.reload();
    const root = new Element('section');
    let closed = 0;
    let confirmed = false;
    const open = () => new Schema5PagePanel({
      root, controller: f.controller, pageId: 'a', token: state.token,
      browser: { confirm: () => confirmed },
      onClose: (outcome) => { assert.equal(outcome.requiresReload, false); closed += 1; },
    });
    const panel = open();
    assert.equal(root.children[0].textContent, `Seiteneinstellungen „${state.live.pages[0].title}“`);
    assert.equal(root.children.length, 5);
    const descendants = (node) => [node, ...node.children.flatMap(descendants)];
    assert.ok(descendants(root).every((node) => node.type !== 'number'
      && !node.className?.includes('grid-stack') && node.textContent !== 'Position übernehmen'));
    const settings = root.children[3];
    assert.equal(settings.children.length, 7, 'appearance settings and direct live URL');
    assert.equal(settings.children[3].children[0].value, 'left');
    assert.deepEqual(settings.children[3].children[0].children.map((option) => option.value), ['left', 'center', 'right']);
    assert.equal(settings.children[0].children[0].value, 'dark');
    assert.notEqual(settings.children[4].hidden, true, 'background settings are available in dark theme');
    assert.equal(settings.children[4].children[5].hidden, true, 'liquid controls are hidden for dark theme');
    assert.equal(settings.children[1].children[0].checked, true);
    assert.deepEqual(settings.children[2].children[0].children.map((option) => option.value), ['12', '24', '48', '96', '192']);
    assert.notEqual(settings.children[2].children[0].disabled, true);
    const footer = root.children[4];
    const [cancel, save] = footer.children;
    assert.equal(save.textContent, 'Speichern');
    assert.equal(cancel.textContent, 'Abbrechen');
    settings.children[0].children[0].value = 'light';
    cancel.fire('click');
    assert.equal(closed, 0, 'rejecting confirmation keeps the dialog open');
    confirmed = true;
    cancel.fire('click');
    assert.equal(closed, 1);
    assert.equal(f.writes, 0);
    assert.equal(root.children.length, 0);
    panel.close();

    const next = open();
    root.children[3].children[0].children[0].value = 'light';
    root.children[3].children[1].children[0].checked = false;
    root.children[3].children[3].children[0].value = 'center';
    const gate = f.delay();
    const saving = root.children[4].children[1].fire('click');
    assert.equal(root.children[4].children[0].disabled, true);
    assert.equal(root.children[3].inert, true);
    await root.children[4].children[1].fire('click');
    assert.throws(() => next.close(), /läuft noch/);
    gate.resolve();
    await saving;
    assert.equal(f.writes, 1);
    const draft = f.controller.snapshot().draft;
    assert.deepEqual(draft.pages, f.live.pages, 'look and feel never repositions or resizes widgets');
    assert.deepEqual(draft.navigation, f.live.navigation);
    assert.equal(draft.pages[0].widgets[0].html, '{{Temp:state}}');
    assert.equal(draft.pages[0].widgets[1].html, '<span device="Temp" reading="state"></span>');
    assert.equal(draft.theme, 'light');
    assert.equal(draft.settings.showFrames, false);
    assert.equal(draft.settings.titleAlign, 'center');
    assert.equal(closed, 2);
    assert.equal(root.children.length, 0);
  } finally {
    globalThis.document = original;
  }
});

test('page settings expose the current live URL and report clipboard failures', async () => {
  const original = globalThis.document;
  globalThis.document = { createElement: (tag) => new Element(tag) };
  try {
    const f = fixture();
    const state = await f.controller.reload();
    const root = new Element('section');
    let copied;
    const browser = { confirm: () => true,
      location: { href: 'https://example.test/fhem/cms/index.html?mode=edit&cms-device=tablet&x=1#/a' },
      navigator: { clipboard: { writeText: async value => { copied = value; } } },
    };
    const panel = new Schema5PagePanel({ root, controller: f.controller, pageId: 'b',
      token: state.token, browser, onClose: () => {} });
    const form = root.children[3];
    const url = form.children[5].children[0];
    const copy = form.children[6];
    assert.equal(url.value, 'https://example.test/fhem/cms/index.html?x=1#/b');
    assert.equal(url.readOnly, true);
    await copy.fire('click');
    assert.equal(copied, url.value);
    assert.match(root.children[2].textContent, /kopiert/);
    browser.navigator.clipboard.writeText = async () => { throw new Error('denied'); };
    await copy.fire('click');
    assert.match(root.children[2].textContent, /Kopieren fehlgeschlagen.*manuell/);
    assert.ok('data-error' in root.children[2].attributes);
    browser.navigator.clipboard = undefined;
    await copy.fire('click');
    assert.match(root.children[2].textContent, /Kopieren fehlgeschlagen/);
    panel.close();
  } finally { globalThis.document = original; }
});

test('freeform presets resize only freeform pages proportionally from the open baseline', async () => {
  const original = globalThis.document;
  globalThis.document = { createElement: (tag) => new Element(tag) };
  try {
    const f = fixture();
    f.live.schemaVersion = 6;
    f.live.pages[0].layoutMode = 'freeform';
    f.live.pages[0].canvas = {width: 1000, height: 800, scaling: 'fit', snapGrid: 5, mobileBehavior: 'stack'};
    f.live.pages[0].widgets[0].rect = {x: 100, y: 200, w: 300, h: 100, z: 2};
    f.live.pages[0].widgets[1].rect = {x: 600, y: 400, w: 200, h: 100};
    f.live.pages[0].navigationRect = {x: 50, y: 50, w: 100, h: 100};
    f.live.pages[1].layoutMode = 'freeform';
    f.live.pages[1].canvas = {width: 500, height: 400, scaling: 'none', snapGrid: 10, mobileBehavior: 'scale'};
    f.live.pages[1].widgets[0].rect = {x: 10, y: 20, w: 30, h: 40};
    f.live.pages[1].navigationRect = {x: 20, y: 10, w: 100, h: 50};
    f.live.pages.push({id: 'grid', title: 'Grid', widgets: [
      {id: 'grid-widget', type: 'text', html: 'Grid', grid: {col: 1, row: 2, w: 3, h: 2}},
    ]});
    const state = await f.controller.reload();
    const root = new Element('section');
    let previewConfig;
    const panel = new Schema5PagePanel({
      root, controller: f.controller, pageId: 'a', token: state.token,
      services: {createSettingsPreview: () => ({
        element: new Element('section'),
        update(config) { previewConfig = structuredClone(config); },
        close() {},
      })},
      browser: {confirm: () => true}, onClose: () => {}, freeformSupported: true,
    });
    const descendants = node => [node, ...node.children.flatMap(descendants)];
    const byClass = name => descendants(root).find(node => node.className === name);
    const modeLabel = byClass('cms-freeform-mode');
    assert.ok(modeLabel, 'the page mode dropdown is the first full-width layout control');
    assert.equal(modeLabel.children[0].value, 'freeform');
    const presetLabel = byClass('cms-freeform-preset');
    assert.ok(presetLabel, 'device presets are grouped in the settings control');
    assert.deepEqual(presetLabel.children[0].children.slice(1).map(group => group.label),
      ['iPhone', 'iPad', 'Desktop / Monitor']);
    assert.equal(byClass('cms-freeform-apply-all'), undefined);
    const preset = byClass('cms-freeform-preset').children[0];
    preset.value = 'desktop-1280';
    preset.fire('change');
    const expectedStart = {
      ...f.live.pages[0],
      canvas: {...f.live.pages[0].canvas, width: 1280, height: 720},
      widgets: f.live.pages[0].widgets.map(widget => ({
        ...widget, rect: widget.id === 'text'
          ? {x: 128, y: 180, w: 384, h: 90, z: 2}
          : {x: 768, y: 360, w: 256, h: 90},
      })),
      navigationRect: {x: 64, y: 45, w: 128, h: 90},
    };
    const expectedOther = {
      ...f.live.pages[1],
      canvas: expectedStart.canvas,
      widgets: [{...f.live.pages[1].widgets[0], rect: {x: 26, y: 36, w: 77, h: 72}}],
      navigationRect: {x: 51, y: 18, w: 256, h: 90},
    };
    assert.deepEqual(previewConfig.pages[0], expectedStart);
    assert.deepEqual(previewConfig.pages[1], expectedOther);
    assert.deepEqual(previewConfig.pages[2], f.live.pages[2], 'Grid pages are never resized');
    preset.value = 'iphone-15';
    preset.fire('change');
    preset.value = 'desktop-1280';
    preset.fire('change');
    assert.deepEqual(previewConfig.pages[0], expectedStart, 'repeated previews scale from the original baseline');
    assert.deepEqual(previewConfig.pages[1], expectedOther);
    await root.children[4].children[1].fire('click');
    assert.deepEqual(f.controller.snapshot().draft.pages[0], expectedStart);
    assert.deepEqual(f.controller.snapshot().draft.pages[1], expectedOther);
    assert.deepEqual(f.controller.snapshot().draft.pages[2], f.live.pages[2]);
    assert.deepEqual(f.controller.snapshot().draft.settings.pageCanvas, expectedStart.canvas);
    assert.deepEqual(f.controller.snapshot().draft.settings.pageNavigationRect, expectedStart.navigationRect);
    panel.close();

    const updated = await f.controller.reload();
    const inheritedRoot = new Element('section');
    const inherited = new Schema5PagePanel({
      root: inheritedRoot, controller: f.controller, pageId: 'b', token: updated.token,
      browser: {confirm: () => true}, onClose: () => {}, freeformSupported: true,
    });
    const inheritedNodes = descendants(inheritedRoot);
    assert.ok(inheritedNodes.some(node => node.textContent?.includes('Seite erbt Größeneinstellungen von der Startseite')));
    assert.ok(!inheritedNodes.some(node => ['cms-freeform-preset', 'cms-freeform-dimension'].includes(node.className)));
    assert.equal(inheritedNodes.filter(node => node.className === 'cms-freeform-advanced').length, 0);
    inherited.close();
    const nextRoot = new Element('section');
    const next = new Schema5PagePanel({
      root: nextRoot, controller: f.controller, pageId: 'a', token: updated.token,
      browser: {confirm: () => true}, onClose: () => {}, freeformSupported: true,
    });
    const nextDescendants = node => [node, ...node.children.flatMap(nextDescendants)];
    const nextByClass = name => nextDescendants(nextRoot).find(node => node.className === name);
    assert.equal(nextByClass('cms-freeform-apply-all'), undefined);
    const nextPreset = nextByClass('cms-freeform-preset').children[0];
    nextPreset.value = 'iphone-13';
    nextPreset.fire('change');
    await nextRoot.children[4].children[1].fire('click');
    assert.equal(f.controller.snapshot().draft.pages[0].canvas.width, 390);
    assert.equal(f.controller.snapshot().draft.pages[1].canvas.width, 390,
      'other Freeform pages always follow Start');
    assert.equal(f.controller.snapshot().draft.settings.sharedFreeformSize, undefined);
    assert.equal(nextRoot.children.length, 0);

    const nonStart = new Element('section');
    const current = f.controller.snapshot();
    new Schema5PagePanel({
      root: nonStart, controller: f.controller, pageId: 'b', token: current.token,
      browser: {confirm: () => true}, onClose: () => {}, freeformSupported: true,
    });
    assert.equal(nextDescendants(nonStart).some(node => node.className === 'cms-freeform-apply-all'), false,
      'bulk resize is available only in the Start page panel');
  } finally {
    globalThis.document = original;
  }
});

test('freeform geometry scaling rounds sizes into the valid canvas bounds', () => {
  const page = {
    layoutMode: 'freeform',
    canvas: {width: 500, height: 500, scaling: 'fit', snapGrid: 5, mobileBehavior: 'stack'},
    widgets: [{id: 'small', rect: {x: 480, y: 480, w: 10, h: 10}}],
    navigationRect: {x: 100, y: 100, w: 10, h: 10},
  };
  resizeFreeformPage(page, 200, 200);
  assert.deepEqual(page.widgets[0].rect, {x: 190, y: 190, w: 10, h: 10});
  assert.deepEqual(page.navigationRect, {x: 40, y: 40, w: 10, h: 10});
});

test('liquid glass uses a reversible start-page background without changing individual images', async () => {
  const original = globalThis.document;
  globalThis.document = { createElement: (tag) => new Element(tag) };
  try {
    const f = fixture();
    const first = `media/${'a'.repeat(32)}.png`;
    const second = `media/${'b'.repeat(32)}.jpg`;
    const root = new Element('section');
    f.live.pages[1].background = second;
    let preview;
    const services = {
      pickAsset: async ({ mode }) => {
        assert.equal(mode, 'image');
        return { href: first, name: 'Beispiel' };
      },
      createSettingsPreview: ({ pageId }) => {
        preview = { element: new Element('section'), update(config) {
          this.background = schema5PageBackground(config, pageId);
        }, close() {} };
        return preview;
      },
    };
    await f.controller.reload();
    const open = (pageId) => new Schema5PagePanel({
      root, controller: f.controller, pageId, token: f.controller.snapshot().token,
      services, browser: { confirm: () => true }, onClose: () => {},
    });
    open('a');
    const settings = root.children[3];
    settings.children[0].children[0].value = 'liquid-glass';
    settings.children[0].children[0].fire('change');
    const background = settings.children[4];
    assert.notEqual(background.hidden, true);
    assert.equal(background.children[5].hidden, false, 'liquid controls appear for liquid glass');
    assert.equal(background.children[3].textContent, 'Hintergrundbild für aktuelle Seite „A“: ');
    assert.equal(background.children[1].textContent, 'Bild auf allen Seiten verwenden ');
    assert.equal(background.children[2].textContent, 'Hintergrundbild entfernen');
    assert.match(background.children[4].textContent, /auf jeder Seite einzeln über die Seiteneinstellungen/);
    await background.children[0].fire('click');
    background.children[1].children[0].checked = true;
    await root.children[4].children[1].fire('click');
    assert.equal(f.controller.snapshot().draft.pages[0].background, first);
    assert.equal(f.controller.snapshot().draft.settings.sharedBackground, true);
    open('b');
    const inherited = root.children[3].children[4];
    assert.equal(inherited.children[0].textContent, 'Bild wird von der Startseite geerbt.');
    assert.ok(inherited.children.every(node => node.tag !== 'button'));
    assert.equal(preview.background, first);
    await root.children[4].children[1].fire('click');
    assert.equal(f.controller.snapshot().draft.pages[1].background, second);

    open('a');
    root.children[3].children[4].children[1].children[0].checked = false;
    await root.children[4].children[1].fire('click');
    const result = f.controller.snapshot().draft;
    assert.equal(result.settings.sharedBackground, false);
    assert.equal(result.pages[0].background, first);
    assert.equal(result.pages[1].background, second);
    open('b');
    assert.equal(preview.background, second,
      'preview returns to the individual image when sharing is disabled');
  } finally {
    globalThis.document = original;
  }
});

test('background selection and shared setting work in light and dark themes', async () => {
  const original = globalThis.document;
  globalThis.document = { createElement: (tag) => new Element(tag) };
  try {
    for (const theme of ['dark', 'light']) {
      const f = fixture();
      const image = `media/${'a'.repeat(32)}.png`;
      const root = new Element('section');
      await f.controller.reload();
      new Schema5PagePanel({ root, controller: f.controller, pageId: 'a', token: f.controller.snapshot().token,
        services: { pickAsset: async () => ({ href: image }) },
        browser: { confirm: () => true }, onClose: () => {} });
      const form = root.children[3];
      form.children[0].children[0].value = theme;
      form.children[0].children[0].fire('change');
      const background = form.children[4];
      assert.notEqual(background.hidden, true);
      assert.equal(background.children[5].hidden, true);
      await background.children[0].fire('click');
      background.children[1].children[0].checked = true;
      await root.children[4].children[1].fire('click');
      assert.equal(f.controller.snapshot().draft.theme || 'dark', theme);
      assert.equal(f.controller.snapshot().draft.pages[0].background, image);
      assert.equal(f.controller.snapshot().draft.settings.sharedBackground, true);
    }
  } finally {
    globalThis.document = original;
  }
});

test('background picker reports errors, tolerates cancellation and removes an image on save', async () => {
  const original = globalThis.document;
  globalThis.document = { createElement: (tag) => new Element(tag) };
  try {
    const f = fixture();
    const first = `media/${'a'.repeat(32)}.png`;
    let pick = async () => ({ href: first, name: 'Beispiel' });
    const root = new Element('section');
    await f.controller.reload();
    const open = () => new Schema5PagePanel({
      root, controller: f.controller, pageId: 'a', token: f.controller.snapshot().token,
      services: { pickAsset: () => pick() }, browser: { confirm: () => true }, onClose: () => {},
    });
    open();
    let background = root.children[3].children[4];
    await background.children[0].fire('click');
    await root.children[4].children[1].fire('click');
    assert.equal(f.controller.snapshot().draft.pages[0].background, first);
    open();
    background = root.children[3].children[4];
    pick = async () => null;
    await background.children[0].fire('click');
    assert.match(background.children[3].children[0].textContent, /Bildname nicht verfügbar: Assetkatalog nicht verfügbar/);
    pick = async () => ({ href: 'https://example.test/image.png' });
    await background.children[0].fire('click');
    assert.match(root.children[2].textContent, /Ungültiger Bildpfad/);
    pick = async () => { throw new Error('Katalog nicht erreichbar'); };
    await background.children[0].fire('click');
    assert.match(root.children[2].textContent, /Katalog nicht erreichbar/);
    background.children[2].fire('click');
    await root.children[4].children[1].fire('click');
    assert.equal('background' in f.controller.snapshot().draft.pages[0], false);
  } finally {
    globalThis.document = original;
  }
});

test('liquid sliders preview immediately, cancel safely and save global settings', async () => {
  const original = globalThis.document;
  globalThis.document = { createElement: (tag) => new Element(tag) };
  try {
    const f = fixture();
    const root = new Element('section');
    let confirmed = true;
    await f.controller.reload();
    const open = (pageId) => new Schema5PagePanel({
      root, controller: f.controller, pageId, token: f.controller.snapshot().token,
      browser: { confirm: () => confirmed }, onClose: () => {},
    });
    open('a');
    const controls = root.children[3].children[4].children[5];
    const intensity = controls.children[0].children[0];
    const transparency = controls.children[1].children[0];
    assert.equal(controls.children.length, 2, 'only the two sliders remain');
    assert.equal(intensity.value, '47');
    assert.equal(transparency.value, '12');
    intensity.value = '100';
    intensity.fire('input');
    transparency.value = '60';
    transparency.fire('input');
    assert.equal(controls.children[0].children[1].textContent, '100 %');
    assert.equal(controls.children[1].children[1].textContent, '60 %');
    assert.equal(f.writes, 0, 'preview does not save');
    confirmed = false;
    root.children[4].children[0].fire('click');
    assert.notEqual(root.children.length, 0, 'unsaved slider changes require confirmation');
    confirmed = true;
    root.children[4].children[0].fire('click');
    assert.equal(f.controller.snapshot().draft, null);
    open('b');
    const otherControls = root.children[3].children[4].children[3];
    otherControls.children[0].children[0].value = '0';
    otherControls.children[1].children[0].value = '100';
    await root.children[4].children[1].fire('click');
    assert.equal(f.controller.snapshot().draft.settings.liquidIntensity, 0);
    assert.equal(f.controller.snapshot().draft.settings.liquidTransparency, 100);
    open('a');
    const savedControls = root.children[3].children[4].children[5];
    assert.equal(savedControls.children[0].children[0].value, '0');
    assert.equal(savedControls.children[1].children[0].value, '100');
    savedControls.children[0].children[0].value = '101';
    await root.children[4].children[1].fire('click');
    assert.match(root.children[2].textContent, /Ungültiger Liquid-Glass-Wert/);
    assert.equal(f.writes, 1, 'invalid value is not saved');
  } finally {
    globalThis.document = original;
  }
});

test('raster selector validates all pages, cancels without writes and scales only on save', async () => {
  const original = globalThis.document;
  globalThis.document = { createElement: (tag) => new Element(tag) };
  try {
    const f = fixture();
    const state = await f.controller.reload();
    const root = new Element('section');
    let closed = 0;
    const open = () => new Schema5PagePanel({
      root, controller: f.controller, pageId: 'a', token: state.token,
      browser: { confirm: () => true }, onClose: () => { closed += 1; },
    });
    open();
    const columns = root.children[3].children[2].children[0];
    columns.value = '24';
    columns.fire('change');
    assert.equal(columns.value, '24');
    assert.equal(f.writes, 0);
    assert.equal(f.controller.snapshot().draft, null);
    root.children[4].children[0].fire('click');
    assert.equal(closed, 1);
    assert.equal(f.writes, 0, 'cancel leaves both live and draft unchanged');
    open();
    const nextColumns = root.children[3].children[2].children[0];
    for (const count of [48, 96, 192]) {
      nextColumns.value = String(count);
      nextColumns.fire('change');
      assert.equal(nextColumns.value, String(count));
    }
    nextColumns.value = '36';
    nextColumns.fire('change');
    assert.equal(nextColumns.value, '12');
    assert.match(root.children[2].textContent, /Ungültige Rastergröße/);
    nextColumns.value = '192';
    nextColumns.fire('change');
    await root.children[4].children[1].fire('click');
    const saved = f.controller.snapshot();
    assert.equal(f.writes, 1);
    assert.equal(saved.draft.settings.gridColumns, 192);
    assert.deepEqual(saved.live, f.live);
    assert.deepEqual(saved.draft.pages[1].widgets[0].grid, { col: 1, row: 65, w: 32, h: 16 });
    assert.equal(saved.draft.navigation.grid.w, 192);
    assert.equal(closed, 2);
  } finally {
    globalThis.document = original;
  }
});

test('page panel reports uncertain saves and requires reload before further edits', async () => {
  const original = globalThis.document;
  globalThis.document = { createElement: (tag) => new Element(tag) };
  try {
    const f = fixture();
    const state = await f.controller.reload();
    f.fail('Antwort verloren');
    const root = new Element('section');
    let closed;
    new Schema5PagePanel({
      root, controller: f.controller, pageId: 'a', token: state.token,
      browser: { confirm: () => true }, onClose: (outcome) => { closed = outcome; },
    });
    root.children[3].children[0].children[0].value = 'light';
    await root.children[4].children[1].fire('click');
    assert.match(root.children[2].textContent, /Antwort verloren.*erneut laden/);
    assert.equal(root.children[3].inert, true);
    assert.equal(root.children[4].children[1].disabled, true);
    assert.equal(root.children[4].children[0].disabled, false);
    assert.throws(() => f.controller.snapshot(), /nicht geladen/);
    root.children[4].children[0].fire('click');
    assert.equal(closed.requiresReload, true);
    assert.equal(root.children.length, 0);
  } finally {
    globalThis.document = original;
  }
});

test('settings reject invalid choices and excessive raster height before writing', async () => {
  const original = globalThis.document;
  globalThis.document = { createElement: (tag) => new Element(tag) };
  try {
    const f = fixture();
    f.live.pages[0].widgets[0].grid.row = 100;
    const state = await f.controller.reload();
    const root = new Element('section');
    const panel = new Schema5PagePanel({ root, controller: f.controller, pageId: 'a', token: state.token,
      browser: { confirm: () => true }, onClose() {} });
    const settings = root.children[3];
    const columns = settings.children[2].children[0];
    columns.value = '192';
    columns.fire('change');
    assert.equal(columns.value, '12');
    assert.match(root.children[2].textContent, /Grenzen/);
    columns.value = '36';
    await root.children[4].children[1].fire('click');
    assert.match(root.children[2].textContent, /Ungültige Rastergröße/);
    columns.value = '12';
    settings.children[0].children[0].value = 'invalid';
    await root.children[4].children[1].fire('click');
    assert.match(root.children[2].textContent, /Ungültige Darstellung/);
    assert.equal(f.writes, 0);
    assert.equal(f.controller.snapshot().draft, null);
    panel.close();
    assert.throws(() => new Schema5PagePanel({ root, controller: f.controller, pageId: 'a', token: 'stale',
      browser: { confirm() {} }, onClose() {} }), /veraltet/);
    assert.equal(root.children.length, 0);
  } finally {
    globalThis.document = original;
  }
});

test('temporary raster selections do not accumulate rounding or alter an existing draft', async () => {
  const original = globalThis.document;
  globalThis.document = { createElement: (tag) => new Element(tag) };
  try {
    const f = fixture();
    const state = await f.controller.reload();
    const draft = structuredClone(state.live);
    draft.settings.gridColumns = 48;
    draft.navigation.grid.w = 48;
    draft.pages[0].widgets[0].grid = { col: 3, row: 3, w: 1, h: 1 };
    draft.pages[0].widgets[1].grid = { col: 4, row: 3, w: 1, h: 1 };
    await f.controller.saveDraft(draft, state.token);
    const current = f.controller.snapshot();
    const root = new Element('section');
    new Schema5PagePanel({ root, controller: f.controller, pageId: 'a', token: current.token,
      browser: { confirm: () => true }, onClose() {} });
    const columns = root.children[3].children[2].children[0];
    for (const count of [12, 24, 96, 192, 48]) {
      columns.value = String(count);
      columns.fire('change');
    }
    await root.children[4].children[1].fire('click');
    assert.deepEqual(f.controller.snapshot().draft, draft, 'only the final raster selection is applied');
    assert.deepEqual(f.controller.snapshot().live, f.live);
  } finally {
    globalThis.document = original;
  }
});

test('suspended page panel disposes after a failed in-flight save without invoking callbacks', async () => {
  const original = globalThis.document;
  globalThis.document = { createElement: (tag) => new Element(tag) };
  try {
    const f = fixture();
    const state = await f.controller.reload();
    const root = new Element('section');
    let callbacks = 0;
    const panel = new Schema5PagePanel({ root, controller: f.controller,
      pageId: 'a', token: state.token, browser: { confirm: () => true }, onClose: () => { callbacks += 1; } });
    root.children[3].children[0].children[0].value = 'light';
    const gate = f.delay();
    f.fail('Antwort verloren');
    const saving = root.children[4].children[1].fire('click');
    panel.suspend();
    assert.equal(root.hidden, true);
    assert.notEqual(root.children.length, 0);
    gate.resolve();
    await saving;
    assert.equal(root.children.length, 0);
    assert.equal(callbacks, 0);
    assert.throws(() => f.controller.snapshot(), /nicht geladen/);
  } finally {
    globalThis.document = original;
  }
});

test('page panel saves a validated draft through real isolated Perl transactions', async () => {
  const originalDocument = globalThis.document;
  const dir = await mkdtemp(join(tmpdir(), 'cms-v5-page-panel-'));
  globalThis.document = { createElement: (tag) => new Element(tag) };
  const original = JSON.stringify({
    schemaVersion: 5, theme: 'dark', settings: { layoutMode: 'grid', gridColumns: 12 },
    navigation: { orientation: 'horizontal', grid: { col: 1, row: 1, w: 12, h: 1 } },
    pages: [{ id: 'a', title: 'A', widgets: [
      { id: 'text', type: 'text', html: '{{Temp:state}}', grid: { col: 1, row: 2, w: 4, h: 2 } },
      { id: 'html', type: 'fhem-html', devices: ['Temp'],
        html: '<span device="Temp" reading="state"></span>', grid: { col: 5, row: 2, w: 4, h: 2 } },
    ] }],
  }, null, 2);
  const perl = `
use strict;
use warnings;
use JSON::PP ();
use MIME::Base64 qw(decode_base64);
sub Log3 {}
require './FHEM/01_FHEMCMS.pm';
my ($dir, $operation, @args) = @ARGV;
my ($result, $error);
if ($operation eq 'read') {
    ($result, $error) = FHEMCMS_ReadVersion5State($dir);
} elsif ($operation eq 'save') {
    my $value = JSON::PP->new->utf8->decode(decode_base64($args[0]));
    $error = FHEMCMS_WriteVersion5Draft($dir, $value, $args[1]);
} else {
    die 'unknown operation';
}
print JSON::PP->new->utf8->canonical->encode({result => $result, error => $error});
`;
  const invoke = (operation, ...args) => {
    const process = spawnSync('perl', ['-e', perl, dir, operation, ...args], { encoding: 'utf8' });
    assert.equal(process.error, undefined);
    assert.equal(process.status, 0, process.stderr);
    const { result, error } = JSON.parse(process.stdout);
    if (error) throw new Error(error);
    return result;
  };
  try {
    await writeFile(join(dir, 'config.json'), original);
    const controller = new Schema5DraftController({
      read: async () => invoke('read'),
      save: async (value, token) => invoke('save', Buffer.from(JSON.stringify(value)).toString('base64'), token),
      publish: async () => {},
      discard: async () => {},
    });
    const state = await controller.reload();
    const root = new Element('section');
    let closed;
    const background = `media/${'a'.repeat(32)}.png`;
    new Schema5PagePanel({ root, controller, pageId: 'a', token: state.token,
      services: { pickAsset: async () => ({ href: background, name: 'Beispiel' }) },
      browser: { confirm: () => true }, onClose: (outcome) => { closed = outcome; } });
    root.children[3].children[1].children[0].checked = false;
    const align = root.children[3].children[3].children[0];
    align.value = 'justify';
    await root.children[4].children[1].fire('click');
    assert.match(root.children[2].textContent, /Ungültige Titelausrichtung/);
    assert.equal(controller.snapshot().draft, null);
    align.value = 'right';
    const theme = root.children[3].children[0].children[0];
    theme.value = 'liquid-glass';
    theme.fire('change');
    await root.children[3].children[4].children[0].fire('click');
    root.children[3].children[4].children[1].children[0].checked = true;
    root.children[3].children[4].children[5].children[0].children[0].value = '80';
    root.children[3].children[4].children[5].children[1].children[0].value = '35';
    const columns = root.children[3].children[2].children[0];
    columns.value = '192';
    columns.fire('change');
    await root.children[4].children[1].fire('click');
    assert.deepEqual(closed, { requiresReload: false });
    const draft = controller.snapshot().draft;
    assert.equal(draft.pages[0].widgets[0].grid.row, 17);
    assert.equal(draft.pages[0].widgets[0].html, '{{Temp:state}}');
    assert.equal(draft.pages[0].widgets[1].html, '<span device="Temp" reading="state"></span>');
    assert.equal(draft.settings.showFrames, false);
    assert.equal(draft.settings.gridColumns, 192);
    assert.equal(draft.settings.titleAlign, 'right');
    assert.equal(draft.theme, 'liquid-glass');
    assert.equal(draft.pages[0].background, background);
    assert.equal(draft.settings.sharedBackground, true);
    assert.equal(draft.settings.liquidIntensity, 80);
    assert.equal(draft.settings.liquidTransparency, 35);
    assert.equal(await readFile(join(dir, 'config.json'), 'utf8'), original);
    assert.equal(JSON.parse(await readFile(join(dir, 'draft.json'), 'utf8')).pages[0].widgets[0].grid.row, 17);
  } finally {
    globalThis.document = originalDocument;
    await rm(dir, { recursive: true });
  }
});
