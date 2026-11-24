import assert from 'node:assert/strict';
import { test } from 'node:test';
import { schema5PageBackground, setLiquidAppearance } from '../www/fhem-cms/js/fcui-schema5-appearance.js';

test('liquid appearance maps bounded settings to CSS variables', () => {
  const values = {};
  const element = { style: { setProperty: (name, value) => { values[name] = value; } } };
  setLiquidAppearance(element);
  assert.equal(values['--cms-liquid-opacity'], '0.88');
  setLiquidAppearance(element, { liquidIntensity: 100, liquidTransparency: 100 });
  assert.equal(values['--cms-liquid-blur'], '30px');
  assert.equal(values['--cms-liquid-gloss'], '0.2');
  assert.equal(values['--cms-liquid-opacity'], '0');
  setLiquidAppearance(element, { liquidIntensity: 0, liquidTransparency: 0 });
  assert.equal(values['--cms-liquid-blur'], '0px');
  assert.equal(values['--cms-liquid-opacity'], '1');
  for (const invalid of [-1, 101, 2.5, '50', null]) {
    assert.throws(() => setLiquidAppearance(element, { liquidIntensity: invalid }), /Ungültige/);
  }
});

test('liquid glass resolves local and shared backgrounds without modifying pages', () => {
  const first = `media/${'a'.repeat(32)}.png`;
  const second = `media/${'b'.repeat(32)}.jpg`;
  const config = { theme: 'liquid-glass', settings: { sharedBackground: false },
    pages: [{ id: 'start', background: first }, { id: 'other', background: second }] };
  assert.equal(schema5PageBackground(config, 'start'), first);
  assert.equal(schema5PageBackground(config, 'other'), second);
  config.settings.sharedBackground = true;
  assert.equal(schema5PageBackground(config, 'other'), first);
  const original = JSON.stringify(config);
  assert.equal(schema5PageBackground(config, 'other'), first);
  assert.equal(JSON.stringify(config), original, 'loading old pages adds no inheritance flag');
  config.pages[1].overrideBackground = true;
  assert.equal(schema5PageBackground(config, 'other'), second, 'explicit exception uses the local image');
  delete config.pages[1].background;
  assert.equal(schema5PageBackground(config, 'other'), '', 'an exception may deliberately have no image');
  config.pages[1].background = second;
  config.pages[1].overrideBackground = false;
  assert.equal(schema5PageBackground(config, 'other'), first, 'false restores inheritance without deleting the local image');
  for (const invalid of [null, 1, 'true', [], {}]) {
    config.pages[1].overrideBackground = invalid;
    assert.throws(() => schema5PageBackground(config, 'other'), /Hintergrundvererbung/);
  }
  delete config.pages[1].overrideBackground;
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
  for (const theme of ['dark', 'light', 'liquid-glass', 'oled-black', 'catppuccin-mocha']) {
    config.theme = theme;
    assert.equal(schema5PageBackground(config, 'other'), second, `${theme} uses the individual image`);
    config.settings = { sharedBackground: true };
    assert.equal(schema5PageBackground(config, 'other'), first, `${theme} uses the shared image`);
    config.settings.sharedBackground = false;
  }
  config.pages[1].background = 'https://example.test/a.png';
  assert.throws(() => schema5PageBackground(config, 'other'), /Ungültiges Hintergrundbild/);
  assert.throws(() => schema5PageBackground(config, 'unknown'), /Unbekannte Seite/);
});
