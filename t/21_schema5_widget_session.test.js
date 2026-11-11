import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Schema5DraftController } from '../www/fhem-cms/js/fcui-schema5-draft.js';
import { Schema5WidgetSession } from '../www/fhem-cms/js/fcui-schema5-widget-session.js';

const config = () => ({
  schemaVersion: 5, theme: 'dark', settings: { layoutMode: 'grid', gridColumns: 12 },
  navigation: { orientation: 'horizontal', grid: { col: 1, row: 1, w: 12, h: 1 } },
  pages: [
    { id: 'one', title: 'Eins', widgets: [
      { id: 'text', type: 'text', html: '{{Temp:state}}', grid: { col: 1, row: 2, w: 4, h: 2 } },
    ] },
    { id: 'two', title: 'Zwei', widgets: [
      { id: 'html', type: 'fhem-html', devices: ['Temp'],
        html: '<span device="Temp" reading="state"></span>', grid: { col: 1, row: 2, w: 4, h: 2 } },
    ] },
  ],
});

function open(controller, pageId, token, widget, action = 'update') {
  return new Schema5WidgetSession({ controller, pageId, token, widget, action });
}

test('dialog services bind identity, page, geometry and a single action', async () => {
  let state = { live: config(), draft: null, token: 'a'.repeat(64) };
  let writes = 0;
  const controller = new Schema5DraftController({
    read: async () => structuredClone(state),
    save: async (draft, token) => {
      assert.equal(token, state.token);
      writes += 1;
      state = { live: state.live, draft, token: 'b'.repeat(64) };
    },
    publish: async () => {}, discard: async () => {},
  });
  await controller.reload();
  const widget = state.live.pages[0].widgets[0];
  assert.throws(() => open(controller, 'two', state.token, widget), /Widget stimmt/);
  assert.throws(() => open(controller, 'one', 'b'.repeat(64), widget), /veraltet/);
  const invalid = open(controller, 'one', state.token, widget);
  const bad = invalid.widget;
  bad.grid.row = 3;
  await assert.rejects(invalid.services({}).saveWidget(bad), /Raster wurde verändert/);
  assert.match((await invalid.completion).error.message, /Raster wurde verändert/);
  await assert.rejects(invalid.services({}).deleteWidget('text'), /nicht mehr aktiv/);
  assert.equal(writes, 0);

  const session = open(controller, 'one', state.token, widget);
  const clone = session.widget;
  clone.html = 'changed';
  assert.equal(session.widget.html, '{{Temp:state}}');
  const sharedService = () => 'available';
  const services = session.services({ listAllDevices: sharedService });
  assert.equal(services.listAllDevices, sharedService);
  const result = await services.saveWidget(clone);
  assert.deepEqual((await session.completion).state, result);
  assert.equal(result.draft.pages[0].widgets[0].html, 'changed');
  assert.equal(result.draft.pages[1].widgets[0].html, config().pages[1].widgets[0].html);
  await assert.rejects(services.deleteWidget('text'), /nicht mehr aktiv/);
  assert.equal(writes, 1);
});

test('new call list height follows count and density without changing existing widget geometry', async () => {
  for (const columns of [12, 24, 48, 96, 192]) {
    for (const limit of [1, 5, 10, 20]) {
      const live = config();
      const scale = columns / 12;
      live.settings.gridColumns = columns;
      live.navigation.grid = { col: 1, row: 1, w: columns, h: scale };
      live.pages[0].widgets = [];
      live.pages[1].widgets = [];
      let state = { live, draft: null, token: 'a'.repeat(64) };
      const controller = new Schema5DraftController({
        read: async () => structuredClone(state),
        save: async draft => { state = { live, draft, token: 'b'.repeat(64) }; },
        publish: async () => {}, discard: async () => {},
      });
      await controller.reload();
      const widget = { id: 'calls', type: 'fhem-calllist', device: 'Calls', limit, columns: ['state'],
        grid: { col: 1, row: scale + 1, w: 6 * scale, h: 6 * scale } };
      const session = open(controller, 'one', state.token, widget, 'create');
      await session.services({}).saveWidget(session.widget);
      const saved = controller.snapshot().draft.pages[0].widgets[0];
      assert.equal(saved.grid.h, (2 + Math.ceil(limit * 0.8)) * scale);
      assert.equal(saved.grid.w, 6 * scale);
      const existing = open(controller, 'one', state.token, saved);
      await existing.services({}).saveWidget({ ...saved, limit: 20 });
      assert.deepEqual(controller.snapshot().draft.pages[0].widgets[0].grid, saved.grid);
    }
  }
});

test('closing a pending dialog suppresses completion while the confirmed write finishes', async () => {
  let state = { live: config(), draft: null, token: 'a'.repeat(64) };
  let release;
  const controller = new Schema5DraftController({
    read: async () => structuredClone(state),
    save: async (draft) => {
      await new Promise((resolve) => { release = resolve; });
      state = { live: state.live, draft, token: 'b'.repeat(64) };
    },
    publish: async () => {}, discard: async () => {},
  });
  await controller.reload();
  const session = open(controller, 'one', state.token, state.live.pages[0].widgets[0]);
  const services = session.services({});
  const widget = session.widget;
  widget.html = 'pending';
  const saving = services.saveWidget(widget);
  await assert.rejects(services.deleteWidget('text'), /nicht mehr aktiv/);
  session.close();
  assert.deepEqual(await session.completion, { cancelled: true });
  release();
  assert.equal((await saving).draft.pages[0].widgets[0].html, 'pending');
  await assert.rejects(services.saveWidget(widget), /nicht mehr aktiv/);
});

