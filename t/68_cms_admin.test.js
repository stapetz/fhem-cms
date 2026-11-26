import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  CmsAdminClient, createCmsConfigurationSession, requestAdminClose, validateInventory,
} from '../www/fhem-cms/js/cms-admin.js';
import { applyCmsAdminAppearance, createCmsAdminMenuLinks } from '../www/fhem-cms/js/cms-admin-link.js';
import { FhemClient } from '../www/fhem-cms/js/fhem-client.js';

test('admin entry points and directly imported helpers have matching cache versions', async () => {
  const html = await readFile(new URL('../www/fhem-cms/admin.html', import.meta.url), 'utf8');
  const script = await readFile(new URL('../www/fhem-cms/js/cms-admin.js', import.meta.url), 'utf8');
  const version = html.match(/js\/cms-admin\.js\?v=([^"]+)/)?.[1];
  assert.ok(version);
  for (const asset of ['css/fhem-cms.css', 'css/cms-admin.css']) {
    assert.ok(html.includes(`${asset}?v=${version}`), asset);
  }
  const imports = [...script.matchAll(/from '\.\/([^']+)'/g)];
  assert.equal(imports.length, 6);
  for (const [, path] of imports) assert.ok(path.endsWith(`?v=${version}`), path);
});

test('administration accepts bounded themes and local CMS backgrounds and rejects injected appearance', () => {
  const styles = new Map();
  let theme = 'dark';
  const root = { setAttribute: (key, value) => { theme = value; },
    style: { setProperty: (key, value) => styles.set(key, value) } };
  for (const value of ['dark', 'light', 'liquid-glass', 'oled-black', 'catppuccin-mocha']) {
    applyCmsAdminAppearance(root, `#theme=${value}`);
    assert.equal(theme, value);
  }
  const background = `/custom/fhem-cms/CMS/media/${'a'.repeat(32)}.jpg`;
  applyCmsAdminAppearance(root, `#${new URLSearchParams({
    theme: 'liquid-glass', background, blur: '14.1', gloss: '0.094', opacity: '0.88',
  })}`);
  assert.equal(styles.get('--cms-page-image'), `url("${background}")`);
  assert.equal(styles.get('--cms-liquid-blur'), '14.1px');
  for (const params of [
    { theme: 'unknown' }, { theme: 'dark', background: 'https://other.test/x.jpg' },
    { theme: 'dark', background: background.replace('/CMS/', '/../') },
    { theme: 'dark', blur: '31' }, { theme: 'dark', opacity: '-1' },
    { theme: 'dark', gloss: 'url(x)' },
  ]) assert.throws(() => applyCmsAdminAppearance(root, `#${new URLSearchParams(params)}`), /Ungültig/);
});

test('admin menu is hidden by default and enabled only by an explicit backend boolean', async () => {
  const client = new FhemClient('CMS', 'https://example.test/fhem/');
  for (const enabled of [undefined, false, '1', 1, true]) {
    client.command = async () => JSON.stringify({ schemaVersion: 5, adminMenuEnabled: enabled });
    await client.getLayoutFormat();
    assert.equal(client.adminMenuEnabled, enabled === true);
    if (enabled !== true) assert.deepEqual(createCmsAdminMenuLinks(client), []);
  }
});

const inventory = () => ({ token: 'a'.repeat(64), items: [
  { name: 'CMS', kind: 'device', blocked: null, files: [{ path: 'fhem-cms-data/CMS', directory: true }] },
  { name: 'Old', kind: 'orphan', blocked: 'Fremde Dateien', files: [] },
] });

test('admin inventory validates device names, duplicates and entry shapes', () => {
  assert.equal(validateInventory(inventory()).items.length, 2);
  for (const change of [
    value => { value.token = ''; },
    value => { value.items[0].name = '../CMS'; },
    value => { value.items[1].name = 'CMS'; },
    value => { value.items[0].kind = 'other'; },
    value => { value.items[0].files[0].directory = 1; },
  ]) {
    const value = inventory();
    change(value);
    assert.throws(() => validateInventory(value), /Ungültig/);
  }
});

test('admin client uses FHEMWEB prefix, fresh CSRF and one non-retried destructive POST', async () => {
  const previous = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({url: String(url), options});
    if (String(url).endsWith('?XHR=1')) return new Response('', {headers: {'X-FHEM-csrfToken': 'fresh'}});
    if (options.method === 'POST') return Response.json({results: [
      {name: 'CMS', kind: 'device', ok: true, message: 'Purge + Delete'},
    ]});
    return Response.json(inventory());
  };
  try {
    for (const [base, expected] of [
      ['https://example.test/', 'https://example.test/fhemcms-admin?op=list'],
      ['https://example.test/fhem/', 'https://example.test/fhem/fhemcms-admin?op=list'],
    ]) {
      await new CmsAdminClient(base).inventory();
      assert.equal(calls.pop().url, expected);
    }
    const client = new CmsAdminClient('https://example.test/custom/');
    await client.inventory();
    const selected = [{name: 'CMS', kind: 'device'}];
    assert.equal((await client.remove(selected, 'a'.repeat(64)))[0].ok, true);
    assert.equal(calls[0].url, 'https://example.test/custom/fhemcms-admin?op=list');
    assert.equal(calls[1].url, 'https://example.test/custom?XHR=1');
    const sent = calls[2].options;
    assert.equal(sent.credentials, 'same-origin');
    assert.equal(sent.body.get('fwcsrf'), 'fresh');
    assert.deepEqual(JSON.parse(sent.body.get('payload')),
      {items: selected, token: 'a'.repeat(64), confirmation: 'DELETE'});
    globalThis.fetch = async () => { throw new Error('Connection lost'); };
    await assert.rejects(client.remove(selected, 'a'.repeat(64)), /Connection lost/);
    let postsWithoutToken = 0;
    globalThis.fetch = async (url, options) => {
      if (options.method !== 'POST') return new Response('');
      postsWithoutToken++;
      assert.equal(options.body.has('fwcsrf'), false);
      return Response.json({results: [{name: 'CMS', kind: 'device', ok: true, message: 'Erledigt'}]});
    };
    assert.equal((await client.remove(selected, 'a'.repeat(64)))[0].ok, true);
    assert.equal(postsWithoutToken, 1, 'explicitly disabled CSRF does not block the client');
    globalThis.fetch = async url => String(url).endsWith('?XHR=1')
      ? new Response('', {headers: {'X-FHEM-csrfToken': 'fresh'}})
      : Response.json({results: []});
    await assert.rejects(client.remove(selected, 'a'.repeat(64)), /nicht eindeutig/);
    globalThis.fetch = async () => Response.json({error: 'Bestand ist veraltet'});
    await assert.rejects(client.inventory(), /veraltet/);
  } finally { globalThis.fetch = previous; }
});

test('cache administration uses GET for status and CSRF-protected POST for rebuild', async () => {
  const previous = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({url: String(url), options});
    if (String(url).endsWith('?XHR=1')) return new Response('', {headers: {'X-FHEM-csrfToken': 'fresh'}});
    return Response.json({status: options.method === 'POST' ? 'pending' : 'ready'});
  };
  try {
    const client = new CmsAdminClient('https://example.test/fhem/');
    assert.equal((await client.cacheStatus()).status, 'ready');
    assert.equal((await client.rebuildCache()).status, 'pending');
    assert.equal(calls[0].url, 'https://example.test/fhem/fhemcms-admin?op=cache-status');
    assert.equal(calls[2].url, 'https://example.test/fhem/fhemcms-admin?op=cache-rebuild');
    assert.equal(calls[2].options.method, 'POST');
    assert.equal(calls[2].options.body.get('fwcsrf'), 'fresh');
  } finally { globalThis.fetch = previous; }
});

test('cache contents use a paged read and reject malformed responses', async () => {
  const previous = globalThis.fetch;
  const client = new CmsAdminClient('https://example.test/fhem/');
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(String(url), 'https://example.test/fhem/fhemcms-admin?op=cache-contents&offset=0');
      assert.equal(options.method, undefined);
      return Response.json({items: [{name: 'Solar', alias: '<b>Solar</b>',
        readings: [{name: 'power', sources: [{type: 'dblog', name: 'DB'}, {type: 'filelog'}]}]}],
        offset: 0, total: 1, warnings: []});
    };
    assert.equal((await client.cacheContents(0)).items[0].alias, '<b>Solar</b>');
    globalThis.fetch = async () => Response.json({status: 'pending'});
    assert.equal((await client.cacheContents(0)).status, 'pending');
    globalThis.fetch = async () => Response.json({items: [{name: '../bad', readings: []}],
      offset: 0, total: 1, warnings: []});
    await assert.rejects(client.cacheContents(0), /Ungültiger Cache-Inhalt/);
    globalThis.fetch = async () => Response.json({items: [{name: 'Solar',
      readings: [{name: 'power', sources: [{type: 'invalid'}]}]}], offset: 0, total: 1, warnings: []});
    await assert.rejects(client.cacheContents(0), /Ungültiger Cache-Inhalt/);
  } finally { globalThis.fetch = previous; }
});

