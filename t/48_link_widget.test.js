import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { linkHref, validateLinkItems, validLinkUrl } from '../www/fhem-cms/js/link-widget.js';
import { resizeSchema5Grid, schema5GridItems } from '../www/fhem-cms/js/fcui-schema5-layout.js';

const link = () => ({ id: 'one', kind: 'internal', page: 'home', text: 'Startseite',
  showText: true, textPosition: 'overlay', target: 'self', grid: { col: 1, row: 1, w: 4, h: 3 } });
const source = () => ({
  schemaVersion: 5, theme: 'dark', settings: { layoutMode: 'grid', gridColumns: 12 },
  navigation: { orientation: 'horizontal', grid: { col: 1, row: 1, w: 12, h: 1 } },
  pages: [{ id: 'home', title: 'Startseite', widgets: [
    { id: 'links', type: 'fhem-link', links: [link()], grid: { col: 1, row: 2, w: 6, h: 4 } },
  ] }],
});
const script = 'use strict; use warnings; use JSON::PP (); require "./FHEM/01_FHEMCMS.pm";'
  + ' local $/; my $v=JSON::PP->new->utf8->decode(<STDIN>); my $e=FHEMCMS_ValidateConfig($v,5); print $e if defined $e;';

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
