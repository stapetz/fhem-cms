import assert from 'node:assert/strict';
import { navigationDom } from './helpers/navigation-dom.js';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Schema5DraftController } from '../www/fhem-cms/js/fcui-schema5-draft.js';

class Element {
  constructor(tag) {
    this.tag = tag;
    navigationDom(this);
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.classList = { toggle() {} };
    this.style = { setProperty(name, value) { this[name] = value; } };
    this.value = '';
  }
  append(...children) {
    this.children.push(...children);
    for (const child of children) child.parent = this;
    if (this.tag === 'select' && !this.value && this.children.length) this.value = this.children[0].value;
  }
  replaceChildren(...children) {
    this.children = children;
    for (const child of children) child.parent = this;
  }
  remove() {
    this.removed = true;
    if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this);
  }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null; }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(name, callback) { (this.listeners[name] ||= []).push(callback); }
  fire(name, event = {}) {
    let result;
    for (const callback of this.listeners[name] || []) result = callback({ preventDefault() {}, ...event });
    return result;
  }
  contains(node) { return this === node || this.children.some((child) => child.contains(node)); }
  focus() { this.focused = true; }
  showModal() { this.open = true; }
  get valueAsNumber() { return this.value === '' ? NaN : Number(this.value); }
}

function toolbarControls(toolbar) {
  const all = (node) => [node, ...node.children.flatMap(all)];
  const nodes = all(toolbar);
  return [
    'Seiteneinstellungen', null, 'Entwurf veröffentlichen', 'Entwurf verwerfen',
    'Zustand erneut laden', 'Widget hinzufügen',
  ].map((label) => nodes.find((node) => label ? node.textContent === label : node.className === 'cms-editor-mode'));
}

