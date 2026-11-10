import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { actionIconUrl, collectActionPresentation, defaultActionIcon } from '../www/fhem-cms/js/action-presentation.js';

const config = () => ({
  schemaVersion: 5, theme: 'dark', settings: { layoutMode: 'grid', gridColumns: 12 },
  navigation: { orientation: 'horizontal', grid: { col: 1, row: 1, w: 12, h: 1 } },
  pages: [{ id: 'one', title: 'Home', widgets: [
    { id: 'button', type: 'fhem-button', device: 'Lamp', command: 'toggle', grid: { col: 1, row: 2, w: 3, h: 2 } },
    { id: 'switch', type: 'fhem-switch', device: 'Lamp', reading: 'state', on: 'on', off: 'off',
      grid: { col: 4, row: 2, w: 3, h: 2 } },
  ] }],
});

test('action presentation shares self-contained defaults and strictly collects the text choice', () => {
  const icons = ['toggle', 'on', 'off', 'unknown', 'press'].map(defaultActionIcon);
  assert.equal(new Set(icons).size, 5);
  for (const icon of icons) assert.match(decodeURIComponent(icon), /viewBox="0 0 24 24"/);
  assert.equal(defaultActionIcon('TOGGLE'), defaultActionIcon('toggle'));
  assert.equal(defaultActionIcon('arbitrary'), defaultActionIcon('press'));
  assert.equal(defaultActionIcon('<script>'), defaultActionIcon('press'));
  for (const command of ['constructor', '__proto__', 'toString']) {
    assert.equal(defaultActionIcon(command), defaultActionIcon('press'));
  }
  assert.equal(actionIconUrl('', 'toggle'), defaultActionIcon('toggle'), 'defaults need no FHEM icon service');
  assert.equal(actionIconUrl('custom.svg', 'toggle', { iconUrl: (name) => `/icons/${name}` }), '/icons/custom.svg');
  for (const value of ['true', 'false', '', null, undefined, 'yes', true]) {
    const form = { elements: { showLabel: { value } } };
    if (['true', 'false'].includes(value)) assert.equal(collectActionPresentation(form), value === 'true');
    else assert.throws(() => collectActionPresentation(form), /Darstellung/);
  }
});

test('Perl validates action captions and persists them through draft and publish without changing geometry', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cms-action-presentation-'));
  const invoke = (operation, value) => {
    const script = `
use strict; use warnings; use JSON::PP ();
sub Log3 {}
require './FHEM/01_FHEMCMS.pm';
my ($dir, $operation) = @ARGV;
local $/; my $value = JSON::PP->new->decode(<STDIN>);
my $error;
if ($operation eq 'validate') { $error = FHEMCMS_ValidateConfig($value, 5); }
else {
    my ($state, $readError) = FHEMCMS_ReadVersion5State($dir);
    die $readError if defined $readError;
    if ($operation eq 'save') {
        $error = FHEMCMS_WriteVersion5Draft($dir, $value, $state->{token});
    } elsif ($operation eq 'publish') {
        (undef, $error) = FHEMCMS_PublishVersion5Draft($dir, $state->{token});
    } else { die 'unknown operation'; }
}
print $error if defined $error;
`;
    const child = spawnSync('perl', ['-e', script, dir, operation], { input: JSON.stringify(value), encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    return child.stdout;
  };
  try {
    const original = JSON.stringify(config());
    await writeFile(join(dir, 'config.json'), original);
    for (const type of ['fhem-button', 'fhem-switch']) {
      for (const showLabel of [undefined, true, false, 'true', 1, null, [], {}]) {
        const candidate = config();
        const widget = candidate.pages[0].widgets.find((entry) => entry.type === type);
        if (showLabel !== undefined) widget.showLabel = showLabel;
        const valid = showLabel === undefined || typeof showLabel === 'boolean';
        const error = invoke('validate', candidate);
        if (valid) assert.equal(error, '');
        else assert.match(error, /showLabel/);
      }
      for (const label of ['', 'x'.repeat(33), 'bad\nlabel', null, [], 'Licht umschalten']) {
        const candidate = config();
        candidate.pages[0].widgets.find((entry) => entry.type === type).label = label;
        const error = invoke('validate', candidate);
        if (label === 'Licht umschalten') assert.equal(error, '');
        else assert.match(error, /Beschriftung/);
      }
    }
    const next = config();
    for (const widget of next.pages[0].widgets) {
      widget.label = 'Licht';
      widget.showLabel = true;
      widget.icon = 'general_an';
    }
    next.pages[0].widgets[1].iconOff = 'general_aus';
    assert.equal(invoke('save', next), '');
    assert.equal(await readFile(join(dir, 'config.json'), 'utf8'), original);
    assert.deepEqual(JSON.parse(await readFile(join(dir, 'draft.json'), 'utf8')), next);
    assert.equal(invoke('publish', null), '');
    assert.deepEqual(JSON.parse(await readFile(join(dir, 'config.json'), 'utf8')), next);
    assert.deepEqual(next.pages[0].widgets.map((widget) => widget.grid), config().pages[0].widgets.map((widget) => widget.grid));
    const iconOnly = structuredClone(next);
    for (const widget of iconOnly.pages[0].widgets) {
      widget.showLabel = false;
      delete widget.icon;
      delete widget.iconOff;
    }
    assert.equal(invoke('save', iconOnly), '');
    assert.deepEqual(JSON.parse(await readFile(join(dir, 'config.json'), 'utf8')), next, 'reset does not change live before publish');
    assert.deepEqual(JSON.parse(await readFile(join(dir, 'draft.json'), 'utf8')), iconOnly);
    assert.equal(invoke('publish', null), '');
    assert.deepEqual(JSON.parse(await readFile(join(dir, 'config.json'), 'utf8')), iconOnly);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
