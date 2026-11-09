import assert from 'node:assert/strict';
import { test } from 'node:test';
import { observeSchema5Navigation } from '../www/fhem-cms/js/fcui-schema5-navigation-fit.js';

test('navigation measures links and gaps, reacts to content/fonts/resize and disconnects', async () => {
  const callbacks = [];
  let disconnected = 0;
  let fontCallback;
  let fontReady;
  let focused = false;
  const attributes = new Set();
  const links = [90, 100, 110].map((width) => ({
    hidden: false,
    width,
    getBoundingClientRect() { assert.ok(attributes.has('data-measuring')); return { width: this.width }; },
    focus() { focused = true; },
  }));
  const burger = { setAttribute(name, value) { this[name] = value; } };
  class Observer {
    constructor(callback) { callbacks.push(callback); }
    observe() {}
    disconnect() { disconnected += 1; }
  }
  const fonts = {
    ready: new Promise((resolve) => { fontReady = resolve; }),
    addEventListener(name, callback) { assert.equal(name, 'loadingdone'); fontCallback = callback; },
    removeEventListener(name, callback) { assert.equal(callback, fontCallback); fontCallback = null; },
  };
  const nav = {
    clientWidth: 336,
    ownerDocument: {
      activeElement: null, fonts,
      defaultView: { ResizeObserver: Observer, MutationObserver: Observer,
        getComputedStyle() { return { columnGap: '8px', paddingLeft: '10px', paddingRight: '10px' }; } },
    },
    querySelector(selector) { return selector === '.cms-nav-burger' ? burger : links[0]; },
    querySelectorAll() { return links; },
    setAttribute(name) { attributes.add(name); },
    removeAttribute(name) { attributes.delete(name); },
    toggleAttribute(name, value) { if (value) attributes.add(name); else attributes.delete(name); },
  };
  const stop = observeSchema5Navigation(nav);
  assert.ok(!attributes.has('data-compact'), '300px links + 16px gaps fit exactly in 316px');
  nav.clientWidth = 335;
  callbacks[0]();
  assert.ok(attributes.has('data-compact'));
  attributes.add('data-open');
  links[2].hidden = true;
  callbacks[1]();
  assert.ok(!attributes.has('data-compact'), 'hidden links do not consume space');
  assert.ok(!attributes.has('data-open'));
  assert.equal(burger['aria-expanded'], 'false');
  links[2].hidden = false;
  links[0].width = 180;
  fontCallback();
  assert.ok(attributes.has('data-compact'));
  nav.clientWidth = 800;
  nav.ownerDocument.activeElement = burger;
  callbacks[0]();
  assert.ok(!attributes.has('data-compact'));
  assert.ok(focused, 'focus is moved off a newly hidden burger');
  nav.clientWidth = 0;
  callbacks[0]();
  assert.ok(!attributes.has('data-compact'), 'detached/hidden navigation retains its last state');
  stop();
  assert.equal(disconnected, 2);
  assert.equal(fontCallback, null);
  assert.ok(!attributes.has('data-adaptive'));
  nav.clientWidth = 1;
  fontReady();
  await Promise.resolve();
  callbacks.forEach((callback) => callback());
  assert.ok(!attributes.has('data-compact'), 'late callbacks after cleanup cannot change the navigation');
});
