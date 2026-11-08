import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Schema5DraftController } from '../www/fhem-cms/js/fcui-schema5-draft.js';
import { Schema5SettingsPanel } from '../www/fhem-cms/js/fcui-schema5-settings.js';

class Element {
  constructor() { this.children = []; this.listeners = {}; this.value = ''; this.attributes = {}; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this.attributes[name] = value; }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  fire(name) { return this.listeners[name]?.({ preventDefault() {} }); }
}

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
} else { die 'unknown operation'; }
print JSON::PP->new->utf8->canonical->encode({result => $result, error => $error});
`;

test('settings preserve live bytes, values and placeholders through real draft transactions', async () => {
  const previous = globalThis.document;
  globalThis.document = { createElement: () => new Element() };
  const dir = await mkdtemp(join(tmpdir(), 'cms-v5-settings-'));
  try {
    const config = {
      schemaVersion: 5, settings: { layoutMode: 'grid', gridColumns: 12 },
      navigation: { orientation: 'horizontal', grid: { col: 1, row: 1, w: 12, h: 1 } },
      pages: [{ id: 'one', title: 'Eins', widgets: [
        { id: 'text', type: 'text', html: '{{Temp:state}}', grid: { col: 1, row: 2, w: 4, h: 2 } },
        { id: 'html', type: 'fhem-html', html: '<span device="Temp" reading="state"></span>',
          devices: ['Temp'], grid: { col: 5, row: 2, w: 4, h: 2 } },
      ] }],
    };
    const original = JSON.stringify(config, null, 2);
    const path = join(dir, 'config.json');
    await writeFile(path, original);
    const invoke = (operation, ...args) => {
      const child = spawnSync('perl', ['-e', perl, dir, operation, ...args], { encoding: 'utf8' });
      if (child.status !== 0) throw new Error(child.stderr);
      const { result, error } = JSON.parse(child.stdout);
      if (error) throw new Error(error);
      return result;
    };
    let gate;
    const transport = {
      read: async () => invoke('read'),
      save: async (draft, token) => {
        if (gate) await new Promise((resolve) => { gate.resolve = resolve; });
        invoke('save', Buffer.from(JSON.stringify(draft)).toString('base64'), token);
      },
      publish: async () => {}, discard: async () => {},
    };
    const controller = new Schema5DraftController(transport);
    const other = new Schema5DraftController(transport);
    const state = await controller.reload();
    const stale = await other.reload();
    let closed;
    const root = new Element();
    const panel = new Schema5SettingsPanel({ root, controller, token: state.token,
      browser: { confirm: () => false }, onClose: (value) => { closed = value; } });
    const [, status, form, close] = root.children;
    const theme = form.children[0].children[0];
    const frames = form.children[1].children[0];
    assert.equal(theme.value, 'dark');
    assert.equal(frames.checked, true);
    await form.fire('submit');
    assert.deepEqual(controller.snapshot().draft, config, 'unchanged optional defaults are not written into the configuration');
    theme.value = 'light';
    frames.checked = false;
    close.fire('click');
    assert.equal(closed, undefined);
    await form.fire('submit');
    const saved = controller.snapshot();
    assert.equal(saved.draft.theme, 'light');
    assert.equal(saved.draft.settings.showFrames, false);
    assert.deepEqual(saved.draft.pages, config.pages);
    assert.deepEqual(saved.draft.navigation, config.navigation);
    assert.equal(await readFile(path, 'utf8'), original);
    assert.match(status.textContent, /Entwurf gespeichert/);

    const staleRoot = new Element();
    let staleClosed;
    const stalePanel = new Schema5SettingsPanel({ root: staleRoot, controller: other, token: stale.token,
      browser: { confirm: () => true }, onClose: (value) => { staleClosed = value; } });
    await staleRoot.children[2].fire('submit');
    assert.match(staleRoot.children[1].textContent, /erneut laden/);
    assert.equal(staleRoot.children[2].inert, true);
    staleRoot.children[3].fire('click');
    assert.deepEqual(staleClosed, { requiresReload: true });

    theme.value = 'dark';
    gate = {};
    const pending = form.fire('submit');
    assert.equal(form.inert, true);
    assert.equal(close.disabled, true);
    panel.suspend();
    gate.resolve();
    await pending;
    assert.equal(root.children.length, 0);
    assert.equal(closed, undefined);
    assert.equal((await controller.reload()).draft.theme, 'dark');
    assert.equal(await readFile(path, 'utf8'), original);
    stalePanel.close();
  } finally {
    globalThis.document = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
