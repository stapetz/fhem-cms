import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const candidates = process.env.CHROME_BIN ? [process.env.CHROME_BIN] : [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
];
let chrome;
for (const path of candidates) {
  try { await access(path); chrome = path; break; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}

async function browserResult(profile, url) {
  let port;
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]);
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await pause(25);
    }
  }
  assert.ok(port, 'Chrome exposes its isolated debugging port');
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target = targets.find((entry) => entry.type === 'page');
  assert.ok(target, 'Chrome opened an isolated page');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  try {
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', () => reject(new Error('Chrome debugging connection failed')), { once: true });
    });
    let id = 0;
    let onLoad;
    const pending = new Map();
    const command = (method, params = {}) => new Promise((resolve, reject) => {
      pending.set(++id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.method === 'Page.loadEventFired') onLoad?.resolve();
      const call = pending.get(message.id);
      if (!call) return;
      pending.delete(message.id);
      if (message.error) call.reject(new Error(JSON.stringify(message.error)));
      else call.resolve(message.result);
    });
    socket.addEventListener('close', () => {
      const error = new Error('Chrome closed before the regression finished');
      for (const call of pending.values()) call.reject(error);
      onLoad?.reject(error);
    });
    await command('Page.enable');
    const loaded = new Promise((resolve, reject) => { onLoad = { resolve, reject }; });
    await command('Page.navigate', { url });
    await loaded;
    const reply = await command('Runtime.evaluate', {
      expression: `new Promise(resolve => {
        const timer = setInterval(() => {
          const output = document.querySelector('#result[data-result]');
          if (!output) return;
          clearInterval(timer);
          resolve({ status: output.dataset.result, text: output.textContent });
        }, 50);
      })`,
      awaitPromise: true, returnByValue: true, timeout: 20000,
    });
    assert.ok(!reply.exceptionDetails, JSON.stringify(reply));
    const output = reply.result.value;
    assert.equal(output.status, 'pass', output.text);
    return JSON.parse(output.text);
  } finally { socket.close(); }
}