test('admin configuration uses schema 5/6 draft controllers and rejects older schemas', async () => {
  const previous = globalThis.fetch;
  const calls = [];
  let version = 5;
  const config = {
    schemaVersion: 5, theme: 'dark', settings: { layoutMode: 'grid', gridColumns: 12 },
    navigation: { orientation: 'horizontal', grid: { col: 1, row: 1, w: 12, h: 1 } },
    pages: [{ id: 'one', title: 'Home', widgets: [] }],
  };
  const state = { live: config, draft: null, token: 'b'.repeat(64) };
  globalThis.fetch = async (url, options) => {
    if (!options.method) return new Response('', {headers: {'X-FHEM-csrfToken': 'fresh'}});
    const command = options.body.get('cmd');
    calls.push(command);
    if (command === 'get CMS layoutformat') {
      return Response.json({schemaVersion: version, ...(version === 6 ? {freeform: true} : {})});
    }
    if (command === `get CMS ${version === 6 ? 'version6state' : 'version5state'}`) {
      const live = {...config, schemaVersion: version};
      return Response.json({...state, live});
    }
    throw new Error(`Unexpected FHEM command: ${command}`);
  };
  try {
    const base = new URL('https://example.test/fhem/');
    const schema5 = await createCmsConfigurationSession('CMS', base);
    assert.equal(schema5.schemaVersion, 5);
    assert.equal(schema5.controller.snapshot().live.schemaVersion, 5);
    assert.deepEqual(calls, ['get CMS layoutformat', 'get CMS version5state']);
    version = 6;
    calls.length = 0;
    const schema6 = await createCmsConfigurationSession('CMS', base);
    assert.equal(schema6.schemaVersion, 6);
    assert.equal(schema6.controller.snapshot().live.schemaVersion, 6);
    assert.deepEqual(calls, ['get CMS layoutformat', 'get CMS version6state']);
    version = 4;
    calls.length = 0;
    await assert.rejects(createCmsConfigurationSession('CMS', base), /Schema 5 oder 6/);
    assert.deepEqual(calls, ['get CMS layoutformat']);
    await assert.rejects(createCmsConfigurationSession('../CMS', base), /Device-Name/);
  } finally { globalThis.fetch = previous; }
});

