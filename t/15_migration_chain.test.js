import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { FhemClient } from '../www/fhem-cms/js/fhem-client.js';
import { migrationPositions } from '../fcui/layout-migration.js';
import { schema5GridItems } from '../www/fhem-cms/js/fcui-schema5-layout.js';

const script = `
use strict;
use warnings;
use JSON::PP ();
use MIME::Base64 qw(decode_base64);
use File::Spec;
our %attr;
sub Log3 {}
sub CommandAttr { return undef }
require "./FHEM/01_FHEMCMS.pm";
my ($root, $operation, @args) = @ARGV;
$attr{global}{modpath} = $root;
my $dir = File::Spec->catdir($root, 'fhem-cms-data', 'CMS');
my $hash = {NAME => 'CMS'};
my $json = JSON::PP->new->utf8->canonical;
my ($value, $error);
if ($operation eq 'get') {
    $value = FHEMCMS_Get($hash, 'CMS', @args);
} elsif ($operation eq 'set') {
    $error = FHEMCMS_Set($hash, 'CMS', @args);
} elsif ($operation eq 'restart') {
    $error = FHEMCMS_Define($hash, 'CMS FHEMCMS');
} elsif ($operation eq 'migrate') {
    my $plan = $json->decode(decode_base64($args[0]));
    ($value, $error) = FHEMCMS_CommitLayoutMigration($dir, $plan, $args[1]);
} elsif ($operation eq 'draft') {
    my $config = $json->decode(decode_base64($args[0]));
    $error = FHEMCMS_WriteVersion5Draft($dir, $config, $args[1]);
} elsif ($operation eq 'publish') {
    ($value, $error) = FHEMCMS_PublishVersion5Draft($dir, $args[0]);
} elsif ($operation eq 'restore') {
    ($value, $error) = FHEMCMS_CommitMigrationRestore($dir, $args[0], $args[1]);
} else {
    die "Unsupported test operation";
}
print $json->encode({value => $value, error => $error});
`;

