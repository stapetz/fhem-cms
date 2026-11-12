import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fitLinkWidget, linkBounds, linkHref, validateLinkItems, validLinkUrl } from '../www/fhem-cms/js/link-widget.js';
import { Schema5DraftController } from '../www/fhem-cms/js/fcui-schema5-draft.js';
import { Schema5WidgetSession } from '../www/fhem-cms/js/fcui-schema5-widget-session.js';
import { resizeSchema5Grid, schema5GridItems } from '../www/fhem-cms/js/fcui-schema5-layout.js';

const link = () => ({ id: 'one', kind: 'internal', page: 'home', text: 'Startseite',
  showText: true, textPosition: 'overlay', target: 'self', grid: { col: 1, row: 1, w: 4, h: 3 } });
const source = () => ({
  schemaVersion: 5, theme: 'dark', settings: { layoutMode: 'grid', gridColumns: 12 },
  navigation: { orientation: 'horizontal', grid: { col: 1, row: 1, w: 12, h: 1 } },
  pages: [{ id: 'home', title: 'Startseite', widgets: [
    { id: 'links', type: 'fhem-link', links: [link()], grid: { col: 1, row: 2, w: 4, h: 3 } },
  ] }],
});
const script = 'use strict; use warnings; use JSON::PP (); require "./FHEM/01_FHEMCMS.pm";'
  + ' local $/; my $v=JSON::PP->new->utf8->decode(<STDIN>); my $e=FHEMCMS_ValidateConfig($v,5); print $e if defined $e;';

test('LinkWidget occupied bounds produce compact density-independent outer dimensions', () => {
  for (const columns of [12, 24, 48, 96, 192]) {
    const widget = source().pages[0].widgets[0];
    const before = structuredClone(widget);
    const scale = columns / 12;
    assert.deepEqual(linkBounds(widget.links), { col: 1, row: 1, w: 4, h: 3 });
    const fitted = fitLinkWidget(widget, columns, source().pages);
    assert.deepEqual(fitted.grid, { col: 1, row: 2, w: 4 * scale, h: 3 * scale });
    assert.deepEqual(widget, before);
    widget.title = 'Links';
    assert.equal(fitLinkWidget(widget, columns, source().pages).grid.h, 4 * scale);
    widget.showTitle = false;
    assert.equal(fitLinkWidget(widget, columns, source().pages).grid.h, 3 * scale);
    widget.links[0].grid = { col: 5, row: 7, w: 4, h: 3 };
    assert.deepEqual(linkBounds(widget.links), { col: 5, row: 7, w: 4, h: 3 });
    widget.links.push({ ...link(), id: 'two', grid: { col: 1, row: 11, w: 6, h: 2 } });
    assert.deepEqual(linkBounds(widget.links), { col: 1, row: 7, w: 8, h: 6 });
    assert.equal(fitLinkWidget(widget, columns, source().pages).grid.w, 8 * scale);
    assert.equal(fitLinkWidget(widget, columns, source().pages).grid.h, 6 * scale);
  }
  const widget = source().pages[0].widgets[0];
  widget.grid.col = 10;
  assert.throws(() => fitLinkWidget(widget, 12, source().pages), /mehr Platz/);
  widget.grid.col = 1; widget.grid.row = 999;
  assert.throws(() => fitLinkWidget(widget, 12, source().pages), /mehr Platz/);
});

