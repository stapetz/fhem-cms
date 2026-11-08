import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { FhemClient } from '../www/fhem-cms/js/fhem-client.js';
import { migrationPositions } from '../fcui/layout-migration.js';
import { applySchema5GridItems, schema5GridItems } from '../www/fhem-cms/js/fcui-schema5-layout.js';

const script = [
  'use strict; use warnings;',
  'our %attr; sub Log3 {}',
  'require "./FHEM/01_FHEMCMS.pm";',
  '$attr{global}{modpath} = shift @ARGV;',
  'my $cmd = shift @ARGV;',
  'my $result = FHEMCMS_Get({ NAME => "CMS" }, "CMS", $cmd, @ARGV);',
  'print $result if defined $result;',
].join(' ');

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

test('real migration preview connects legacy plan to schema 5 grid without writes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fhem-cms-layout-test-'));
  const dir = join(root, 'fhem-cms-data', 'CMS');
  const livePath = join(dir, 'config.json');
  const draftPath = join(dir, 'draft.json');
  const previousFetch = globalThis.fetch;
  const live = {
    schemaVersion: 4, theme: 'light', settings: { layoutMode: 'grid', gridColumns: 12 },
    navigation: { orientation: 'horizontal', grid: { col: 1, row: 1, w: 48, h: 1 } },
    pages: [
      { id: 'one', title: 'One', widgets: [
        { id: 'text', type: 'text', html: '<p>{{Temp:state}}</p><img src="media/0123456789abcdef0123456789abcdef.png">',
          grid: { col: 1, row: 2, w: 4, h: 1 } },
        { id: 'html', type: 'fhem-html', devices: ['Temp'],
          html: '<span device="Temp" reading="state"></span>',
          grid: { col: 5, row: 2, w: 4, h: 1 } },
      ] },
      { id: 'two', title: 'Two', widgets: [] },
    ],
  };
  const bytes = JSON.stringify(live);
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(livePath, bytes);
    globalThis.fetch = async (url, options) => {
      if (!options.method) return new Response('', { headers: { 'X-FHEM-csrfToken': 'test-token' } });
      const parts = options.body.get('cmd').split(' ');
      assert.deepEqual(parts.slice(0, 3), ['get', 'CMS', 'migrationpreview']);
      const result = spawnSync('perl', ['-e', script, root, ...parts.slice(2)], { encoding: 'utf8' });
      assert.equal(result.error, undefined);
      assert.equal(result.status, 0, result.stderr);
      return new Response(result.stdout);
    };
    const client = new FhemClient('CMS', 'https://example.test/fhem/');
    const positions = migrationPositions(live);
    const result = await client.previewMigration(positions);
    assert.deepEqual(result.source, live);
    assert.match(result.token, /^[0-9a-f]{64}$/);
    for (const page of result.config.pages) {
      const items = schema5GridItems(result.config, page.id);
      assert.deepEqual(applySchema5GridItems(result.config, page.id, items), result.config);
    }
    assert.equal(result.config.pages[0].widgets[0].html, live.pages[0].widgets[0].html);
    assert.equal(result.config.pages[0].widgets[1].html, live.pages[0].widgets[1].html);
    assert.deepEqual(result.config.pages[0].widgets[1].devices, ['Temp']);
    assert.equal(await readFile(livePath, 'utf8'), bytes);
    assert.deepEqual(await readdir(dir), ['config.json']);
    await writeFile(draftPath, bytes);
    await assert.rejects(client.previewMigration(positions), /Entwurf vorhanden/);
    assert.equal(await readFile(livePath, 'utf8'), bytes);
    assert.equal(await readFile(draftPath, 'utf8'), bytes);
  } finally {
    globalThis.fetch = previousFetch;
    await rm(root, { recursive: true });
  }
});

test('versioned state client reads actual live and draft data without modifying files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fhem-cms-version5-test-'));
  const dir = join(root, 'fhem-cms-data', 'CMS');
  const livePath = join(dir, 'config.json');
  const draftPath = join(dir, 'draft.json');
  const previousFetch = globalThis.fetch;
  const live = {
    schemaVersion: 5, theme: 'light', settings: { layoutMode: 'grid', gridColumns: 12 },
    navigation: { orientation: 'horizontal', grid: { col: 1, row: 1, w: 12, h: 1 } },
    pages: [{ id: 'one', title: 'Live', widgets: [
      { id: 'text', type: 'text', html: '{{Temp:state}}', grid: { col: 1, row: 2, w: 1, h: 1 } },
    ] }],
  };
  const draft = structuredClone(live);
  draft.pages[0].title = 'Draft';
  const liveBytes = JSON.stringify(live);
  const draftBytes = JSON.stringify(draft);
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(livePath, liveBytes);
    globalThis.fetch = async (url, options) => {
      if (!options.method) return new Response('', { headers: { 'X-FHEM-csrfToken': 'test-token' } });
      const parts = options.body.get('cmd').split(' ');
      assert.deepEqual(parts, ['get', 'CMS', 'version5state']);
      const result = spawnSync('perl', ['-e', script, root, 'version5state'], { encoding: 'utf8' });
      assert.equal(result.error, undefined);
      assert.equal(result.status, 0, result.stderr);
      return new Response(result.stdout);
    };
    const client = new FhemClient('CMS', 'https://example.test/fhem/');
    const initial = await client.getVersion5State();
    assert.deepEqual(initial.live, live);
    assert.equal(initial.draft, null);
    assert.match(initial.token, /^[0-9a-f]{64}$/);
    assert.deepEqual(await readdir(dir), ['config.json']);
    await writeFile(draftPath, draftBytes);
    const withDraft = await client.getVersion5State();
    assert.deepEqual(withDraft.live, live);
    assert.deepEqual(withDraft.draft, draft);
    assert.notEqual(withDraft.token, initial.token);
    assert.equal(await readFile(livePath, 'utf8'), liveBytes);
    assert.equal(await readFile(draftPath, 'utf8'), draftBytes);
    await writeFile(draftPath, `${draftBytes}\n`);
    const reformatted = await client.getVersion5State();
    assert.deepEqual(reformatted.draft, draft);
    assert.notEqual(reformatted.token, withDraft.token, 'byte-only draft change invalidates token');
    await writeFile(draftPath, JSON.stringify({ ...draft, schemaVersion: 4 }));
    await assert.rejects(client.getVersion5State(), /draft.json/);
    assert.equal(await readFile(livePath, 'utf8'), liveBytes);
    assert.equal(await readFile(draftPath, 'utf8'), JSON.stringify({ ...draft, schemaVersion: 4 }));
  } finally {
    globalThis.fetch = previousFetch;
    await rm(root, { recursive: true });
  }
});
