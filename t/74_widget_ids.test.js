import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeWidgetIds, widgetIds } from '../www/fhem-cms/js/widget-ids.js';
import { Schema5DraftController } from '../www/fhem-cms/js/fcui-schema5-draft.js';

const config = () => ({
  schemaVersion: 5, theme: 'dark', settings: { layoutMode: 'grid', gridColumns: 12 },
  navigation: { grid: { col: 1, row: 1, w: 12, h: 1 } },
  pages: ['one', 'two'].map((id) => ({ id, title: id, widgets: [
    { id: 'w1', type: 'text', html: id, grid: { col: 1, row: 2, w: 4, h: 2 } },
  ] })),
});

test('global ID normalization reserves existing suffixes, preserves content and is idempotent', () => {
  const source = config();
  source.pages[0].widgets.push({ ...source.pages[0].widgets[0], id: 'w1-2', grid: { col: 5, row: 2, w: 4, h: 2 } });
  const normalized = normalizeWidgetIds(source);
  assert.equal(normalized.pages[1].widgets[0].id, 'w1-3');
  assert.equal(normalized.pages[1].widgets[0].html, 'two');
  assert.equal(source.pages[1].widgets[0].id, 'w1');
  assert.deepEqual(normalizeWidgetIds(normalized), normalized);
  const long = 'w'.repeat(64);
  source.pages.forEach(page => { page.widgets[0].id = long; });
  assert.equal(normalizeWidgetIds(source).pages[1].widgets[0].id.length, 64);
});

test('moving legacy duplicate IDs preserves both widgets and writes only the draft', async () => {
  const live = config();
  let state = { live, draft: null, token: 'a'.repeat(64) };
  const controller = new Schema5DraftController({
    read: async () => structuredClone(state),
    save: async draft => { state = { ...state, draft, token: 'b'.repeat(64) }; },
    publish: async () => {},
    discard: async () => {},
  });
  await controller.reload();
  const result = await controller.moveWidget('one', 'two', 'w1',
    { col: 5, row: 2, w: 4, h: 2 }, state.token);
  assert.equal(result.draft.pages[0].widgets.length, 0);
  assert.deepEqual(result.draft.pages[1].widgets.map(widget => widget.html), ['two', 'one']);
  assert.equal(widgetIds(result.draft).size, 2);
  assert.equal(live.pages[0].widgets.length, 1);
  assert.equal(live.pages[1].widgets[0].id, 'w1');
});

test('widget copies reserve IDs on other pages and arbitrary draft writes normalize old collisions', async () => {
  const live = config();
  live.pages[1].widgets[0].id = 'w1-copy';
  let state = { live, draft: null, token: 'a'.repeat(64) };
  const controller = new Schema5DraftController({
    read: async () => structuredClone(state),
    save: async draft => { state = { ...state, draft }; },
    publish: async () => {},
    discard: async () => {},
  });
  await controller.reload();
  const result = await controller.duplicateWidget('one', 'w1', state.token);
  assert.equal(result.draft.pages[0].widgets[1].id, 'w1-copy-2');
  const normalized = await controller.saveDraft(config(), state.token);
  assert.equal(widgetIds(normalized.draft).size, 2);
});
