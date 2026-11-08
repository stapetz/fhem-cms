import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Schema5DraftController } from '../www/fhem-cms/js/fcui-schema5-draft.js';

class Element {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.listeners = {};
    this.attributes = {};
    this.style = {};
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this.attributes[name] = value; }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  fire(name, event = {}) { return this.listeners[name]?.(event); }
  querySelector(selector) { return selector === 'form' ? this.form : null; }
}

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
        const panel = new Schema5WidgetPanel({ root, controller, services: {}, pageId: 'one', token: state.token,
          createElement, onClose: () => {} });
        const list = root.children[3];
        const form = list.children.at(-1);
        form.children[0].children[0].value = 'fhem-html';
        form.fire('submit', { preventDefault() {} });
        await Promise.resolve();
        const html = '<span device="Temp" reading="state">{{Temp:state|upper}}</span>';
        await widget.services.saveWidget({ ...widget.config, html, devices: ['Temp'] });
        await Promise.resolve();
        assert.equal(controller.snapshot().draft.pages[0].widgets[0].html, html);
        assert.equal(await readFile(path, 'utf8'), original);
        await list.children[0].fire('click');
        await widget.services.deleteWidget(widget.config.id);
        await Promise.resolve();
        assert.deepEqual(controller.snapshot().draft.pages[0].widgets, []);
        assert.equal(await readFile(path, 'utf8'), original);
        panel.close();
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
    const root = new Element('section');
    let closed;
    const panel = new Schema5WidgetPanel({ root, controller, services: {}, pageId: 'one', token: initial.token,
      createElement, onClose: (value) => { closed = value; } });
    const [, , status, list, host, close] = root.children;
    await list.children[0].fire('click');
    assert.equal(item.tile.inert, true);
    assert.equal(close.disabled, true);
    await assert.rejects(item.services.setCommand('device', 'on'), /gesperrt/);
    item.dialog.open = false;
    item.dialog.fire('close');
    await Promise.resolve();
    assert.equal(writes, 0);
    assert.equal(close.disabled, false);
    assert.equal(host.children.length, 0);

    await list.children[0].fire('click');
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
    await Promise.resolve();
    assert.equal(state.draft.pages[0].widgets[0].html, savedWidget.html);
    assert.equal(state.live.pages[0].widgets[0].html, live.pages[0].widgets[0].html);
    assert.equal(close.disabled, false);
    assert.match(status.textContent, /Entwurf gespeichert/);

    pending = false;
    const form = list.children.at(-1);
    form.children[0].children[0].value = 'text';
    form.fire('submit', { preventDefault() {} });
    await Promise.resolve();
    assert.equal(item.options.isNew, true);
    assert.deepEqual(item.config.grid, { col: 1, row: 4, w: 6, h: 2 });
    assert.equal(item.config.id, 'x1');
    await item.services.saveWidget({ ...item.config, html: 'Neuer Text' });
    await Promise.resolve();
    assert.equal(state.draft.pages[0].widgets[1].html, 'Neuer Text');
    assert.equal(state.live.pages[0].widgets.length, 1);
    assert.equal(writes, 2);

    fail = true;
    await list.children[0].fire('click');
    await assert.rejects(item.services.deleteWidget('text'), /Antwort verloren/);
    await Promise.resolve();
    assert.equal(list.inert, true);
    assert.match(status.textContent, /erneut laden/);
    close.fire('click');
    assert.deepEqual(closed, { requiresReload: true });

    fail = false;
    const restored = await controller.reload();
    const suspendedRoot = new Element('section');
    const suspended = new Schema5WidgetPanel({ root: suspendedRoot, controller, services: {}, pageId: 'one',
      token: restored.token, createElement, onClose: () => { throw new Error('unexpected callback'); } });
    opening = {};
    const promise = suspendedRoot.children[3].children[0].fire('click');
    suspended.suspend();
    opening.resolve();
    await promise;
    await Promise.resolve();
    assert.equal(suspendedRoot.children.length, 0);
  } finally {
    Object.assign(globalThis, previous);
  }
});
