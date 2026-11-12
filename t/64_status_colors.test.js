import assert from 'node:assert/strict';
import { test } from 'node:test';

globalThis.HTMLElement ??= class {};
const elements = new Map();
globalThis.customElements ??= {
  get: name => elements.get(name),
  define: (name, value) => elements.set(name, value),
};

const { stateColorInputValue } = await import('../www/fhem-cms/components/cms-icon.js');

test('new status color mappings use the current theme accent without replacing custom colors', () => {
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => '#287a47' });
  const host = {};
  assert.equal(stateColorInputValue('', host), '#287a47');
  assert.equal(stateColorInputValue('not-a-color', host), '#287a47');
  assert.equal(stateColorInputValue('#ffb300', host), '#ffb300');
});

test('status color mapping falls back when a theme accent is not a supported hex color', () => {
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => 'rgb(40, 122, 71)' });
  assert.equal(stateColorInputValue('', {}), '#8fd0a8');
});
