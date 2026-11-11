import assert from 'node:assert/strict';
import { test } from 'node:test';
import { observeSchema5Navigation } from '../www/fhem-cms/js/fcui-schema5-navigation-fit.js';

function style() {
  const values = new Map();
  return {
    [Symbol.iterator]: () => values.keys(),
    getPropertyValue: name => values.get(name) || '',
    getPropertyPriority: () => '',
    setProperty: (name, value) => values.set(name, value),
    removeProperty: name => values.delete(name),
  };
}

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
    style: style(), getAttribute: () => '',
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
    style: style(), getAttribute: () => '',
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

test('horizontal links shrink only for a small height shortage and restore when space grows', () => {
  const attributes = new Set();
  const callbacks = [];
  const navStyle = style();
  class Observer {
    constructor(callback) { callbacks.push(callback); }
    observe() {}
    disconnect() {}
  }
  const link = { getBoundingClientRect() {
    const scale = Number(navStyle.getPropertyValue('--cms-nav-fit-scale') || 1);
    return { width: 100 * scale, height: 30 * scale + 2 };
  } };
  const nav = {
    style: navStyle, getAttribute: () => navStyle.getPropertyValue('--cms-nav-fit-scale'),
    clientWidth: 150, clientHeight: 30,
    classList: { contains: () => false },
    hasAttribute: name => attributes.has(name),
    setAttribute: name => attributes.add(name),
    removeAttribute: name => attributes.delete(name),
    toggleAttribute: (name, value) => value ? attributes.add(name) : attributes.delete(name),
    querySelector: () => ({ setAttribute() {} }),
    querySelectorAll: () => [link],
    ownerDocument: { defaultView: { ResizeObserver: Observer, MutationObserver: Observer,
      getComputedStyle: () => ({}) } },
  };
  const stop = observeSchema5Navigation(nav, true);
  const scale = Number(navStyle.getPropertyValue('--cms-nav-fit-scale'));
  assert.ok(scale >= 0.8 && scale < 1, `small reduction applied: ${scale}`);
  assert.ok(!attributes.has('data-compact'), 'reduced link fits');
  nav.clientHeight = 32;
  callbacks[0]();
  assert.equal(navStyle.getPropertyValue('--cms-nav-fit-scale'), '');
  assert.ok(!attributes.has('data-compact'));
  nav.clientHeight = 20;
  callbacks[0]();
  assert.ok(attributes.has('data-compact'), 'large height shortage still collapses');
  nav.clientHeight = 30;
  nav.clientWidth = 50;
  callbacks[0]();
  assert.ok(attributes.has('data-compact'), 'insufficient width still collapses');
  assert.equal(navStyle.getPropertyValue('--cms-nav-fit-scale'), '', 'burger keeps normal size');
  stop();
  assert.equal(navStyle.getPropertyValue('--cms-nav-fit-scale'), '');
});

test('style observer ignores its own scaling but reacts to external style changes', () => {
  const callbacks = [];
  let measurements = 0;
  const attributes = new Set();
  const navStyle = style();
  class Observer {
    constructor(callback) { callbacks.push(callback); }
    observe() {}
    disconnect() {}
  }
  const nav = {
    style: navStyle, clientWidth: 150, clientHeight: 30,
    classList: { contains: () => false },
    hasAttribute: name => attributes.has(name),
    setAttribute: name => attributes.add(name),
    removeAttribute: name => attributes.delete(name),
    toggleAttribute: (name, value) => value ? attributes.add(name) : attributes.delete(name),
    querySelector: () => ({ setAttribute() {} }),
    querySelectorAll: () => [{ getBoundingClientRect() {
      measurements++;
      return { width: 100, height: 30 * Number(navStyle.getPropertyValue('--cms-nav-fit-scale') || 1) + 2 };
    } }],
    ownerDocument: { defaultView: { ResizeObserver: Observer, MutationObserver: Observer,
      getComputedStyle: () => ({}) } },
  };
  const stop = observeSchema5Navigation(nav, true);
  const afterInitial = measurements;
  callbacks[1]([{ target: nav, attributeName: 'style' }]);
  assert.equal(measurements, afterInitial, 'scale writes do not retrigger measurement');
  navStyle.setProperty('height', '40px');
  callbacks[1]([{ target: nav, attributeName: 'style' }]);
  assert.ok(measurements > afterInitial, 'external inline style change is measured');
  stop();
});
