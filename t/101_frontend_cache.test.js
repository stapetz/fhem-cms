import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const chrome = process.env.CHROME_BIN || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome',
  '/usr/bin/chromium', '/usr/bin/chromium-browser',
].find(path => spawnSync('test', ['-x', path]).status === 0);

test('cached generated pages revalidate and load a single current transitive module graph', {
  skip: chrome ? false : 'Chrome not installed', timeout: 45000,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'cms-cache-'));
  const profile = join(root, 'profile');
  let child;
  let socket;
  let server;
  try {
    const assets = join(root, 'www', 'fhem-cms');
    await mkdir(join(assets, 'js'), { recursive: true });
    await mkdir(join(assets, 'components'));
    await mkdir(join(assets, 'css'));
    await writeFile(join(assets, 'css', 'fhem-cms.css'), '');
    await writeFile(join(assets, 'css', 'fcui-gridstack.css'), '');
    const generate = async version => {
      await writeFile(join(assets, 'js', 'fhem-cms.js'),
        `import {nested} from './nested.js'; import {widget} from '../components/widget.js';
        document.querySelector('.cms-status').textContent=JSON.stringify({version:${version},nested,widget});`);
      await writeFile(join(assets, 'js', 'nested.js'), `export const nested=${version};`);
      await writeFile(join(assets, 'components', 'widget.js'), `export const widget=${version};`);
      const result = spawnSync('perl', ['-e', `
        require './FHEM/01_FHEMCMS.pm';
        $main::attr{global}{modpath}=$ARGV[0];
        my $error=FHEMCMS_CreateStartPage('Test');
        die $error if defined $error;
      `, root], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
    };
    await generate(1);
    const requests = [];
    server = createServer(async (req, res) => {
      const url = new URL(req.url, 'http://localhost');
      requests.push({ path: url.pathname, search: url.search, cache: req.headers['cache-control'] });
      const relative = url.pathname.replace(/^\/fhem-cms\//, '');
      if (relative.includes('..') || !url.pathname.startsWith('/fhem-cms/')) {
        res.writeHead(404).end(); return;
      }
      try {
        const body = await readFile(join(assets, relative));
        res.setHeader('Content-Type', relative.endsWith('.js') ? 'text/javascript'
          : relative.endsWith('.css') ? 'text/css' : 'text/html');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.end(body);
      } catch (error) {
        if (error.code === 'ENOENT') res.writeHead(404).end();
        else res.writeHead(500).end(String(error));
      }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    child = spawn(chrome, ['--headless=new', '--no-sandbox', '--no-first-run',
      '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank']);
    child.stdout.resume();
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    let port;
    for (let attempt = 0; attempt < 600; attempt++) {
      try { port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (port) break;
      if (child.exitCode !== null) throw new Error(stderr);
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.ok(port, stderr);
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    let id = 0;
    const pending = new Map();
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      const call = pending.get(message.id);
      if (call) {
        pending.delete(message.id);
        if (message.error) call.reject(new Error(JSON.stringify(message.error)));
        else call.resolve(message.result);
      }
    });
    const call = (method, params = {}) => new Promise((resolve, reject) => {
      pending.set(++id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
    const url = `http://127.0.0.1:${server.address().port}/fhem-cms/Test/index.html?mode=edit#page`;
    const navigate = async expected => {
      await call('Page.navigate', { url });
      for (let attempt = 0; attempt < 200; attempt++) {
        const result = await call('Runtime.evaluate', {
          expression: 'JSON.stringify({text:document.querySelector(".cms-status")?.textContent,href:location.href})',
          returnByValue: true,
        });
        const state = JSON.parse(result.result.value);
        if (state.text?.startsWith('{"version":')) {
          const graph = JSON.parse(state.text);
          if (graph.version === expected) return { graph, href: state.href };
        }
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      throw new Error(`Frontend ${expected} did not load`);
    };
    assert.deepEqual((await navigate(1)).graph, { version: 1, nested: 1, widget: 1 });
    await generate(2);
    await call('Page.navigate', { url: 'about:blank' });
    const updated = await navigate(2);
    assert.deepEqual(updated.graph, { version: 2, nested: 2, widget: 2 });
    assert.equal(new URL(updated.href).searchParams.get('mode'), 'edit');
    assert.equal(new URL(updated.href).hash, '#page');
    assert.match(new URL(updated.href).searchParams.get('cms-assets'), /^[a-f0-9]{10}$/);
    const moduleRequests = requests.filter(request => request.path.endsWith('.js'));
    assert.equal(moduleRequests.length, 6, 'only three current modules load per version');
    for (const group of [moduleRequests.slice(0, 3), moduleRequests.slice(3)]) {
      assert.equal(new Set(group.map(request => request.search)).size, 1,
        'entry and transitive dependencies share a content-versioned URL');
    }
    assert.ok(requests.filter(request => request.path.endsWith('index.html'))
      .some(request => /no-cache/.test(request.cache || '')), 'cached HTML is revalidated without cache');
  } finally {
    socket?.close();
    if (child && child.exitCode === null) {
      const stopped = new Promise(resolve => child.once('close', resolve));
      child.kill('SIGTERM');
      await stopped;
    }
    if (server) await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});
