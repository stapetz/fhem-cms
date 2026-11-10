import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Schema5DraftController } from '../www/fhem-cms/js/fcui-schema5-draft.js';
import { resizeSchema5Grid } from '../www/fhem-cms/js/fcui-schema5-layout.js';

class Element {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.listeners = {};
    this.attributes = {};
    this.style = {};
    this.value = '';
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this.attributes[name] = value; }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  fire(name, event = {}) { return this.listeners[name]?.(event); }
  querySelector(selector) { return selector === 'form' ? this.form : null; }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('widget panel binds real draft controller, cancellation, failures and lifecycle', async () => {
  const previous = {
    window: globalThis.window, document: globalThis.document,
    HTMLElement: globalThis.HTMLElement, customElements: globalThis.customElements,
  };
  globalThis.window = { location: { href: 'https://example.test/' } };
  globalThis.document = { createElement: (tag) => new Element(tag) };
  globalThis.HTMLElement = class {};
  const registry = new Map();
  globalThis.customElements = {
    define(name, item) { registry.set(name, item); },
    get(name) { return registry.get(name); },
  };
  try {
    const { Schema5WidgetPanel } = await import('../www/fhem-cms/js/fcui-schema5-widget-panel.js');
    const live = {
      schemaVersion: 5, settings: { layoutMode: 'grid', gridColumns: 12 },
      navigation: { orientation: 'horizontal', grid: { col: 1, row: '1', w: 12, h: '1' } },
      pages: [{ id: 'one', title: 'Eins', widgets: [
        { id: 'text', type: 'text', html: '{{Temp:state}}', grid: { col: 1, row: '2', w: 4, h: '2' } },
      ] }],
    };
    let state = { live, draft: null, token: 'a'.repeat(64) };
    let writes = 0;
    let pending = false;
    let release;
    let fail = false;
    const controller = new Schema5DraftController({
      read: async () => structuredClone(state),
      save: async (draft, token) => {
        assert.equal(token, state.token);
        writes += 1;
        if (pending) await new Promise((resolve) => { release = resolve; });
        if (fail) throw new Error('Antwort verloren');
        state = { live, draft, token: String(writes).repeat(64) };
      },
      publish: async () => {}, discard: async () => {},
    });

    await test('widget panel creates and removes HTML through isolated Perl draft transactions', async () => {
      const previous = {
        window: globalThis.window, document: globalThis.document,
        HTMLElement: globalThis.HTMLElement, customElements: globalThis.customElements,
      };
      globalThis.window = { location: { href: 'https://example.test/' } };
      globalThis.document = { createElement: (tag) => new Element(tag) };
      globalThis.HTMLElement = class {};
      const registry = new Map();
      globalThis.customElements = { define: (name, value) => registry.set(name, value), get: (name) => registry.get(name) };
      const dir = await mkdtemp(join(tmpdir(), 'cms-v5-widget-panel-'));
      const source = `
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
    } else { die 'unknown operation'; }
    print JSON::PP->new->utf8->canonical->encode({result => $result, error => $error});
    `;
      try {
        const { Schema5WidgetPanel } = await import('../www/fhem-cms/js/fcui-schema5-widget-panel.js');
        const live = {
          schemaVersion: 5, theme: 'dark', settings: { layoutMode: 'grid', gridColumns: 12 },
          navigation: { orientation: 'horizontal', grid: { col: 1, row: 1, w: 12, h: 1 } },
          pages: [{ id: 'one', title: 'Eins', widgets: [] }],
        };
        const original = JSON.stringify(live, null, 2);
        const path = join(dir, 'config.json');
        await writeFile(path, original);
        const invoke = (operation, ...args) => {
          const child = spawnSync('perl', ['-e', source, dir, operation, ...args], { encoding: 'utf8' });
          if (child.status !== 0) throw new Error(child.stderr);
          const reply = JSON.parse(child.stdout);
          if (reply.error) throw new Error(reply.error);
          return reply.result;
        };
        const controller = new Schema5DraftController({
          read: async () => invoke('read'),
          save: async (draft, token) => invoke('save', Buffer.from(JSON.stringify(draft)).toString('base64'), token),
          publish: async () => {}, discard: async () => {},
        });
        const state = await controller.reload();
        let widget;
        const createElement = (config, services) => {
          const dialog = new Element('dialog');
          dialog.form = new Element('form');
          const tile = new Element('article');
          widget = new Element('widget');
          widget.config = config;
          widget.services = services;
          widget.shadowRoot = { querySelector: (selector) => selector === '[data-dialog]' ? dialog : tile };
          widget.openConfig = async () => { dialog.open = true; };
          return widget;
        };
        const root = new Element('section');
        let closed;
        new Schema5WidgetPanel({ root, controller, services: {}, pageId: 'one', token: state.token,
          createElement, onClose: (value) => { closed = value; } });
        assert.equal(root.children[0].textContent, 'Widget hinzufügen');
        const search = root.children[3].children[0];
        search.value = 'freies';
        search.fire('input');
        const list = root.children[4];
        assert.equal(list.children.length, 1);
        assert.equal(list.children[0].textContent, 'Freies HTML');
        await list.children[0].fire('click');
        await tick();
        const html = '<span device="Temp" reading="state">{{Temp:state|upper}}</span>';
        await widget.services.saveWidget({ ...widget.config, html, devices: ['Temp'], showTitle: false });
        await tick();
        assert.deepEqual(closed, { requiresReload: false }, 'saving a new widget closes the dialog');
        assert.equal(root.children.length, 0);
        assert.equal(controller.snapshot().draft.pages[0].widgets[0].html, html);
        assert.equal(controller.snapshot().draft.pages[0].widgets[0].showTitle, false,
          'the Perl module accepts the showTitle flag');
        assert.equal(await readFile(path, 'utf8'), original);

        const editRoot = new Element('section');
        let editClosed;
        new Schema5WidgetPanel({ root: editRoot, controller, services: {}, pageId: 'one',
          token: controller.snapshot().token, widgetId: controller.snapshot().draft.pages[0].widgets[0].id,
          createElement, onClose: (value) => { editClosed = value; } });
        assert.equal(editRoot.children[0].textContent, 'Widget bearbeiten');
        await tick();
        await widget.services.deleteWidget(widget.config.id);
        await tick();
        assert.deepEqual(editClosed, { requiresReload: false });
        assert.equal(editRoot.children.length, 0);
        assert.deepEqual(controller.snapshot().draft.pages[0].widgets, []);
        assert.equal(await readFile(path, 'utf8'), original);

        const linkRoot = new Element('section');
        let linkClosed;
        new Schema5WidgetPanel({ root: linkRoot, controller, services: {}, pageId: 'one',
          token: controller.snapshot().token, createElement,
          onClose: value => { linkClosed = value; } });
        const linkSearch = linkRoot.children[3].children[0];
        linkSearch.value = 'linkwidget';
        linkSearch.fire('input');
        assert.equal(linkRoot.children[4].children.length, 1);
        await linkRoot.children[4].children[0].fire('click');
        await tick();
        assert.equal(widget.config.type, 'fhem-link');
        assert.equal(widget.config.links[0].page, 'one', 'new LinkWidget starts with a valid local page');
        assert.deepEqual(widget.services.pages, [{ id: 'one', title: 'Eins' }]);
        const candidate = structuredClone(widget.config);
        candidate.links[0].grid.col = 5;
        candidate.links[0].text = 'Startseite öffnen';
        await widget.services.saveWidget(candidate);
        await tick();
        assert.deepEqual(linkClosed, { requiresReload: false });
        const persisted = controller.snapshot().draft.pages[0].widgets[0];
        assert.deepEqual(persisted, candidate, 'nested geometry and link text survive a real Perl draft write/readback');
        assert.equal(await readFile(path, 'utf8'), original, 'LinkWidget saves do not publish live configuration');
        const reread = await controller.reload();
        assert.deepEqual(reread.draft.pages[0].widgets[0], candidate);
      } finally {
        Object.assign(globalThis, previous);
        await rm(dir, { recursive: true, force: true });
      }
    });
    const initial = await controller.reload();
    let item;
    let opening;
    const createElement = (widget, services) => {
      const dialog = new Element('dialog');
      dialog.form = new Element('form');
      const tile = new Element('article');
      item = new Element('widget');
      item.config = widget;
      item.services = services;
      item.shadowRoot = { querySelector: (selector) => selector === '[data-dialog]' ? dialog : tile };
      item.openConfig = async (options) => {
        item.options = options;
        if (opening) await new Promise((resolve) => { opening.resolve = resolve; });
        dialog.open = true;
      };
      item.dialog = dialog;
      item.tile = tile;
      return item;
    };

    // Direktbearbeitung: Abbruch über den Widgetdialog schließt das Panel ohne Schreibzugriff
    let root = new Element('section');
    let closed;
    new Schema5WidgetPanel({ root, controller, services: {}, pageId: 'one', token: initial.token,
      widgetId: 'text', createElement, onClose: (value) => { closed = value; } });
    await tick();
    assert.equal(item.tile.inert, true);
    assert.equal(root.children[6].children[0].disabled, true);
    await assert.rejects(item.services.setCommand('device', 'on'), /gesperrt/);
    item.dialog.open = false;
    item.dialog.fire('close');
    await tick();
    assert.equal(writes, 0);
    assert.deepEqual(closed, { requiresReload: false });
    assert.equal(root.children.length, 0);

    // Laufendes Speichern blockiert Abbruch und Löschen; Erfolg schließt das Panel
    root = new Element('section');
    closed = undefined;
    new Schema5WidgetPanel({ root, controller, services: {}, pageId: 'one', token: controller.snapshot().token,
      widgetId: 'text', createElement, onClose: (value) => { closed = value; } });
    await tick();
    pending = true;
    const savedWidget = { ...item.config, html: '<p>{{Temp:state|upper}}</p>' };
    const saving = item.services.saveWidget(savedWidget);
    assert.equal(item.dialog.form.inert, true);
    let prevented = false;
    let stopped = false;
    item.dialog.fire('cancel', { preventDefault() { prevented = true; }, stopImmediatePropagation() { stopped = true; } });
    assert.equal(prevented && stopped, true);
    await assert.rejects(item.services.deleteWidget('text'), /nicht mehr aktiv/);
    release();
    await saving;
    await tick();
    assert.equal(state.draft.pages[0].widgets[0].html, savedWidget.html);
    assert.equal(state.live.pages[0].widgets[0].html, live.pages[0].widgets[0].html);
    assert.deepEqual(closed, { requiresReload: false });
    assert.equal(root.children.length, 0);

    // Widget hinzufügen über die durchsuchbare Typauswahl
    pending = false;
    root = new Element('section');
    closed = undefined;
    new Schema5WidgetPanel({ root, controller, services: {}, pageId: 'one', token: controller.snapshot().token,
      createElement, onClose: (value) => { closed = value; } });
    const search = root.children[3].children[0];
    search.value = 'zzz';
    search.fire('input');
    assert.match(root.children[4].children[0].textContent, /Kein Widget-Typ/);
    search.value = 'Textbaustein';
    search.fire('input');
    const status = root.children[2];
    await root.children[4].children[0].fire('click');
    await tick();
    assert.equal(item.options.isNew, true);
    assert.deepEqual(item.config.grid, { col: 1, row: 4, w: 6, h: 2 });
    assert.equal(item.config.id, 'x1');
    // Abbruch kehrt zur Auswahl zurück
    item.dialog.open = false;
    item.dialog.fire('close');
    await tick();
    assert.equal(closed, undefined);
    assert.match(status.textContent, /abgebrochen/);
    await root.children[4].children[0].fire('click');
    await tick();
    await item.services.saveWidget({ ...item.config, html: 'Neuer Text' });
    await tick();
    assert.deepEqual(closed, { requiresReload: false });
    assert.equal(state.draft.pages[0].widgets[1].html, 'Neuer Text');
    assert.equal(state.live.pages[0].widgets.length, 1);
    assert.equal(writes, 2);

    state.draft = resizeSchema5Grid(state.draft, 48);
    await controller.reload();
    root = new Element('section');
    new Schema5WidgetPanel({ root, controller, services: {}, pageId: 'one', token: controller.snapshot().token,
      createElement, onClose: () => {} });
    const textButton = root.children[4].children.find((button) => button.textContent === 'Textbaustein');
    await textButton.fire('click');
    await tick();
    assert.deepEqual(item.config.grid, { col: 1, row: 21, w: 24, h: 8 },
      'new widgets retain their visual default size on finer rasters');
    item.dialog.open = false;
    item.dialog.fire('close');
    await tick();
    root.children[6].children[0].fire('click');
    assert.equal(writes, 2, 'cancelling the new widget does not save');

    // Fehlgeschlagene Änderung sperrt das Panel bis zum erneuten Laden
    fail = true;
    root = new Element('section');
    closed = undefined;
    new Schema5WidgetPanel({ root, controller, services: {}, pageId: 'one', token: controller.snapshot().token,
      widgetId: 'text', createElement, onClose: (value) => { closed = value; } });
    await tick();
    await assert.rejects(item.services.deleteWidget('text'), /Antwort verloren/);
    await tick();
    assert.match(root.children[2].textContent, /erneut laden/);
    root.children[6].children[0].fire('click');
    assert.deepEqual(closed, { requiresReload: true });

    // Unterbrechung während des Öffnens schließt still
    fail = false;
    const restored = await controller.reload();
    const suspendedRoot = new Element('section');
    const suspended = new Schema5WidgetPanel({ root: suspendedRoot, controller, services: {}, pageId: 'one',
      token: restored.token, createElement, onClose: () => { throw new Error('unexpected callback'); } });
    opening = {};
    const promise = suspendedRoot.children[4].children[0].fire('click');
    suspended.suspend();
    opening.resolve();
    await promise;
    await tick();
    assert.equal(suspendedRoot.children.length, 0);
  } finally {
    Object.assign(globalThis, previous);
  }
});
