import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gridPreferenceKey, readGridPreference, writeGridPreference } from '../www/fhem-cms/js/grid-preference.js';

test('grid preference persists both states across visits and isolates CMS and endpoints', () => {
  const values = new Map();
  const browser = { localStorage: { getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value) } };
  const client = { endpoint: new URL('https://example.test/fhem/'), cmsDevice: 'CMS' };
  const other = { ...client, cmsDevice: 'Other' };
  const notify = message => assert.fail(message);
  assert.equal(readGridPreference(browser, client, notify), false);
  writeGridPreference(browser, client, true, notify);
  assert.equal(readGridPreference({ localStorage: browser.localStorage }, client, notify), true);
  assert.equal(readGridPreference(browser, other, notify), false);
  assert.notEqual(gridPreferenceKey(client), gridPreferenceKey({ ...client, endpoint: new URL('https://example.test/custom/') }));
  writeGridPreference(browser, client, false, notify);
  assert.equal(readGridPreference(browser, client, notify), false);
  values.set('fhem-cms-show-grid', '1');
  assert.equal(readGridPreference(browser, client, notify), false, 'explicit disabled preference wins over legacy key');
  assert.equal(readGridPreference(browser, other, notify), true, 'legacy preference is preserved for unmigrated CMS');
});

test('unavailable browser storage explicitly reports read and write failures', () => {
  const messages = [];
  const browser = { get localStorage() { throw new Error('Blocked'); } };
  assert.equal(readGridPreference(browser, {}, message => messages.push(message)), false);
  writeGridPreference(browser, {}, true, message => messages.push(message));
  assert.equal(messages.length, 2);
  assert.match(messages[0], /nicht.*gelesen/);
  assert.match(messages[1], /nur für diesen Besuch/);
});