test('row sessions save drafts using CSRF and versioned tokens and never retry uncertain writes', async () => {
  const previous = globalThis.fetch;
  const config = {
    schemaVersion: 5, theme: 'dark', settings: {layoutMode: 'grid', gridColumns: 12},
    navigation: {orientation: 'horizontal', grid: {col: 1, row: 1, w: 12, h: 1}},
    pages: [{id: 'home', title: 'Home', widgets: []}],
  };
  let state;
  let version;
  let failAnswer = false;
  let writes = 0;
  const seen = [];
  globalThis.fetch = async (url, options) => {
    if (!options.method) return new Response('', {headers: {'X-FHEM-csrfToken': 'fresh'}});
    assert.equal(options.body.get('fwcsrf'), 'fresh');
    const command = options.body.get('cmd');
    seen.push(command);
    if (command === 'get CMS layoutformat') return Response.json({schemaVersion: version, freeform: version === 6});
    if (command === `get CMS version${version}state`) return Response.json(state);
    const parts = command.split(' ');
    assert.deepEqual(parts.slice(0, 4), ['set', 'CMS', `version${version}draft`, 'save']);
    writes++;
    if (parts[4] !== state.token) return new Response('Zustand ist veraltet');
    const candidate = JSON.parse(Buffer.from(parts[5], 'base64').toString('utf8'));
    state = {...state, draft: candidate, token: 'c'.repeat(64)};
    if (failAnswer) throw new Error('Antwort verloren');
    return new Response('');
  };
  try {
    for (version of [5, 6]) {
      state = {live: {...structuredClone(config), schemaVersion: version}, draft: null, token: 'b'.repeat(64)};
      const session = await createCmsConfigurationSession('CMS', 'https://example.test/fhem/');
      const candidate = structuredClone(state.live);
      candidate.pages[0].title = 'Entwurf';
      const saved = await session.controller.saveDraft(candidate, session.state.token);
      assert.equal(saved.draft.pages[0].title, 'Entwurf');
      assert.equal(saved.live.pages[0].title, 'Home');
      assert.ok(seen.some(command => command.startsWith(`set CMS version${version}draft save ${'b'.repeat(64)} `)));
      const stale = await createCmsConfigurationSession('CMS', 'https://example.test/fhem/');
      state.token = 'd'.repeat(64);
      await assert.rejects(stale.controller.saveDraft(candidate, stale.state.token), /veraltet/);
      const uncertain = await createCmsConfigurationSession('CMS', 'https://example.test/fhem/');
      failAnswer = true;
      const before = writes;
      await assert.rejects(uncertain.controller.saveDraft(candidate, uncertain.state.token), /Antwort verloren/);
      assert.equal(writes, before + 1);
      assert.throws(() => uncertain.controller.snapshot(), /nicht geladen/);
      failAnswer = false;
      const recovered = await createCmsConfigurationSession('CMS', 'https://example.test/fhem/');
      assert.equal(recovered.state.draft.pages[0].title, 'Entwurf');
    }
  } finally { globalThis.fetch = previous; }
});

test('admin close notifies when browser refuses to close a non-script-opened page', async () => {
  let callback;
  let closes = 0;
  let warning = '';
  requestAdminClose({ closed: false, close: () => { closes++; },
    setTimeout: fn => { callback = fn; } }, text => { warning = text; });
  assert.equal(closes, 1);
  assert.equal(warning, '');
  callback();
  assert.match(warning, /nicht skriptgesteuert geöffnet/);
});
