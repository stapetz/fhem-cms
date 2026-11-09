import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Schema5DraftController } from '../www/fhem-cms/js/fcui-schema5-draft.js';
import { Schema5PagePanel } from '../www/fhem-cms/js/fcui-schema5-page-panel.js';

class Element {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.value = '';
    this.checked = false;
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
  let grid;
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
  const GridStack = { init(options) {
    grid = {
      items: [], columns: options.column, frozen: true, destroyed: false,
      getColumn() { return this.columns; },
      makeWidget(wrapper, item) { wrapper.gridstackNode = { id: item.id }; this.items.push({ ...item }); },
      save() { return structuredClone(this.items); },
      update(wrapper, position) { Object.assign(this.items.find((item) => item.id === wrapper.gridstackNode.id), position); },
      setStatic(value) { this.frozen = value; },
      destroy() { this.destroyed = true; },
    };
    return grid;
  } };
  return {
    controller, GridStack, live, get grid() { return grid; }, get writes() { return writes; },
    delay() { release = {}; return release; },
    fail(message) { error = message; },
  };
}

test('page panel protects unsaved input, stale coordinates, cancel and verified save', async () => {
  const original = globalThis.document;
  globalThis.document = { createElement: (tag) => new Element(tag) };
  try {
    const f = fixture();
    const state = await f.controller.reload();
    const root = new Element('section');
    let closed = 0;
    const open = () => new Schema5PagePanel({
      GridStack: f.GridStack, root, controller: f.controller, pageId: 'a', token: state.token,
      browser: { confirm: () => true },
      onClose: (outcome) => { assert.equal(outcome.requiresReload, false); closed += 1; },
    });
    const panel = open();
    assert.equal(root.children[0].textContent, 'Seiteneinstellungen');
    const settings = root.children[3];
    assert.equal(settings.children[0].children[0].value, 'dark');
    assert.equal(settings.children[1].children[0].checked, true);
    assert.deepEqual(settings.children[2].children[0].children.map((option) => option.value), ['12', '24', '48', '96', '192']);
    assert.notEqual(settings.children[2].children[0].disabled, true);
    const form = root.children[5];
    const footer = root.children[6];
    const [cancel, save] = footer.children;
    assert.equal(save.textContent, 'Speichern');
    assert.equal(cancel.textContent, 'Abbrechen');
    const status = root.children[2];
    const select = form.children[0].children[0];
    const col = form.children[1].children[0];
    const row = form.children[2].children[0];
    const load = form.children[5];
    assert.equal(select.value, '__nav');
    select.value = 'text';
    select.fire('change');
    assert.equal(col.value, '1');
    assert.equal(row.value, '2');
    row.value = '4';
    row.fire('input');
    select.value = 'html';
    select.fire('change');
    assert.equal(select.value, 'text');
    await save.fire('click');
    assert.equal(f.writes, 0);
    assert.match(status.textContent, /zuerst übernehmen/);
    f.grid.items[1].y = 3;
    form.fire('submit');
    assert.match(status.textContent, /erneut laden/);
    assert.equal(f.grid.items[1].y, 3);
    load.fire('click');
    assert.equal(row.value, '4');
    row.value = '6';
    row.fire('input');
    form.fire('submit');
    assert.match(status.textContent, /noch nicht gespeichert/);
    assert.equal(f.grid.items[1].y, 5);
    cancel.fire('click');
    assert.equal(closed, 1);
    assert.equal(f.writes, 0);
    assert.equal(root.children.length, 0);
    assert.equal(f.grid.destroyed, true);
    panel.close();

    const next = open();
    const nextForm = root.children[5];
    nextForm.children[0].children[0].value = 'text';
    nextForm.children[0].children[0].fire('change');
    nextForm.children[2].children[0].value = '4';
    nextForm.children[2].children[0].fire('input');
    nextForm.fire('submit');
    // zusätzlich Theme wechseln: wird mitgespeichert
    root.children[3].children[0].children[0].value = 'light';
    const gate = f.delay();
    const saving = root.children[6].children[1].fire('click');
    assert.equal(root.children[6].children[0].disabled, true);
    assert.throws(() => next.close(), /läuft noch/);
    gate.resolve();
    await saving;
    assert.equal(f.writes, 1);
    const draft = f.controller.snapshot().draft;
    assert.equal(draft.pages[0].widgets[0].grid.row, 4);
    assert.equal(draft.pages[0].widgets[0].html, '{{Temp:state}}');
    assert.equal(draft.pages[0].widgets[1].html, '<span device="Temp" reading="state"></span>');
    assert.equal(draft.theme, 'light');
    assert.equal(closed, 2);
    assert.equal(root.children.length, 0);
  } finally {
    globalThis.document = original;
  }
});

