import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_CANVAS, freeformReadingOrder, freeformScale } from '../www/fhem-cms/js/fcui-freeform-layout.js';
import { changePageLayout, resizeSchema5Grid, schema5GridItems } from '../www/fhem-cms/js/fcui-schema5-layout.js';
import { freeformGesture } from '../www/fhem-cms/js/fcui-freeform-edit.js';

const config = () => ({
  schemaVersion: 5, settings: {layoutMode: 'grid', gridColumns: 12},
  navigation: {grid: {col: 1, row: 1, w: 12, h: 1}},
  pages: [{id: 'home', widgets: [{id: 'a', grid: {col: 1, row: 2, w: 4, h: 2}}]},
    {id: 'other', widgets: []}],
});

test('switches mode with measured bounds and keeps other pages and original grid positions', () => {
  const state = config();
  const measured = {x: 31, y: 80, w: 150, h: 62};
  changePageLayout(state, 'home', 'freeform', {...DEFAULT_CANVAS}, new Map([['a', measured]]));
  assert.equal(state.schemaVersion, 6);
  assert.deepEqual(state.pages[0].widgets[0].rect, {...measured, z: 1});
  assert.deepEqual(state.pages[1], config().pages[1]);
  state.pages[0].widgets.push({id: 'new', rect: {x: 0, y: 0, w: 30, h: 30}});
  const resized = resizeSchema5Grid(state, 24);
  assert.deepEqual(resized.pages[0].widgets[0].rect, {...measured, z: 1});
  changePageLayout(state, 'home', 'grid');
  assert.deepEqual(state.pages[0].widgets[0], config().pages[0].widgets[0]);
  assert.equal(state.schemaVersion, 6);
  assert.equal(schema5GridItems(state, 'home').length, 3);
});

test('fits, fills and uses one-to-one canvas sizes', () => {
  assert.equal(freeformScale(DEFAULT_CANVAS, 640, 200), 0.25);
  assert.equal(freeformScale({...DEFAULT_CANVAS, scaling: 'width'}, 640, 200), 0.5);
  assert.equal(freeformScale({...DEFAULT_CANVAS, scaling: 'none'}, 640, 200), 1);
});

test('drag and resize find the nearest guide; Alt disables raster and guides', () => {
  const canvas = {width: 200, height: 200, snapGrid: 10};
  const rect = {x: 30, y: 12, w: 40, h: 50};
  const widgets = [{rect: {x: 83, y: 100, w: 20, h: 20}}];
  assert.deepEqual(freeformGesture(rect, 'e', 14, 0, canvas, widgets, false),
    {rect: {...rect, w: 53}, guides: [['x', 83]]});
  assert.deepEqual(freeformGesture(rect, 'e', 14, 0, canvas, widgets, true),
    {rect: {...rect, w: 54}, guides: []});
  assert.equal(freeformGesture(rect, 'w', 100, 0, canvas, [], true).rect.w, 10);
  assert.equal(freeformGesture(rect, 'move', -200, 300, canvas, [], true).rect.y, 150);
});

test('mobile reader order clusters rows and is deterministic for equal coordinates', () => {
  const widgets = [{id: 'right', rect: {x: 80, y: 10}}, {id: 'left', rect: {x: 10, y: 35}},
    {id: 'next', rect: {x: 0, y: 41}}, {id: 'same', rect: {x: 10, y: 35}}];
  assert.deepEqual(freeformReadingOrder(widgets).map(w => w.id), ['left', 'same', 'right', 'next']);
});
