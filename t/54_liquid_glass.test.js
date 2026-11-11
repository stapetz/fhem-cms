import assert from 'node:assert/strict';
import { test } from 'node:test';
import { schema5PageBackground } from '../www/fhem-cms/js/fcui-schema5-appearance.js';

test('liquid glass resolves local and shared backgrounds without modifying pages', () => {
  const first = `media/${'a'.repeat(32)}.png`;
  const second = `media/${'b'.repeat(32)}.jpg`;
  const config = { theme: 'liquid-glass', settings: { sharedBackground: false },
    pages: [{ id: 'start', background: first }, { id: 'other', background: second }] };
  assert.equal(schema5PageBackground(config, 'start'), first);
  assert.equal(schema5PageBackground(config, 'other'), second);
  config.settings.sharedBackground = true;
  assert.equal(schema5PageBackground(config, 'other'), first);
  config.pages.reverse();
  assert.equal(schema5PageBackground(config, 'start'), second, 'the current first page supplies the shared image');
  delete config.pages[0].background;
  assert.equal(schema5PageBackground(config, 'start'), '', 'a missing start image does not fall back to another page');
  config.pages[0].background = second;
  config.pages.reverse();
  config.settings.sharedBackground = false;
  assert.equal(schema5PageBackground(config, 'other'), second);
  delete config.settings;
  assert.equal(schema5PageBackground(config, 'other'), second, 'optional settings default to individual backgrounds');
  config.theme = 'dark';
  assert.equal(schema5PageBackground(config, 'other'), '');
  config.pages[1].background = 'https://example.test/a.png';
  assert.throws(() => schema5PageBackground(config, 'other'), /Ungültiges Hintergrundbild/);
  assert.throws(() => schema5PageBackground(config, 'unknown'), /Unbekannte Seite/);
});