test('LinkWidget session persists fitted dimensions as draft and live without altering nested links', async () => {
  let state = { live: source(), draft: null, token: 'a'.repeat(64) };
  let writes = 0;
  const controller = new Schema5DraftController({
    read: async () => structuredClone(state),
    save: async (draft, token) => {
      assert.equal(token, state.token);
      writes++;
      state = { live: state.live, draft, token: String(writes).padStart(64, '0') };
    },
    publish: async token => {
      assert.equal(token, state.token);
      state = { live: state.draft, draft: null, token: 'f'.repeat(64) };
    },
    discard: async () => {},
  });
  await controller.reload();
  const save = async links => {
    const config = controller.snapshot();
    const widget = (config.draft || config.live).pages[0].widgets[0];
    const session = new Schema5WidgetSession({ controller, pageId: 'home', token: config.token, widget, action: 'update' });
    await session.services({}).saveWidget({ ...widget, links });
    return controller.snapshot().draft.pages[0].widgets[0];
  };
  let widget = await save([link()]);
  assert.deepEqual(widget.grid, { col: 1, row: 2, w: 4, h: 3 });
  assert.deepEqual(state.live, source(), 'live stays untouched before publication');
  const links = [link(), { ...link(), id: 'two', grid: { col: 5, row: 1, w: 3, h: 2 } }];
  widget = await save(links);
  assert.deepEqual(widget.grid, { col: 1, row: 2, w: 7, h: 3 });
  assert.deepEqual(widget.links, links);
  const expanded = [{ ...link(), grid: { col: 1, row: 1, w: 8, h: 4 } }];
  widget = await save(expanded);
  assert.deepEqual(widget.grid, { col: 1, row: 2, w: 8, h: 4 });
  widget = await save([link()]);
  assert.deepEqual(widget.grid, { col: 1, row: 2, w: 4, h: 3 });
  await controller.publishDraft(state.token);
  await controller.reload();
  assert.deepEqual(controller.snapshot().live.pages[0].widgets[0], widget);
  parity(state.live, true, 'auto-sized published widget');
});

test('existing LinkWidgets retain their own scale across densities, titles and manual outer resizing', () => {
  for (const columns of [12, 24, 48, 96, 192]) {
    const scale = columns / 12;
    const previous = { ...source().pages[0].widgets[0], title: 'Links',
      grid: { col: 1, row: 2, w: 5 * scale, h: 4 * scale } };
    const before = structuredClone(previous);
    assert.deepEqual(fitLinkWidget(previous, columns, source().pages, previous), previous,
      'saving unchanged links preserves manually chosen dimensions');
    const untitled = { ...structuredClone(previous), title: '', grid: { ...previous.grid, h: 3 * scale } };
    assert.equal(fitLinkWidget({ ...untitled, title: 'Visible title' }, columns, source().pages, untitled).grid.h,
      4 * scale, 'adding a title uses the existing height scale');
    const changed = structuredClone(previous);
    changed.links[0].grid = { col: 3, row: 6, w: 2, h: 1 };
    changed.showTitle = false;
    const fitted = fitLinkWidget(changed, columns, source().pages, previous);
    assert.deepEqual(fitted.grid, { col: 1, row: 2, w: Math.round(2.5 * scale), h: scale });
    assert.deepEqual(fitted.links, changed.links, 'nested coordinates remain unchanged');
    assert.deepEqual(fitLinkWidget(fitted, columns, source().pages, fitted), fitted,
      'reopening and saving does not introduce rounding growth');
    assert.deepEqual(previous, before);
  }
});

test('new LinkWidgets use the page density instead of a placeholder outer scale', async () => {
  for (const columns of [12, 24, 48, 96, 192]) {
    const scale = columns / 12;
    const live = source();
    live.settings.gridColumns = columns;
    live.navigation.grid.w = columns;
    live.pages[0].widgets = [];
    let state = { live, draft: null, token: 'a'.repeat(64) };
    const controller = new Schema5DraftController({
      read: async () => structuredClone(state),
      save: async draft => { state = { live, draft, token: 'b'.repeat(64) }; },
      publish: async () => {}, discard: async () => {},
    });
    await controller.reload();
    const widget = source().pages[0].widgets[0];
    widget.grid.w = 6 * scale;
    widget.grid.h = 4 * scale;
    const session = new Schema5WidgetSession({ controller, pageId: 'home', token: state.token,
      widget, action: 'create' });
    await session.services({}).saveWidget(session.widget);
    assert.deepEqual(state.draft.pages[0].widgets[0].grid, { col: 1, row: 2, w: 4 * scale, h: 3 * scale });
    assert.deepEqual(state.live, live);
  }
});

