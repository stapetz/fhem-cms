import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CmsAdminClient, validateInventory } from '../www/fhem-cms/js/cms-admin.js';
import { applyCmsAdminAppearance, createCmsAdminMenuLinks } from '../www/fhem-cms/js/cms-admin-link.js';
import { FhemClient } from '../www/fhem-cms/js/fhem-client.js';

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
