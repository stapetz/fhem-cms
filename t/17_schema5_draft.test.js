import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Schema5DraftController } from '../www/fhem-cms/js/fcui-schema5-draft.js';
import { Schema5GridEdit } from '../www/fhem-cms/js/fcui-schema5-grid-edit.js';
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
  assert.throws(() => controller.saveNavigation(saved.draft.navigation, 'a'.repeat(64)), /veraltet/);
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

test('first navigation edit persists cross-page reflow atomically and leaves live untouched', async () => {
  const live = config();
  live.pages.push({ id: 'second', title: 'Zweite', widgets: [
    { id: 'clock', type: 'fhem-clock', style: 'digital', showSeconds: false, showDate: false, showWeekday: false,
      grid: { col: 1, row: 5, w: 2, h: 1 } },
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
  invalid[1].y = 0;
  assert.throws(() => controller.saveLayout('start', invalid, 'a'.repeat(64)), /überschneidung/);
  assert.equal(writes, 0);
  positions[0].h = 5;
  positions[1].y = 5;
  positions[2].y = 5;
  const saved = await controller.saveLayout('start', positions, 'a'.repeat(64));
  assert.equal(writes, 1);
  assert.deepEqual(saved.live, live);
  assert.equal(saved.draft.pages[0].widgets[0].grid.row, 6);
  assert.equal(saved.draft.pages[1].widgets[0].grid.row, 6);
  assert.deepEqual(saved.draft.navigation.grid, { col: 1, row: 1, w: 12, h: 5 });
  const reloaded = await controller.reload();
  assert.deepEqual(reloaded.draft, saved.draft, 'all page changes survive reload');
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

test('modal link survives real draft and publish without changing existing live data early', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cms-v5-modal-'));
  const live = config();
  live.pages[0].widgets.push({ id: 'links', type: 'fhem-link', grid: { col: 9, row: 2, w: 4, h: 2 },
    links: [{ id: 'one', kind: 'internal', page: 'start', text: 'Start', showText: true,
      textPosition: 'overlay', target: 'self', grid: { col: 1, row: 1, w: 12, h: 2 } }] });
  const original = JSON.stringify(live);
  const invoke = (operation, ...args) => {
    const process = spawnSync('perl', ['-e', perl, dir, operation, ...args], { encoding: 'utf8' });
    assert.equal(process.status, 0, process.stderr);
    const { result, error } = JSON.parse(process.stdout);
    if (error) throw new Error(error);
    return result;
  };
  const controller = new Schema5DraftController({
    read: async () => invoke('read'),
    save: async (value, token) => invoke('save', Buffer.from(JSON.stringify(value)).toString('base64'), token),
    publish: async token => invoke('publish', token),
    discard: async token => invoke('discard', token),
  });
  try {
    await writeFile(join(dir, 'config.json'), original);
    const before = await controller.reload();
    const draft = structuredClone(live);
    Object.assign(draft.pages[0].widgets[2].links[0], { targetMode: 'modal', modalSize: 'lg' });
    const saved = await controller.saveDraft(draft, before.token);
    assert.equal(await readFile(join(dir, 'config.json'), 'utf8'), original);
    assert.deepEqual((await controller.reload()).draft, draft);
    const published = await controller.publishDraft(saved.token);
    assert.deepEqual(published.live, draft);
    assert.equal(published.draft, null);
    assert.ok((await readdir(dir)).some(name => /^config\.json\..*\.bak$/.test(name)));
  } finally { await rm(dir, { recursive: true }); }
});

test('compact link geometry survives real draft, reload and publication', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cms-v5-link-fit-'));
  const live = config();
  const link = { id: 'one', kind: 'internal', page: 'start', text: 'Start', showText: true,
    textPosition: 'overlay', target: 'self', grid: { col: 1, row: 1, w: 4, h: 3 } };
  live.pages[0].widgets.push({ id: 'links', type: 'fhem-link', title: 'Links',
    grid: { col: 9, row: 2, w: 4, h: 4 }, links: [link] });
  const original = JSON.stringify(live);
  const invoke = (operation, ...args) => {
    const child = spawnSync('perl', ['-e', perl, dir, operation, ...args], { encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    const { result, error } = JSON.parse(child.stdout);
    if (error) throw new Error(error);
    return result;
  };
  const controller = new Schema5DraftController({
    read: async () => invoke('read'),
    save: async (value, token) => invoke('save', Buffer.from(JSON.stringify(value)).toString('base64'), token),
    publish: async token => invoke('publish', token),
    discard: async token => invoke('discard', token),
  });
  try {
    await writeFile(join(dir, 'config.json'), original);
    await controller.reload();
    const links = [link, { ...link, id: 'two', grid: { col: 1, row: 4, w: 4, h: 2 } }];
    for (const [items, height] of [[[link], 4], [links, 6], [[link], 4]]) {
      const state = controller.snapshot();
      const widget = structuredClone((state.draft || state.live).pages[0].widgets[2]);
      widget.links = structuredClone(items);
      await controller.saveWidget('start', widget, state.token, 'update');
      const reloaded = await controller.reload();
      assert.deepEqual(reloaded.draft.pages[0].widgets[2].grid, { col: 9, row: 2, w: 4, h: height });
      assert.deepEqual(reloaded.draft.pages[0].widgets[2].links, items);
      assert.deepEqual(reloaded.draft.pages[0].widgets.slice(0, 2), live.pages[0].widgets.slice(0, 2));
      assert.equal(await readFile(join(dir, 'config.json'), 'utf8'), original);
    }
    const draft = controller.snapshot().draft;
    await controller.publishDraft(controller.snapshot().token);
    assert.deepEqual((await controller.reload()).live, draft);
  } finally { await rm(dir, { recursive: true }); }
});

test('confirmed LinkWidget growth persists the previewed page atomically through real Perl transactions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cms-v5-link-reflow-'));
  const live = config();
  live.settings.gridColumns = 96;
  live.navigation.grid = { col: 1, row: 1, w: 92, h: 4 };
  live.pages[0].widgets = [
    { id: 'links', type: 'fhem-link', title: 'Existing links', grid: { col: 1, row: 27, w: 40, h: 23 },
      links: [1, 2, 3].map(number => ({ id: `link${number}`, kind: 'internal', page: 'start',
        text: `Link ${number}`, showText: true, textPosition: 'overlay', target: 'self',
        grid: { col: 1 + (number - 1) * 4, row: 1, w: 4, h: 4 } })) },
    { id: 'side', type: 'text', html: '{{Temp:state}}', grid: { col: 72, row: 23, w: 13, h: 12 } },
    { id: 'below', type: 'fhem-html', devices: ['Temp'],
      html: '<span device="Temp" reading="state"></span>', grid: { col: 27, row: 50, w: 45, h: 12 } },
    { id: 'tail', type: 'text', html: 'Keep', grid: { col: 27, row: 62, w: 45, h: 8 } },
  ];
  live.pages.push({ id: 'other', title: 'Other', widgets: [
    { id: 'untouched', type: 'text', html: 'Other page', grid: { col: 1, row: 5, w: 30, h: 8 } },
  ] });
  let writes = 0;
  const original = JSON.stringify(live);
  const invoke = (operation, ...args) => {
    const child = spawnSync('perl', ['-e', perl, dir, operation, ...args], { encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    const { result, error } = JSON.parse(child.stdout);
    if (error) throw new Error(error);
    return result;
  };
  const controller = new Schema5DraftController({
    read: async () => invoke('read'),
    save: async (value, token) => {
      writes++;
      invoke('save', Buffer.from(JSON.stringify(value)).toString('base64'), token);
    },
    publish: async token => invoke('publish', token),
    discard: async token => invoke('discard', token),
  });
  try {
    await writeFile(join(dir, 'config.json'), original);
    const state = await controller.reload();
    const widget = structuredClone(live.pages[0].widgets[0]);
    widget.links.push({ ...widget.links[0], id: 'four', text: 'Fourth link', targetMode: 'modal', modalSize: 'lg',
      image: `media/${'a'.repeat(32)}.png`, grid: { col: 1, row: 5, w: 4, h: 3 } });
    widget.links.push({ id: 'five', kind: 'external', url: 'https://example.test/', text: 'Fifth link',
      showText: true, textPosition: 'overlay', target: 'tab', grid: { col: 5, row: 5, w: 4, h: 3 } });
    const preview = controller.previewWidget('start', widget, state.token, 'update');
    assert.deepEqual(preview.moved, ['below', 'tail']);
    assert.equal(writes, 0);
    assert.deepEqual(await readdir(dir), ['config.json'], 'preview creates no draft or journal');
    assert.equal(await readFile(join(dir, 'config.json'), 'utf8'), original);
    const saved = await controller.saveWidget('start', widget, state.token, 'update', preview);
    assert.equal(writes, 1);
    const expected = structuredClone(live);
    expected.pages[0].widgets[0] = { ...widget, grid: { ...widget.grid, h: 37 } };
    expected.pages[0].widgets[2].grid.row = 64;
    expected.pages[0].widgets[3].grid.row = 76;
    assert.deepEqual(saved.draft, expected);
    assert.deepEqual(JSON.parse(await readFile(join(dir, 'draft.json'), 'utf8')), expected);
    assert.equal(await readFile(join(dir, 'config.json'), 'utf8'), original);
    assert.deepEqual((await controller.reload()).draft, expected);
    assert.deepEqual((await controller.publishDraft(controller.snapshot().token)).live, expected);
    assert.deepEqual((await controller.reload()).live, expected);
  } finally { await rm(dir, { recursive: true }); }
});

test('navigation reflow survives real Perl persistence and rejects overflow before any write', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cms-v5-navigation-reflow-'));
  const live = config();
  live.pages.push({ id: 'other', title: 'Other', widgets: [
    { id: 'first', type: 'text', html: '<p>First</p>', grid: { col: 1, row: 2, w: 4, h: 2 } },
    { id: 'next', type: 'text', html: '<p>Next</p>', grid: { col: 1, row: 4, w: 4, h: 2 } },
  ] });
  const original = JSON.stringify(live, null, 2);
  const livePath = join(dir, 'config.json');
  const draftPath = join(dir, 'draft.json');
  let writes = 0;
  const invoke = (operation, ...args) => {
    const process = spawnSync('perl', ['-e', perl, dir, operation, ...args], { encoding: 'utf8' });
    assert.equal(process.status, 0, process.stderr);
    const { result, error } = JSON.parse(process.stdout);
    if (error) throw new Error(error);
    return result;
  };
  const controller = new Schema5DraftController({
    read: async () => invoke('read'),
    save: async (value, token) => {
      writes += 1;
      invoke('save', Buffer.from(JSON.stringify(value)).toString('base64'), token);
    },
    publish: async () => { throw new Error('No publishing'); },
    discard: async () => { throw new Error('No discard'); },
  });
  try {
    await writeFile(livePath, original);
    const state = await controller.reload();
    const items = schema5GridItems(live, 'start');
    items[0].h = 5;
    items[1].y = 5;
    items[2].y = 5;
    const saved = await controller.saveLayout('start', items, state.token);
    assert.equal(writes, 1, 'all page changes are one version-bound transaction');
    assert.deepEqual(saved.draft.pages[1].widgets.map((widget) => widget.grid.row), [6, 8]);
    assert.equal(await readFile(livePath, 'utf8'), original);
    assert.deepEqual(JSON.parse(await readFile(draftPath, 'utf8')), saved.draft);
    assert.deepEqual((await controller.reload()).draft, saved.draft);
    const draftBytes = await readFile(draftPath, 'utf8');
    const overflow = schema5GridItems(saved.draft, 'start');
    overflow[0].h = 1000;
    assert.throws(() => controller.saveLayout('start', overflow, saved.token), /Grenzen/);
    assert.equal(writes, 1, 'overflow never reaches persistence');
    assert.equal(await readFile(draftPath, 'utf8'), draftBytes);
    assert.equal(await readFile(livePath, 'utf8'), original);
  } finally {
    await rm(dir, { recursive: true });
  }
});

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
    const unsafe = { ...moved.draft.pages[0].widgets[0], html: '<script>alert(1)</script>' };
    const beforeUnsafe = await readFile(draftPath, 'utf8');
    await assert.rejects(first.saveWidget('start', unsafe, moved.token, 'update'), /HTML|Element|Tag/i);
    assert.equal(await readFile(draftPath, 'utf8'), beforeUnsafe, 'server rejects unsafe HTML without overwriting draft');
    assert.throws(() => first.snapshot(), /nicht geladen/);
    const afterUnsafe = await first.reload();
    assert.deepEqual(afterUnsafe.draft, moved.draft);
    const newWidget = { id: 'new', type: 'text', html: '<p>Neu</p>', grid: { col: 1, row: 7, w: 4, h: 1 } };
    const added = await first.saveWidget('start', newWidget, afterUnsafe.token, 'create');
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
    const navigation = { ...removed.draft.navigation, orientation: 'vertical' };
    const changedNav = await first.saveNavigation(navigation, removed.token);
    assert.equal(changedNav.draft.navigation.orientation, 'vertical');
    assert.deepEqual(changedNav.draft.pages, removed.draft.pages);
    assert.throws(() => first.saveNavigation(navigation, removed.token), /veraltet/);
    const restoredNav = await first.saveNavigation(removed.draft.navigation, changedNav.token);
    assert.deepEqual(restoredNav.draft, moved.draft);
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
    await assert.rejects(first.discardDraft(restoredNav.token), /veraltet/);
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

test('page management preserves content and rejects stale or destructive operations with real Perl', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cms-v5-pages-'));
  const initial = config();
  const original = JSON.stringify(initial, null, 2);
  const livePath = join(dir, 'config.json');
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
    const editor = new Schema5DraftController(transport);
    const initialState = await editor.reload();
    assert.throws(() => editor.deleteEmptyPage('start', initialState.token), /letzte Seite/);
    assert.throws(() => editor.addPage('bad/id', 'Seite', initialState.token), /Seiten-ID/);
    assert.throws(() => editor.addPage('second', '', initialState.token), /Seitentitel/);
    const added = await editor.addPage('second', 'Zweite', initialState.token);
    assert.deepEqual(added.live, initial);
    assert.throws(() => editor.addPage('third', 'Alt', initialState.token), /veraltet/);
    assert.throws(() => editor.addPage('second', 'Doppelt', added.token), /bereits vorhanden/);
    assert.throws(() => editor.deleteEmptyPage('start', added.token), /enthält Widgets/);
    assert.throws(() => editor.reorderPages(['start', 'start'], added.token), /Seitenreihenfolge/);
    assert.throws(() => editor.reorderPages(['start'], added.token), /Seitenreihenfolge/);
    assert.throws(() => editor.moveWidget('start', 'second', 'text',
      { col: 1, row: 1, w: 4, h: 2 }, added.token), /überschneidung/);
    assert.deepEqual(editor.snapshot(), added, 'rejected local edits do not mutate saved state');
    const moved = await editor.moveWidget('start', 'second', 'text',
      { col: 1, row: 2, w: 4, h: 2 }, added.token);
    assert.deepEqual(moved.draft.pages[0].widgets, [initial.pages[0].widgets[1]]);
    assert.deepEqual(moved.draft.pages[1].widgets, [initial.pages[0].widgets[0]]);
    const duplicate = await editor.saveWidget('start', {
      ...initial.pages[0].widgets[0], grid: { col: 1, row: 4, w: 4, h: 2 },
    }, moved.token, 'create');
    assert.throws(() => editor.moveWidget('second', 'start', 'text',
      { col: 1, row: 2, w: 4, h: 2 }, duplicate.token), /Widget-ID/);
    assert.deepEqual(editor.snapshot(), duplicate, 'duplicate destination does not remove either widget');
    const unique = await editor.deleteWidget('start', 'text', duplicate.token);
    assert.throws(() => editor.deleteEmptyPage('second', unique.token), /enthält Widgets/);
    const renamed = await editor.renamePage('second', 'Handbuch', unique.token);
    const reordered = await editor.reorderPages(['second', 'start'], renamed.token);
    assert.deepEqual(reordered.draft.pages.map((page) => page.id), ['second', 'start']);
    assert.equal(reordered.draft.pages[0].title, 'Handbuch');
    assert.equal(reordered.draft.pages[0].widgets[0].html, '<p>{{Temp:state}}</p>');
    assert.equal(reordered.draft.pages[1].widgets[0].html, '<span device="Temp" reading="state"></span>');
    assert.equal(await readFile(livePath, 'utf8'), original);
    const back = await editor.moveWidget('second', 'start', 'text',
      { col: 1, row: 2, w: 4, h: 2 }, reordered.token);
    const withNav = await editor.saveNavigation({
      ...back.draft.navigation, items: [{ page: 'second', label: 'Handbuch' }],
    }, back.token);
    const deleted = await editor.deleteEmptyPage('second', withNav.token);
    assert.equal(deleted.draft.navigation.items, undefined);
    assert.deepEqual(deleted.draft.pages.map((page) => page.id), ['start']);
    assert.deepEqual(deleted.draft.pages[0].widgets, [
      initial.pages[0].widgets[1], initial.pages[0].widgets[0],
    ]);
    assert.equal(await readFile(livePath, 'utf8'), original);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('grid editing is explicit, state-bound and never changes live bytes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cms-v5-grid-edit-'));
  const originalDocument = globalThis.document;
  const initial = config();
  initial.pages.push({ id: 'second', title: 'Zweite', widgets: [
    { id: 'clock', type: 'fhem-clock', style: 'digital', showSeconds: false, showDate: false, showWeekday: false,
      grid: { col: 1, row: 5, w: 2, h: 1 } },
  ] });
  const original = JSON.stringify(initial, null, 2);
  const livePath = join(dir, 'config.json');
  class Element {
    constructor() { this.children = []; }
    append(child) { this.children.push(child); }
    replaceChildren(...children) { this.children = children; }
  }
  globalThis.document = { createElement: () => new Element() };
  let grid;
  let changeOnEnable = false;
  let changeOtherOnUpdate = false;
  const GridStack = { init() {
    grid = {
      items: [], columns: 12, destroyed: 0, static: true,
      getColumn() { return this.columns; },
      makeWidget(wrapper, item) {
        wrapper.gridstackNode = { id: item.id };
        this.items.push({ ...item });
      },
      save() { return structuredClone(this.items); },
      update(wrapper, position) {
        Object.assign(this.items.find((item) => item.id === wrapper.gridstackNode.id), position);
        if (changeOtherOnUpdate) this.items[0].y += 1;
      },
      setStatic(value) {
        this.static = value;
        if (!value && changeOnEnable) this.items[0].y += 1;
      },
      destroy() { this.destroyed += 1; },
    };
    return grid;
  } };
  const invoke = (operation, ...args) => {
    const process = spawnSync('perl', ['-e', perl, dir, operation, ...args], { encoding: 'utf8' });
    assert.equal(process.error, undefined);
    assert.equal(process.status, 0, process.stderr);
    const { result, error } = JSON.parse(process.stdout);
    if (error) throw new Error(error);
    return result;
  };
  let release;
  let delaySave = false;
  let loseResponse = false;
  const transport = {
    read: async () => invoke('read'),
    save: async (value, token) => {
      if (delaySave) await new Promise((resolve) => { release = resolve; });
      invoke('save', Buffer.from(JSON.stringify(value)).toString('base64'), token);
      if (loseResponse) throw new Error('Antwort verloren');
    },
    publish: async (token) => invoke('publish', token),
    discard: async (token) => invoke('discard', token),
  };
  try {
    await writeFile(livePath, original);
    const controller = new Schema5DraftController(transport);
    const state = await controller.reload();
    const root = new Element();
    assert.throws(() => new Schema5GridEdit({ GridStack, root, controller, pageId: 'start', token: 'a'.repeat(64) }), /veraltet/);
    changeOnEnable = true;
    assert.throws(() => new Schema5GridEdit({ GridStack, root, controller, pageId: 'start', token: state.token }), /Aktivieren/);
    assert.equal(grid.destroyed, 1);
    assert.equal(root.children.length, 0);
    changeOnEnable = false;
    const cancelled = new Schema5GridEdit({ GridStack, root, controller, pageId: 'start', token: state.token });
    assert.equal(grid.static, false);
    assert.equal(root.children[0].children[0].children[0].textContent, 'Navigation');
    assert.equal(root.children[1].children[0].children[0].textContent, 'text: text');
    grid.items[1].y = 3;
    cancelled.close();
    cancelled.close();
    assert.equal(root.children.length, 0);
    assert.equal((await controller.reload()).draft, null);
    await assert.rejects(cancelled.save(), /nicht mehr aktiv/);

    const collision = new Schema5GridEdit({ GridStack, root, controller, pageId: 'start', token: state.token });
    grid.items[1].y = 0;
    await assert.rejects(collision.save(), /überschneidung/);
    assert.equal(grid.static, true);
    await assert.rejects(collision.save(), /nicht mehr aktiv/);
    collision.close();
    assert.equal(controller.snapshot().draft, null);

    const narrow = new Schema5GridEdit({ GridStack, root, controller, pageId: 'start', token: state.token });
    grid.columns = 1;
    await assert.rejects(narrow.save(), /12-Spalten/);
    narrow.close();
    assert.equal(controller.snapshot().draft, null);

    const precise = new Schema5GridEdit({ GridStack, root, controller, pageId: 'start', token: state.token });
    assert.throws(() => precise.setPosition('missing', { col: 1, row: 4, w: 1, h: 1 }), /Unbekannt/);
    assert.throws(() => precise.setPosition('text', { col: '9', row: 2, w: 4, h: 2 }), /Ungültige/);
    assert.throws(() => precise.setPosition('text', { col: 5, row: 2, w: 4, h: 2 }), /überschneidung/);
    precise.setPosition('__nav', { col: 1, row: 5, w: 12, h: 1 });
    assert.deepEqual(grid.items[0], { id: '__nav', x: 0, y: 4, w: 12, h: 1 });
    precise.setPosition('text', { col: 9, row: 2, w: 4, h: 2 });
    assert.deepEqual(grid.items[1], { id: 'text', x: 8, y: 1, w: 4, h: 2 });
    precise.close();
    assert.equal(controller.snapshot().draft, null, 'position changes are not persisted until save');

    const altered = new Schema5GridEdit({ GridStack, root, controller, pageId: 'start', token: state.token });
    changeOtherOnUpdate = true;
    assert.throws(() => altered.setPosition('text', { col: 9, row: 2, w: 4, h: 2 }), /weitere Rasterpositionen/);
    changeOtherOnUpdate = false;
    assert.equal(grid.static, true);
    await assert.rejects(altered.save(), /nicht mehr aktiv/);
    altered.close();
    assert.equal(controller.snapshot().draft, null);

    delaySave = true;
    const editor = new Schema5GridEdit({ GridStack, root, controller, pageId: 'start', token: state.token });
    grid.items[1].y = 3;
    const saving = editor.save();
    assert.equal(grid.static, true);
    assert.throws(() => editor.close(), /läuft noch/);
    await assert.rejects(editor.save(), /nicht mehr aktiv/);
    release();
    const saved = await saving;
    assert.equal(saved.draft.pages[0].widgets[0].grid.row, 4);
    assert.equal(saved.draft.pages[0].widgets[0].html, '<p>{{Temp:state}}</p>');
    assert.equal(saved.draft.pages[0].widgets[1].html, '<span device="Temp" reading="state"></span>');
    assert.deepEqual(saved.draft.pages[1], initial.pages[1]);
    assert.equal(await readFile(livePath, 'utf8'), original);
    editor.close();
    assert.equal(root.children.length, 0);

    delaySave = false;
    const stale = new Schema5GridEdit({ GridStack, root, controller, pageId: 'start', token: saved.token });
    const other = new Schema5DraftController(transport);
    const otherState = await other.reload();
    await other.renamePage('second', 'Anderer Tab', otherState.token);
    await assert.rejects(stale.save(), /veraltet|geändert/i);
    assert.throws(() => controller.snapshot(), /nicht geladen/);
    stale.close();
    const refreshed = await controller.reload();
    assert.equal(refreshed.draft.pages[1].title, 'Anderer Tab');
    loseResponse = true;
    const uncertain = new Schema5GridEdit({ GridStack, root, controller, pageId: 'start', token: refreshed.token });
    grid.items[1].x = 8;
    await assert.rejects(uncertain.save(), /Antwort verloren/);
    assert.equal(grid.static, true);
    await assert.rejects(uncertain.save(), /nicht mehr aktiv/);
    assert.throws(() => controller.snapshot(), /nicht geladen/);
    uncertain.close();
    const verified = await controller.reload();
    assert.equal(verified.draft.pages[0].widgets[0].grid.col, 9);
    assert.equal(verified.draft.pages[1].title, 'Anderer Tab');
    assert.equal(await readFile(livePath, 'utf8'), original);
  } finally {
    globalThis.document = originalDocument;
    await rm(dir, { recursive: true });
  }
});