test('96-column existing layout saves without full-page inflation and retries a fourth link safely', async () => {
  const live = source();
  live.settings.gridColumns = 96;
  live.navigation.grid = { col: 1, row: 1, w: 92, h: 4 };
  const original = live.pages[0].widgets[0];
  original.title = 'Existing links';
  original.grid = { col: 1, row: 27, w: 40, h: 23 };
  original.links = [1, 2, 3].map((number) => ({ ...link(), id: `link${number}`,
    grid: { col: 1 + (number - 1) * 4, row: 1, w: 4, h: 4 } }));
  live.pages[0].widgets.push(
    { id: 'side', type: 'text', html: 'Keep side', grid: { col: 72, row: 23, w: 13, h: 12 } },
    { id: 'below', type: 'text', html: 'Keep below', grid: { col: 27, row: 50, w: 45, h: 12 } });
  let state = { live, draft: null, token: 'a'.repeat(64) };
  let writes = 0;
  const controller = new Schema5DraftController({
    read: async () => structuredClone(state),
    save: async (draft, token) => {
      assert.equal(token, state.token);
      writes++;
      state = { live, draft, token: String(writes).padStart(64, '0') };
    },
    publish: async () => {}, discard: async () => {},
  });
  await controller.reload();
  await controller.saveWidget('home', original, state.token, 'update');
  assert.deepEqual(state.draft, live, 'even saving the original three links used to cause a collision');
  const session = new Schema5WidgetSession({ controller, pageId: 'home', token: state.token,
    widget: state.draft.pages[0].widgets[0], action: 'update' });
  const edited = session.widget;
  edited.links.push({ ...link(), id: 'link4', text: 'Keep new link',
    image: `media/${'a'.repeat(32)}.png`, grid: { col: 1, row: 5, w: 4, h: 3 } });
  const fitted = fitLinkWidget(edited, 96, live.pages, original);
  assert.deepEqual(fitted.grid, { col: 1, row: 27, w: 40, h: 37 },
    'a new row grows height at the existing scale, never width to 96');
  const services = session.services({});
  await assert.rejects(services.saveWidget(edited), /nichts gespeichert/);
  assert.equal(writes, 1, 'real overlap with the widget below is still rejected before transport');
  edited.links.forEach((item, index) => {
    item.grid = { col: 1 + index * 3, row: 1, w: 3, h: 4 };
  });
  await services.saveWidget(edited);
  assert.equal(writes, 2);
  assert.deepEqual(state.draft.pages[0].widgets[0].grid, original.grid);
  assert.deepEqual(state.draft.pages[0].widgets[0].links, edited.links);
  assert.deepEqual(state.draft.pages[0].widgets.slice(1), live.pages[0].widgets.slice(1));
  assert.deepEqual(state.live, live);
  parity(state.draft, true, '96-column existing scale and four links');
});

test('LinkWidget growth rejects collisions without writes or moving other widgets', async () => {
  const live = source();
  live.pages[0].widgets.push({ id: 'other', type: 'text', html: 'Keep',
    grid: { col: 7, row: 2, w: 2, h: 4 } });
  let writes = 0;
  const controller = new Schema5DraftController({
    read: async () => ({ live, draft: null, token: 'a'.repeat(64) }),
    save: async () => { writes++; }, publish: async () => {}, discard: async () => {},
  });
  await controller.reload();
  const widget = structuredClone(live.pages[0].widgets[0]);
  widget.links[0].grid.w = 8;
  assert.throws(() => controller.saveWidget('home', widget, 'a'.repeat(64), 'update'), /Rasterüberschneidung/);
  assert.equal(writes, 0);
  assert.deepEqual(controller.snapshot().live, live);
  assert.equal(controller.snapshot().draft, null);
});

function growthConfig() {
  const live = source();
  live.pages[0].widgets.push(
    { id: 'neighbor', type: 'text', title: 'Neighbor', html: '{{Temp:state}}',
      grid: { col: 1, row: '5', w: 4, h: '2' } },
    { id: 'tail', type: 'text', html: 'Keep tail', grid: { col: 1, row: 7, w: 4, h: 2 } },
    { id: 'side', type: 'text', html: 'Keep side', grid: { col: 8, row: '5', w: 4, h: '2' } });
  live.pages.push({ id: 'other', title: 'Other', widgets: [
    { id: 'other', type: 'text', html: 'Keep page', grid: { col: 1, row: 2, w: 4, h: 3 } },
  ] });
  return live;
}

