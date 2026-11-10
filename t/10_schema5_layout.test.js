import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { applySchema5GridItems, arrangeSchema5Widgets, createSchema5Grid, resizeSchema5Grid, schema5GridItems } from '../www/fhem-cms/js/fcui-schema5-layout.js';

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

test('schema 5 layout fails closed for invalid positions and widget collisions', () => {
  const config = source();
  const items = schema5GridItems(config, 'a');
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

test('automatic arrangement packs left and up in visual order without changing navigation, sizes or other pages', () => {
  for (const columns of [12, 24, 48, 96, 192]) {
    const config = source();
    config.settings.gridColumns = columns;
    config.navigation.grid = { col: 1, row: 1, w: 2, h: 5 };
    config.pages[0].widgets = [
      { id: 'last', type: 'text', html: '<p>Last</p>', grid: { col: 1, row: 30, w: 3, h: 2 } },
      { id: 'right', type: 'text', html: '<p>Right</p>', grid: { col: 8, row: 10, w: 3, h: 4 } },
      { id: 'first', type: 'text', html: '<p>First</p>', grid: { col: 3, row: 10, w: 4, h: 2 } },
      { id: 'wide', type: 'text', html: '<p>Wide</p>', grid: { col: 1, row: 20, w: columns, h: 3 } },
    ];
    config.pages[1].widgets[0].grid = { col: 4, row: 2, w: 1, h: 1 };
    const before = structuredClone(config);
    const changed = arrangeSchema5Widgets(config, 'a');
    const ordered = [...changed.pages[0].widgets].sort((a, b) => a.grid.row - b.grid.row || a.grid.col - b.grid.col);
    assert.deepEqual(ordered.map((widget) => widget.id), ['first', 'right', 'wide', 'last']);
    assert.deepEqual(ordered[0].grid, { col: 3, row: 1, w: 4, h: 2 });
    assert.deepEqual(ordered[1].grid, { col: 7, row: 1, w: 3, h: 4 });
    assert.deepEqual(ordered[2].grid, { col: 1, row: 6, w: columns, h: 3 });
    assert.deepEqual(ordered[3].grid, { col: 1, row: 9, w: 3, h: 2 });
    for (const [i, widget] of changed.pages[0].widgets.entries()) {
      const { grid, ...content } = widget;
      const { grid: original, ...originalContent } = config.pages[0].widgets[i];
      assert.deepEqual(content, originalContent, 'stored order and all content survive');
      assert.equal(grid.w, original.w);
      assert.equal(grid.h, original.h);
    }
    assert.deepEqual(changed.navigation, config.navigation);
    assert.deepEqual(changed.pages[1], config.pages[1]);
    assert.deepEqual(config, before, 'input not mutated');
    assert.deepEqual(arrangeSchema5Widgets(changed, 'a'), changed, 'repeating is a no-op');
    const script = 'use strict; use warnings; use JSON::PP (); require "./FHEM/01_FHEMCMS.pm";'
      + ' local $/; my $v=JSON::PP->new->decode(<STDIN>); my $e=FHEMCMS_ValidateConfig($v,5); die $e if defined $e;';
    const result = spawnSync('perl', ['-e', script], { input: JSON.stringify(changed), encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
});

test('automatic arrangement respects horizontal navigation, empty pages and the last raster row', () => {
  const config = source();
  const changed = arrangeSchema5Widgets(config, 'a');
  assert.deepEqual(changed.pages[0].widgets.map((widget) => widget.grid), [
    { col: 1, row: 2, w: 2, h: 2 }, { col: 3, row: 2, w: 1, h: 1 },
  ]);
  config.pages[0].widgets = [];
  assert.deepEqual(arrangeSchema5Widgets(config, 'a'), config);
  config.pages[0].widgets = [{ id: 'tall', grid: { col: 1, row: 2, w: 12, h: 999 } }];
  assert.deepEqual(arrangeSchema5Widgets(config, 'a'), config);
  assert.throws(() => arrangeSchema5Widgets(config, 'missing'), /Unbekannte Seite/);
  config.pages[0].widgets[0].grid.row = 1;
  assert.throws(() => arrangeSchema5Widgets(config, 'a'), /überschneidung/);
});

test('automatic arrangement stays stable for 200 mixed-size widgets at maximum raster density', () => {
  const config = source();
  config.settings.gridColumns = 192;
  config.pages[0].widgets = Array.from({ length: 200 }, (_, i) => ({
    id: `widget${i}`, grid: { col: 20 + i % 10, row: 5 * i + 1, w: 1 + i % 20, h: 1 + i % 4 },
  })).reverse();
  const changed = arrangeSchema5Widgets(config, 'a');
  assert.deepEqual(arrangeSchema5Widgets(changed, 'a'), changed);
  const ordered = [...changed.pages[0].widgets].sort((a, b) => a.grid.row - b.grid.row || a.grid.col - b.grid.col);
  assert.deepEqual(ordered.map((widget) => widget.id), Array.from({ length: 200 }, (_, i) => `widget${i}`));
  assert.ok(Math.max(...ordered.map((widget) => widget.grid.row + widget.grid.h)) < 100);
});

test('navigation changes move collisions down on every page without changing sizes or content', () => {
  const config = source();
  config.navigation.grid = { col: 1, row: 1, w: 2, h: 3 };
  config.pages[0].widgets[0].grid = { col: 3, row: 1, w: 4, h: 2 };
  config.pages[0].widgets[1].grid = { col: 3, row: 3, w: 4, h: 2 };
  const clock = config.pages[1].widgets[0];
  clock.grid = { col: 3, row: 1, w: 2, h: 1 };
  config.pages[1].widgets = [
    { ...clock, id: 'later', grid: { col: 3, row: 2, w: 2, h: 1 } },
    clock,
    { ...clock, id: 'untouched', grid: { col: 9, row: 1, w: 2, h: 1 } },
  ];
  const before = structuredClone(config);
  const items = schema5GridItems(config, 'a');
  items[0].w = 4;
  // Gridstack already pushes widgets on the visible page.
  items[1].y = 3;
  items[2].y = 5;
  const changed = applySchema5GridItems(config, 'a', items);
  assert.deepEqual(changed.navigation.grid, { col: 1, row: 1, w: 4, h: 3 });
  assert.deepEqual(changed.pages.map((page) => page.widgets.map((widget) => widget.grid.row)), [[4, 6], [5, 4, 1]]);
  for (const [p, page] of changed.pages.entries()) {
    assert.deepEqual(page.widgets.map(({ grid, ...widget }) => widget),
      before.pages[p].widgets.map(({ grid, ...widget }) => widget));
    for (const [i, widget] of page.widgets.entries()) {
      const { row, ...grid } = widget.grid;
      const { row: originalRow, ...originalGrid } = before.pages[p].widgets[i].grid;
      assert.deepEqual(grid, originalGrid);
      assert.ok(row >= originalRow);
    }
    schema5GridItems(changed, page.id);
  }
  assert.deepEqual(config, before, 'input is never mutated');
  const smaller = schema5GridItems(changed, 'a');
  smaller[0].w = 2;
  const shrunk = applySchema5GridItems(changed, 'a', smaller);
  assert.deepEqual(shrunk.pages, changed.pages, 'shrinking never pulls widgets upward');
  assert.deepEqual(applySchema5GridItems(shrunk, 'a', schema5GridItems(shrunk, 'a')), shrunk);
  const script = 'use strict; use warnings; use JSON::PP (); require "./FHEM/01_FHEMCMS.pm";'
    + ' local $/; my $v=JSON::PP->new->decode(<STDIN>); my $e=FHEMCMS_ValidateConfig($v,5); die $e if defined $e;';
  const result = spawnSync('perl', ['-e', script], { input: JSON.stringify(changed), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('navigation reflow rejects row overflow and unrelated widget overlaps without mutating input', () => {
  const config = source();
  config.navigation.grid = { col: 1, row: 999, w: 1, h: 1 };
  config.pages[1].widgets[0].grid = { col: 1, row: 1000, w: 1, h: 1 };
  const before = structuredClone(config);
  const items = schema5GridItems(config, 'a');
  items[0].h = 2;
  assert.throws(() => applySchema5GridItems(config, 'a', items), /Grenzen/);
  assert.deepEqual(config, before);
  items[0].y = 0;
  items[0].h = 1;
  Object.assign(items[2], { x: items[1].x, y: items[1].y });
  assert.throws(() => applySchema5GridItems(config, 'a', items), /überschneidung/);
  assert.deepEqual(config, before);
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
