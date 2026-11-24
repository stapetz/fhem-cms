import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pinCanvasPoint, pinImageFrame, pinPercentPoint, validatePinPage } from '../www/fhem-cms/js/pin-layout.js';
import { changePageLayout, schema5GridItems } from '../www/fhem-cms/js/fcui-schema5-layout.js';

const canvas = {width: 1280, height: 800};
const config = () => ({
  schemaVersion: 6, settings: {layoutMode: 'grid', gridColumns: 12},
  navigation: {grid: {col: 1, row: 1, w: 12, h: 1}},
  pages: [{id: 'home', title: 'Start', layoutMode: 'freeform', canvas, widgets: [
    {id: 'one', type: 'text', markdown: 'Bestand', rect: {x: 400, y: 200, w: 200, h: 120}},
  ]}],
});

test('optional Pin page fields are strict, Freeform-only and never migrated on read', () => {
  for (const renderAsPins of [true, false]) for (const backgroundDim of [0, .125, .5, 1e-7]) {
    const state = config();
    Object.assign(state.pages[0], {renderAsPins, backgroundDim});
    const bytes = JSON.stringify(state);
    schema5GridItems(state, 'home');
    assert.equal(JSON.stringify(state), bytes);
  }
  for (const [field, values] of [
    ['renderAsPins', [undefined, null, 0, 1, 'true', [], {}]],
    ['backgroundDim', [undefined, null, false, true, '0.5', -.01, .501, Infinity, NaN, [], {}]],
  ]) {
    for (const value of values) {
      const state = config();
      state.pages[0][field] = value;
      assert.throws(() => schema5GridItems(state, 'home'), new RegExp(field));
    }
    for (const schemaVersion of [5, 6]) {
      assert.throws(() => validatePinPage({layoutMode: 'grid', [field]: field === 'renderAsPins' ? false : 0},
        schemaVersion), /nur auf Schema-6-Freeform/);
    }
  }
  const legacy = config();
  changePageLayout(legacy, 'home', 'grid');
  legacy.schemaVersion = 5;
  const bytes = JSON.stringify(legacy);
  schema5GridItems(legacy, 'home');
  assert.equal(JSON.stringify(legacy), bytes, 'old grid data and absent fields stay absent');
});

test('returning to Grid clears optional page fields without leaking to other pages', () => {
  const state = config();
  Object.assign(state.pages[0], {renderAsPins: true, backgroundDim: .25});
  state.pages[0].widgets[0].forceCard = false;
  const other = structuredClone(state.pages[0]);
  other.id = 'other';
  other.widgets[0].id = 'two';
  state.pages.push(other);
  const bytes = JSON.stringify(other);
  changePageLayout(state, 'home', 'grid');
  assert.equal(Object.hasOwn(state.pages[0], 'renderAsPins'), false);
  assert.equal(Object.hasOwn(state.pages[0], 'backgroundDim'), false);
  assert.equal(Object.hasOwn(state.pages[0].widgets[0], 'forceCard'), false);
  assert.equal(JSON.stringify(state.pages[1]), bytes);
});

test('forceCard accepts only real Freeform booleans and leaves old data alone', () => {
  for (const value of [true, false]) {
    const state = config();
    state.pages[0].widgets[0].forceCard = value;
    const bytes = JSON.stringify(state);
    schema5GridItems(state, 'home');
    assert.equal(JSON.stringify(state), bytes);
  }
  for (const value of [undefined, null, 0, 1, 'true', [], {}]) {
    const state = config();
    state.pages[0].widgets[0].forceCard = value;
    assert.throws(() => schema5GridItems(state, 'home'), /forceCard/);
  }
  for (const schema of [5, 6]) {
    const state = config();
    changePageLayout(state, 'home', 'grid');
    state.schemaVersion = schema;
    state.pages[0].widgets[0].forceCard = false;
    assert.throws(() => schema5GridItems(state, 'home'), /forceCard/);
  }
});

test('image frames use centred contain, never stretch, with explicit no-image Canvas fallback', () => {
  assert.deepEqual(pinImageFrame(canvas), {x: 0, y: 0, w: 1280, h: 800});
  assert.deepEqual(pinImageFrame(canvas, {width: 1000, height: 1000}), {x: 240, y: 0, w: 800, h: 800});
  assert.deepEqual(pinImageFrame(canvas, {width: 1600, height: 800}), {x: 0, y: 80, w: 1280, h: 640});
  assert.deepEqual(pinImageFrame(canvas, {width: 1280, height: 800}), {x: 0, y: 0, w: 1280, h: 800});
  for (const image of [null, {}, {width: 0, height: 100}, {width: 1.5, height: 1},
    {width: Infinity, height: 1}, {width: '100', height: 100}, {width: 100, height: -1}]) {
    assert.throws(() => pinImageFrame(canvas, image), /Bildmaße/);
  }
  assert.throws(() => pinImageFrame({width: 0, height: 800}), /Canvas/);
});

test('Pin projections round percentages, clamp the image edges and preserve physical image anchors', () => {
  const frame = pinImageFrame(canvas, {width: 1000, height: 1000});
  assert.deepEqual(pinPercentPoint({x: 580, y: 488}, frame), {centerX: 42.5, centerY: 61});
  assert.deepEqual(pinCanvasPoint({centerX: 42.5, centerY: 61}, frame), {x: 580, y: 488});
  assert.deepEqual(pinPercentPoint({x: 0, y: 900}, frame), {centerX: 0, centerY: 100});
  assert.deepEqual(pinPercentPoint({x: 581.2345, y: 488.9876}, frame), {centerX: 42.65, centerY: 61.12});
  const position = {centerX: 42.5, centerY: 61};
  for (const size of [{width: 390, height: 844}, {width: 820, height: 1180},
    {width: 1920, height: 1080}]) {
    const target = pinImageFrame(size, {width: 1000, height: 1000});
    const point = pinCanvasPoint(position, target);
    assert.deepEqual(pinPercentPoint(point, target), position);
    assert.ok(Math.abs((point.x-target.x)/target.w-.425) < 1e-10);
    assert.ok(Math.abs((point.y-target.y)/target.h-.61) < 1e-10);
  }
  for (const frame of [null, {}, {x: 0, y: 0, w: 0, h: 1}, {x: NaN, y: 0, w: 1, h: 1}]) {
    assert.throws(() => pinPercentPoint({x: 0, y: 0}, frame), /Bildbezugsfläche/);
    assert.throws(() => pinCanvasPoint(position, frame), /Bildbezugsfläche/);
  }
  for (const point of [null, {}, {x: Infinity, y: 0}, {x: '0', y: 0}]) {
    assert.throws(() => pinPercentPoint(point, frame), /Mittelpunkt/);
  }
  for (const point of [null, {}, {centerX: -.01, centerY: 0}, {centerX: 101, centerY: 0},
    {centerX: 0, centerY: NaN}, {centerX: '0', centerY: 0}]) {
    assert.throws(() => pinCanvasPoint(point, frame), /Position/);
  }
});
