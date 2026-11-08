import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Schema5DraftController } from '../www/fhem-cms/js/fcui-schema5-draft.js';
import { schema5GridItems } from '../www/fhem-cms/js/fcui-schema5-layout.js';

const config = () => ({
  schemaVersion: 5, theme: 'dark', settings: { layoutMode: 'grid', gridColumns: 12 },
  navigation: { orientation: 'horizontal', grid: { col: 1, row: 1, w: 12, h: 1 } },
  pages: [{ id: 'start', title: 'Start', widgets: [
    { id: 'text', type: 'text', html: '<p>{{Temp:state}}</p>', grid: { col: 1, row: 2, w: 4, h: 2 } },
    { id: 'html', type: 'fhem-html', devices: ['Temp'],
      html: '<span device="Temp" reading="state"></span>', grid: { col: 5, row: 2, w: 4, h: 2 } },
  ] }],
});

test('controller blocks concurrent and uncertain actions until explicit reload', async () => {
  let state = { live: config(), draft: null, token: 'a'.repeat(64) };
  let finishSave;
  let calls = 0;
  const transport = {
    read: async () => structuredClone(state),
    save: async (draft, token) => {
      calls += 1;
      assert.equal(token, 'a'.repeat(64));
      await new Promise((resolve) => { finishSave = resolve; });
      state = { live: state.live, draft, token: 'b'.repeat(64) };
    },
    publish: async () => {},
    discard: async () => {},
  };
  const controller = new Schema5DraftController(transport);
  assert.throws(() => controller.snapshot(), /nicht geladen/);
  await assert.rejects(controller.publishDraft(), /nicht geladen/);
  await controller.reload();
  await assert.rejects(controller.discardDraft('a'.repeat(64)), /keinen Entwurf/);
  const draft = config();
  draft.pages[0].title = 'Bearbeitet';
  const saving = controller.saveDraft(draft, 'a'.repeat(64));
  draft.pages[0].title = 'Späte Änderung';
  await assert.rejects(controller.publishDraft(), /läuft bereits/);
  await assert.rejects(controller.reload(), /läuft bereits/);
  assert.throws(() => controller.snapshot(), /nicht geladen/);
  finishSave();
  const saved = await saving;
  assert.equal(saved.draft.pages[0].title, 'Bearbeitet');
  saved.draft.pages[0].title = 'Externe Änderung';
  assert.equal(controller.snapshot().draft.pages[0].title, 'Bearbeitet');
  assert.equal(calls, 1);
  await assert.rejects(controller.saveDraft(config(), 'a'.repeat(64)), /veraltet/);
  await assert.rejects(controller.publishDraft('a'.repeat(64)), /veraltet/);
  assert.throws(() => controller.saveLayout('start', schema5GridItems(saved.draft, 'start'), 'a'.repeat(64)), /veraltet/);
  assert.throws(() => controller.deleteWidget('start', 'text', 'a'.repeat(64)), /veraltet/);
  assert.throws(() => controller.saveWidget('start', saved.draft.pages[0].widgets[0], 'a'.repeat(64), 'update'), /veraltet/);
  assert.equal(controller.snapshot().token, saved.token, 'stale local dialogs do not invalidate the current state');
  assert.equal(calls, 1, 'stale local dialogs never reach the transport');
  transport.publish = async () => {
    state = { live: state.draft, draft: null, token: 'c'.repeat(64) };
    throw new Error('Antwort verloren');
  };
  await assert.rejects(controller.publishDraft(saved.token), /Antwort verloren/);
  assert.throws(() => controller.snapshot(), /nicht geladen/);
  await assert.rejects(controller.saveDraft(config()), /nicht geladen/);
  const actual = await controller.reload();
  assert.equal(actual.draft, null);
  assert.equal(actual.live.pages[0].title, 'Bearbeitet');
  transport.save = async (value) => {
    state = { live: state.live, draft: { ...value, theme: 'light' }, token: 'd'.repeat(64) };
  };
  await assert.rejects(controller.saveDraft(config(), actual.token), /Zustand nach der Entwurfsaktion geändert/);
  assert.throws(() => controller.snapshot(), /nicht geladen/);
  transport.read = async () => ({ ...state, token: 'ungültig' });
  await assert.rejects(controller.reload(), /Ungültiger Schema-5-Zustand/);
  assert.throws(() => controller.snapshot(), /nicht geladen/);
});

