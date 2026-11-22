import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateCssStructure, validateCssStructureDetailed } from '../www/fhem-cms/js/freehtml-css.js';

test('detailed CSS validation identifies unknown properties, functions and z-index values', () => {
  for (const [css, token, reason] of [
    ['.x{border-mystery:1px}', 'border-mystery', 'unknown-property'],
    ['.x{color:mystery-fn(1)}', 'mystery-fn', 'unknown-function'],
    ['.x{z-index:101}', '101', 'invalid-z-index'],
    ['.x{color:@invalid}', '@', 'invalid-value-token'],
  ]) {
    const detail = validateCssStructureDetailed(css);
    assert.equal(detail?.reason, reason);
    assert.equal(css.slice(detail.start, detail.end), token);
    assert.equal(validateCssStructure(css), false);
  }
});

test('detailed CSS validation preserves accepted syntax and Boolean API behavior', () => {
  for (const css of [
    '.x{color:rgb(1 2 3);content:"a > b; c"}',
    '@media (min-width: 20rem){.x{z-index:100}}',
    '@import "cms-validated-resource";',
    '.x{color:var(--accent, #fff)}',
  ]) {
    const detail = validateCssStructureDetailed(css);
    assert.equal(detail, null);
    assert.equal(validateCssStructure(css), true);
  }
});

test('structural CSS errors return a precise delimiter range', () => {
  const css = '.x{color:red';
  const detail = validateCssStructureDetailed(css);
  assert.equal(detail?.reason, 'unclosed-rule');
  assert.equal(css.slice(detail.start, detail.end), '{');
});

test('nested rules inside declarations remain rejected', () => {
  const css = '.x{color:red;.y{z-index:1}}';
  const detail = validateCssStructureDetailed(css);
  assert.equal(detail?.reason, 'nested-rule-in-declarations');
  assert.equal(validateCssStructure(css), false);
});
