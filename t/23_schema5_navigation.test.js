import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Schema5DraftController } from '../www/fhem-cms/js/fcui-schema5-draft.js';
import { Schema5NavigationPanel } from '../www/fhem-cms/js/fcui-schema5-navigation.js';

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

test('navigation panel saves against real Perl, preserves positions and handles stale or pending changes', async () => {
  const previous = globalThis.document;
  globalThis.document = { createElement: () => new Element() };
  const dir = await mkdtemp(join(tmpdir(), 'cms-v5-nav-'));
  try {
    const config = {
      schemaVersion: 5, theme: 'dark', settings: { layoutMode: 'grid', gridColumns: 12 },
      navigation: { orientation: 'horizontal', grid: { col: 1, row: 1, w: 12, h: 1 },
        items: [{ page: 'two' }, { page: 'one', label: 'Start', width: '040' }] },
      pages: [{ id: 'one', title: 'Eins', widgets: [
        { id: 'text', type: 'text', html: '{{Temp:state}}', grid: { col: 1, row: 2, w: 4, h: 2 } },
      ] }, { id: 'two', title: 'Zwei', widgets: [] }],
    };
    const original = JSON.stringify(config, null, 2);
    const path = join(dir, 'config.json');
    await writeFile(path, original);
    const invoke = (operation, ...args) => {
      const child = spawnSync('perl', ['-e', perl, dir, operation, ...args], { encoding: 'utf8' });
      if (child.status !== 0) throw new Error(child.stderr);
      const reply = JSON.parse(child.stdout);
      if (reply.error) throw new Error(reply.error);
      return reply.result;
    };
    let gate = null;
    let writes = 0;
    const transport = {
      read: async () => invoke('read'),
      save: async (draft, token) => {
        writes += 1;
        if (gate) await new Promise((resolve) => { gate.resolve = resolve; });
        invoke('save', Buffer.from(JSON.stringify(draft)).toString('base64'), token);
      },
      publish: async () => {}, discard: async () => {},
    };
    const controller = new Schema5DraftController(transport);
    const other = new Schema5DraftController(transport);
    const state = await controller.reload();
    const stale = await other.reload();
    const root = new Element();
    let allowClose = false;
    let closed;
    new Schema5NavigationPanel({ root, controller, token: state.token,
      browser: { confirm: () => allowClose }, onClose: (outcome) => { closed = outcome; } });
    const [, , status, form, footer] = root.children;
    const [save, close] = footer.children;
    assert.equal(save.textContent, 'Speichern');
    assert.equal(close.textContent, 'Abbrechen');
    const orientation = form.children[0].children[0];
    const shared = form.children[1];
    const first = form.children[2];
    const label = first.children[1].children[0];
    const width = first.children[2].children[0];
    const height = first.children[3].children[0];
    orientation.value = 'vertical';
    label.value = 'Home';
    close.fire('click');
    assert.equal(closed, undefined);
    width.value = '39';
    await form.fire('submit');
    assert.match(status.textContent, /Breite/);
    assert.equal(writes, 0);
    width.value = '040';
    height.value = '60';
    await form.fire('submit');
    assert.deepEqual(closed, { requiresReload: false }, 'successful save closes the dialog');
    assert.equal(root.children.length, 0);
    closed = undefined;
    assert.equal(controller.snapshot().draft.navigation.orientation, 'vertical');
    assert.deepEqual(controller.snapshot().draft.navigation.grid, config.navigation.grid);
    assert.deepEqual(controller.snapshot().draft.navigation.items,
      [{ page: 'two' }, { page: 'one', label: 'Home', width: '040', height: 60 }]);
    assert.equal(await readFile(path, 'utf8'), original);
    assert.equal(controller.snapshot().draft.pages[0].widgets[0].html, '{{Temp:state}}');

    const staleRoot = new Element();
    let staleClosed;
    const stalePanel = new Schema5NavigationPanel({ root: staleRoot, controller: other, token: stale.token,
      browser: { confirm: () => true }, onClose: (value) => { staleClosed = value; } });
    await staleRoot.children[3].fire('submit');
    assert.match(staleRoot.children[2].textContent, /erneut laden/);
    assert.equal(staleRoot.children[3].inert, true);
    staleRoot.children[4].children[1].fire('click');
    assert.deepEqual(staleClosed, { requiresReload: true });

    // Gemeinsame Größe für alle Navigationspunkte: überstimmt individuelle Werte
    const sharedState = controller.snapshot();
    const sharedRoot = new Element();
    let sharedClosed;
    new Schema5NavigationPanel({ root: sharedRoot, controller, token: sharedState.token,
      browser: { confirm: () => true }, onClose: (outcome) => { sharedClosed = outcome; } });
    const sharedForm = sharedRoot.children[3];
    const sharedSet = sharedForm.children[1];
    sharedSet.children[1].children[0].checked = true;
    sharedSet.children[2].children[0].value = '120';
    sharedSet.children[3].children[0].value = '48';
    await sharedForm.fire('submit');
    assert.deepEqual(sharedClosed, { requiresReload: false });
    assert.equal(controller.snapshot().draft.navigation.itemWidth, 120);
    assert.equal(controller.snapshot().draft.navigation.itemHeight, 48);
    assert.deepEqual(controller.snapshot().draft.navigation.items,
      [{ page: 'two' }, { page: 'one', label: 'Home', width: '040', height: 60 }],
      'individual sizes stay stored');

    // Deaktivieren entfernt die gemeinsamen Werte wieder
    const offState = controller.snapshot();
    const offRoot = new Element();
    let offClosed;
    new Schema5NavigationPanel({ root: offRoot, controller, token: offState.token,
      browser: { confirm: () => true }, onClose: (outcome) => { offClosed = outcome; } });
    const offForm = offRoot.children[3];
    assert.equal(offForm.children[1].children[1].children[0].checked, true);
    offForm.children[1].children[1].children[0].checked = false;
    await offForm.fire('submit');
    assert.deepEqual(offClosed, { requiresReload: false });
    assert.equal(controller.snapshot().draft.navigation.itemWidth, undefined);
    assert.equal(controller.snapshot().draft.navigation.itemHeight, undefined);

    const latest = controller.snapshot();
    const root2 = new Element();
    const panel2 = new Schema5NavigationPanel({ root: root2, controller, token: latest.token,
      browser: { confirm: () => allowClose }, onClose: (outcome) => { closed = outcome; } });
    const form2 = root2.children[3];
    const close2 = root2.children[4].children[1];
    form2.children[2].children[1].children[0].value = 'Später';
    gate = {};
    const saving = form2.fire('submit');
    assert.equal(form2.inert, true);
    assert.equal(close2.disabled, true);
    panel2.suspend();
    assert.equal(root2.children.length, 0);
    gate.resolve();
    await saving;
    assert.equal(root2.children.length, 0);
    assert.equal(closed, undefined, 'suspended save never reports completion');
    assert.equal((await controller.reload()).draft.navigation.items[1].label, 'Später');
    assert.equal(await readFile(path, 'utf8'), original);
    assert.equal(writes, 5);
    stalePanel.close();
    allowClose = true;
  } finally {
    globalThis.document = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