test('successful writes with failed or conflicting verification require explicit reload', async () => {
  let state = { live: config(), draft: null, token: 'a'.repeat(64) };
  let reads = 0;
  const transport = {
    read: async () => {
      reads += 1;
      if (reads === 2) throw new Error('Lesen fehlgeschlagen');
      return structuredClone(state);
    },
    save: async (draft) => {
      state = { live: state.live, draft, token: 'b'.repeat(64) };
    },
    publish: async () => {
      const competing = structuredClone(state.draft);
      competing.theme = 'light';
      state = { live: competing, draft: null, token: 'c'.repeat(64) };
    },
    discard: async () => {},
  };
  const controller = new Schema5DraftController(transport);
  await controller.reload();
  await assert.rejects(controller.saveDraft(config(), 'a'.repeat(64)), /Lesen fehlgeschlagen/);
  assert.throws(() => controller.snapshot(), /nicht geladen/);
  assert.deepEqual((await controller.reload()).draft, config());
  await assert.rejects(controller.publishDraft('b'.repeat(64)), /Zustand nach der Entwurfsaktion geändert/);
  assert.throws(() => controller.snapshot(), /nicht geladen/);
  assert.equal((await controller.reload()).live.theme, 'light');
});

test('first layout edit copies live and rejects a navigation collision on another page', async () => {
  const live = config();
  live.pages.push({ id: 'second', title: 'Zweite', widgets: [
    { id: 'clock', type: 'fhem-clock', style: 'digital', grid: { col: 1, row: 5, w: 2, h: 1 } },
  ] });
  let state = { live, draft: null, token: 'a'.repeat(64) };
  let writes = 0;
  const transport = {
    read: async () => structuredClone(state),
    save: async (draft, token) => {
      writes += 1;
      assert.equal(token, 'a'.repeat(64));
      state = { live, draft, token: 'b'.repeat(64) };
    },
    publish: async () => {},
    discard: async () => {},
  };
  const controller = new Schema5DraftController(transport);
  await controller.reload();
  const positions = schema5GridItems(live, 'start');
  const invalid = structuredClone(positions);
  invalid[0].y = 4;
  assert.throws(() => controller.saveLayout('start', invalid, 'a'.repeat(64)), /Seite second/);
  assert.equal(writes, 0);
  positions[1].y = 3;
  const saved = await controller.saveLayout('start', positions, 'a'.repeat(64));
  assert.equal(writes, 1);
  assert.deepEqual(saved.live, live);
  assert.equal(saved.draft.pages[0].widgets[0].grid.row, 4);
  assert.deepEqual(saved.draft.pages[1], live.pages[1]);
  assert.equal(saved.draft.pages[0].widgets[1].html, live.pages[0].widgets[1].html);
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
} elsif ($operation eq 'publish') {
    ($result, $error) = FHEMCMS_PublishVersion5Draft($dir, $args[0]);
} elsif ($operation eq 'discard') {
    $error = FHEMCMS_DiscardVersion5Draft($dir, $args[0]);
} else {
    die 'unknown operation';
}
print JSON::PP->new->utf8->canonical->encode({result => $result, error => $error});
`;

test('controller runs against isolated real Perl draft transactions and rejects stale tabs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cms-v5-draft-'));
  const livePath = join(dir, 'config.json');
  const draftPath = join(dir, 'draft.json');
  const original = JSON.stringify(config(), null, 2);
  const invoke = (operation, ...args) => {
    const process = spawnSync('perl', ['-e', perl, dir, operation, ...args], { encoding: 'utf8' });
    assert.equal(process.error, undefined);
    assert.equal(process.status, 0, process.stderr);
    const { result, error } = JSON.parse(process.stdout);
    if (error) throw new Error(error);
    return result;
  };
  const transport = {
    read: async () => invoke('read'),
    save: async (value, token) => invoke('save', Buffer.from(JSON.stringify(value)).toString('base64'), token),
    publish: async (token) => invoke('publish', token),
    discard: async (token) => invoke('discard', token),
  };
  try {
    await writeFile(livePath, original);
    const first = new Schema5DraftController(transport);
    const second = new Schema5DraftController(transport);
    const firstState = await first.reload();
    const secondState = await second.reload();
    const draft = config();
    draft.pages[0].title = 'Entwurf';
    const saved = await first.saveDraft(draft, firstState.token);
    assert.deepEqual(saved.live, config());
    assert.deepEqual(saved.draft, draft);
    assert.equal(await readFile(livePath, 'utf8'), original);
    const draftBytes = await readFile(draftPath, 'utf8');
    await assert.rejects(second.saveDraft(config(), secondState.token), /veraltet/);
    assert.equal(await readFile(draftPath, 'utf8'), draftBytes);
    await assert.rejects(second.publishDraft(), /nicht geladen/);
    const positions = schema5GridItems(draft, 'start');
    const invalid = structuredClone(positions);
    invalid[1].y = 0;
    assert.throws(() => first.saveLayout('start', invalid, saved.token), /überschneidung/);
    assert.equal(await readFile(draftPath, 'utf8'), draftBytes, 'invalid grid does not reach persistence');
    positions[1].y = 3;
    const moved = await first.saveLayout('start', positions, saved.token);
    assert.equal(moved.draft.pages[0].widgets[0].grid.row, 4);
    assert.equal(moved.draft.pages[0].widgets[0].html, draft.pages[0].widgets[0].html);
    assert.equal(moved.draft.pages[0].title, 'Entwurf');
    assert.equal(await readFile(livePath, 'utf8'), original);
    const newWidget = { id: 'new', type: 'text', html: '<p>Neu</p>', grid: { col: 1, row: 7, w: 4, h: 1 } };
    const added = await first.saveWidget('start', newWidget, moved.token, 'create');
    assert.equal(added.draft.pages[0].widgets[2].id, 'new');
    assert.throws(() => first.saveWidget('start', newWidget, moved.token, 'update'), /veraltet/);
    assert.throws(() => first.saveWidget('start', newWidget, added.token, 'create'), /bereits vorhanden/);
    assert.throws(() => first.saveWidget('start', { ...newWidget, id: 'missing' }, added.token, 'update'), /Unbekanntes Widget/);
    assert.throws(() => first.saveWidget('start', newWidget, added.token), /Widget-Aktion/);
    const updated = await first.saveWidget('start', { ...newWidget, html: '<p>Geändert</p>' }, added.token, 'update');
    assert.equal(updated.draft.pages[0].widgets[2].html, '<p>Geändert</p>');
    assert.throws(() => first.deleteWidget('start', 'missing', updated.token), /Unbekanntes Widget/);
    assert.throws(() => first.deleteWidget('missing', 'new', updated.token), /Unbekannte Seite/);
    const removed = await first.deleteWidget('start', 'new', updated.token);
    assert.deepEqual(removed.draft, moved.draft);
    const movedBytes = await readFile(draftPath, 'utf8');
    const secondReload = await second.reload();
    const published = await second.publishDraft(secondReload.token);
    assert.deepEqual(published.live, moved.draft);
    assert.equal(published.draft, null);
    const files = await readdir(dir);
    const backup = files.find((name) => /^config\.json\.\d{8}-\d{6}(?:-\d+)?\.bak$/.test(name));
    assert.ok(backup);
    assert.equal(await readFile(join(dir, backup), 'utf8'), original);
    assert.equal(await readFile(livePath, 'utf8'), movedBytes);
    await assert.rejects(first.discardDraft(removed.token), /veraltet/);
    const reloaded = await first.reload();
    const fresh = structuredClone(moved.draft);
    fresh.pages[0].title = 'Nicht veröffentlicht';
    const freshState = await first.saveDraft(fresh, reloaded.token);
    const discarded = await first.discardDraft(freshState.token);
    assert.deepEqual(discarded.live, moved.draft);
    assert.equal(discarded.draft, null);
    assert.equal(await readFile(livePath, 'utf8'), movedBytes);
    assert.match(discarded.live.pages[0].widgets[0].html, /\{\{Temp:state\}\}/);
    assert.match(discarded.live.pages[0].widgets[1].html, /device="Temp" reading="state"/);
  } finally {
    await rm(dir, { recursive: true });
  }
});
