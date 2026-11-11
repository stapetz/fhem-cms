import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const widget = () => ({ id: 'a1', type: 'fhem-calllist', device: 'Calls', limit: 5,
  columns: ['state', 'party', 'timestamp', 'duration'], grid: { col: 1, row: 2, w: 8, h: 8 } });
const config = value => ({ schemaVersion: 5, theme: 'dark', settings: { layoutMode: 'grid', gridColumns: 12 },
  navigation: { orientation: 'horizontal', grid: { col: 1, row: 1, w: 12, h: 1 } },
  pages: [{ id: 'home', title: 'Start', widgets: [value] }] });
const source = 'use strict; use warnings; use JSON::PP (); require "./FHEM/01_FHEMCMS.pm";'
  + ' local $/; my $v=JSON::PP->new->utf8->decode(<STDIN>); my $e=FHEMCMS_ValidateConfig($v,5); print $e if defined $e;';
function validate(value) {
  const result = spawnSync('perl', ['-e', source], { input: JSON.stringify(config(value)), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test('call list configuration is bounded and validated by the backend', () => {
  for (const limit of [1, 5, 20]) assert.equal(validate({ ...widget(), limit }), '');
  for (const limit of [0, 21, -1, 1.5, 'x', null]) assert.notEqual(validate({ ...widget(), limit }), '');
  for (const columns of [[], ['state', 'state'], ['state', 'html'], null, 'state']) {
    assert.notEqual(validate({ ...widget(), columns }), '');
  }
  assert.equal(validate({ ...widget(), columns: ['state', 'party', 'timestamp', 'duration', 'name',
    'number', 'internal', 'external', 'connection'] }), '');
  assert.notEqual(validate({ ...widget(), device: 'invalid;command' }), '');
  assert.notEqual(validate({ ...widget(), extra: true }), '');
});

test('call list participates in live snapshot subscription and widget creation', async () => {
  globalThis.HTMLElement = class {};
  const registry = new Map();
  globalThis.customElements = { get: key => registry.get(key), define: (key, value) => registry.set(key, value) };
  const { devicesOf, dataFor, isLiveWidget, createWidgetElement } = await import('../www/fhem-cms/js/widget-factory.js');
  const snapshots = new Map([['Calls', [{ name: 'Calls', readings: { '1-state': '=>' } }]]]);
  assert.deepEqual(devicesOf(widget()), ['Calls']);
  assert.equal(isLiveWidget(widget()), true);
  assert.deepEqual(dataFor(widget(), snapshots), snapshots.get('Calls'));
  globalThis.document = { createElement: tag => ({ tag, setAttribute(name) { this[name] = true; } }) };
  const element = createWidgetElement(widget(), {}, snapshots, true);
  assert.equal(element.tag, 'cms-calllist');
  assert.deepEqual(element.data, snapshots.get('Calls'));
  assert.equal(element['view-only'], true);
});

test('call list survives real isolated Perl draft storage', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cms-calllist-'));
  const script = `
    use strict;
    use warnings;
    use JSON::PP ();
    use MIME::Base64 qw(decode_base64);
    sub Log3 {}
    require './FHEM/01_FHEMCMS.pm';
    my ($dir, $operation, @args) = @ARGV;
    my ($result, $error);
    if ($operation eq 'read') {
      ($result, $error) = FHEMCMS_ReadVersion5State($dir);
    } elsif ($operation eq 'save') {
      my $value = JSON::PP->new->utf8->decode(decode_base64($args[0]));
      $error = FHEMCMS_WriteVersion5Draft($dir, $value, $args[1]);
    } else { die 'unknown operation'; }
    print JSON::PP->new->utf8->canonical->encode({result => $result, error => $error});
  `;
  const invoke = (operation, ...args) => {
    const result = spawnSync('perl', ['-e', script, dir, operation, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const reply = JSON.parse(result.stdout);
    assert.equal(reply.error, null);
    return reply.result;
  };
  try {
    const live = config(widget());
    live.pages[0].widgets = [];
    await writeFile(join(dir, 'config.json'), JSON.stringify(live));
    const initial = invoke('read');
    const draft = config(widget());
    invoke('save', Buffer.from(JSON.stringify(draft)).toString('base64'), initial.token);
    const after = invoke('read');
    assert.deepEqual(after.live, live);
    assert.deepEqual(after.draft, draft);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
