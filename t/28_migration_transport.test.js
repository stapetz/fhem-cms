import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { FhemClient } from '../www/fhem-cms/js/fhem-client.js';
import { createMigrationTransport } from '../www/fhem-cms/js/fcui-migration-transport.js';
import { MigrationController } from '../www/fhem-cms/js/fcui-migration-controller.js';

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
if ($operation eq 'get') {
    $value = FHEMCMS_Get({NAME => 'CMS'}, 'CMS', @args);
} elsif ($operation eq 'contract') {
    ($value, $error) = FHEMCMS_MigrationCommand($dir, @args);
} elsif ($operation eq 'public') {
    my $answer = FHEMCMS_Set({NAME => 'CMS'}, 'CMS', 'migrationcommit', @args);
    if (defined($answer) && $answer =~ /^\\{/) {
        $value = JSON::PP->new->decode($answer)->{backup};
    } else {
        $error = $answer;
    }
} else { die 'unknown operation'; }
print JSON::PP->new->utf8->canonical->encode({value => $value, error => $error});
`;

test('prepared migration transport binds previews, backups and restore to isolated Perl transactions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cms-migration-transport-'));
  const dir = join(root, 'fhem-cms-data', 'CMS');
  const path = join(dir, 'config.json');
  const originalFetch = globalThis.fetch;
  const legacy = {
    schemaVersion: 4, theme: 'dark', settings: { layoutMode: 'grid', gridColumns: 48 },
    navigation: { orientation: 'horizontal', grid: { col: 1, row: 1, w: 48, h: 1 } },
    pages: [{ id: 'one', title: 'Eins', widgets: [
      { id: 'text', type: 'text', html: '{{Temp:state}}', grid: { col: 1, row: 2, w: 8, h: 2 } },
      { id: 'html', type: 'fhem-html', devices: ['Temp'],
        html: '<span device="Temp" reading="state"></span>', grid: { col: 9, row: 2, w: 8, h: 2 } },
    ] }],
  };
  const positions = {
    navigation: { col: 1, row: 1, w: 12, h: 1 },
    pages: [{ id: 'one', widgets: [
      { id: 'text', grid: { col: 1, row: 2, w: 2, h: 2 } },
      { id: 'html', grid: { col: 3, row: 2, w: 2, h: 2 } },
    ] }],
  };
  const original = `${JSON.stringify(legacy, null, 2)}\n`;
  const invoke = (operation, ...args) => {
    const child = spawnSync('perl', ['-e', script, root, operation, ...args], { encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    return JSON.parse(child.stdout);
  };
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(path, original);
    let writes = 0;
    let loseAnswer = false;
    globalThis.fetch = async (url, options) => {
      if (!options.method) return new Response('', { headers: { 'X-FHEM-csrfToken': 'test-token' } });
      assert.equal(options.body.get('fwcsrf'), 'test-token');
      const parts = options.body.get('cmd').split(' ');
      assert.equal(parts[1], 'CMS');
      if (parts[0] === 'get') return new Response(invoke('get', ...parts.slice(2)).value);
      assert.deepEqual(parts.slice(0, 3), ['set', 'CMS', 'migrationcommit']);
      writes += 1;
      const reply = invoke('public', ...parts.slice(3));
      if (loseAnswer && !reply.error) throw new Error('Antwort verloren');
      return new Response(reply.error || JSON.stringify({ backup: reply.value }));
    };
    const client = new FhemClient('CMS', 'https://example.test/fhem/');
    const transport = createMigrationTransport(client);
    const controller = new MigrationController(transport);
    const preview = await transport.previewMigration(positions);
    assert.deepEqual(preview.source, legacy);
    assert.match(invoke('public', 'migrate', preview.token, 'e30=').error, /ungueltig|fehlt/i);
    for (const [args, pattern] of [
      [['bad'], /Unbekannte/],
      [['migrate', preview.token], /zwei Parameter/],
      [['migrate', 'bad', 'e30='], /Bestaetigung/],
      [['migrate', preview.token, 'A'], /Base64/],
      [['migrate', preview.token, '!!!!'], /Base64/],
      [['migrate', preview.token, Buffer.from('{').toString('base64')], /JSON/],
      [['restore', preview.token, '../config.json'], /Backup-Name/],
    ]) assert.match(invoke('contract', ...args).error, pattern);
    await assert.rejects(transport.migrate(positions, `${preview.token}\n`), /Bestätigung/);
    await assert.rejects(transport.restore('../config.json', preview.token), /Backup-Name/);
    await assert.rejects(transport.restore('config.json.20000101-000000.bak\n', preview.token), /Backup-Name/);
    assert.throws(() => createMigrationTransport({ ...client, cmsDevice: 'CMS\n',
      command() {}, previewMigration() {}, previewMigrationRestore() {} }), /Client/);
    await assert.rejects(transport.migrate({ data: 'ä'.repeat(524288) }, preview.token), /zu groß/);
    assert.equal(writes, 0);
    const changed = structuredClone(positions);
    changed.pages[0].widgets[0].grid.col = 5;
    await assert.rejects(transport.migrate(changed, preview.token), /veraltet/);
    assert.equal(await readFile(path, 'utf8'), original);
    assert.deepEqual(await readdir(dir), ['config.json']);
    const checked = await controller.previewMigration(legacy, positions);
    assert.deepEqual(checked, preview);
    assert.equal(await controller.commit(() => false), null);
    const backup = await controller.commit(() => true);
    assert.equal(await readFile(join(dir, backup), 'utf8'), original);
    const migrated = await readFile(path, 'utf8');
    assert.deepEqual(JSON.parse(migrated), preview.config);
    await assert.rejects(transport.migrate(positions, preview.token), /schemaVersion/);
    const restore = await controller.previewRestore(backup);
    assert.deepEqual(restore.backup, legacy);
    await writeFile(join(dir, backup), `${original}\n`);
    await assert.rejects(controller.commit(() => true), /veraltet/);
    assert.equal(await readFile(path, 'utf8'), migrated);
    await writeFile(join(dir, backup), original);
    await assert.rejects(controller.commit(() => true), /Vorschau/);
    await controller.previewRestore(backup);
    const rollback = await controller.commit(() => true);
    assert.equal(await readFile(path, 'utf8'), original);
    assert.equal(await readFile(join(dir, rollback), 'utf8'), migrated);
    assert.match(invoke('public', 'restore', restore.token, backup).error, /veraltet/);
    await controller.previewMigration(legacy, positions);
    const before = writes;
    loseAnswer = true;
    await assert.rejects(controller.commit(() => true), /Antwort verloren/);
    assert.equal(writes, before + 1, 'uncertain result is not retried automatically');
    assert.equal(JSON.parse(await readFile(path, 'utf8')).schemaVersion, 5);
    await assert.rejects(controller.commit(() => true), /Vorschau/);
    loseAnswer = false;
    await controller.previewRestore(backup);
    const recovery = await controller.commit(() => true);
    assert.equal(await readFile(path, 'utf8'), original);
    assert.equal(JSON.parse(await readFile(join(dir, recovery), 'utf8')).schemaVersion, 5);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(root, { recursive: true, force: true });
  }
});

test('migration transport rejects missing, malformed and untrusted success responses', async () => {
  let response = '';
  const transport = createMigrationTransport({
    cmsDevice: 'CMS',
    previewMigration() {},
    previewMigrationRestore() {},
    async command() { return response; },
  });
  for (const invalid of ['', 'null', '[]', '{}', '{"backup":"../config.json"}',
    '{"backup":"config.json.20000101-000000.bak\\n"}']) {
    response = invalid;
    await assert.rejects(transport.restore('config.json.20000101-000000.bak', 'a'.repeat(64)),
      /Bestätigung/);
  }
  response = 'Entwurf vorhanden';
  await assert.rejects(transport.restore('config.json.20000101-000000.bak', 'a'.repeat(64)),
    /Entwurf vorhanden/);
});