test('real browser zoom and resizing scale widgets and navigation without writes', {
  skip: chrome ? false : 'Chrome not installed; set CHROME_BIN to run the browser regression',
  timeout: 120000,
}, async () => {
  const server = createServer(async (request, response) => {
    const path = resolve(root, `.${new URL(request.url, 'http://localhost').pathname}`);
    if (!path.startsWith(root.endsWith(sep) ? root : `${root}${sep}`)) {
      response.writeHead(403).end(); return;
    }
    try {
      const body = await readFile(path);
      response.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript'
        : path.endsWith('.css') ? 'text/css' : 'text/html');
      response.end(body);
    } catch (error) {
      if (error.code !== 'ENOENT') { response.writeHead(500).end(String(error)); return; }
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const profiles = await mkdtemp(join(tmpdir(), 'cms-scaling-'));
  try {
    const results = new Map();
    for (const [zoom, windowWidth] of [[1, 1440], [0.8, 1440], [1.25, 1440], [2, 1440], [2, 600]]) {
      const profile = join(profiles, `${zoom}-${windowWidth}`);
      const preferences = join(profile, 'Default', 'Preferences');
      await mkdir(dirname(preferences), { recursive: true });
      await writeFile(preferences, JSON.stringify({
        // Chromium keys the default storage partition by "x" plus its empty relative path.
        partition: { default_zoom_level: { x: Math.log(zoom) / Math.log(1.2) } },
      }));
      const child = spawn(chrome, [
        '--headless=new', '--no-first-run', '--no-default-browser-check',
        '--disable-background-networking', '--force-device-scale-factor=1',
        '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
        `--user-data-dir=${profile}`, `--window-size=${windowWidth},1000`,
        'about:blank',
      ]);
      let stderr = '';
      child.stdout.resume();
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      const closed = new Promise((resolve, reject) => {
        child.on('error', reject);
        child.on('close', resolve);
      });
      const timeout = setTimeout(() => child.kill('SIGTERM'), 25000);
      let data;
      try {
        data = await browserResult(profile,
          `http://127.0.0.1:${server.address().port}/t/35_schema5_scaling.html`);
        assert.equal(child.exitCode, null, stderr);
      } finally {
        child.kill('SIGTERM');
        await closed;
        clearTimeout(timeout);
      }
      if (windowWidth === 1440) results.set(zoom, data);
      assert.ok(Math.abs(data.initial.dpr - zoom) < 0.02, `real page zoom ${zoom}: ${data.initial.dpr}`);
      assert.ok(Math.abs(data.initial.viewport - windowWidth / zoom) < 2, 'zoom changes the CSS viewport');
      assert.ok(data.unchanged, 'resize and zoom do not mutate config or restart requests');
      assert.ok(data.editorPreserved, 'editor retains precise saved grid coordinates and does not reflow');
      assert.ok(data.longCompact && data.openLinks, 'long navigation switches to a usable burger');
      assert.equal(data.restored.compact, data.initial.compact,
        `navigation recovers after label changes: ${JSON.stringify({ initial: data.initial, restored: data.restored })}`);
      const [wide, narrow, phone, landscape, again] = data.resize;
      assert.ok(wide.link.width > narrow.link.width * 1.1,
        `navigation buttons resize with the window: ${JSON.stringify({ zoom, windowWidth, wide, narrow })}`);
      assert.ok(wide.navFont > narrow.navFont * 1.1, 'navigation text resizes with buttons');
      assert.ok(wide.widget.width > narrow.widget.width, 'widgets resize with the window');
      assert.ok(Math.abs(wide.widget.width - again.widget.width) < 1, 'rotation/resizing is stable');
      for (const state of [data.initial, ...data.resize, data.restored]) {
        assert.ok(state.root.width >= state.widget.width, 'widgets remain within their container');
        assert.ok(state.navFont >= 11.5, 'navigation text retains its readable minimum size');
        const sorted = [...state.widgets].sort((a, b) => a.y - b.y || a.x - b.x);
        for (let i = 0; i < sorted.length; i++) {
          for (let j = i + 1; j < sorted.length; j++) {
            const a = sorted[i]; const b = sorted[j];
            assert.ok(a.x + a.width <= b.x + 1 || b.x + b.width <= a.x + 1
              || a.y + a.height <= b.y + 1 || b.y + b.height <= a.y + 1, 'widgets never overlap');
          }
        }
      }
      assert.ok(!data.initial.overflow, 'browser zoom does not cause horizontal scrolling');
      assert.ok(phone.widgets[0].y === phone.widgets[1].y, 'two small widgets still fit on a phone');
      assert.ok(landscape.widgets[0].y === landscape.widgets[1].y, 'landscape retains side-by-side widgets');
    }
    const physical = (zoom, element, key) => results.get(zoom).initial[element][key] * zoom;
    for (const zoom of [0.8, 1.25, 2]) {
      for (const font of ['navFont', 'widgetFont']) {
        const ratio = results.get(zoom).initial[font] * zoom / results.get(1).initial[font];
        assert.ok(zoom < 1 ? ratio < 0.98 : ratio > 1.02, `${font} visibly follows real zoom ${zoom}`);
      }
      for (const element of ['widget', 'link']) {
        for (const dimension of ['width', 'height']) {
          const ratio = physical(zoom, element, dimension) / physical(1, element, dimension);
          assert.ok(zoom < 1 ? ratio < 0.98 : ratio > 1.02,
            `${element} ${dimension} visibly follows real zoom ${zoom}: ratio ${ratio}`);
        }
      }
    }
    const rowCount = (zoom) => results.get(zoom).initial.widgets.slice(0, 4)
      .filter((item) => Math.abs(item.y - results.get(zoom).initial.widgets[0].y) < 1).length;
    assert.ok(rowCount(2) < rowCount(1), 'zooming in places fewer widgets on a row');
    console.log(JSON.stringify([...results].map(([zoom, data]) => ({
      zoom, viewport: data.initial.viewport, widget: data.initial.widget.width,
      button: data.initial.link.width, rowCount: rowCount(zoom),
    }))));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(profiles, { recursive: true, force: true });
  }
});