test('editor connects view and grid draft, and suspends in-flight writes on pagehide', async () => {
  const previous = {
    window: globalThis.window, document: globalThis.document,
    HTMLElement: globalThis.HTMLElement, customElements: globalThis.customElements,
  };
  globalThis.window = {
    location: { href: 'https://example.test/' },
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.document = {
    createElement: (tag) => new Element(tag),
    documentElement: new Element('html'),
    body: new Element('body'),
    addEventListener() {},
    removeEventListener() {},
  };
  document.documentElement.setAttribute('data-cms-theme', 'light');
  document.documentElement.setAttribute('data-cms-frames', 'off');
  globalThis.HTMLElement = class {};
  const registry = new Map();
  globalThis.customElements = {
    define(name, element) { registry.set(name, element); },
    get(name) { return registry.get(name); },
  };
  let editor;
  let waitingEditor;
  try {
    const { Schema5Editor } = await import('../www/fhem-cms/js/fcui-schema5-editor.js');
    const live = {
      schemaVersion: 5, settings: { layoutMode: 'grid', gridColumns: 12 },
      navigation: { orientation: 'horizontal', grid: { col: 1, row: 1, w: 12, h: 1 } },
      pages: [{ id: 'a', title: 'A', widgets: [
        { id: 'text', type: 'text', html: '{{Temp:state}}', grid: { col: 1, row: 2, w: 4, h: 2 } },
      ] }],
    };
    let state = { live, draft: null, token: 'a'.repeat(64) };
    let release;
    let blocked = false;
    let fail = false;
    let writes = 0;
    let publishCalls = 0;
    let discardCalls = 0;
    let failPublish = false;
    const controller = new Schema5DraftController({
      read: async () => structuredClone(state),
      save: async (draft, token) => {
        assert.equal(token, state.token);
        writes += 1;
        if (blocked) await new Promise((resolve) => { release = resolve; });
        if (fail) throw new Error('Antwort verloren');
        state = { live, draft, token: writes === 1 ? 'b'.repeat(64) : 'c'.repeat(64) };
      },
      publish: async (token) => {
        assert.equal(token, state.token);
        publishCalls += 1;
        if (failPublish) throw new Error('Antwort verloren');
        state = { live: state.draft, draft: null, token: 'd'.repeat(64) };
      },
      discard: async (token) => {
        assert.equal(token, state.token);
        discardCalls += 1;
        state = { live: state.live, draft: null, token: 'e'.repeat(64) };
      },
    });

    const listeners = new Map();
    let reloads = 0;
    let confirmed = false;
    const browser = {
      location: { href: 'https://example.test/?mode=edit#/a', hash: '#/a', reload() { reloads += 1; } },
      confirm() { return confirmed; },
      addEventListener(name, callback) {
        if (!listeners.has(name)) listeners.set(name, new Set());
        listeners.get(name).add(callback);
      },
      removeEventListener(name, callback) { listeners.get(name).delete(callback); },
      dispatch(name, event = {}) {
        for (const callback of [...(listeners.get(name) || [])]) callback(event);
      },
    };
    const grids = [];
    const GridStack = { init() {
      const grid = {
        items: [], destroyed: false,
        getColumn() { return 12; },
        makeWidget(wrapper, item) { wrapper.gridstackNode = { id: item.id }; this.items.push({ ...item }); },
        save() { return structuredClone(this.items); },
        update(wrapper, position) { Object.assign(this.items.find((item) => item.id === wrapper.gridstackNode.id), position); },
        setStatic() {},
        on() {},
        destroy() { this.destroyed = true; },
      };
      grids.push(grid);
      return grid;
    } };
    let unsubscribed = 0;
    const client = {
      jsonlist: async () => [],
      subscribe(names, update, status) { status('polling'); },
      unsubscribe() { unsubscribed += 1; },
    };
    const root = new Element('section');
    let assetCalls = 0;
    editor = new Schema5Editor({ GridStack, root, controller, client, services: {
      pickAsset: async options => {
        assert.equal(options.owner, root, 'File menu Assetmanager follows editor lifecycle');
        assert.equal(options.mode, undefined, 'File menu opens management, not a filtered picker');
        assetCalls++;
        return null;
      },
    }, browser });
    await editor.start();
    const deviceBar = document.body.children.find((node) => node.className === 'cms-device-bar');
    assert.ok(deviceBar, 'device preview controls are available in the schema-5 editor');
    const [deviceSelect, rotate] = deviceBar.children;
    assert.deepEqual(deviceSelect.children.filter((node) => node.tag === 'optgroup').map((group) => group.label),
      ['iPhone', 'iPad', 'Android', 'Desktop / Monitor']);
    deviceSelect.value = 'iphone-se';
    await deviceSelect.fire('change');
    const preview = document.body.children.find((node) => node.className === 'cms-device-overlay');
    let iframe = preview.children[0].children[0].children[0];
    assert.equal(iframe.src, 'https://example.test/?mode=preview#/a');
    assert.equal(iframe.style.width, '375px');
    rotate.fire('click');
    assert.equal(iframe.style.width, '667px', 'rotation swaps the phone dimensions');
    assert.equal(iframe.style.height, '375px');
    deviceSelect.value = 'desktop-1280';
    await deviceSelect.fire('change');
    iframe = document.body.children.find((node) => node.className === 'cms-device-overlay')
      .children[0].children[0].children[0];
    assert.equal(iframe.style.width, '1280px');
    assert.equal(iframe.style.height, '720px');
    rotate.fire('click');
    assert.equal(iframe.style.width, '720px', 'desktop resolutions can also be rotated');
    assert.equal(iframe.style.height, '1280px');
    deviceSelect.value = '';
    await deviceSelect.fire('change');
    assert.equal(document.body.children.some((node) => node.className === 'cms-device-overlay'), false);
    assert.equal(document.documentElement.getAttribute('data-cms-theme'), 'dark');
    assert.equal(document.documentElement.getAttribute('data-cms-frames'), 'on');
    const [, , content] = root.children;
    const toolbar = { children: toolbarControls(root.children[0]) };
    assert.equal(root.children[0].className, 'cms-toolbar');
    const [fileMenu, editMenu, viewMenu] = root.children[0].children;
    assert.deepEqual([fileMenu, editMenu, viewMenu].map((menu) => menu.children[0].textContent),
      ['Datei', 'Bearbeiten', 'Ansicht']);
    assert.equal(editMenu.children[1].children[0].textContent, 'Seiteneinstellungen');
    assert.deepEqual(viewMenu.children[1].children.map((item) => item.textContent), ['Vorschau', 'Raster anzeigen']);
    const assetButton = fileMenu.children[1].children.find(item => item.textContent === 'Assetmanager');
    assert.ok(assetButton, 'File menu exposes shared Assetmanager');
    await assetButton.fire('click');
    assert.equal(assetCalls, 1);
    assert.equal(writes, 0, 'opening Assetmanager never saves or publishes a page draft');
    fileMenu.open = true;
    editMenu.open = true;
    editMenu.fire('toggle');
    assert.equal(fileMenu.open, false);
    editMenu.fire('keydown', { key: 'Escape' });
    assert.equal(editMenu.open, false);
    assert.equal(editMenu.children[0].focused, true);
    const [edit, mode, publish, discard, reload] = toolbar.children;
    assert.equal(mode.textContent, 'Live');
    assert.equal(edit.disabled, false);
    assert.equal(publish.disabled, true);
    assert.equal(discard.disabled, true);
    const widgetServices = content.children[0].children[1].children[0].children[0].services;
    await assert.rejects(widgetServices.setCommand('Lamp', 'on'), /Bearbeitungsmodus deaktiviert/);
    await assert.rejects(widgetServices.setTarget({}, 20), /Bearbeitungsmodus deaktiviert/);
    edit.fire('click');
    assert.equal(grids[0].destroyed, true);
    assert.equal(unsubscribed, 1);
    const panel = content.children[0];
    assert.equal(panel.children[0].textContent, 'Seiteneinstellungen');
    assert.equal(panel.children.length, 5, 'settings contain no separate widget grid or position form');
    panel.children[3].children[0].children[0].value = 'light';
    await panel.children[4].children[1].fire('click');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(mode.textContent, 'Entwurf');
    assert.equal(edit.disabled, false);
    assert.equal(state.draft.pages[0].widgets[0].grid.row, 2);
    assert.equal(state.draft.theme, 'light');
    assert.equal(state.live.pages[0].widgets[0].grid.row, 2);
    assert.equal(publish.disabled, false);
    assert.equal(discard.disabled, false);
    await publish.fire('click');
    await discard.fire('click');
    assert.equal(publishCalls, 0, 'cancelled confirmation never writes');
    assert.equal(discardCalls, 0, 'cancelled confirmation never writes');

    confirmed = true;
    failPublish = true;
    await publish.fire('click');
    assert.equal(publishCalls, 1);
    assert.equal(publish.disabled, true);
    assert.equal(discard.disabled, true);
    assert.equal(reload.hidden, false);
    assert.match(root.children[1].textContent, /Antwort verloren.*erneut laden/);
    assert.throws(() => controller.snapshot(), /nicht geladen/);
    failPublish = false;
    await reload.fire('click');
    assert.equal(mode.textContent, 'Entwurf');
    assert.equal(publish.disabled, false);
    await discard.fire('click');
    assert.equal(discardCalls, 1);
    assert.equal(mode.textContent, 'Live');
    assert.equal(state.draft, null);
    assert.equal(state.live.pages[0].widgets[0].grid.row, 2);
    assert.equal(discard.disabled, true);

    edit.fire('click');
    const anotherPanel = content.children[0];
    await anotherPanel.children[4].children[1].fire('click');
    await new Promise((resolve) => setTimeout(resolve, 0));
    await publish.fire('click');
    assert.equal(publishCalls, 2);
    assert.equal(mode.textContent, 'Live');
    assert.equal(state.draft, null);
    assert.equal(publish.disabled, true);

    edit.fire('click');
    fail = true;
    const failedPanel = content.children[0];
    await failedPanel.children[4].children[1].fire('click');
    assert.match(failedPanel.children[2].textContent, /Antwort verloren/);
    assert.equal(edit.disabled, true);
    fail = false;
    failedPanel.children[4].children[0].fire('click');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(mode.textContent, 'Live');
    assert.equal(edit.disabled, false);

    const widgetButton = toolbar.children[5];
    widgetButton.fire('click');
    const widgetPanel = content.children[0];
    assert.match(widgetPanel.children[0].textContent, /Widget hinzufügen/);
    assert.equal(edit.disabled, true);
    widgetPanel.children[6].children[0].fire('click');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(mode.textContent, 'Live');
    assert.equal(widgetButton.disabled, false);

    // Navigation bearbeiten öffnet über das Stiftsymbol an der Navigationskachel
    const navWrapper = content.children[0].children[0];
    const navTools = navWrapper.children.at(-1);
    navTools.children[1].fire('click');
    const navigationPanel = content.children[0];
    assert.equal(navigationPanel.children[0].textContent, 'Navigation bearbeiten');
    assert.equal(edit.disabled, true);
    navigationPanel.children[4].children[0].fire('click');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(mode.textContent, 'Live');
    assert.equal(widgetButton.disabled, false);

    // Vorschau blendet die Bearbeitungswerkzeuge aus und wieder ein
    const previewButton = toolbarControls(root.children[0]).length && [root.children[0], ...root.children[0].children.flatMap(function all(n) { return [n, ...n.children.flatMap(all)]; })]
      .find((node) => node.textContent === 'Vorschau');
    previewButton.fire('click');
    await new Promise((resolve) => setTimeout(resolve, 0));
    const previewWrapper = content.children[0].children[0];
    assert.equal(previewWrapper.children.some?.((c) => c.className === 'cms-widget-tools') ?? previewWrapper.children.filter((c) => c.className === 'cms-widget-tools').length > 0, false, 'preview hides widget tools');
    previewButton.fire('click');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(content.children[0].children[0].children.at(-1).className, 'cms-widget-tools');

    edit.fire('click');
    const pendingPanel = content.children[0];
    const pendingGrid = grids.at(-1);
    blocked = true;
    const saving = pendingPanel.children[4].children[1].fire('click');
    browser.dispatch('pagehide');
    assert.equal(pendingPanel.hidden, true);
    assert.equal(content.children.length, 0);
    assert.equal(edit.disabled, true);
    assert.equal(pendingGrid.destroyed, true, 'opening settings already destroys the main widget grid');
    release();
    await saving;
    assert.equal(pendingGrid.destroyed, true);
    assert.equal(content.children.length, 0, 'late completion cannot restart the view');
    browser.dispatch('pageshow', { persisted: true });
    assert.equal(reloads, 1);
    editor.stop();
    assert.equal(root.children.length, 0);
    assert.equal(document.documentElement.getAttribute('data-cms-theme'), 'light');
    assert.equal(document.documentElement.getAttribute('data-cms-frames'), 'off');
    assert.ok([...listeners.values()].every((set) => set.size === 0));

    let rejectRead;
    const waitingController = new Schema5DraftController({
      read: () => new Promise((resolve, reject) => { rejectRead = reject; }),
      save: async () => {}, publish: async () => {}, discard: async () => {},
    });
    const waitingRoot = new Element('section');
    waitingEditor = new Schema5Editor({
      GridStack, root: waitingRoot, controller: waitingController, client, services: {}, browser,
    });
    const starting = waitingEditor.start();
    browser.dispatch('pagehide');
    rejectRead(new Error('Verbindung verloren'));
    await starting;
    browser.dispatch('pageshow', { persisted: true });
    assert.equal(reloads, 2, 'a late failed startup cannot suppress a BFCache reload');
    waitingEditor.stop();
    assert.ok([...listeners.values()].every((set) => set.size === 0));
  } finally {
    if (editor) editor.stop();
    if (waitingEditor) waitingEditor.stop();
    globalThis.window = previous.window;
    globalThis.document = previous.document;
    globalThis.HTMLElement = previous.HTMLElement;
    globalThis.customElements = previous.customElements;
  }
});

test('editor lifecycle and auto-arrangement use real isolated Perl draft transactions with stale-tab protection', async () => {
  const previous = {
    window: globalThis.window, document: globalThis.document,
    HTMLElement: globalThis.HTMLElement, customElements: globalThis.customElements,
  };
  const dir = await mkdtemp(join(tmpdir(), 'cms-v5-editor-'));
  globalThis.window = {
    location: { href: 'https://example.test/' },
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.document = {
    createElement: (tag) => new Element(tag),
    documentElement: new Element('html'),
    body: new Element('body'),
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.HTMLElement = class {};
  const registry = new Map();
  globalThis.customElements = {
    define(name, element) { registry.set(name, element); },
    get(name) { return registry.get(name); },
  };
  let editor;
  const script = `
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
} elsif ($operation eq 'publish') {
    ($result, $error) = FHEMCMS_PublishVersion5Draft($dir, $args[0]);
} elsif ($operation eq 'discard') {
    $error = FHEMCMS_DiscardVersion5Draft($dir, $args[0]);
} else {
    die 'unknown operation';
}
print JSON::PP->new->utf8->canonical->encode({result => $result, error => $error});
`;
  const invoke = (operation, ...args) => {
    const process = spawnSync('perl', ['-e', script, dir, operation, ...args], { encoding: 'utf8' });
    assert.equal(process.error, undefined);
    assert.equal(process.status, 0, process.stderr);
    const { result, error } = JSON.parse(process.stdout);
    if (error) throw new Error(error);
    return result;
  };
  const transport = {
    read: async () => invoke('read'),
    save: async (value, token) => invoke('save', Buffer.from(JSON.stringify(value)).toString('base64'), token),
    publish: async (token) => invoke('publish', token),
    discard: async (token) => invoke('discard', token),
  };
  const live = {
    schemaVersion: 5, theme: 'dark', settings: { layoutMode: 'grid', gridColumns: 12 },
    navigation: { orientation: 'horizontal', grid: { col: 1, row: 1, w: 12, h: 1 } },
    pages: [{ id: 'a', title: 'A', widgets: [
      { id: 'text', type: 'text', html: '{{Temp:state}}', grid: { col: 2, row: 10, w: 4, h: 2 } },
      { id: 'html', type: 'fhem-html', devices: ['Temp'],
        html: '<span device="Temp" reading="state"></span>', grid: { col: 8, row: 20, w: 4, h: 2 } },
    ] }],
  };
  const original = JSON.stringify(live, null, 2);
  const browser = {
    location: { href: 'https://example.test/?mode=edit#/a', hash: '#/a', reload() {} },
    confirm: () => true,
    addEventListener() {}, removeEventListener() {},
  };
  const GridStack = { init() {
    return {
      items: [],
      getColumn() { return 12; },
      makeWidget(wrapper, item) { wrapper.gridstackNode = { id: item.id }; this.items.push({ ...item }); },
      save() { return structuredClone(this.items); },
      update(wrapper, position) { Object.assign(this.items.find((item) => item.id === wrapper.gridstackNode.id), position); },
      setStatic() {}, enableMove() {}, enableResize() {}, on() {}, destroy() {},
    };
  } };
  const client = {
    jsonlist: async () => [], subscribe(names, update, status) { status('polling'); }, unsubscribe() {},
  };
  try {
    await writeFile(join(dir, 'config.json'), original);
    const controller = new Schema5DraftController(transport);
    const { Schema5Editor } = await import('../www/fhem-cms/js/fcui-schema5-editor.js');
    const root = new Element('section');
    editor = new Schema5Editor({ GridStack, root, controller, client, services: {}, browser });
    await editor.start();
    const [, status, content] = root.children;
    const toolbar = { children: toolbarControls(root.children[0]) };
    const [edit, mode, publish, discard, reload] = toolbar.children;
    const all = (node) => [node, ...node.children.flatMap(all)];
    const arrange = all(root.children[0]).find((node) => node.textContent === 'Widgets automatisch anordnen');
    await arrange.fire('click');
    const arranged = JSON.parse(await readFile(join(dir, 'draft.json'), 'utf8'));
    assert.deepEqual(arranged.pages[0].widgets.map((widget) => widget.grid), [
      { col: 1, row: 2, w: 4, h: 2 }, { col: 5, row: 2, w: 4, h: 2 },
    ]);
    assert.equal(await readFile(join(dir, 'config.json'), 'utf8'), original);
    const persistedToken = controller.snapshot().token;
    await arrange.fire('click');
    assert.equal(controller.snapshot().token, persistedToken, 'already arranged does not rewrite the draft');
    edit.fire('click');
    content.children[0].children[3].children[1].children[0].checked = false;
    await content.children[0].children[4].children[1].fire('click');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(mode.textContent, 'Entwurf');
    assert.equal(await readFile(join(dir, 'config.json'), 'utf8'), original);

    const other = new Schema5DraftController(transport);
    const otherState = await other.reload();
    await other.renamePage('a', 'Anderer Tab', otherState.token);
    await publish.fire('click');
    assert.match(status.textContent, /veraltet/);
    assert.equal(reload.hidden, false);
    assert.equal(await readFile(join(dir, 'config.json'), 'utf8'), original);
    assert.deepEqual((await readdir(dir)).sort(), ['config.json', 'draft.json']);
    await reload.fire('click');
    await publish.fire('click');
    const published = JSON.parse(await readFile(join(dir, 'config.json'), 'utf8'));
    assert.equal(published.pages[0].title, 'Anderer Tab');
    assert.equal(published.pages[0].widgets[0].grid.row, 2);
    assert.equal(published.settings.showFrames, false);
    assert.equal(published.pages[0].widgets[0].html, '{{Temp:state}}');
    assert.equal(published.pages[0].widgets[1].html, '<span device="Temp" reading="state"></span>');
    const backup = (await readdir(dir)).find((name) => name.endsWith('.bak'));
    assert.ok(backup);
    assert.equal(await readFile(join(dir, backup), 'utf8'), original);
    assert.equal(mode.textContent, 'Live');
    edit.fire('click');
    await content.children[0].children[4].children[1].fire('click');
    await new Promise((resolve) => setTimeout(resolve, 0));
    const navWrapper2 = content.children[0].children[0];
    navWrapper2.children.at(-1).children[1].fire('click');
    const navPanel = content.children[0];
    const addSection = navPanel.children[3].children[3];
    addSection.children[0].children[0].value = 'Zweite';
    addSection.children[1].children[0].value = 'second';
    addSection.children[2].fire('click');
    await navPanel.children[4].children[1].fire('click');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(JSON.parse(await readFile(join(dir, 'draft.json'), 'utf8')).pages.length, 2);
    assert.equal(mode.textContent, 'Entwurf');
    edit.fire('click');
    const pagePanel = content.children[0];
    const appearanceForm = pagePanel.children[3];
    appearanceForm.children[0].children[0].value = 'light';
    appearanceForm.children[1].children[0].checked = false;
    await pagePanel.children[4].children[1].fire('click');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(document.documentElement.getAttribute('data-cms-theme'), 'light');
    assert.equal(document.documentElement.getAttribute('data-cms-frames'), 'off');
    await discard.fire('click');
    assert.equal(mode.textContent, 'Live');
    assert.equal(document.documentElement.getAttribute('data-cms-theme'), 'dark');
    assert.equal(document.documentElement.getAttribute('data-cms-frames'), 'off');
    assert.equal((await readdir(dir)).includes('draft.json'), false);
    assert.deepEqual(JSON.parse(await readFile(join(dir, 'config.json'), 'utf8')), published);
  } finally {
    if (editor) editor.stop();
    assert.equal(document.body.children.some((node) => node.className === 'cms-device-bar'), false);
    globalThis.window = previous.window;
    globalThis.document = previous.document;
    globalThis.HTMLElement = previous.HTMLElement;
    globalThis.customElements = previous.customElements;
    await rm(dir, { recursive: true });
  }
});
