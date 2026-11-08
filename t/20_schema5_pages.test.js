import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Schema5DraftController } from '../www/fhem-cms/js/fcui-schema5-draft.js';
import { Schema5PagesPanel } from '../www/fhem-cms/js/fcui-schema5-pages.js';

class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.listeners = {}; this.value = ''; this.attributes = {}; }
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
} else {
    die 'unknown operation';
}
print JSON::PP->new->utf8->canonical->encode({result => $result, error => $error});
`;

test('page management collects changes locally and saves them once through real Perl', async () => {
  const previous = globalThis.document;
  const dir = await mkdtemp(join(tmpdir(), 'cms-v5-pages-panel-'));
  globalThis.document = { createElement: (tag) => new Element(tag) };
  const original = JSON.stringify({
    schemaVersion: 5, theme: 'dark', settings: { layoutMode: 'grid', gridColumns: 12 },
    navigation: { orientation: 'horizontal', grid: { col: 1, row: 1, w: 12, h: 1 } },
    pages: [{ id: 'start', title: 'Start', widgets: [
      { id: 'text', type: 'text', html: '{{Temp:state}}', grid: { col: 1, row: 2, w: 4, h: 2 } },
      { id: 'html', type: 'fhem-html', devices: ['Temp'], html: '<span device="Temp" reading="state"></span>',
        grid: { col: 5, row: 2, w: 4, h: 2 } },
    ] }],
  }, null, 2);
  const invoke = (operation, ...args) => {
    const process = spawnSync('perl', ['-e', script, dir, operation, ...args], { encoding: 'utf8' });
    assert.equal(process.error, undefined);
    assert.equal(process.status, 0, process.stderr);
    const { result, error } = JSON.parse(process.stdout);
    if (error) throw new Error(error);
    return result;
  };
  let gate;
  let writes = 0;
  const transport = {
    read: async () => invoke('read'),
    save: async (value, token) => {
      writes += 1;
      if (gate) await new Promise((resolve) => { gate.resolve = resolve; });
      invoke('save', Buffer.from(JSON.stringify(value)).toString('base64'), token);
    },
    publish: async () => {}, discard: async () => {},
  };
  let confirm = false;
  const browser = { confirm: () => confirm };
  let closed;
  try {
    await writeFile(join(dir, 'config.json'), original);
    const controller = new Schema5DraftController(transport);
    const state = await controller.reload();
    const root = new Element('section');
    new Schema5PagesPanel({ root, controller, token: state.token, browser,
      onClose: (outcome) => { closed = outcome; } });
    const status = root.children[2];
    const controls = root.children[3];
    const footer = root.children[4];
    const [save, close] = footer.children;
    assert.equal(save.textContent, 'Speichern');
    assert.equal(close.textContent, 'Abbrechen');
    let list = () => root.children[3].children[0];
    let row = (index) => list().children[index];
    assert.equal(row(0).children[4].disabled, true, 'nonempty last page cannot be deleted');

    // Seite lokal anlegen: kein Schreibzugriff, Entwurf bleibt leer
    const create = controls.children[1];
    create.children[0].children[0].value = 'bad id!';
    create.children[1].children[0].value = 'Zweite';
    await create.fire('submit');
    assert.match(status.textContent, /Ungültiger Dateiname/);
    assert.equal(writes, 0);
    const createAgain = root.children[3].children[1];
    createAgain.children[0].children[0].value = 'second';
    createAgain.children[1].children[0].value = 'Zweite';
    await createAgain.fire('submit');
    assert.equal(writes, 0, 'adding a page is collected locally');
    assert.equal(controller.snapshot().draft, null);
    assert.match(root.children[2].textContent, /Noch nicht gespeicherte/);

    // Abbrechen mit offenen Änderungen erfordert Bestätigung
    confirm = false;
    close.fire('click');
    assert.equal(closed, undefined, 'cancelled close keeps local changes');

    // Titel ändern, Reihenfolge tauschen, Widget verschieben – alles lokal
    row(0).children[0].children[0].value = 'Haupt';
    row(0).children[0].children[0].fire('input');
    await row(1).children[2].fire('click');
    assert.equal(writes, 0);
    assert.equal(row(0).children[0].children[0].value, 'Zweite');
    const moves = row(1).children[5];
    const moveForm = moves.children[1];
    await moveForm.fire('submit');
    assert.equal(writes, 0);
    assert.equal(row(0).children[4].disabled, true, 'page with a widget cannot be deleted');

    // Dateiname umbenennen: ungültig wird abgewiesen, gültig lokal übernommen
    const fileInput = row(0).children[1].children[0];
    fileInput.value = 'böse id';
    fileInput.fire('change');
    assert.match(root.children[2].textContent, /Ungültiger Dateiname/);
    assert.equal(fileInput.value, 'second');
    fileInput.value = 'zweite-seite';
    fileInput.fire('change');
    assert.equal(writes, 0);

    // Speichern schreibt genau einmal und schließt den Dialog
    await save.fire('click');
    assert.equal(writes, 1);
    assert.deepEqual(closed, { requiresReload: false });
    assert.equal(root.children.length, 0);
    const draft = controller.snapshot().draft;
    assert.deepEqual(draft.pages.map((page) => page.id), ['zweite-seite', 'start']);
    assert.equal(draft.pages[1].title, 'Haupt');
    assert.equal(draft.pages[0].widgets[0].html, '{{Temp:state}}');
    assert.equal(draft.pages[1].widgets.length, 1);
    assert.equal(await readFile(join(dir, 'config.json'), 'utf8'), original);

    // Veralteter Tab: Speichern schlägt fehl und sperrt weitere Bearbeitung
    const other = new Schema5DraftController(transport);
    const otherState = await other.reload();
    const staleRoot = new Element('section');
    let staleClosed;
    new Schema5PagesPanel({ root: staleRoot, controller: other, token: otherState.token, browser,
      onClose: (outcome) => { staleClosed = outcome; } });
    await controller.renamePage('start', 'Anderer Tab', controller.snapshot().token);
    staleRoot.children[3].children[0].children[0].children[0].children[0].value = 'Konflikt';
    staleRoot.children[3].children[0].children[0].children[0].children[0].fire('input');
    await staleRoot.children[4].children[0].fire('click');
    assert.match(staleRoot.children[2].textContent, /nicht bestätigt/);
    assert.equal(staleRoot.children[3].inert, true);
    staleRoot.children[4].children[1].fire('click');
    assert.equal(staleClosed.requiresReload, true);
    assert.equal((await controller.reload()).draft.pages[1].title, 'Anderer Tab');
    assert.equal(await readFile(join(dir, 'config.json'), 'utf8'), original);

    // Unterbrechung während eines laufenden Speicherns schließt still
    const fresh = await controller.reload();
    const root2 = new Element('section');
    let late = false;
    const pending = new Schema5PagesPanel({ root: root2, controller, token: fresh.token, browser,
      onClose: () => { late = true; } });
    root2.children[3].children[0].children[1].children[0].children[0].value = 'Spät';
    root2.children[3].children[0].children[1].children[0].children[0].fire('input');
    gate = {};
    const saving = root2.children[4].children[0].fire('click');
    assert.equal(root2.children[4].children[1].disabled, true);
    pending.suspend();
    assert.equal(root2.hidden, true);
    gate.resolve();
    await saving;
    assert.equal(root2.children.length, 0);
    assert.equal(late, false);
    assert.equal((await controller.reload()).draft.pages[1].title, 'Spät');
    assert.equal(await readFile(join(dir, 'config.json'), 'utf8'), original);
  } finally {
    globalThis.document = previous;
    await rm(dir, { recursive: true });
  }
});
