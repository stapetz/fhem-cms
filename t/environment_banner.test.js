import { test } from 'node:test';
import assert from 'node:assert/strict';
import { showDevBanner } from '../www/fhem-cms/js/environment-banner.js';

test('DEV-Banner nur für DEV-Backend ohne lokales Banner und außerhalb der Geräte-Vorschau', () => {
  const previous = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class { observe() {} };
  try {
    for (const [version, search, framed, local, expected] of [
      ['1.37.0-dev', '', false, false, true],
      ['1.37.0-dev', '', false, true, false],
      ['1.37.0', '', false, false, false],
      ['', '', false, false, false],
      ['1.37.0-dev', '?mode=preview', true, false, true],
      ['1.37.0-dev', '?mode=preview', true, true, false],
      ['1.37.0-dev', '?mode=preview&cms-device-preview=1', true, false, false],
      ['1.37.0-dev', '?mode=preview&cms-device-preview=1', false, false, true],
    ]) {
      const banners = [];
      const props = {};
      const document = {
        querySelector: selector => selector.startsWith('meta') ? { content: version }
          : selector === '.cms-local-banner' && local ? {} : null,
        createElement: () => ({ setAttribute() {}, offsetHeight: 32 }),
        body: { prepend: element => banners.push(element) },
        documentElement: { style: { setProperty: (key, value) => { props[key] = value; } } },
      };
      const browser = { location: { search } };
      browser.parent = framed ? {} : browser;
      showDevBanner(document, browser);
      assert.equal(banners.length, Number(expected), `${version} ${search} framed=${framed} local=${local}`);
      if (expected) {
        assert.equal(banners[0].textContent, 'TEST - DEV Version');
        assert.equal(props['--cms-dev-banner-height'], '32px');
      }
    }
  } finally {
    globalThis.ResizeObserver = previous;
  }
});
