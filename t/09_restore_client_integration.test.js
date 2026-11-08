import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { FhemClient } from '../www/fhem-cms/js/fhem-client.js';

test('restore preview client and Perl API exchange validated data without changing files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fhem-cms-restore-test-'));
  const dir = join(root, 'fhem-cms-data', 'CMS');
  const backupName = 'config.json.20000101-000000.bak';
  const livePath = join(dir, 'config.json');
  const backupPath = join(dir, backupName);
  const draftPath = join(dir, 'draft.json');
  const originalFetch = globalThis.fetch;
  const live = {
    schemaVersion: 5, settings: { layoutMode: 'grid', gridColumns: 12 },
    navigation: { orientation: 'horizontal', grid: { col: 1, row: 1, w: 12, h: 1 } },
    pages: [{ id: 'start', title: 'Live', widgets: [] }],
  };
  const backup = {
    schemaVersion: 4, pages: [{ id: 'start', title: 'Backup', widgets: [
      { id: 'text', type: 'text', html: '<p>{{Temp:state}}</p>', grid: { col: 1, row: 2, w: 4, h: 1 } },
    ] }],
  };
  const liveBytes = `${JSON.stringify(live)}\n`;
  const backupBytes = JSON.stringify(backup, null, 2);
  const script = [
    'use strict; use warnings;',
    'our %attr; sub Log3 {}',
    'require "./FHEM/01_FHEMCMS.pm";',
    '$attr{global}{modpath} = shift @ARGV;',
    'my $cmd = shift @ARGV;',
    'my $result = FHEMCMS_Get({ NAME => "CMS" }, "CMS", $cmd, @ARGV);',
    'print $result if defined $result;',
  ].join(' ');
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(livePath, liveBytes);
    await writeFile(backupPath, backupBytes);
    const calls = [];
    globalThis.fetch = async (url, options) => {
      if (!options.method) return new Response('', { headers: { 'X-FHEM-csrfToken': 'test-token' } });
      const command = options.body.get('cmd');
      calls.push(command);
      const parts = command.split(' ');
      assert.equal(parts[0], 'get');
      assert.equal(parts[1], 'CMS');
      assert.ok(['migrationbackups', 'migrationrestorepreview'].includes(parts[2]));
      const result = spawnSync('perl', ['-e', script, root, ...parts.slice(2)], { encoding: 'utf8' });
      assert.equal(result.error, undefined);
      assert.equal(result.status, 0, result.stderr);
      return new Response(result.stdout);
    };
    const client = new FhemClient('CMS', 'https://example.test/fhem/');
    assert.deepEqual(await client.getMigrationBackups(), [backupName]);
    const preview = await client.previewMigrationRestore(backupName);
    assert.deepEqual(preview.live, live);
    assert.deepEqual(preview.backup, backup);
    assert.match(preview.token, /^[0-9a-f]{64}$/);
    assert.equal(await readFile(livePath, 'utf8'), liveBytes);
    assert.equal(await readFile(backupPath, 'utf8'), backupBytes);
    assert.deepEqual((await readdir(dir)).sort(), [backupName, 'config.json'].sort());

    await writeFile(livePath, `${liveBytes}\n`);
    const changed = await client.previewMigrationRestore(backupName);
    assert.notEqual(changed.token, preview.token, 'byte-only live change invalidates token');
    await writeFile(draftPath, JSON.stringify(live));
    await assert.rejects(client.previewMigrationRestore(backupName), /Entwurf vorhanden/);
    assert.equal(await readFile(draftPath, 'utf8'), JSON.stringify(live));
    await unlink(draftPath);
    await writeFile(backupPath, '{"schemaVersion":99,"pages":[]}');
    await assert.rejects(client.previewMigrationRestore(backupName), /schemaVersion/);
    assert.equal(await readFile(backupPath, 'utf8'), '{"schemaVersion":99,"pages":[]}');
    assert.equal(await readFile(livePath, 'utf8'), `${liveBytes}\n`);
    assert.ok(calls.every((command) => command.startsWith('get ')));
  } finally {
    globalThis.fetch = originalFetch;
    await rm(root, { recursive: true });
  }
});