test('raster selector previews all pages, protects pending input and cancel, and saves only a draft', async () => {
  const original = globalThis.document;
  globalThis.document = { createElement: (tag) => new Element(tag) };
  try {
    const f = fixture();
    const state = await f.controller.reload();
    const root = new Element('section');
    let closed = 0;
    const open = () => new Schema5PagePanel({
      GridStack: f.GridStack, root, controller: f.controller, pageId: 'a', token: state.token,
      browser: { confirm: () => true }, onClose: () => { closed += 1; },
    });
    open();
    const columns = root.children[3].children[2].children[0];
    const form = root.children[5];
    form.children[2].children[0].value = '3';
    form.children[2].children[0].fire('input');
    columns.value = '24';
    columns.fire('change');
    assert.equal(columns.value, '12', 'unapplied numeric input blocks changing the raster');
    form.children[5].fire('click');
    columns.value = '24';
    columns.fire('change');
    assert.equal(f.grid.getColumn(), 24);
    assert.equal(form.children[1].children[0].max, '24');
    assert.equal(form.children[3].children[0].max, '24');
    assert.equal(f.writes, 0);
    assert.equal(f.controller.snapshot().draft, null);
    root.children[6].children[0].fire('click');
    assert.equal(closed, 1);
    assert.equal(f.writes, 0, 'cancel leaves both live and draft unchanged');
    open();
    const nextColumns = root.children[3].children[2].children[0];
    for (const count of [48, 96, 192]) {
      nextColumns.value = String(count);
      nextColumns.fire('change');
      assert.equal(f.grid.getColumn(), count);
      assert.equal(root.children[5].children[1].children[0].max, String(count));
    }
    nextColumns.value = '36';
    nextColumns.fire('change');
    assert.equal(nextColumns.value, '192');
    assert.match(root.children[2].textContent, /Ungültige Rastergröße/);
    await root.children[6].children[1].fire('click');
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
      GridStack: f.GridStack, root, controller: f.controller, pageId: 'a', token: state.token,
      browser: { confirm: () => true }, onClose: (outcome) => { closed = outcome; },
    });
    root.children[3].children[0].children[0].value = 'light';
    await root.children[6].children[1].fire('click');
    assert.match(root.children[2].textContent, /Antwort verloren.*erneut laden/);
    assert.equal(root.children[5].inert, true);
    assert.equal(root.children[6].children[1].disabled, true);
    assert.equal(root.children[6].children[0].disabled, false);
    assert.throws(() => f.controller.snapshot(), /nicht geladen/);
    root.children[6].children[0].fire('click');
    assert.equal(closed.requiresReload, true);
    assert.equal(f.grid.destroyed, true);
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
    const panel = new Schema5PagePanel({ GridStack: f.GridStack, root, controller: f.controller,
      pageId: 'a', token: state.token, browser: { confirm: () => true }, onClose: () => { callbacks += 1; } });
    root.children[3].children[0].children[0].value = 'light';
    const gate = f.delay();
    f.fail('Antwort verloren');
    const saving = root.children[6].children[1].fire('click');
    panel.suspend();
    assert.equal(root.hidden, true);
    assert.equal(f.grid.destroyed, false);
    gate.resolve();
    await saving;
    assert.equal(f.grid.destroyed, true);
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
    const f = fixture();
    const controller = new Schema5DraftController({
      read: async () => invoke('read'),
      save: async (value, token) => invoke('save', Buffer.from(JSON.stringify(value)).toString('base64'), token),
      publish: async () => {},
      discard: async () => {},
    });
    const state = await controller.reload();
    const root = new Element('section');
    let closed;
    new Schema5PagePanel({ GridStack: f.GridStack, root, controller, pageId: 'a', token: state.token,
      browser: { confirm: () => true }, onClose: (outcome) => { closed = outcome; } });
    const form = root.children[5];
    form.children[0].children[0].value = 'text';
    form.children[0].children[0].fire('change');
    form.children[2].children[0].value = '4';
    form.children[2].children[0].fire('input');
    form.fire('submit');
    root.children[3].children[1].children[0].checked = false;
    const columns = root.children[3].children[2].children[0];
    columns.value = '192';
    columns.fire('change');
    await root.children[6].children[1].fire('click');
    assert.deepEqual(closed, { requiresReload: false });
    const draft = controller.snapshot().draft;
    assert.equal(draft.pages[0].widgets[0].grid.row, 49);
    assert.equal(draft.pages[0].widgets[0].html, '{{Temp:state}}');
    assert.equal(draft.pages[0].widgets[1].html, '<span device="Temp" reading="state"></span>');
    assert.equal(draft.settings.showFrames, false);
    assert.equal(draft.settings.gridColumns, 192);
    assert.equal(await readFile(join(dir, 'config.json'), 'utf8'), original);
    assert.equal(JSON.parse(await readFile(join(dir, 'draft.json'), 'utf8')).pages[0].widgets[0].grid.row, 49);
  } finally {
    globalThis.document = originalDocument;
    await rm(dir, { recursive: true });
  }
});
