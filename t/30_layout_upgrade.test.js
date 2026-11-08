import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { FhemClient } from '../www/fhem-cms/js/fhem-client.js';

test('one-click client uses real Perl, retains live and draft and verifies schema 5', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cms-layout-upgrade-'));
  const dir = join(root, 'fhem-cms-data', 'CMS');
  const originalFetch = globalThis.fetch;
  const script = `
    use strict; use warnings;
    our %attr; sub Log3 {}
    require './FHEM/01_FHEMCMS.pm';
    my ($root, $kind, @args) = @ARGV;
    $attr{global}{modpath} = $root;
    my $answer = $kind eq 'set' ? FHEMCMS_Set({NAME => 'CMS'}, 'CMS', @args)
      : FHEMCMS_Get({NAME => 'CMS'}, 'CMS', @args);
    print $answer // '';
  `;
  const source = {
    schemaVersion: 4, theme: 'dark',
    pages: [{ id: 'start', title: 'Live', widgets: [
      { id: 'text', type: 'text', html: '<p>{{Temp:state}}</p>',
        grid: { col: 2, row: 1000, w: 3, h: 999 } },
      { id: 'html', type: 'fhem-html', devices: ['Temp'],
        html: '<span device="Temp" reading="state"></span>',
        grid: { col: 1, row: 1, w: 48, h: 10 } },
    ] }],
  };
  const draft = structuredClone(source);
  draft.pages[0].title = 'Draft';
  draft.pages[0].widgets.pop();
  const liveBytes = JSON.stringify(source);
  const draftBytes = JSON.stringify(draft);
  const commands = [];
  let loseAnswer = false;
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'config.json'), liveBytes);
    await writeFile(join(dir, 'draft.json'), draftBytes);
    globalThis.fetch = async (url, options) => {
      if (!options.method) return new Response('', { headers: { 'X-FHEM-csrfToken': 'token' } });
      const cmd = options.body.get('cmd');
      commands.push(cmd);
      assert.equal(options.body.get('fwcsrf'), 'token');
      const [kind, device, ...args] = cmd.split(' ');
      assert.equal(device, 'CMS');
      const result = spawnSync('perl', ['-e', script, root, kind, ...args], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      if (kind === 'set' && loseAnswer) throw new Error('Antwort verloren');
      return new Response(result.stdout);
    };
    const client = new FhemClient('CMS', 'https://example.test/fhem/');
    const result = await client.upgradeLayout();
    assert.deepEqual(commands, ['set CMS layoutupgrade', 'get CMS version5state']);
    assert.equal(await readFile(join(dir, result.backup), 'utf8'), liveBytes);
    assert.equal(await readFile(join(dir, result.draftBackup), 'utf8'), draftBytes);
    const state = await client.getVersion5State();
    assert.equal(state.live.pages[0].title, 'Live');
    assert.equal(state.draft.pages[0].title, 'Draft');
    for (const [actual, expected] of [[state.live, source], [state.draft, draft]]) {
      assert.deepEqual(actual.pages[0].widgets.map(({ grid, ...widget }) => widget),
        expected.pages[0].widgets.map(({ grid, ...widget }) => widget), 'content and bindings survive exactly');
    }
    assert.equal((await readdir(dir)).includes('layout-upgrade.json'), false);
    const files = await readdir(dir);
    assert.equal((await client.upgradeLayout()).backup, null);
    assert.deepEqual(await readdir(dir), files, 'already converted data is not backed up again');
    loseAnswer = true;
    commands.length = 0;
    await assert.rejects(client.upgradeLayout(), /Antwort verloren/);
    assert.deepEqual(commands, ['set CMS layoutupgrade'], 'lost write answer is never retried');
  } finally {
    globalThis.fetch = originalFetch;
    await rm(root, { recursive: true, force: true });
  }
});

test('upgrade client rejects error text and untrusted confirmations', async () => {
  const client = new FhemClient('CMS', 'https://example.test/fhem/');
  let reads = 0;
  client.getVersion5State = async () => { reads += 1; };
  for (const answer of ['Sicherung fehlgeschlagen', '', '{}', '[]', '{"schemaVersion":5,"backup":"../x","draftBackup":null}',
    '{"schemaVersion":5,"backup":null}', '{"schemaVersion":4,"backup":null,"draftBackup":null}']) {
    client.command = async () => answer;
    await assert.rejects(client.upgradeLayout());
  }
  assert.equal(reads, 0, 'invalid write results do not become successful reads');
  client.command = async () => '{"schemaVersion":5,"backup":null,"draftBackup":null}';
  client.getVersion5State = async () => { throw new Error('mixed state'); };
  await assert.rejects(client.upgradeLayout(), /mixed state/, 'failed post-write verification stays a failure');
});
