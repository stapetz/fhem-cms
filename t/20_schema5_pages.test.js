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

test('page management protects unsaved forms, live bytes and stale tabs through real Perl', async () => {
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
  const transport = {
    read: async () => invoke('read'),
    save: async (value, token) => {
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
    const panel = new Schema5PagesPanel({ root, controller, token: state.token, browser,
      onClose: (outcome) => { closed = outcome; } });
    const status = root.children[2];
    const controls = root.children[3];
    const first = controls.children[0].children[0];
    assert.equal(first.children[3].disabled, true, 'nonempty last page cannot be deleted');
    const create = controls.children[1];
    create.children[0].children[0].value = 'second';
    create.children[1].children[0].value = 'Zweite';
    const rename = first.children[0];
    rename.children[0].children[0].value = 'Änderung';
    await create.fire('submit');
    assert.match(status.textContent, /Andere Eingaben/);
    root.children[4].fire('click');
    assert.equal(closed, undefined, 'cancelled close keeps uncommitted inputs');
    rename.children[0].children[0].value = 'Start';
    await create.fire('submit');
    assert.equal(controller.snapshot().draft.pages.length, 2);
    assert.equal(await readFile(join(dir, 'config.json'), 'utf8'), original);
    const second = controls.children[0].children[1];
    assert.equal(second.children[3].disabled, false);
    confirm = false;
    await second.children[3].fire('click');
    assert.equal(controller.snapshot().draft.pages.length, 2);
    await second.children[1].fire('click');
    assert.deepEqual(controller.snapshot().draft.pages.map((page) => page.id), ['second', 'start']);
    const secondForm = controls.children[0].children[0].children[0];
    secondForm.children[0].children[0].value = 'Handbuch';
    await secondForm.fire('submit');
    assert.equal(controller.snapshot().draft.pages[0].title, 'Handbuch');
    const move = controls.children[0].children[1].children[4].children[1];
    await move.fire('submit');
    assert.equal(controller.snapshot().draft.pages[0].widgets[0].html, '{{Temp:state}}');
    assert.equal(controls.children[0].children[0].children[3].disabled, true, 'page with a widget cannot be deleted');
    const moveBack = controls.children[0].children[0].children[4].children[1];
    await moveBack.fire('submit');
    assert.equal(controller.snapshot().draft.pages[1].widgets.at(-1).html, '{{Temp:state}}');
    const other = new Schema5DraftController(transport);
    const otherState = await other.reload();
    await other.renamePage('start', 'Anderer Tab', otherState.token);
    confirm = true;
    await controls.children[0].children[0].children[3].fire('click');
    assert.match(status.textContent, /veraltet/);
    assert.equal(controls.inert, true);
    root.children[4].fire('click');
    assert.equal(closed.requiresReload, true);
    const refreshed = await controller.reload();
    assert.equal(refreshed.draft.pages[1].title, 'Anderer Tab');
    assert.equal(refreshed.draft.pages[1].widgets[1].html, '{{Temp:state}}');
    assert.equal(refreshed.draft.pages[1].widgets[0].html, '<span device="Temp" reading="state"></span>');
    assert.equal(await readFile(join(dir, 'config.json'), 'utf8'), original);

    const root2 = new Element('section');
    let late = false;
    const pending = new Schema5PagesPanel({ root: root2, controller, token: refreshed.token, browser,
      onClose: () => { late = true; } });
    gate = {};
    const deleting = root2.children[3].children[0].children[0].children[3].fire('click');
    assert.equal(root2.children[4].disabled, true);
    pending.suspend();
    assert.equal(root2.hidden, true);
    gate.resolve();
    await deleting;
    assert.equal(root2.children.length, 0);
    assert.equal(late, false);
    assert.equal((await controller.reload()).draft.pages.length, 1);
    assert.equal(await readFile(join(dir, 'config.json'), 'utf8'), original);
    panel.close();
  } finally {
    globalThis.document = previous;
    await rm(dir, { recursive: true });
  }
});
