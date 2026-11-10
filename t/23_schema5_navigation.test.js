import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Schema5DraftController } from '../www/fhem-cms/js/fcui-schema5-draft.js';
import { Schema5NavigationPanel } from '../www/fhem-cms/js/fcui-schema5-navigation.js';

class Element {
  constructor(tag) {
    this.tag = tag; this.children = []; this.listeners = {}; this.value = ''; this.attributes = {};
    this.checked = false;
  }
  append(...children) {
    this.children.push(...children);
    if (this.tag === 'select' && !this.value && this.children.length) this.value = this.children[0].value;
  }
  prepend(...children) { this.children.unshift(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this.attributes[name] = value; }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  fire(name, event = {}) { return this.listeners[name]?.({ preventDefault() {}, ...event }); }
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

test('navigation panel manages pages, order, shared sizes and files against real Perl', async () => {
  const previous = globalThis.document;
  globalThis.document = { createElement: (tag) => new Element(tag) };
  const dir = await mkdtemp(join(tmpdir(), 'cms-v5-nav-'));
  try {
    const config = {
      schemaVersion: 5, theme: 'dark', settings: { layoutMode: 'grid', gridColumns: 12 },
      navigation: { orientation: 'horizontal', grid: { col: 1, row: 1, w: 12, h: 1 },
        items: [{ page: 'one', label: 'Start', width: 40 }] },
      pages: [{ id: 'one', title: 'Eins', widgets: [
        { id: 'text', type: 'text', html: '{{Temp:state}}', grid: { col: 1, row: 2, w: 4, h: 2 } },
        { id: 'links', type: 'fhem-link', grid: { col: 5, row: 2, w: 6, h: 4 }, links: [
          { id: 'target', kind: 'internal', page: 'two', text: 'Zweite Seite', target: 'self',
            showText: true, textPosition: 'above', grid: { col: 1, row: 1, w: 4, h: 3 } },
        ] },
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
    const state = await controller.reload();

    const root = new Element('section');
    let allowClose = false;
    let closed;
    new Schema5NavigationPanel({ root, controller, token: state.token,
      browser: { confirm: () => allowClose }, onClose: (outcome) => { closed = outcome; } });
    const [, , status, form, footer] = root.children;
    const [close, save] = footer.children;
    assert.equal(save.textContent, 'Speichern');
    assert.equal(close.textContent, 'Abbrechen');
    const orientation = form.children[0].children[0];
    const shared = form.children[1];
    const rows = () => form.children[2].children.slice(1);
    const add = form.children[3];

    // Zeile eins: Griff, Dateiname, Titel, Beschriftung, Breite, Höhe, Löschen
    const row0 = rows()[0];
    assert.equal(row0.children[0].textContent, '≡');
    assert.equal(row0.children[1].children[0].value, 'one');
    assert.equal(row0.children[2].children[0].value, 'Eins');
    assert.equal(row0.children[3].children[0].value, 'Start');
    assert.equal(row0.children[4].children[0].value, '40');
    assert.equal(row0.children[7].disabled, true, 'page with widgets cannot be deleted');
    assert.equal(rows()[1].children[7].disabled, false);

    // Abbrechen mit Änderungen erfordert Bestätigung
    orientation.value = 'vertical';
    const label0 = row0.children[3].children[0];
    label0.value = 'Home';
    label0.fire('input');
    close.fire('click');
    assert.equal(closed, undefined);

    // Reihenfolge per Pfeiltaste am Griff
    rows()[1].children[0].fire('keydown', { key: 'ArrowUp' });
    assert.equal(rows()[0].children[1].children[0].value, 'two');

    // Dateiname umbenennen und neue Seite erstellen (lokal, kein Schreibzugriff)
    rows()[0].children[1].children[0].value = 'zweite-seite';
    rows()[0].children[1].children[0].fire('input');
    add.children[0].children[0].value = 'Dritte';
    add.children[1].children[0].value = 'bad name';
    add.children[2].fire('click');
    assert.match(status.textContent, /Ungültiger Dateiname/);
    add.children[1].children[0].value = '';
    add.children[2].fire('click');
    assert.equal(rows().length, 3);
    assert.equal(writes, 0, 'all edits stay local until saving');

    // Anzeigen-Flag: Punkt verstecken (Parkplatz)
    const showBox = rows()[1].children[6].children[0];
    assert.equal(showBox.checked, true, 'Anzeigen ist standardmäßig aktiv');
    showBox.checked = false;
    showBox.fire('change');

    // Ungültige gemeinsame Größe wird abgewiesen
    shared.children[1].children[0].checked = true;
    shared.children[2].children[0].value = '39';
    await save.fire('click');
    assert.match(status.textContent, /gemeinsame Breite/);
    assert.equal(writes, 0);
    shared.children[2].children[0].value = '120';

    // Speichern schreibt genau einmal und schließt
    await save.fire('click');
    assert.equal(writes, 1);
    assert.deepEqual(closed, { requiresReload: false });
    assert.equal(root.children.length, 0);
    const draft = controller.snapshot().draft;
    assert.deepEqual(draft.pages.map((page) => page.id), ['zweite-seite', 'one', 'page1']);
    assert.equal(draft.pages[2].title, 'Dritte');
    assert.equal(draft.navigation.orientation, 'vertical');
    assert.equal(draft.navigation.itemWidth, 120);
    assert.deepEqual(draft.navigation.items,
      [{ page: 'one', label: 'Home', width: 40, hidden: true }]);
    assert.equal(draft.pages[1].widgets[0].html, '{{Temp:state}}');
    assert.equal(draft.pages[1].widgets[1].links[0].page, 'zweite-seite',
      'internal LinkWidget references follow page ID renames in the same transaction');
    assert.equal(await readFile(path, 'utf8'), original);

    // Gemeinsame Größe deaktivieren entfernt sie; leere Seite löschen
    const second = controller.snapshot();
    const root2 = new Element('section');
    let closed2;
    new Schema5NavigationPanel({ root: root2, controller, token: second.token,
      browser: { confirm: () => true }, onClose: (outcome) => { closed2 = outcome; } });
    const form2 = root2.children[3];
    form2.children[1].children[1].children[0].checked = false;
    form2.children[2].children[3].children[7].fire('click');
    await root2.children[4].children[1].fire('click');
    assert.deepEqual(closed2, { requiresReload: false });
    const draft2 = controller.snapshot().draft;
    assert.equal(draft2.navigation.itemWidth, undefined);
    assert.deepEqual(draft2.pages.map((page) => page.id), ['zweite-seite', 'one']);
    const beforeDelete = controller.snapshot();
    assert.throws(() => controller.deleteEmptyPage('zweite-seite', beforeDelete.token), /CMS-Seite/);
    assert.deepEqual(controller.snapshot(), beforeDelete, 'linked target deletion is refused without a write');

    // Veralteter Tab wird abgewiesen
    const other = new Schema5DraftController(transport);
    const stale = await other.reload();
    const staleRoot = new Element('section');
    let staleClosed;
    new Schema5NavigationPanel({ root: staleRoot, controller: other, token: stale.token,
      browser: { confirm: () => true }, onClose: (outcome) => { staleClosed = outcome; } });
    const mid = controller.snapshot();
    const changedDraft = structuredClone(mid.draft);
    changedDraft.pages[0].title = 'Konflikt';
    await controller.saveDraft(changedDraft, mid.token);
    staleRoot.children[3].children[0].children[0].value = 'horizontal';
    await staleRoot.children[4].children[1].fire('click');
    assert.match(staleRoot.children[2].textContent, /nicht bestätigt/);
    assert.equal(staleRoot.children[3].inert, true);
    staleRoot.children[4].children[0].fire('click');
    assert.deepEqual(staleClosed, { requiresReload: true });

    // Unterbrechung während eines laufenden Speicherns schließt still
    const fresh = await controller.reload();
    const root3 = new Element('section');
    let late = false;
    const pending = new Schema5NavigationPanel({ root: root3, controller, token: fresh.token,
      browser: { confirm: () => true }, onClose: () => { late = true; } });
    const title3 = root3.children[3].children[2].children[1].children[2].children[0];
    title3.value = 'Später';
    title3.fire('input');
    gate = {};
    const saving = root3.children[4].children[1].fire('click');
    assert.equal(root3.children[4].children[0].disabled, true);
    pending.suspend();
    assert.equal(root3.children.length, 0);
    gate.resolve();
    await saving;
    assert.equal(late, false);
    assert.equal((await controller.reload()).draft.pages[0].title, 'Später');
    assert.equal(await readFile(path, 'utf8'), original);
  } finally {
    globalThis.document = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
