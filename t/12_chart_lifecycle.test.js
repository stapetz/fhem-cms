import assert from 'node:assert/strict';
import { test } from 'node:test';

test('chart ignores detached responses and refreshes on reconnect', async () => {
  const previous = {
    window: globalThis.window, HTMLElement: globalThis.HTMLElement, customElements: globalThis.customElements,
  };
  globalThis.window = { clearInterval() {} };
  globalThis.HTMLElement = class {
    attachShadow() { this.shadowRoot = { childElementCount: 1 }; }
  };
  let Chart;
  globalThis.customElements = {
    get() { return undefined; },
    define(name, type) { if (name === 'cms-chart') Chart = type; },
  };
  try {
    await import('../www/fhem-cms/components/cms-chart.js');
    const chart = new Chart();
    const pending = [];
    const drawn = [];
    const messages = [];
    chart.services = { history: () => new Promise((resolve, reject) => pending.push({ resolve, reject })) };
    chart.isConnected = true;
    chart.scheduleRefresh = () => {};
    chart.render = () => {};
    chart.message = (text) => messages.push(text);
    chart.draw = (result) => drawn.push(result);
    chart.config = { device: 'Temp', reading: 'state' };
    assert.equal(pending.length, 1);
    chart.isConnected = false;
    chart.disconnectedCallback();
    pending[0].resolve({ points: [[1, 1]] });
    await Promise.resolve();
    assert.deepEqual(drawn, [], 'detached chart ignores late data');
    chart.config = { device: 'Temp', reading: 'temperature' };
    assert.equal(pending.length, 1, 'changing disconnected configuration does not request history');
    chart.isConnected = true;
    chart.connectedCallback();
    assert.equal(pending.length, 2, 'reconnection starts a fresh request');
    pending[1].resolve({ points: [[2, 2]] });
    await Promise.resolve();
    assert.deepEqual(drawn, [{ points: [[2, 2]] }]);
    assert.equal(messages.at(-1), 'Verlauf wird geladen …');
    const rejected = chart.load();
    chart.isConnected = false;
    chart.disconnectedCallback();
    pending[2].reject(new Error('late network failure'));
    await rejected;
    assert.equal(messages.at(-1), 'Verlauf wird geladen …', 'detached chart ignores late errors');
  } finally {
    globalThis.window = previous.window;
    globalThis.HTMLElement = previous.HTMLElement;
    globalThis.customElements = previous.customElements;
  }
});
