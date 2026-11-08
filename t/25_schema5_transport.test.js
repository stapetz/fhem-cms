import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { FhemClient } from '../www/fhem-cms/js/fhem-client.js';
import { Schema5DraftController } from '../www/fhem-cms/js/fcui-schema5-draft.js';
import { createSchema5Transport } from '../www/fhem-cms/js/fcui-schema5-transport.js';

const script = `
use strict;
use warnings;
use JSON::PP ();
use File::Spec;
our %attr;
sub Log3 {}
require './FHEM/01_FHEMCMS.pm';
my ($root, $operation, @args) = @ARGV;
$attr{global}{modpath} = $root;
my $dir = File::Spec->catdir($root, 'fhem-cms-data', 'CMS');
my ($value, $error);
if ($operation eq 'read') {
    ($value, $error) = FHEMCMS_ReadVersion5State($dir);
} elsif ($operation eq 'contract') {
    $error = FHEMCMS_Version5DraftCommand($dir, @args);
} elsif ($operation eq 'public') {
    $error = FHEMCMS_Set({NAME => 'CMS'}, 'CMS', 'version5draft', @args);
} else { die 'unknown operation'; }
print JSON::PP->new->utf8->canonical->encode({value => $value, error => $error});
`;

test('versioned transport and public command enforce state, validation and backup', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cms-v5-transport-'));
  const dir = join(root, 'fhem-cms-data', 'CMS');
  const path = join(dir, 'config.json');
  const originalFetch = globalThis.fetch;
  const live = {
    schemaVersion: 5, theme: 'dark', settings: { layoutMode: 'grid', gridColumns: 12 },
    navigation: { orientation: 'horizontal', grid: { col: 1, row: 1, w: 12, h: 1 } },
    pages: [{ id: 'one', title: 'Eins', widgets: [
      { id: 'text', type: 'text', html: '{{Temp:state}}', grid: { col: 1, row: 2, w: 4, h: 2 } },
      { id: 'html', type: 'fhem-html', devices: ['Temp'],
        html: '<span device="Temp" reading="state"></span>', grid: { col: 5, row: 2, w: 4, h: 2 } },
    ] }],
  };
  const original = JSON.stringify(live, null, 2);
  const invoke = (operation, ...args) => {
    const child = spawnSync('perl', ['-e', script, root, operation, ...args], { encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    return JSON.parse(child.stdout);
  };
  let requests = 0;
  let loseAnswer = false;
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(path, original);
    const initial = invoke('read').value;
    assert.match(invoke('public', 'discard', initial.token).error, /keinen Entwurf/);
    assert.deepEqual(await readdir(dir), ['config.json']);
    for (const [args, pattern] of [
      [['bad'], /Unbekannte/],
      [['save', initial.token], /Parameter/],
      [['discard', 'token'], /Zustandskennung/],
      [['save', initial.token, 'A'], /Base64/],
      [['save', initial.token, '!!!!'], /Base64/],
      [['save', initial.token, Buffer.from('{').toString('base64')], /JSON/],
      [['save', initial.token, Buffer.from('{}').toString('base64')], /ungueltig/],
    ]) assert.match(invoke('contract', ...args).error, pattern);
    assert.deepEqual(await readdir(dir), ['config.json']);

    globalThis.fetch = async (url, options) => {
      if (!options.method) return new Response('', { headers: { 'X-FHEM-csrfToken': 'csrf-test' } });
      assert.equal(options.credentials, 'same-origin');
      assert.equal(options.body.get('fwcsrf'), 'csrf-test');
      requests += 1;
      const parts = options.body.get('cmd').split(' ');
      if (parts.join(' ') === 'get CMS version5state') {
        const reply = invoke('read');
        return new Response(reply.error || JSON.stringify(reply.value));
      }
      assert.deepEqual(parts.slice(0, 3), ['set', 'CMS', 'version5draft']);
      const reply = invoke('public', ...parts.slice(3));
      if (loseAnswer) throw new Error('Antwort verloren');
      return new Response(reply.error || '');
    };
    const client = new FhemClient('CMS', 'https://example.test/fhem/');
    const transport = createSchema5Transport(client);
    await assert.rejects(transport.discard('x;set andere on'), /Zustandskennung/);
    await assert.rejects(transport.discard(`${initial.token}\n`), /Zustandskennung/);
    assert.throws(() => createSchema5Transport({ ...client, cmsDevice: 'CMS\n',
      command() {}, getVersion5State() {} }), /Client/);
    await assert.rejects(transport.save(null, initial.token), /Konfiguration/);
    await assert.rejects(transport.save({ text: 'ä'.repeat(524288) }, initial.token), /zu groß/);
    assert.equal(requests, 0);
    const first = new Schema5DraftController(transport);
    const second = new Schema5DraftController(transport);
    const a = await first.reload();
    const b = await second.reload();
    const draft = structuredClone(a.live);
    draft.pages[0].title = 'Änderung';
    const saved = await first.saveDraft(draft, a.token);
    assert.equal(saved.draft.pages[0].title, 'Änderung');
    assert.equal(await readFile(path, 'utf8'), original);
    await assert.rejects(second.saveDraft(b.live, b.token), /veraltet/);
    assert.throws(() => second.snapshot(), /nicht geladen/);
    const after = await second.reload();
    assert.equal(after.draft.pages[0].widgets[0].html, '{{Temp:state}}');
    assert.equal(after.draft.pages[0].widgets[1].html, live.pages[0].widgets[1].html);
    const published = await second.publishDraft(after.token);
    assert.equal(published.draft, null);
    const backup = (await readdir(dir)).find((name) => name.endsWith('.bak'));
    assert.ok(backup);
    assert.equal(await readFile(join(dir, backup), 'utf8'), original);
    const next = structuredClone(published.live);
    next.pages[0].title = 'Antwortverlust';
    loseAnswer = true;
    await assert.rejects(second.saveDraft(next, published.token), /Antwort verloren/);
    assert.throws(() => second.snapshot(), /nicht geladen/);
    loseAnswer = false;
    const recovered = await second.reload();
    assert.equal(recovered.draft.pages[0].title, 'Antwortverlust');
    const discarded = await second.discardDraft(recovered.token);
    assert.equal(discarded.draft, null);
    assert.equal(discarded.live.pages[0].title, 'Änderung');
    assert.match(invoke('public', 'save', discarded.token, 'e30=').error, /ungueltig/);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(root, { recursive: true, force: true });
  }
});
