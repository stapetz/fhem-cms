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
    this.style = {};
    this.value = '';
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null; }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  fire(name) { return this.listeners[name]({ preventDefault() {} }); }
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
    globalThis.window = { location: { href: 'https://example.test/fhem/' }, clearTimeout, setTimeout };
    globalThis.document = { createElement: (tag) => new Element(tag), documentElement: new Element('html') };
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
    const GridStack = { init() {
      return {
        items: [], getColumn() { return 12; },
        makeWidget(wrapper, item) { wrapper.gridstackNode = { id: item.id }; this.items.push({ ...item }); },
        save() { return structuredClone(this.items); }, destroy() {},
      };
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
    const [toolbar, status, content] = root.children;
    assert.equal(toolbar.children[1].textContent, 'Live');
    toolbar.children[8].fire('click');
    const form = content.children[0].children[2];
    form.children[0].children[0].value = 'light';
    await form.fire('submit');
    assert.equal(await readFile(livePath, 'utf8'), original);
    content.children[0].children[3].fire('click');
    await new Promise((resolve) => setTimeout(resolve, 0));
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
    toolbar.children[8].fire('click');
    const secondForm = content.children[0].children[2];
    secondForm.children[0].children[0].value = 'dark';
    await secondForm.fire('submit');
    content.children[0].children[3].fire('click');
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
  } finally {
    if (editor) editor.stop();
    Object.assign(globalThis, previous);
    await rm(rootDir, { recursive: true, force: true });
  }
});