test('isolated migration, restart, versioned draft and restore form one protected chain', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fhem-cms-chain-'));
  const dir = join(root, 'fhem-cms-data', 'CMS');
  const livePath = join(dir, 'config.json');
  const draftPath = join(dir, 'draft.json');
  const mediaDir = join(root, 'www', 'fhem-cms', 'CMS', 'media');
  const mediaName = '0123456789abcdef0123456789abcdef.png';
  const previous = {
    fetch: globalThis.fetch, window: globalThis.window, document: globalThis.document,
    HTMLElement: globalThis.HTMLElement, customElements: globalThis.customElements,
  };
  class Element {
    constructor(tag) {
      this.tag = tag;
      this.children = [];
      this.attributes = {};
      this.style = { setProperty(name, value) { this[name] = value; } };
      this.classList = { toggle() {} };
    }
    append(child) { this.children.push(child); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(name, value) { this.attributes[name] = value; }
    removeAttribute(name) { delete this.attributes[name]; }
    toggleAttribute(name) {
      if (name in this.attributes) { delete this.attributes[name]; return false; }
      this.attributes[name] = ''; return true;
    }
    addEventListener() {}
  }
  const legacy = {
    schemaVersion: 4, theme: 'light', settings: { layoutMode: 'grid', gridColumns: 12 },
    navigation: { orientation: 'horizontal', grid: { col: 1, row: 1, w: 48, h: 1 } },
    pages: [
      { id: 'one', title: 'Erste', widgets: [
        { id: 'text', type: 'text', html: `<p>{{Temp:state}}</p><img src="media/${mediaName}">`,
          grid: { col: 1, row: 2, w: 8, h: 2 } },
        { id: 'html', type: 'fhem-html', devices: ['Temp'],
          html: '<span device="Temp" reading="state"></span>',
          grid: { col: 9, row: 2, w: 8, h: 2 } },
      ] },
      { id: 'two', title: 'Zweite', widgets: [
        { id: 'value', type: 'fhem-value', device: 'Temp', reading: 'state',
          grid: { col: 1, row: 2, w: 4, h: 1 } },
      ] },
    ],
  };
  const original = `${JSON.stringify(legacy, null, 2)}\n`;
  const media = Buffer.from('synthetic media bytes');
  const encoded = (data) => Buffer.from(JSON.stringify(data)).toString('base64');
  const invoke = (operation, ...args) => {
    const result = spawnSync('perl', ['-e', script, root, operation, ...args], { encoding: 'utf8' });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  const commands = [];
  try {
    await mkdir(dir, { recursive: true });
    await mkdir(mediaDir, { recursive: true });
    await writeFile(livePath, original);
    await writeFile(join(mediaDir, mediaName), media);
    globalThis.fetch = async (url, options) => {
      if (!options.method) return new Response('', { headers: { 'X-FHEM-csrfToken': 'test-token' } });
      assert.equal(options.body.get('fwcsrf'), 'test-token');
      const command = options.body.get('cmd');
      commands.push(command);
      if (command === 'jsonlist2 Temp,device=Temp') {
        return new Response(JSON.stringify({ Results: [
          { Name: 'Temp', Readings: { state: { Value: 'Testwert' } } },
        ] }));
      }
      const parts = command.split(' ');
      assert.deepEqual(parts.slice(0, 2), ['get', 'CMS']);
      assert.ok(['layoutformat', 'migrationstate', 'migrationpreview', 'version5state', 'migrationrestorepreview'].includes(parts[2]));
      return new Response(invoke('get', ...parts.slice(2)).value);
    };
    const client = new FhemClient('CMS', 'https://example.test/fhem/');
    assert.equal(await client.getLayoutFormat(), 4);
    const source = await client.getMigrationSource();
    const positions = migrationPositions(source);
    const preview = await client.previewMigration(positions);
    assert.deepEqual(preview.source, legacy);
    assert.equal(await readFile(livePath, 'utf8'), original);
    const changedPlan = structuredClone(positions);
    changedPlan.pages[1].widgets[0].grid.col = 2;
    assert.match(invoke('migrate', encoded(changedPlan), preview.token).error, /veraltet/);
    assert.equal(await readFile(livePath, 'utf8'), original);
    assert.deepEqual(await readdir(dir), ['config.json']);
    const migrated = invoke('migrate', encoded(positions), preview.token);
    assert.equal(migrated.error, null);
    assert.equal(await readFile(join(dir, migrated.value), 'utf8'), original);
    assert.match(invoke('migrate', encoded(positions), preview.token).error, /schemaVersion/);
    const version5Bytes = await readFile(livePath, 'utf8');
    assert.equal(invoke('restart').error, null, 'device restarts without replacing schema 5');
    assert.equal(await readFile(livePath, 'utf8'), version5Bytes);
    assert.equal(await client.getLayoutFormat(), 5);
    assert.match(invoke('get', 'config').value, /schemaVersion/);
    for (const command of ['publish', 'discard']) {
      assert.match(invoke('set', command).error, /schemaVersion/);
    }
    assert.match(invoke('set', 'draft', encoded(legacy)).error, /schemaVersion/);
    assert.equal(await readFile(livePath, 'utf8'), version5Bytes);
    const state = await client.getVersion5State();
    assert.deepEqual(state.live, preview.config);
    assert.equal(state.draft, null);
    assert.deepEqual(state.live.pages.map((page) => page.id), ['one', 'two']);
    assert.match(state.live.pages[0].widgets[0].html, /\{\{Temp:state\}\}/);
    assert.match(state.live.pages[0].widgets[1].html, /device="Temp" reading="state"/);
    for (const page of state.live.pages) assert.equal(schema5GridItems(state.live, page.id).length, page.widgets.length + 1);
    globalThis.window = { location: { href: 'https://example.test/fhem/' }, clearTimeout };
    globalThis.document = { createElement: (tag) => new Element(tag) };
    globalThis.HTMLElement = class {};
    const registry = new Map();
    globalThis.customElements = {
      define(name, element) { registry.set(name, element); },
      get(name) { return registry.get(name); },
    };
    const { Schema5View } = await import('../www/fhem-cms/js/fcui-schema5-view.js');
    const browser = { location: { hash: '#/one' }, addEventListener() {}, removeEventListener() {} };
    const GridStack = { init() {
      return {
        items: [],
        getColumn() { return 12; },
        makeWidget(wrapper, item) { this.items.push({ ...item }); },
        save() { return this.items; },
        destroy() {},
      };
    } };
    const checkView = async (config, secondTitle) => {
      const grid = new Element('grid');
      const view = new Schema5View({
        GridStack, root: grid, status: new Element('status'), config, client, services: {}, browser,
      });
      try {
        await view.start();
        const nav = grid.children[0].children[0].children[0];
        const text = grid.children[1].children[0].children[0];
        const html = grid.children[2].children[0].children[0];
        assert.equal(nav.children[2].textContent, secondTitle);
        assert.equal(text.config.html, legacy.pages[0].widgets[0].html);
        assert.equal(html.config.html, legacy.pages[0].widgets[1].html);
        assert.equal(text.data.get('Temp')[0].readings.state, 'Testwert');
        assert.equal(html.data.get('Temp')[0].readings.state, 'Testwert');
      } finally {
        view.stop();
      }
    };
    await checkView(state.live, 'Zweite');
    const draft = structuredClone(state.live);
    draft.pages[1].title = 'Bearbeitet';
    assert.equal(invoke('draft', encoded(draft), state.token).error, null);
    const withDraft = await client.getVersion5State();
    assert.deepEqual(withDraft.live, state.live);
    assert.deepEqual(withDraft.draft, draft);
    await checkView(withDraft.draft, 'Bearbeitet');
    assert.match(invoke('draft', encoded(state.live), state.token).error, /veraltet/);
    assert.match(invoke('publish', state.token).error, /veraltet/);
    assert.equal(await readFile(livePath, 'utf8'), version5Bytes);
    const draftBytes = await readFile(draftPath, 'utf8');
    await assert.rejects(client.previewMigrationRestore(migrated.value), /Entwurf vorhanden/);
    assert.equal(await readFile(draftPath, 'utf8'), draftBytes);
    const published = invoke('publish', withDraft.token);
    assert.equal(published.error, null);
    assert.equal(await readFile(join(dir, published.value), 'utf8'), version5Bytes);
    assert.equal(await readFile(livePath, 'utf8'), draftBytes);
    const afterPublish = await client.getVersion5State();
    assert.equal(afterPublish.draft, null);
    assert.deepEqual(afterPublish.live, draft);
    let restorePreview = await client.previewMigrationRestore(migrated.value);
    assert.deepEqual(restorePreview.live, draft);
    assert.deepEqual(restorePreview.backup, legacy);
    const backupPath = join(dir, migrated.value);
    await writeFile(backupPath, `${original}\n`);
    assert.match(invoke('restore', migrated.value, restorePreview.token).error, /veraltet/);
    assert.equal(await readFile(livePath, 'utf8'), draftBytes);
    await writeFile(backupPath, original);
    restorePreview = await client.previewMigrationRestore(migrated.value);
    const restored = invoke('restore', migrated.value, restorePreview.token);
    assert.equal(restored.error, null);
    assert.equal(await readFile(join(dir, restored.value), 'utf8'), draftBytes);
    assert.equal(await readFile(livePath, 'utf8'), original);
    assert.match(invoke('draft', encoded(draft), afterPublish.token).error, /config\.json:/);
    assert.equal(invoke('restart').error, null);
    assert.equal(await readFile(livePath, 'utf8'), original);
    assert.equal(await client.getLayoutFormat(), 4);
    assert.deepEqual(await client.getMigrationSource(), legacy);
    assert.deepEqual(await readFile(join(mediaDir, mediaName)), media);
    assert.deepEqual(await readdir(mediaDir), [mediaName]);
    assert.ok(commands.every((command) => command.startsWith('get ') || command.startsWith('jsonlist2 ')));
  } finally {
    globalThis.fetch = previous.fetch;
    globalThis.window = previous.window;
    globalThis.document = previous.document;
    globalThis.HTMLElement = previous.HTMLElement;
    globalThis.customElements = previous.customElements;
    await rm(root, { recursive: true });
  }
});
