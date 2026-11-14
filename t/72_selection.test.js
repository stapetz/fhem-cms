import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  isDiscreteSetCommand,
  parseDiscreteSetCommand,
  parseDiscreteSetCommands,
} from '../www/fhem-cms/js/select-commands.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const chromeCandidates = process.env.CHROME_BIN ? [process.env.CHROME_BIN] : [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];
let chrome;
for (const path of chromeCandidates) {
  try {
    await access(path);
    chrome = path;
    break;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

test('parses safe discrete FHEM set entries', () => {
  assert.deepEqual(parseDiscreteSetCommand('mode:auto,eco,comfort'), {
    command: 'mode',
    values: ['auto', 'eco', 'comfort'],
  });
  assert.deepEqual(parseDiscreteSetCommand('level:10,20,30,40'), {
    command: 'level',
    values: ['10', '20', '30', '40'],
  });
  assert.deepEqual(parseDiscreteSetCommand('temperature:-5,+2.5,20'), {
    command: 'temperature',
    values: ['-5', '+2.5', '20'],
  });
  assert.equal(isDiscreteSetCommand('mode:auto,eco'), true);
});

test('rejects non-discrete, ambiguous, or unsafe set entries', () => {
  for (const token of [
    'on:noArg',
    'dim:slider,0,1,100',
    'mode:auto',
    'bad command:auto,eco',
    'mode:auto,eco;set',
    'mode:auto,eco value',
    'mode:auto,auto',
    'mode:.,eco',
    `mode:${Array.from({ length: 33 }, (_, index) => `v${index}`).join(',')}`,
    'mode:auto;set Lamp on',
  ]) {
    assert.equal(parseDiscreteSetCommand(token), null, token);
  }
  assert.equal(isDiscreteSetCommand('dim:slider,0,1,100'), false);
});

test('lists only valid discrete entries and keeps deterministic source order', () => {
  assert.deepEqual(parseDiscreteSetCommands(
    'on:noArg mode:auto,eco dim:slider,0,1,100 level:10,20 mode:other,duplicate bad:one,one'
  ), [
    { command: 'mode', values: ['auto', 'eco'] },
    { command: 'level', values: ['10', '20'] },
  ]);
  assert.deepEqual(parseDiscreteSetCommands(null), []);
});

test('selection widget behavior in isolated Chrome', { skip: !chrome && 'Chrome not installed; set CHROME_BIN' }, async () => {
  const profile = await mkdtemp(join(root, '.selection-browser-'));
  const server = createServer(async (request, response) => {
    let path;
    try {
      path = resolve(root, `.${decodeURIComponent(new URL(request.url, 'http://localhost').pathname)}`);
    } catch (error) {
      response.writeHead(400).end();
      return;
    }
    if (!path.startsWith(root.endsWith(sep) ? root : `${root}${sep}`)) {
      response.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(path);
      response.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript'
        : path.endsWith('.css') ? 'text/css' : 'text/html');
      response.end(body);
    } catch (error) {
      response.writeHead(error.code === 'ENOENT' ? 404 : 500).end();
    }
  });
  let child;
  let stderr = '';
  let socket;
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const url = `http://127.0.0.1:${server.address().port}/t/72_selection.html`;
    child = spawn(chrome, [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      'about:blank',
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-8000); });

    let port;
    for (let attempt = 0; attempt < 400; attempt += 1) {
      if (child.exitCode !== null) throw new Error(`Chrome exited before debugging was ready (${child.exitCode})`);
      try {
        port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]);
        if (Number.isInteger(port) && port > 0 && port <= 65535) break;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      await pause(25);
    }
    assert.ok(port, 'Chrome exposes its isolated debugging port');
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const target = targets.find((entry) => entry.type === 'page');
    assert.ok(target, 'Chrome opened the isolated widget fixture');
    socket = new WebSocket(target.webSocketDebuggerUrl);
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
      for (const call of pending.values()) call.reject(new Error('Chrome closed before the regression finished'));
    });
    await command('Page.enable');
    await command('Runtime.enable');
    const loaded = new Promise((resolve, reject) => {
      onLoad = { resolve, reject };
    });
    await command('Page.navigate', { url });
    await loaded;
    const reply = await command('Runtime.evaluate', {
      expression: `new Promise(resolve => {
        const started = Date.now();
        const poll = () => {
          const output = document.querySelector('#result[data-result]');
          if (output) resolve({ status: output.dataset.result, text: output.textContent });
          else if (Date.now() - started > 30000) resolve({ status: 'timeout', text: 'fixture did not finish' });
          else setTimeout(poll, 50);
        };
        poll();
      })`,
      awaitPromise: true,
      returnByValue: true,
      timeout: 35000,
    });
    assert.ok(!reply.exceptionDetails, JSON.stringify(reply));
    const result = reply.result.value;
    assert.equal(result.status, 'pass', result.text);
    assert.ok(JSON.parse(result.text).checks >= 15, 'browser fixture covers the selection widget lifecycle');
  } catch (error) {
    throw new Error(`${error.message}\nChrome stderr:\n${stderr}`, { cause: error });
  } finally {
    socket?.close();
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      await new Promise((resolve) => child.once('close', resolve));
    }
    await new Promise((resolve) => server.close(resolve));
    await rm(profile, { recursive: true, force: true });
  }
});
