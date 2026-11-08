import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inspectLegacyLayout } from '../fcui/layout-migration.js';

const grid = (col, row, w, h) => ({ col, row, w, h });

test('analyses navigation and each page without changing source data', () => {
  const config = {
    schemaVersion: 4,
    settings: { gridColumns: 12 },
    navigation: { grid: grid(1, 1, 48, 1) },
    pages: [
      { id: 'one', widgets: [
        { id: 'exact', grid: grid(5, 2, 8, 3) },
        { id: 'manual', grid: grid(2, 2, 3, 3) },
      ] },
      { id: 'two', widgets: [{ id: 'edge', grid: grid(45, 1, 4, 1) }] },
    ],
  };
  const before = structuredClone(config);
  const result = inspectLegacyLayout(config);
  assert.deepEqual(config, before);
  assert.deepEqual(result.navigation.exact, grid(1, 1, 12, 1));
  assert.deepEqual(result.pages[0].widgets[0].exact, grid(2, 2, 2, 3));
  assert.deepEqual(result.pages[0].widgets[1].issues, ['col', 'w']);
  assert.equal(result.pages[0].widgets[1].exact, null);
  assert.deepEqual(result.pages[1].widgets[0].exact, grid(12, 1, 1, 1));
  assert.deepEqual(result.pages[1].collisions, [[
    { type: 'navigation', id: null }, { type: 'widget', id: 'edge' },
  ]]);
  assert.equal(result.requiresEffectiveNavigation, false);
});

test('reports every overlap per page without treating shared edges as overlaps', () => {
  const result = inspectLegacyLayout({ schemaVersion: 4, pages: [
    { id: 'a', widgets: [
      { id: 'x', grid: grid(1, 1, 8, 2) },
      { id: 'y', grid: grid(5, 2, 8, 2) },
      { id: 'z', grid: grid(13, 1, 4, 1) },
    ] },
    { id: 'b', widgets: [{ id: 'x', grid: grid(1, 1, 8, 2) }] },
  ] });
  assert.deepEqual(result.pages[0].collisions, [[
    { type: 'widget', id: 'x' }, { type: 'widget', id: 'y' },
  ]]);
  assert.deepEqual(result.pages[1].collisions, []);
  assert.equal(result.navigation, null);
  assert.equal(result.requiresEffectiveNavigation, true);
});

test('accepts numeric strings accepted by the existing backend', () => {
  const result = inspectLegacyLayout({
    schemaVersion: '4',
    pages: [{ id: 'a', widgets: [{ id: 'w', grid: grid('05', '2', '08', '3') }] }],
  });
  assert.deepEqual(result.pages[0].widgets[0].exact, grid(2, 2, 2, 3));
});

test('rejects invalid schema, geometry and ambiguous identifiers', () => {
  const config = { schemaVersion: 4, pages: [{ id: 'a', widgets: [{ id: 'w', grid: grid(1, 1, 4, 1) }] }] };
  for (const change of [
    (c) => { c.schemaVersion = 5; },
    (c) => { c.pages[0].widgets[0].grid.col = 0; },
    (c) => { c.pages[0].widgets[0].grid.w = 49; },
    (c) => { c.pages[0].widgets[0].grid.col = 1.5; },
    (c) => { c.pages[0].widgets.push(structuredClone(c.pages[0].widgets[0])); },
    (c) => { c.pages.push(structuredClone(c.pages[0])); },
    (c) => { c.navigation = {}; },
  ]) {
    const bad = structuredClone(config);
    change(bad);
    assert.throws(() => inspectLegacyLayout(bad), /Schema|Ungültig/);
  }
});
