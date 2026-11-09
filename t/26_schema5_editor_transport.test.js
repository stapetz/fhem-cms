import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { FhemClient } from '../www/fhem-cms/js/fhem-client.js';
import { Schema5DraftController } from '../www/fhem-cms/js/fcui-schema5-draft.js';
import { createSchema5Transport } from '../www/fhem-cms/js/fcui-schema5-transport.js';

class Element {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.classList = { toggle() {} };
    this.style = { setProperty(name, value) { this[name] = value; } };
    this.value = '';
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  remove() { this.removed = true; }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null; }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(name, callback) { (this.listeners[name] ||= []).push(callback); }
  fire(name) {
    let result;
    for (const callback of this.listeners[name] || []) result = callback({ preventDefault() {} });
    return result;
  }
  showModal() { this.open = true; }
}

function toolbarControls(toolbar) {
  const all = (node) => [node, ...node.children.flatMap(all)];
  const nodes = all(toolbar);
  return [
    'Seiteneinstellungen', null, 'Entwurf veröffentlichen', 'Entwurf verwerfen',
    'Zustand erneut laden', 'Widget hinzufügen',
  ].map((label) => nodes.find((node) => label ? node.textContent === label : node.className === 'cms-editor-mode'));
}

const script = `
use strict;
use warnings;
use JSON::PP ();
use File::Spec;
our %attr;
sub Log3 {}
require './FHEM/01_FHEMCMS.pm';
my ($root, $operation, @args) = @ARGV;
$attr{global}{modpath} = $root;
my $dir = File::Spec->catdir($root, 'fhem-cms-data', 'CMS');
my ($value, $error);
if ($operation eq 'get') {
    $value = FHEMCMS_Get({NAME => 'CMS'}, 'CMS', @args);
} elsif ($operation eq 'contract') {
    $error = FHEMCMS_Version5DraftCommand($dir, @args);
} elsif ($operation eq 'public') {
    $error = FHEMCMS_Set({NAME => 'CMS'}, 'CMS', 'version5draft', @args);
} else { die 'unknown operation'; }
print JSON::PP->new->utf8->canonical->encode({value => $value, error => $error});
`;