test('create and delete enforce their original action and cannot reuse a stale token', async () => {
  let state = { live: config(), draft: null, token: 'a'.repeat(64) };
  let writes = 0;
  const controller = new Schema5DraftController({
    read: async () => structuredClone(state),
    save: async (draft, token) => {
      assert.equal(token, state.token);
      writes += 1;
      state = { live: state.live, draft, token: (writes === 1 ? 'b' : 'c').repeat(64) };
    },
    publish: async () => {}, discard: async () => {},
  });
  await controller.reload();
  const widget = { id: 'clock', type: 'fhem-clock', style: 'digital',
    grid: { col: 5, row: 2, w: 4, h: 2 } };
  assert.throws(() => open(controller, 'one', state.token, state.live.pages[0].widgets[0], 'create'), /bereits vorhanden/);
  const denied = open(controller, 'one', state.token, widget, 'create');
  await assert.rejects(denied.services({}).deleteWidget('clock'), /nicht gelöscht/);
  assert.equal(writes, 0);

  const stale = open(controller, 'one', state.token, state.live.pages[0].widgets[0]);
  const create = open(controller, 'one', state.token, widget, 'create');
  await create.services({}).saveWidget(create.widget);
  await assert.rejects(stale.services({}).deleteWidget('text'), /veraltet/);
  assert.equal(writes, 1);
  assert.equal((await stale.completion).error.message.includes('veraltet'), true);

  const current = controller.snapshot();
  const remove = open(controller, 'one', current.token, current.draft.pages[0].widgets[1]);
  await remove.services({}).deleteWidget('clock');
  assert.deepEqual((await remove.completion).state.draft.pages[0].widgets.map((item) => item.id), ['text']);
  assert.equal(writes, 2);
});

test('cancelled and failed sessions do not allow another operation', async () => {
  let state = { live: config(), draft: null, token: 'a'.repeat(64) };
  let fail;
  let writes = 0;
  const controller = new Schema5DraftController({
    read: async () => structuredClone(state),
    save: async () => {
      writes += 1;
      await new Promise((resolve, reject) => { fail = reject; });
    },
    publish: async () => {}, discard: async () => {},
  });
  await controller.reload();
  const widget = state.live.pages[0].widgets[0];
  const cancelled = open(controller, 'one', state.token, widget);
  cancelled.close();
  assert.deepEqual(await cancelled.completion, { cancelled: true });
  await assert.rejects(cancelled.services({}).saveWidget(widget), /nicht mehr aktiv/);
  assert.equal(writes, 0);

  const changedId = open(controller, 'one', state.token, widget);
  await assert.rejects(changedId.services({}).saveWidget({ ...widget, id: 'other' }), /Identität/);
  const changedType = open(controller, 'one', state.token, widget);
  await assert.rejects(changedType.services({}).saveWidget({ ...widget, type: 'fhem-html' }), /Identität/);
  const wrongDelete = open(controller, 'one', state.token, widget);
  await assert.rejects(wrongDelete.services({}).deleteWidget('other'), /nicht gelöscht/);
  assert.equal(writes, 0);

  const pending = open(controller, 'one', state.token, widget);
  const saving = pending.services({}).saveWidget(widget);
  pending.close();
  fail(new Error('Antwort verloren'));
  await assert.rejects(saving, /Antwort verloren/);
  assert.deepEqual(await pending.completion, { cancelled: true });
  assert.throws(() => controller.snapshot(), /nicht geladen/);
  assert.equal(writes, 1);
});

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

test('real draft transactions reject stale dialogs and preserve both placeholder forms', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cms-v5-widget-'));
  try {
    const path = join(dir, 'config.json');
    const original = JSON.stringify(config(), null, 2);
    await writeFile(path, original);
    const invoke = (operation, ...args) => {
      const child = spawnSync('perl', ['-e', perl, dir, operation, ...args], { encoding: 'utf8' });
      if (child.status !== 0) throw new Error(child.stderr);
      const reply = JSON.parse(child.stdout);
      if (reply.error) throw new Error(reply.error);
      return reply.result;
    };
    const transport = {
      read: async () => invoke('read'),
      save: async (draft, token) => invoke('save', Buffer.from(JSON.stringify(draft)).toString('base64'), token),
      publish: async () => {}, discard: async () => {},
    };
    const first = new Schema5DraftController(transport);
    const second = new Schema5DraftController(transport);
    const a = await first.reload();
    const b = await second.reload();
    const text = open(first, 'one', a.token, a.live.pages[0].widgets[0]);
    const stale = open(second, 'two', b.token, b.live.pages[1].widgets[0]);
    const edit = text.widget;
    edit.html = '<p>{{Temp:state|upper}}</p>';
    await text.services({}).saveWidget(edit);
    const outdated = stale.widget;
    outdated.html = '<span device="Temp" reading="state" filter="upper"></span>';
    await assert.rejects(stale.services({}).saveWidget(outdated));
    assert.ok((await stale.completion).error);
    assert.equal(await readFile(path, 'utf8'), original);
    const fresh = await second.reload();
    assert.equal(fresh.draft.pages[0].widgets[0].html, edit.html);
    assert.equal(fresh.draft.pages[1].widgets[0].html, config().pages[1].widgets[0].html);
    const html = open(second, 'two', fresh.token, fresh.draft.pages[1].widgets[0]);
    await html.services({}).saveWidget(outdated);
    const saved = await second.reload();
    assert.equal(saved.draft.pages[0].widgets[0].html, edit.html);
    assert.equal(saved.draft.pages[1].widgets[0].html, outdated.html);
    assert.equal(await readFile(path, 'utf8'), original);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
