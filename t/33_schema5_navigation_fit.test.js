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
    getBoundingClientRect() { assert.ok(attributes.has('data-measuring')); return { width: this.width, height: 30 }; },
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
    clientHeight: 120,
    classList: { contains() { return false; } },
    hasAttribute(name) { return attributes.has(name); },
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

test('vertical navigation needs only the widest link but reserves full stacked height in the editor', () => {
  const attributes = new Set();
  let vertical = true;
  const callbacks = [];
  class Observer {
    constructor(callback) { callbacks.push(callback); }
    observe() {}
    disconnect() {}
  }
  const nav = {
    clientWidth: 166, clientHeight: 120,
    classList: { contains() { return vertical; } },
    hasAttribute(name) { return attributes.has(name); },
    setAttribute(name) { attributes.add(name); },
    removeAttribute(name) { attributes.delete(name); },
    toggleAttribute(name, value) { if (value) attributes.add(name); else attributes.delete(name); },
    querySelector() { return { setAttribute() {} }; },
    querySelectorAll() { return [56, 105, 154, 94].map((width) => ({
      getBoundingClientRect() { return { width, height: 25 }; },
    })); },
    ownerDocument: { defaultView: { ResizeObserver: Observer, MutationObserver: Observer,
      getComputedStyle() { return { columnGap: '6px', rowGap: '6px' }; } } },
  };
  const stop = observeSchema5Navigation(nav, true);
  assert.ok(!attributes.has('data-compact'), '154 × 118px stacked contents fit in 166 × 120px');
  nav.clientHeight = 117;
  callbacks[0]();
  assert.ok(attributes.has('data-compact'), 'insufficient height also activates burger in editor');
  nav.clientHeight = 118;
  callbacks[0]();
  assert.ok(!attributes.has('data-compact'), 'growing height restores links');
  nav.clientWidth = 153;
  callbacks[0]();
  assert.ok(attributes.has('data-compact'), 'widest individual link must fit');
  nav.clientWidth = 166;
  vertical = false;
  callbacks[1]();
  assert.ok(attributes.has('data-compact'), 'horizontal orientation still requires sum of widths');
  stop();
  vertical = true;
  nav.clientHeight = 25;
  const stopPreview = observeSchema5Navigation(nav);
  assert.ok(!attributes.has('data-compact'), 'auto-height preview is not constrained by collapsed height');
  stopPreview();
  let constrained = true;
  const stopResponsive = observeSchema5Navigation(nav, () => constrained);
  assert.ok(attributes.has('data-compact'), 'desktop view respects saved navigation height');
  constrained = false;
  callbacks.at(-2)();
  assert.ok(!attributes.has('data-compact'), 'mobile auto-height responds to container changes');
  constrained = true;
  callbacks.at(-2)();
  assert.ok(attributes.has('data-compact'), 'returning to desktop restores height constraint');
  stopResponsive();
});
