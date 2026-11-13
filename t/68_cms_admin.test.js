import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CmsAdminClient, validateInventory } from '../www/fhem-cms/js/cms-admin.js';

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
    globalThis.fetch = async () => new Response('');
    await assert.rejects(client.remove(selected, 'a'.repeat(64)), /CSRF/);
    globalThis.fetch = async url => String(url).endsWith('?XHR=1')
      ? new Response('', {headers: {'X-FHEM-csrfToken': 'fresh'}})
      : Response.json({results: []});
    await assert.rejects(client.remove(selected, 'a'.repeat(64)), /nicht eindeutig/);
    globalThis.fetch = async () => Response.json({error: 'Bestand ist veraltet'});
    await assert.rejects(client.inventory(), /veraltet/);
  } finally { globalThis.fetch = previous; }
});