test('LinkWidget placement preview is read-only and exact confirmation saves cascading reflow atomically', async () => {
  const live = growthConfig();
  let state = { live, draft: null, token: 'a'.repeat(64) };
  let writes = 0;
  const controller = new Schema5DraftController({
    read: async () => structuredClone(state),
    save: async (draft, token) => {
      assert.equal(token, state.token);
      writes++;
      state = { live, draft, token: 'b'.repeat(64) };
    },
    publish: async () => {}, discard: async () => {},
  });
  await controller.reload();
  const session = new Schema5WidgetSession({ controller, pageId: 'home', token: state.token,
    widget: live.pages[0].widgets[0], action: 'update' });
  let completed = false;
  session.completion.then(() => { completed = true; });
  const services = session.services({});
  const widget = session.widget;
  widget.links.push({ ...link(), id: 'two', text: 'Keep new link', image: `media/${'a'.repeat(32)}.png`,
    grid: { col: 1, row: 4, w: 4, h: 3 } });
  const preview = await services.previewWidget(widget);
  assert.equal(writes, 0);
  assert.equal(completed, false);
  assert.deepEqual(controller.snapshot(), state);
  assert.deepEqual(preview.moved, ['neighbor', 'tail']);
  assert.deepEqual(preview.after.map(item => [item.id, item.grid.row]),
    [['__nav', 1], ['links', 2], ['neighbor', 8], ['tail', 10], ['side', '5']]);
  assert.deepEqual(preview.before[1].grid, live.pages[0].widgets[0].grid);
  assert.throws(() => controller.saveWidget('home', widget, state.token, 'update'), /Platzvorschau/);
  const altered = structuredClone(preview);
  altered.after.find(item => item.id === 'neighbor').grid.row = 20;
  await assert.rejects(services.saveWidget(widget, altered), /erneut prüfen/);
  await assert.rejects(services.saveWidget({ ...widget, title: 'Changed since preview' }, preview), /erneut prüfen/);
  assert.equal(writes, 0);
  const result = await services.saveWidget(widget, preview);
  assert.equal(writes, 1, 'widget and all moved neighbors are one write');
  assert.deepEqual((await session.completion).state, result);
  assert.equal(result.draft.pages[0].widgets[0].grid.h, 6);
  for (const [index, row] of [[1, 8], [2, 10]]) {
    assert.deepEqual(result.draft.pages[0].widgets[index],
      { ...live.pages[0].widgets[index], grid: { ...live.pages[0].widgets[index].grid, row } });
  }
  assert.deepEqual(result.draft.pages[0].widgets[3], live.pages[0].widgets[3]);
  assert.deepEqual(result.draft.pages[1], live.pages[1]);
  assert.deepEqual(result.draft.navigation, live.navigation);
  assert.deepEqual(result.live, live);
  parity(result.draft, true, 'explicitly confirmed cascading LinkWidget growth');
});

test('LinkWidget preview cancellation, stale tokens and impossible layouts never write', async () => {
  for (const failure of ['cancel', 'stale', 'overflow', 'navigation', 'edge']) {
    const live = growthConfig();
    if (failure === 'navigation') {
      live.navigation.grid = { col: 1, row: 5, w: 4, h: 1 };
      live.pages[0].widgets[1].grid.row = 6;
      live.pages[0].widgets[2].grid.row = 8;
      live.pages[1].widgets = [];
    }
    let state = { live, draft: null, token: 'a'.repeat(64) };
    let writes = 0;
    const controller = new Schema5DraftController({
      read: async () => structuredClone(state), save: async () => { writes++; },
      publish: async () => {}, discard: async () => {},
    });
    await controller.reload();
    const widget = structuredClone(live.pages[0].widgets[0]);
    widget.links.push({ ...link(), id: 'two', grid: { col: 1, row: 4, w: 4, h: failure === 'overflow' ? 996 : 3 } });
    if (failure === 'edge') {
      widget.links[0].grid.w = 12;
      widget.grid.col = 2;
    }
    if (['overflow', 'navigation', 'edge'].includes(failure)) {
      assert.throws(() => controller.previewWidget('home', widget, state.token, 'update'), /Platz|Navigation/);
    } else {
      const session = new Schema5WidgetSession({ controller, pageId: 'home', token: state.token,
        widget: live.pages[0].widgets[0], action: 'update' });
      const services = session.services({});
      const preview = await services.previewWidget(widget);
      if (failure === 'cancel') {
        session.close();
        assert.deepEqual(await session.completion, { cancelled: true });
        await assert.rejects(services.saveWidget(widget, preview), /nicht mehr aktiv/);
      } else {
        state.token = 'b'.repeat(64);
        await controller.reload();
        await assert.rejects(services.saveWidget(widget, preview), /veraltet/);
        assert.match((await session.completion).error.message, /veraltet/);
      }
    }
    assert.equal(writes, 0, failure);
    assert.deepEqual(controller.snapshot().live, live);
    assert.equal(controller.snapshot().draft, null);
  }
});

