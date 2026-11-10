import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { applySchema5GridItems, createSchema5Grid, resizeSchema5Grid, schema5GridItems } from '../www/fhem-cms/js/fcui-schema5-layout.js';

const source = () => ({
  schemaVersion: 5, theme: 'light', settings: { layoutMode: 'grid', gridColumns: 12 },
  navigation: { orientation: 'horizontal', grid: { col: 1, row: 1, w: 12, h: 1 }, items: [{ page: 'a' }] },
  pages: [
    { id: 'a', title: 'A', widgets: [
      { id: 'text', type: 'text', html: '<p>{{Temp:state}}</p>', grid: { col: 2, row: 5, w: 2, h: 2 } },
      { id: 'html', type: 'fhem-html', devices: ['Temp'], html: '<span device="Temp" reading="state"></span>',
        grid: { col: 12, row: 1000, w: 1, h: 1 } },
    ] },
    { id: 'b', title: 'B', widgets: [
      { id: 'other', type: 'fhem-clock', style: 'digital', showSeconds: false, showDate: false, showWeekday: false,
        grid: { col: 1, row: 2, w: 1, h: 1 } },
    ] },
  ],
});

test('title alignment is optional, validated and preserved by frontend and Perl', () => {
  const script = 'use strict; use warnings; use JSON::PP (); require "./FHEM/01_FHEMCMS.pm";'
    + ' local $/; my $v=JSON::PP->new->decode(<STDIN>); my $e=FHEMCMS_ValidateConfig($v,5); print $e if defined $e;';
  for (const alignment of [undefined, 'left', 'center', 'right', '', 'justify', null, [], {}, '<script>']) {
    const config = source();
    if (alignment !== undefined) config.settings.titleAlign = alignment;
    const valid = alignment === undefined || ['left', 'center', 'right'].includes(alignment);
    const result = spawnSync('perl', ['-e', script], { input: JSON.stringify(config), encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    if (valid) {
      assert.equal(result.stdout, '');
      assert.deepEqual(applySchema5GridItems(config, 'a', schema5GridItems(config, 'a')), config);
    } else {
      assert.match(result.stdout, /titleAlign/);
      assert.throws(() => schema5GridItems(config, 'a'), /Titelausrichtung/);
    }
  }
});

test('schema 5 layout converts exact coordinates and roundtrips without changing content', () => {
  const config = source();
  const before = structuredClone(config);
  const items = schema5GridItems(config, 'a');
  assert.deepEqual(items, [
    { id: '__nav', x: 0, y: 0, w: 12, h: 1 },
    { id: 'text', x: 1, y: 4, w: 2, h: 2 },
    { id: 'html', x: 11, y: 999, w: 1, h: 1 },
  ]);
  assert.deepEqual(applySchema5GridItems(config, 'a', items), config);
  assert.deepEqual(applySchema5GridItems(config, 'a', [
    { id: '__nav', w: 12 }, { id: 'text', x: 1, y: 4, w: 2, h: 2 }, { id: 'html', x: 11, y: 999 },
  ]), config, 'Gridstack omits default coordinates and sizes');
  items[1].x = 5;
  const changed = applySchema5GridItems(config, 'a', items);
  assert.equal(changed.pages[0].widgets[0].grid.col, 6);
  assert.deepEqual(config, before);
  assert.equal(changed.pages[0].widgets[0].html, '<p>{{Temp:state}}</p>');
  assert.equal(changed.pages[0].widgets[1].html, '<span device="Temp" reading="state"></span>');
  const script = 'use strict; use warnings; use JSON::PP (); require "./FHEM/01_FHEMCMS.pm";'
    + ' local $/; my $v=JSON::PP->new->decode(<STDIN>); my $e=FHEMCMS_ValidateConfig($v,5); die $e if defined $e;';
  const result = spawnSync('perl', ['-e', script], { input: JSON.stringify(changed), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('schema 5 layout fails closed for invalid and cross-page collisions', () => {
  const config = source();
  const items = schema5GridItems(config, 'a');
  const invalid = structuredClone(items);
  invalid[0].y = 1;
  assert.throws(() => applySchema5GridItems(config, 'a', invalid), /Seite b/);
  assert.throws(() => applySchema5GridItems(config, 'a', items.slice(1)), /fehlende/);
  assert.throws(() => applySchema5GridItems(config, 'a', [items[0], items[1], items[1]]), /doppelte/);
  const outOfBounds = structuredClone(items);
  outOfBounds[2].h = 2;
  assert.throws(() => applySchema5GridItems(config, 'a', outOfBounds), /Grenzen/);
  const overlap = structuredClone(items);
  overlap[1].y = 0;
  assert.throws(() => applySchema5GridItems(config, 'a', overlap), /überschneidung/);
  const incompatible = source();
  incompatible.schemaVersion = 4;
  assert.throws(() => schema5GridItems(incompatible, 'a'), /Schema 5/);
  assert.throws(() => schema5GridItems(config, 'missing'), /Unbekannte Seite/);
});

test('raster changes scale both axes on every page, preserve content and pass the backend validator', () => {
  const config = source();
  config.pages[0].widgets[1].grid.row = 20;
  const before = structuredClone(config);
  for (const columns of [12, 24, 48, 96, 192]) {
    const changed = resizeSchema5Grid(config, columns);
    const scale = columns / 12;
    assert.equal(changed.settings.gridColumns, columns);
    assert.deepEqual(changed.navigation.grid, { col: 1, row: 1, w: columns, h: scale });
    assert.deepEqual(changed.pages[0].widgets[0].grid,
      { col: scale + 1, row: 4 * scale + 1, w: 2 * scale, h: 2 * scale });
    assert.deepEqual(changed.pages[1].widgets[0].grid, { col: 1, row: scale + 1, w: scale, h: scale });
    assert.equal(changed.pages[0].widgets[0].html, config.pages[0].widgets[0].html);
    assert.equal(changed.pages[0].widgets[1].html, config.pages[0].widgets[1].html);
    assert.deepEqual(resizeSchema5Grid(changed, 12), config, 'exact roundtrip retains every field');
    const script = 'use strict; use warnings; use JSON::PP (); require "./FHEM/01_FHEMCMS.pm";'
      + ' local $/; my $v=JSON::PP->new->decode(<STDIN>); my $e=FHEMCMS_ValidateConfig($v,5); die $e if defined $e;';
    const result = spawnSync('perl', ['-e', script], { input: JSON.stringify(changed), encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const root = { children: [] };
    const GridStack = { init(options) {
      assert.equal(options.column, columns);
      assert.equal(options.minRow, 8 * scale);
      throw new Error('options verified');
    } };
    assert.throws(() => createSchema5Grid(GridStack, root, changed, 'a', () => {}, true), /options verified/);
  }
  assert.deepEqual(config, before);
  assert.throws(() => resizeSchema5Grid(config, 36), /Rastergröße/);
  assert.throws(() => resizeSchema5Grid(source(), 48), /Grenzen/, 'row overflow is reported, not clipped');
});

test('coarsening rounds and resolves collisions below the shared navigation without losing widgets', () => {
  const config = source();
  config.settings.gridColumns = 48;
  config.navigation.grid = { col: 1, row: 1, w: 48, h: 4 };
  config.pages[0].widgets[0].grid = { col: 1, row: 5, w: 1, h: 1 };
  config.pages[0].widgets[1].grid = { col: 2, row: 5, w: 1, h: 1 };
  config.pages[1].widgets[0].grid = { col: 48, row: 5, w: 1, h: 1 };
  const coarse = resizeSchema5Grid(config, 12);
  assert.deepEqual(coarse.pages[0].widgets.map((widget) => widget.grid), [
    { col: 1, row: 2, w: 1, h: 1 }, { col: 1, row: 3, w: 1, h: 1 },
  ]);
  assert.deepEqual(coarse.pages[1].widgets[0].grid, { col: 12, row: 2, w: 1, h: 1 });
  for (const page of coarse.pages) assert.equal(schema5GridItems(coarse, page.id).length, page.widgets.length + 1);
  assert.deepEqual(coarse.pages[0].widgets.map((widget) => widget.id), config.pages[0].widgets.map((widget) => widget.id));
});

test('Gridstack initialization refuses to silently reposition or drop elements', () => {
  const previous = globalThis.document;
  const element = () => ({
    children: [], append(child) { this.children.push(child); },
    replaceChildren() { this.children = []; },
  });
  globalThis.document = { createElement: element };
  try {
    let behavior = 'exact';
    let destroyed = false;
    const root = element();
    const grid = {
      items: [],
      getColumn() { return 12; },
      makeWidget(wrapper, item) { this.items.push({ ...item }); },
      save() {
        const items = structuredClone(this.items);
        if (behavior === 'move') items[1].y += 1;
        if (behavior === 'drop') items.pop();
        return items;
      },
      destroy(remove) { assert.equal(remove, false); destroyed = true; },
    };
    const api = { init(options) {
      assert.equal(options.column, 12);
      assert.equal(options.mode, 'float');
      assert.equal(options.staticGrid, true);
      grid.items = [];
      return grid;
    } };
    const rendered = [];
    assert.equal(createSchema5Grid(api, root, source(), 'a', (id) => {
      rendered.push(id);
      assert.equal(grid.items.length, 3, 'all positions are established before rendering');
      return element();
    }), grid);
    assert.equal(root.children.length, 3);
    assert.deepEqual(rendered, ['__nav', 'text', 'html']);
    root.replaceChildren();
    rendered.length = 0;
    behavior = 'move';
    assert.throws(() => createSchema5Grid(api, root, source(), 'a', (id) => {
      rendered.push(id);
      return element();
    }), /Position verändert/);
    assert.equal(destroyed, true);
    assert.equal(root.children.length, 0);
    assert.deepEqual(rendered, [], 'invalid positions never instantiate widget content');
    behavior = 'drop';
    assert.throws(() => createSchema5Grid(api, root, source(), 'a', (id) => {
      rendered.push(id);
      return element();
    }), /verloren/);
    assert.equal(root.children.length, 0);
    assert.deepEqual(rendered, [], 'missing grid elements never instantiate widget content');
    behavior = 'exact';
    destroyed = false;
    assert.throws(() => createSchema5Grid(api, root, source(), 'a', () => {
      throw new Error('Inhalt fehlgeschlagen');
    }), /Inhalt fehlgeschlagen/);
    assert.equal(destroyed, true, 'render failures destroy the grid');
    assert.equal(root.children.length, 0, 'render failures remove all grid elements');
  } finally {
    globalThis.document = previous;
  }
});
