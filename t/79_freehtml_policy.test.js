import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { isSafeCss, isSafeHtmlUrl } from '../www/fhem-cms/js/freehtml.js';

const cases = JSON.parse(readFileSync(new URL('./fixtures/freehtml_policy.json', import.meta.url), 'utf8'));

test('frontend and backend implement the same positive CSS and URL policy', () => {
  const result = spawnSync('perl', ['-MJSON::PP', '-e', `
    require './FHEM/01_FHEMCMS.pm';
    local $/; my $cases = decode_json(<STDIN>);
    print encode_json({
      css => [map { FHEMCMS_FreeHtmlCss($_->[0]) ? JSON::PP::true : JSON::PP::false } @{$cases->{css}}],
      urls => [map { FHEMCMS_FreeHtmlUrl($_->[0]) ? JSON::PP::true : JSON::PP::false } @{$cases->{urls}}],
      html => [map { !defined(FHEMCMS_ValidateFreeHtml($_->[0])) ? JSON::PP::true : JSON::PP::false } @{$cases->{html}}]
    });
  `], { input: JSON.stringify(cases), encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  const backend = JSON.parse(result.stdout);
  for (const [kind, entries] of Object.entries(cases)) {
    entries.forEach(([source, expected], index) => {
      assert.equal(backend[kind][index], expected, `backend ${kind}: ${source}`);
      if (kind !== 'html') assert.equal((kind === 'css' ? isSafeCss : isSafeHtmlUrl)(source), expected, `frontend ${kind}: ${source}`);
    });
  }
});

test('CSS property and function allowlists remain identical in Perl and JavaScript', () => {
  const js = readFileSync(new URL('../www/fhem-cms/js/freehtml-css.js', import.meta.url), 'utf8');
  const perl = readFileSync(new URL('../FHEM/01_FHEMCMS.pm', import.meta.url), 'utf8');
  for (const name of ['properties', 'functions']) {
    const jsWords = new RegExp(`const ${name.toUpperCase()} = new Set\\(\`([\\s\\S]*?)\``).exec(js)[1];
    const perlWords = new RegExp(`my %${name} = map.*?qw\\(([\\s\\S]*?)\\);`).exec(perl)[1];
    const words = text => [...new Set(text.toLowerCase().trim().split(/\s+/))].sort();
    assert.deepEqual(words(jsWords), words(perlWords), name);
  }
});