function parity(config, valid, name) {
  const before = structuredClone(config);
  const result = spawnSync('perl', ['-e', script], { input: JSON.stringify(config), encoding: 'utf8' });
  assert.equal(result.status, 0, `${name}: ${result.stderr}`);
  assert.equal(result.stdout === '', valid, `${name}: Perl: ${result.stdout}`);
  if (valid) assert.doesNotThrow(() => schema5GridItems(config, 'home'), name);
  else assert.throws(() => schema5GridItems(config, 'home'), name);
  assert.deepEqual(config, before, `${name}: validation does not mutate input`);
}

test('LinkWidget frontend and backend agree on content, targets, images and nested raster', () => {
  parity(source(), true, 'internal default');
  for (const modalSize of ['sm', 'md', 'lg']) {
    const config = source();
    Object.assign(config.pages[0].widgets[0].links[0], { targetMode: 'modal', modalSize });
    parity(config, true, `internal modal ${modalSize}`);
  }
  for (const extra of [{ targetMode: 'page' }, { targetMode: 'modal' }]) {
    const config = source();
    Object.assign(config.pages[0].widgets[0].links[0], extra);
    parity(config, true, `internal ${extra.targetMode} without size`);
  }
  for (const textPosition of ['above', 'overlay', 'below']) for (const showText of [true, false]) {
    const config = source();
    Object.assign(config.pages[0].widgets[0].links[0], { textPosition, showText,
      image: `media/${'a'.repeat(32)}.png` });
    parity(config, true, `${textPosition}/${showText}`);
  }
  for (const target of ['self', 'tab', 'window']) for (const url of [
    'https://example.test', 'http://localhost:8080/a?b=c&d=3#part', 'https://[::1]:65535/a',
    'https://example.test/a%20b/kWh', 'https://example.test/?s=@',
  ]) {
    const config = source();
    const item = config.pages[0].widgets[0].links[0];
    delete item.page;
    Object.assign(item, { kind: 'external', url, target });
    parity(config, true, `${url}/${target}`);
    assert.equal(linkHref(item), url);
    assert.equal(validLinkUrl(url), true);
  }
  assert.equal(linkHref(link()), '#/home');
  for (const target of ['self', 'tab', 'window']) {
    const config = source();
    const item = config.pages[0].widgets[0].links[0];
    delete item.page;
    Object.assign(item, { kind: 'asset', asset: `../../fhemcms-assets/CMS/${'a'.repeat(32)}`, target });
    parity(config, true, `document/${target}`);
    assert.equal(linkHref(item), item.asset);
  }
  for (const text of ['Übersicht °C', '☀️ Solar', '🌞'.repeat(128)]) {
    const config = source();
    config.pages[0].widgets[0].links[0].text = text;
    parity(config, true, 'Unicode link text');
  }
  for (const url of ['javascript:alert(1)', 'data:text/html,hi', '//example.test', 'file:///tmp/x',
    'https://user:secret@example.test', 'https://example.test\\@evil.test', 'https://example.test/\n',
    'https://example.test:0', 'https://example.test:65536', 'https://example.test/"onclick=x',
    'https://example.test/with space', 'https://', '', `https://example.test/${'a'.repeat(2000)}`]) {
    const config = source();
    const item = config.pages[0].widgets[0].links[0];
    delete item.page;
    Object.assign(item, { kind: 'external', url });
    parity(config, false, url);
    assert.equal(validLinkUrl(url), false, url);
    assert.throws(() => linkHref(item));
  }
  const bad = [
    ['empty', widget => { widget.links = []; }],
    ['object', widget => { widget.links = {}; }],
    ['null item', widget => { widget.links = [null]; }],
    ['duplicate', widget => { widget.links.push(structuredClone(widget.links[0])); }],
    ['missing text', widget => { delete widget.links[0].text; }],
    ['unknown field', widget => { widget.links[0].onclick = 'alert(1)'; }],
    ['invalid id', widget => { widget.links[0].id = '<x>'; }],
    ['numeric id', widget => { widget.links[0].id = 17; }],
    ['text empty', widget => { widget.links[0].text = '  '; }],
    ['numeric text', widget => { widget.links[0].text = 17; }],
    ['text length', widget => { widget.links[0].text = 'x'.repeat(129); }],
    ['Unicode text length', widget => { widget.links[0].text = '🌞'.repeat(129); }],
    ['text control', widget => { widget.links[0].text = 'a\u0000b'; }],
    ['showText type', widget => { widget.links[0].showText = 'true'; }],
    ['position', widget => { widget.links[0].textPosition = 'outside'; }],
    ['kind', widget => { widget.links[0].kind = 'other'; }],
    ['unknown page', widget => { widget.links[0].page = 'deleted'; }],
    ['internal tab', widget => { widget.links[0].target = 'tab'; }],
    ['internal window', widget => { widget.links[0].target = 'window'; }],
    ['unknown targetMode', widget => { widget.links[0].targetMode = 'popup'; }],
    ['numeric targetMode', widget => { widget.links[0].targetMode = 5; }],
    ['invalid modalSize', widget => { Object.assign(widget.links[0], { targetMode: 'modal', modalSize: 'xl' }); }],
    ['modalSize without modal', widget => { widget.links[0].modalSize = 'sm'; }],
    ['external modal', widget => {
      Object.assign(widget.links[0], { kind: 'external', url: 'https://example.test', targetMode: 'modal' });
      delete widget.links[0].page;
    }],
    ['internal URL', widget => { widget.links[0].url = 'https://example.test'; }],
    ['remote image', widget => { widget.links[0].image = 'https://example.test/a.png'; }],
    ['image traversal', widget => { widget.links[0].image = `media/../${'a'.repeat(32)}.png`; }],
    ['image SVG', widget => { widget.links[0].image = `media/${'a'.repeat(32)}.svg`; }],
    ['image null', widget => { widget.links[0].image = null; }],
    ['grid missing', widget => { delete widget.links[0].grid; }],
    ['grid extra', widget => { widget.links[0].grid.x = 1; }],
    ...['col', 'row', 'w', 'h'].flatMap(key => [0, -1, 1.5, '1', null, 1001].map(value =>
      [`${key}=${value}`, widget => { widget.links[0].grid[key] = value; }])),
    ['width overflow', widget => { Object.assign(widget.links[0].grid, { col: 12, w: 2 }); }],
    ['height overflow', widget => { Object.assign(widget.links[0].grid, { row: 1000, h: 2 }); }],
    ['overlap', widget => { widget.links.push({ ...link(), id: 'two' }); }],
  ];
  for (const [name, change] of bad) {
    const config = source();
    change(config.pages[0].widgets[0]);
    parity(config, false, name);
  }
  const config = source();
  config.pages[0].widgets[0].links = Array.from({ length: 200 }, (_, index) =>
    ({ ...link(), id: `link${index}`, grid: { col: 1, row: index * 5 + 1, w: 12, h: 5 } }));
  parity(config, true, '200 links including final raster row');
  config.pages[0].widgets[0].links.push({ ...link(), id: 'excess' });
  parity(config, false, '201 links rejected');
  assert.throws(() => validateLinkItems([link()], []), /CMS-Seite/);
});

test('changing page raster density never rescales the inner LinkWidget raster', () => {
  const config = source();
  for (const columns of [12, 24, 48, 96, 192]) {
    const changed = resizeSchema5Grid(config, columns);
    assert.deepEqual(changed.pages[0].widgets[0].links, config.pages[0].widgets[0].links);
    parity(changed, true, `${columns} page columns`);
  }
});