test('editor and prepared FHEM transport preserve data, reject stale tabs and verify publish', async () => {
  const previous = {
    fetch: globalThis.fetch, window: globalThis.window, document: globalThis.document,
    HTMLElement: globalThis.HTMLElement, customElements: globalThis.customElements,
  };
  const rootDir = await mkdtemp(join(tmpdir(), 'cms-v5-editor-transport-'));
  const dataDir = join(rootDir, 'fhem-cms-data', 'CMS');
  const livePath = join(dataDir, 'config.json');
  const live = {
    schemaVersion: 5, theme: 'dark', settings: { layoutMode: 'grid', gridColumns: 12 },
    navigation: { orientation: 'horizontal', grid: { col: 1, row: 1, w: 12, h: 1 } },
    pages: [{ id: 'one', title: 'Eins', widgets: [
      { id: 'text', type: 'text', html: '{{Temp:state}}', grid: { col: 1, row: 2, w: 4, h: 2 } },
      { id: 'html', type: 'fhem-html', devices: ['Temp'],
        html: '<span device="Temp" reading="state"></span>', grid: { col: 5, row: 2, w: 4, h: 2 } },
    ] }],
  };
  const original = JSON.stringify(live, null, 2);
  const invoke = (operation, ...args) => {
    const child = spawnSync('perl', ['-e', script, rootDir, operation, ...args], { encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    return JSON.parse(child.stdout);
  };
  let editor;
  try {
    await mkdir(dataDir, { recursive: true });
    await writeFile(livePath, original);
    globalThis.window = {
      location: { href: 'https://example.test/fhem/' }, clearTimeout, setTimeout,
      addEventListener() {}, removeEventListener() {},
    };
    globalThis.document = {
      createElement: (tag) => new Element(tag), documentElement: new Element('html'), body: new Element('body'),
      addEventListener() {}, removeEventListener() {},
    };
    globalThis.HTMLElement = class {};
    const registry = new Map();
    globalThis.customElements = { define: (name, value) => registry.set(name, value), get: (name) => registry.get(name) };
    const commands = [];
    let failAfterWrite = false;
    globalThis.fetch = async (url, options) => {
      if (!options.method) return new Response('', { headers: { 'X-FHEM-csrfToken': 'test-token' } });
      assert.equal(options.credentials, 'same-origin');
      assert.equal(options.body.get('fwcsrf'), 'test-token');
      const command = options.body.get('cmd');
      commands.push(command);
      if (command.startsWith('jsonlist2 ')) return new Response('{"Results":[]}');
      const parts = command.split(' ');
      assert.equal(parts[1], 'CMS');
      if (parts[0] === 'get') {
        assert.equal(parts[2], 'version5state');
        return new Response(invoke('get', ...parts.slice(2)).value);
      }
      assert.deepEqual(parts.slice(0, 3), ['set', 'CMS', 'version5draft']);
      const reply = invoke('public', ...parts.slice(3));
      if (failAfterWrite && !reply.error) throw new Error('Antwort verloren');
      return new Response(reply.error || '');
    };
    const client = new FhemClient('CMS', 'https://example.test/fhem/');
    const other = new Schema5DraftController(createSchema5Transport(new FhemClient('CMS', 'https://example.test/fhem/')));
    const stale = await other.reload();
    const listeners = new Map();
    let confirm = false;
    const browser = {
      location: { hash: '#/one', reload() {} },
      confirm: () => confirm,
      addEventListener(name, handler) {
        if (!listeners.has(name)) listeners.set(name, new Set());
        listeners.get(name).add(handler);
      },
      removeEventListener(name, handler) { listeners.get(name)?.delete(handler); },
    };
    const grids = [];
    const GridStack = { init() {
      const grid = {
        items: [], getColumn() { return 12; },
        makeWidget(wrapper, item) { wrapper.gridstackNode = { id: item.id }; this.items.push({ ...item }); },
        save() { return structuredClone(this.items); }, destroy() {},
        setStatic(value) { this.static = value; },
        enableMove(value) { this.canMove = value; },
        enableResize(value) { this.canResize = value; },
        on(events, callback) { this.onStop = callback; },
      };
      grids.push(grid);
      return grid;
    } };
    const { createSchema5Editor } = await import('../www/fhem-cms/js/fcui-schema5-editor.js');
    const root = new Element('section');
    assert.throws(() => createSchema5Editor({
      GridStack, root, draftClient: client, liveClient: client, services: {}, browser,
    }), /Getrennte FHEM-Clients/);
    for (const otherClient of [
      new FhemClient('Andere', 'https://example.test/fhem/'),
      new FhemClient('CMS', 'https://other.example.test/fhem/'),
    ]) {
      assert.throws(() => createSchema5Editor({
        GridStack, root, draftClient: client, liveClient: otherClient, services: {}, browser,
      }), /dasselbe CMS-Device/);
    }
    editor = createSchema5Editor({
      GridStack, root, draftClient: client,
      liveClient: new FhemClient('CMS', 'https://example.test/fhem/'), browser,
    });
    await editor.start();
    const [, status, content] = root.children;
    const toolbar = { children: toolbarControls(root.children[0]) };
    assert.equal(toolbar.children[1].textContent, 'Live');
    toolbar.children[0].fire('click');
    const pagePanel = content.children[0];
    pagePanel.children[3].children[0].children[0].value = 'light';
    await pagePanel.children[4].children[1].fire('click');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(await readFile(livePath, 'utf8'), original);
    assert.equal(toolbar.children[1].textContent, 'Entwurf');
    assert.equal(document.documentElement.getAttribute('data-cms-theme'), 'light');
    await assert.rejects(other.saveDraft(stale.live, stale.token), /veraltet/);
    assert.throws(() => other.snapshot(), /nicht geladen/);
    const before = commands.length;
    await toolbar.children[2].fire('click');
    assert.equal(commands.length, before, 'cancelled confirmation never writes');
    confirm = true;
    failAfterWrite = true;
    await toolbar.children[2].fire('click');
    assert.match(status.textContent, /Antwort verloren/);
    assert.equal(toolbar.children[4].hidden, false);
    assert.equal(toolbar.children[2].disabled, true);
    failAfterWrite = false;
    await toolbar.children[4].fire('click');
    assert.equal(toolbar.children[1].textContent, 'Live');
    const current = JSON.parse(await readFile(livePath, 'utf8'));
    assert.equal(current.theme, 'light');
    assert.deepEqual(current.pages, live.pages);
    const backup = (await readdir(dataDir)).find((name) => name.endsWith('.bak'));
    assert.ok(backup);
    assert.equal(await readFile(join(dataDir, backup), 'utf8'), original);
    toolbar.children[0].fire('click');
    const secondPanel = content.children[0];
    secondPanel.children[3].children[0].children[0].value = 'dark';
    await secondPanel.children[4].children[1].fire('click');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(toolbar.children[1].textContent, 'Entwurf');
    assert.equal(document.documentElement.getAttribute('data-cms-theme'), 'dark');
    assert.deepEqual(JSON.parse(await readFile(livePath, 'utf8')), current);

    await toolbar.children[3].fire('click');
    assert.equal(toolbar.children[1].textContent, 'Live');
    assert.equal(document.documentElement.getAttribute('data-cms-theme'), 'light');
    assert.deepEqual(JSON.parse(await readFile(livePath, 'utf8')), current);
    assert.equal((await readdir(dataDir)).includes('draft.json'), false);
    assert.match(invoke('public', 'discard', 'a'.repeat(64)).error, /veraltet/);

    const dragGrid = grids.at(-1);
    assert.equal(dragGrid.static, false);
    dragGrid.items.find((item) => item.id === 'text').y = 4;
    dragGrid.onStop();
    assert.equal(content.children[0].inert, true, 'saving locks pointer edits synchronously');
    assert.equal(toolbar.children[0].disabled, true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const moved = JSON.parse(await readFile(join(dataDir, 'draft.json'), 'utf8'));
    assert.equal(moved.pages[0].widgets[0].grid.row, 5);
    assert.deepEqual(JSON.parse(await readFile(livePath, 'utf8')), current);
    const resizeGrid = grids.at(-1);
    resizeGrid.items.find((item) => item.id === 'text').h = 3;
    resizeGrid.onStop();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const resized = JSON.parse(await readFile(join(dataDir, 'draft.json'), 'utf8'));
    assert.equal(resized.pages[0].widgets[0].grid.h, 3);
    assert.equal(resized.pages[0].widgets[0].html, '{{Temp:state}}');
    assert.equal(resized.pages[0].widgets[1].html, '<span device="Temp" reading="state"></span>');
    assert.deepEqual(JSON.parse(await readFile(livePath, 'utf8')), current);

    const noChange = commands.filter((command) => command.startsWith('set ')).length;
    grids.at(-1).onStop();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(commands.filter((command) => command.startsWith('set ')).length, noChange,
      'a grip click without geometry change does not write');
    const draftBytes = await readFile(join(dataDir, 'draft.json'), 'utf8');
    grids.at(-1).items.find((item) => item.id === '__nav').y = 4;
    grids.at(-1).onStop();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.match(status.textContent, /Position nicht übernommen.*überschneidung/);
    assert.equal(toolbar.children[0].disabled, false, 'invalid geometry restores a usable editor');
    assert.equal(await readFile(join(dataDir, 'draft.json'), 'utf8'), draftBytes);

    failAfterWrite = true;
    grids.at(-1).items.find((item) => item.id === 'text').y = 7;
    grids.at(-1).onStop();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.match(status.textContent, /Antwort verloren/);
    assert.equal(toolbar.children[0].disabled, true);
    assert.deepEqual(JSON.parse(await readFile(livePath, 'utf8')), current);
    failAfterWrite = false;
    await toolbar.children[4].fire('click');
    const beforeHide = commands.length;
    grids.at(-1).items.find((item) => item.id === 'text').y = 10;
    grids.at(-1).onStop();
    for (const handler of [...listeners.get('pagehide')]) handler({});
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(commands.length, beforeHide, 'pagehide before deferred pointer completion prevents a write');
  } finally {
    if (editor) editor.stop();
    Object.assign(globalThis, previous);
    await rm(rootDir, { recursive: true, force: true });
  }
});
