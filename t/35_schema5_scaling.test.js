import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { pngFixture } from './lib/asset-exif-fixtures.js';

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

test('graph touch taps show values without breaking range selection or scrolling', {
  skip: chrome ? false : 'Chrome not installed; set CHROME_BIN to run the browser regression',
  timeout: 90000,
}, async () => {
  const server = await testServer();
  const profile = await mkdtemp(join(root, 't/.cms-graph-touch-'));
  const child = spawn(chrome, ['--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank']);
  child.stdout.resume();
  child.stderr.resume();
  const closed = new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
  const timeout = setTimeout(() => child.kill('SIGTERM'), 60000);
  try {
    const url = `http://127.0.0.1:${server.address().port}/t/116_graph_touch.html`;
    await browserResult(profile, url, child, async command => {
      const evaluate = async expression => {
        const reply = await command('Runtime.evaluate', {expression, awaitPromise:true, returnByValue:true});
        assert.ok(!reply.exceptionDetails, JSON.stringify(reply.exceptionDetails));
        return reply.result.value;
      };
      await evaluate(`new Promise(resolve => {const timer=setInterval(() => {
        if (!document.querySelector('#result').dataset.ready) return;
        clearInterval(timer); resolve();
      }, 25);})`);
      const tap = async fraction => {
        const point = await evaluate(`window.graphTouch.point(${fraction})`);
        await command('Input.dispatchTouchEvent', {type:'touchStart',touchPoints:[{...point,id:1}]});
        await command('Input.dispatchTouchEvent', {type:'touchEnd',touchPoints:[]});
        await pause(80);
        return evaluate('window.graphTouch.tip()');
      };
      for (const [width,height,scale] of [[390,844,1], [834,1194,.5]]) {
        await command('Emulation.setDeviceMetricsOverride', {width,height,deviceScaleFactor:1,mobile:false});
        for (const type of ['line','stack','pie']) {
          await evaluate(`window.graphTouch.draw('${type}',false,${scale})`);
          const tip = await tap(type === 'pie' ? .5 : .85);
          assert.equal(tip.hidden, false, `${width}: ${type} touch tooltip stays visible after release`);
          assert.match(tip.text, /Solar: 9 W/, `${width}: ${type} displays the selected value`);
          if (type !== 'pie') {
            assert.match((await tap(.15)).text, /Solar: 1 W/, `${width}: another tap selects another value`);
          }
        }
      }
      for (const type of ['line','stack','pie']) {
        await evaluate(`window.graphTouch.draw('${type}',true,1)`);
        const tip = await tap(type === 'pie' ? .5 : .85);
        assert.equal(tip.hidden, false, `preview ${type} touch tooltip stays visible`);
        assert.match(tip.text, /Solar: 9 W/);
      }
      await evaluate("window.graphTouch.draw('line',false,1)");
      const start = await evaluate('window.graphTouch.point(.2)');
      const end = await evaluate('window.graphTouch.point(.8)');
      const before = await evaluate('window.graphTouch.calls()');
      await command('Input.dispatchTouchEvent', {type:'touchStart',touchPoints:[{...start,id:1}]});
      await command('Input.dispatchTouchEvent', {type:'touchMove',touchPoints:[{x:start.x+4,y:start.y,id:1}]});
      await command('Input.dispatchTouchEvent', {type:'touchEnd',touchPoints:[]});
      assert.equal((await evaluate('window.graphTouch.tip()')).hidden, false, 'small finger movement remains a tap');
      assert.equal(await evaluate('window.graphTouch.calls()'), before, 'a tap never reloads the history');
      await command('Input.dispatchTouchEvent', {type:'touchStart',touchPoints:[{...start,id:1}]});
      await command('Input.dispatchTouchEvent', {type:'touchCancel',touchPoints:[]});
      assert.equal((await evaluate('window.graphTouch.tip()')).hidden, true, 'cancelled touch hides the tooltip');
      await command('Input.dispatchTouchEvent', {type:'touchStart',touchPoints:[{...start,id:1}]});
      await command('Input.dispatchTouchEvent', {type:'touchMove',touchPoints:[{...end,id:1}]});
      await command('Input.dispatchTouchEvent', {type:'touchEnd',touchPoints:[]});
      await pause(100);
      assert.equal(await evaluate('window.graphTouch.range()'), 'custom', 'horizontal touch drag selects a range');
      assert.ok(await evaluate('window.graphTouch.calls()') > before, 'range selection reloads history');
      await evaluate("window.graphTouch.draw('line',false,1); window.scrollTo(0,0)");
      const scrollStart = await evaluate('window.graphTouch.point(.5)');
      await command('Input.dispatchTouchEvent', {type:'touchStart',touchPoints:[{...scrollStart,id:1}]});
      for (const distance of [20, 50, 80, 110]) {
        await command('Input.dispatchTouchEvent', {type:'touchMove',
          touchPoints:[{x:scrollStart.x,y:scrollStart.y-distance,id:1}]});
        await pause(30);
      }
      await command('Input.dispatchTouchEvent', {type:'touchEnd',touchPoints:[]});
      await pause(150);
      const scroll = await evaluate(`({page:window.scrollY, height:document.documentElement.scrollHeight,
        tile:document.querySelector('cms-graph').shadowRoot.querySelector('.tile').scrollTop,
        point:window.graphTouch.point(.5)})`);
      assert.ok(scroll.page > 0 || scroll.tile > 0, `vertical touch gesture scrolls: ${JSON.stringify(scroll)}`);
      assert.equal((await evaluate('window.graphTouch.tip()')).hidden, true, 'cancelled scroll does not leave a tooltip');
      const spin = await evaluate('window.graphTouch.loadWithSpinner(150)');
      assert.equal(spin.during, true, 'spinner shows while the history loads');
      assert.equal(spin.after, false, 'spinner hides after loading');
      await evaluate("window.scrollTo(0,0); window.graphTouch.draw('line',false,1); window.graphTouch.resetRange()");
      const clampBefore = await evaluate('window.graphTouch.calls()');
      const finger1 = await evaluate('window.graphTouch.point(.3)');
      const finger2 = await evaluate('window.graphTouch.point(.6)');
      await command('Input.dispatchTouchEvent', {type:'touchStart',
        touchPoints:[{...finger1,id:1},{...finger2,id:2}]});
      await command('Input.dispatchTouchEvent', {type:'touchMove',
        touchPoints:[{x:finger1.x-90,y:finger1.y,id:1},{x:finger2.x-90,y:finger2.y,id:2}]});
      await command('Input.dispatchTouchEvent', {type:'touchEnd',touchPoints:[]});
      await pause(150);
      assert.equal(await evaluate('window.graphTouch.range()'), '24h', 'panning into the future is clamped at now');
      assert.equal(await evaluate('window.graphTouch.calls()'), clampBefore, 'a clamped pan never reloads');
      await command('Input.dispatchTouchEvent', {type:'touchStart',
        touchPoints:[{...finger1,id:1},{...finger2,id:2}]});
      await command('Input.dispatchTouchEvent', {type:'touchMove',
        touchPoints:[{x:finger1.x+90,y:finger1.y,id:1},{x:finger2.x+90,y:finger2.y,id:2}]});
      await command('Input.dispatchTouchEvent', {type:'touchEnd',touchPoints:[]});
      await pause(150);
      assert.equal(await evaluate('window.graphTouch.range()'), 'custom', 'two-finger pan shifts into the past');
      assert.ok(await evaluate('window.graphTouch.calls()') > clampBefore, 'two-finger pan reloads the history');
      assert.equal((await evaluate('window.graphTouch.tip()')).hidden, true, 'panning does not leave a tooltip');
      await evaluate("window.scrollTo(0,0); window.graphTouch.draw('line',false,1); window.graphTouch.resetRange()");
      const mid = await evaluate('window.graphTouch.point(.5)');
      await command('Input.dispatchMouseEvent', {type:'mouseMoved', x:mid.x, y:mid.y});
      await command('Input.dispatchKeyEvent', {type:'keyDown', key:' ', code:'Space', windowsVirtualKeyCode:32});
      assert.equal((await evaluate('window.graphTouch.plotPan()')).ready, true, 'held space shows the grab cursor');
      const mouseBefore = await evaluate('window.graphTouch.calls()');
      await command('Input.dispatchMouseEvent', {type:'mousePressed', x:mid.x, y:mid.y,
        button:'left', buttons:1, clickCount:1});
      assert.equal((await evaluate('window.graphTouch.plotPan()')).panning, true, 'space drag shows the grabbing cursor');
      await command('Input.dispatchMouseEvent', {type:'mouseMoved', x:mid.x+90, y:mid.y, button:'left', buttons:1});
      await command('Input.dispatchMouseEvent', {type:'mouseReleased', x:mid.x+90, y:mid.y,
        button:'left', buttons:1, clickCount:1});
      await command('Input.dispatchKeyEvent', {type:'keyUp', key:' ', code:'Space', windowsVirtualKeyCode:32});
      await pause(150);
      assert.equal(await evaluate('window.graphTouch.range()'), 'custom', 'space pan shifts into the past');
      assert.ok(await evaluate('window.graphTouch.calls()') > mouseBefore, 'space pan reloads the history');
      assert.equal((await evaluate('window.graphTouch.plotPan()')).ready, false, 'released space restores the cursor');
      await evaluate("window.scrollTo(0,0); window.graphTouch.draw('line',false,1)");
      const leftPoint = await evaluate('window.graphTouch.point(.25)');
      await command('Input.dispatchMouseEvent', {type:'mouseMoved', x:leftPoint.x, y:leftPoint.y});
      const leftTip = await evaluate('window.graphTouch.tipBox()');
      assert.equal(leftTip.hidden, false, 'hover in the left half shows the tooltip');
      assert.ok(leftTip.left >= leftPoint.x, 'tooltip sits right of the cursor line in the left half');
      const rightPoint = await evaluate('window.graphTouch.point(.75)');
      await command('Input.dispatchMouseEvent', {type:'mouseMoved', x:rightPoint.x, y:rightPoint.y});
      const rightTip = await evaluate('window.graphTouch.tipBox()');
      assert.ok(rightTip.right <= rightPoint.x, 'tooltip sits left of the cursor line in the right half');
      for (const kind of ['graph','chart']) for (const scale of [1,.5]) {
        await command('Emulation.setDeviceMetricsOverride', {width:900,height:1000,deviceScaleFactor:1,mobile:false});
        await command('Emulation.setTouchEmulationEnabled', {enabled:false});
        await evaluate(`window.graphTouch.livePan('${kind}',${scale})`);
        let point = await evaluate('window.graphTouch.livePoint(.5)');
        await command('Input.dispatchMouseEvent', {type:'mouseMoved',...point});
        await command('Input.dispatchKeyEvent', {type:'keyDown',key:' ',code:'Space',windowsVirtualKeyCode:32});
        await command('Input.dispatchMouseEvent', {type:'mousePressed',...point,button:'left',clickCount:1});
        await command('Input.dispatchMouseEvent', {type:'mouseMoved',x:point.x+60,y:point.y,button:'left',buttons:1});
        let state = await evaluate('window.graphTouch.liveState()');
        assert.match(state.transform, /translate/, `${kind}/${scale}: data really moves during desktop pan`);
        assert.equal(state.axis, null, 'Y-axis stays fixed during pan');
        await command('Input.dispatchMouseEvent', {type:'mouseReleased',x:point.x+60,y:point.y,button:'left',clickCount:1});
        await command('Input.dispatchKeyEvent', {type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});
        await pause(100);
        state = await evaluate('window.graphTouch.liveState()');
        let last = state.requests.at(-1);
        assert.ok(last.to < state.now, 'desktop pan actually requests past data');
        assert.equal(last.to-last.from,86400,'desktop pan keeps the 24-hour width');
        await command('Emulation.setTouchEmulationEnabled', {enabled:true});
        const a = await evaluate('window.graphTouch.livePoint(.25)');
        const b = await evaluate('window.graphTouch.livePoint(.5)');
        await command('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...a,id:1}]});
        await command('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...a,id:1},{...b,id:2}]});
        await command('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[
          {x:a.x+40,y:a.y-30,id:1},{x:b.x+40,y:b.y-30,id:2}]});
        await pause(80);
        state = await evaluate('window.graphTouch.liveState()');
        assert.match(state.transform,/translate/,`${kind}/${scale}: two sequentially placed fingers move the curve`);
        await command('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
        await pause(100);
        state = await evaluate('window.graphTouch.liveState()');
        assert.ok(state.requests.at(-1).to < last.to,'touch pan requests an earlier window');
        assert.equal(state.requests.at(-1).to-state.requests.at(-1).from,86400);
        await evaluate('window.graphTouch.loadEmpty()');
        assert.equal((await evaluate('window.graphTouch.liveState()')).transform,undefined,
          'empty historical window contains no invented curve');
        point = await evaluate('window.graphTouch.livePoint(.8)');
        await command('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[
          {...point,id:1},{x:point.x-40,y:point.y,id:2}]});
        await command('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[
          {x:point.x-350,y:point.y,id:1},{x:point.x-390,y:point.y,id:2}]});
        await command('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
        await pause(100);
        state = await evaluate('window.graphTouch.liveState()');
        last = state.requests.at(-1);
        assert.ok(Math.abs(last.to-Math.floor(Date.now()/1000)) <= 3,'return pan from an empty window stops at the present');
        assert.equal(last.to-last.from,86400,'return pan does not zoom');
      }
      await evaluate('window.graphTouch.finish()');
    }, async command => {
      await command('Emulation.setDeviceMetricsOverride', {width:390,height:844,deviceScaleFactor:1,mobile:false});
      await command('Emulation.setTouchEmulationEnabled', {enabled:true});
    });
  } finally {
    clearTimeout(timeout);
    child.kill('SIGTERM');
    await closed;
    await new Promise(resolve => server.close(resolve));
    await rm(profile, {recursive:true, force:true});
  }
});

test('phone landscape shared grid reflows consistently in preview and touch view', {
  skip: chrome ? false : 'Chrome not installed; set CHROME_BIN to run the browser regression',
  timeout: 90000,
}, async () => {
  const server = await testServer();
  const profile = await mkdtemp(join(root, 't/.cms-phone-'));
  const child = spawn(chrome, ['--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank']);
  child.stdout.resume();
  child.stderr.resume();
  const closed = new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
  const timeout = setTimeout(() => child.kill('SIGTERM'), 60000);
  try {
    for (const preview of [true, false]) {
      const url = `http://127.0.0.1:${server.address().port}/t/112_phone_landscape.html`
        + (preview ? '?mode=preview&cms-device=mobile' : '');
      const beforeNavigate = async command => {
        await command('Emulation.setTouchEmulationEnabled', {enabled: !preview});
        await command('Emulation.setDeviceMetricsOverride', {
          width:852, height:393, deviceScaleFactor:1, mobile:false,
        });
      };
      await browserResult(profile, url, child, async command => {
        const evaluate = async expression => {
          const response = await command('Runtime.evaluate', {expression, awaitPromise:true, returnByValue:true});
          assert.ok(!response.exceptionDetails, JSON.stringify(response.exceptionDetails));
          return response.result.value;
        };
        await evaluate(`new Promise(resolve => {
          const timer = setInterval(() => {
            if (document.querySelector('#result').textContent !== 'ready') return;
            clearInterval(timer); resolve();
          }, 25);
        })`);
        for (const [width, height] of [[852,393], [393,852], [852,393], [393,852], [852,393]]) {
          await command('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor:1, mobile:false});
          await pause(250);
          assert.deepEqual(await evaluate('window.checkPhoneLayout()'), {count:5, compact:true},
            `${preview ? 'preview' : 'touch'} ${width}x${height}`);
        }
        if (!preview) {
          for (const [width, height] of [[1194,834], [1440,1000]]) {
            await command('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor:1, mobile:false});
            await pause(250);
            assert.equal(await evaluate(`!document.querySelector('.cms-freeform-viewport')
              .classList.contains('cms-freeform-stack')`), true, `${width}x${height} keeps the canvas`);
          }
        }
        await evaluate(`Object.assign(document.querySelector('#result'), {textContent:'{"checks":5}'}).dataset.result='pass'`);
      }, beforeNavigate);
    }
  } finally {
    clearTimeout(timeout);
    child.kill('SIGTERM');
    await closed;
    await new Promise(resolve => server.close(resolve));
    await rm(profile, {recursive:true, force:true});
  }
});

async function browserResult(profile, url, child, interact, beforeNavigate) {
  let port;
  for (let attempt = 0; attempt < 600; attempt++) {
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
    if (beforeNavigate) await beforeNavigate(command);
    const loaded = new Promise((resolve, reject) => { onLoad = { resolve, reject }; });
    await command('Page.navigate', { url });
    await loaded;
    if (interact) await interact(command);
    const reply = await command('Runtime.evaluate', {
      expression: `new Promise(resolve => {
        const timer = setInterval(() => {
          const output = document.querySelector('#result[data-result]');
          if (!output) return;
          clearInterval(timer);
          resolve({ status: output.dataset.result, text: output.textContent });
        }, 50);
      })`,
      awaitPromise: true, returnByValue: true, timeout: 30000,
    });
    assert.ok(!reply.exceptionDetails, JSON.stringify(reply));
    const output = reply.result.value;
    assert.equal(output.status, 'pass', output.text);
    return JSON.parse(output.text);
  } finally { socket.close(); }
}

async function testServer() {
  const server = createServer(async (request, response) => {
    if (new URL(request.url, 'http://localhost').pathname === '/fhem/icons/temp_temperature') {
      response.setHeader('Content-Type', 'image/svg+xml');
      response.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M8 2h4v11a4 4 0 1 1-4 0z"/></svg>');
      return;
    }
    if ([`/t/media/${'a'.repeat(32)}.png`, `/t/media/${'b'.repeat(32)}.png`]
      .includes(new URL(request.url, 'http://localhost').pathname)) {
      response.setHeader('Content-Type', 'image/png');
      response.end(pngFixture());
      return;
    }
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
  return server;
}

for (const [name, fixtures] of [
  ['FHEM system monitor displays safe source data and configuration',
    [['120_system_monitor.html', 10]]],
  ['Eventmonitor popup, standalone window and live event controls',
    [['119_eventmonitor.html', 20]]],
  ['shared close buttons preserve nested dialog behavior and themes',
    [['111_close_buttons.html', 90]]],
  ['Pin interactions use safe tap and hold commands, keyboard access and popup X',
    [['108_pin_interactions.html', 20], ['108_pin_interactions.html?mode=preview', 5],
      ['108_pin_interactions.html?input=1', 2]]],
  ['Pin reading choices preserve real widget dialogs, live values and cancel semantics',
    [['106_pin_readings.html', 80]]],
  ['Pin badges preserve themes, physical targets, lazy widgets and portrait cards',
    [['104_pin_badges.html', 400], ['104_pin_badges.html?input=1', 2],
      ['104_pin_badges.html?preview=1&mode=preview', 2]]],
  ['widget editor actions retain usable targets across all types, themes and canvas scales',
    [['102_widget_editor_tools.html', 10000], ['102_widget_editor_tools.html?touch=1', 10000]]],
  ['standard widget typography grows in actual Grid and scaled Freeform without changing authored content',
    [['99_widget_typography.html?width=1440', 1000],
      ['99_widget_typography.html?mode=preview&cms-device=tablet&width=768', 1000],
      ['99_widget_typography.html?mode=preview&cms-device=mobile&width=390', 1000]]],
  ['shared German dates render across widget types without rewriting source data',
    [['90_widget_dates.html', 19]]],
  ['DWD weather renders responsive tiles, details and editor',
    [['95_weather.html', 42], ['95_weather.html?width=820', 42], ['95_weather.html?width=390', 42]]],
  ['CMS popups contain scroll without moving the page',
    [['96_popup_scroll.html', 10]]],
  ['VolvoConnect renders module groups and preserves responsive live vehicle data',
    [['88_volvoconnect.html', 400]]],
  ['VolvoConnect popup reorders cards by pointer and saves only the editor draft',
    [['89_volvoconnect_order.html', 20], ['89_volvoconnect_order.html?height=600', 20],
      ['89_volvoconnect_order.html?touch=1', 20], ['89_volvoconnect_order.html?columns=96&inline=1',20],
      ['89_volvoconnect_order.html?columns=192',20]]],
  ['widget titles inherit alignment and compact contents fill their available area',
    [['98_freeform_widget_scaling.html', 121], ['97_widget_responsive.html', 19], ['36_widget_titles.html', 180], ['37_widget_content.html', 600],
      ['39_action_presentation.html', 40], ['40_navigation_orientation.html', 70],
      ['42_richtext_selection.html', 85], ['43_auto_arrange.html', 84],
      ['64_widget_hierarchy.html', 80],
      ['44_placeholder_units.html', 384], ['45_solarflow_sizing.html', 868], ['46_unit_inputs.html', 998]]],
  ['view and editor retain identical desktop geometry', [['47_view_editor_layout.html', 810]]],
  ['LinkWidget configures nested tiles and renders safe links', [['49_link_widget.html', 65]]],
  ['shared Assetmanager handles folders, administration and widget insertion', [['51_asset_manager.html', 207]]],
  ['image variants crop, resize and select without changing original',
    [['61_asset_image.html', 75], ['61_asset_image.html?touch=1', 75]]],
  ['modal page preserves the main page and closes by keyboard and backdrop', [['62_page_modal.html', 35]]],
  ['themes use and restore page backgrounds', [['55_liquid_glass.html', 63]]],
  ['page settings preview shows the real phone page without saving', [['57_settings_preview.html', 25]]],
  ['Pin editor supports physical tools, mouse, touch and keyboard without device commands', [['110_pin_editor.html', 65]]],
  ['page and widget duplication preserve drafts and live configuration',
    [['59_page_duplicate.html', 21]]],
  ['Widget-Vorlagen speichern, Device-Referenzen ersetzen und als Entwurf einfügen',
    [['67_blueprints.html', 16]]],
  ['CMS-Verwaltung bestaetigt Sammelloeschung und trennt verwaiste Dateien',
    [['69_cms_admin.html', 28]]],
  ['Einrichtungsassistent zeigt echten Fortschritt ohne historische Serienabfragen',
    [['53_schema5_setup_wizard.html', 59]]],
  ['direct widget deletion preserves the draft and handles errors', [['60_direct_widget_delete.html', 15]]],
  ['call list displays and configures device readings', [['58_calllist.html', 64]]],
  ['Smart-Home-Statusfarben bleiben semantisch und kontrastreich', [['64_status_colors.html', 13]]],
  ['Widget-Dialoge behalten Drafts, Validierung und responsive Disclosure-Gruppen',
    [['65_widget_dialogs.html', 12]]],
  ['Device-Widgetdialoge schlagen passende Readings und Set-Werte vor',
    [['66_device_suggestions.html', 27]]],
  ['Device-first flow filters capabilities and prefills standard widget dialogs',
    [['71_device_first.html', 23]]],
  ['Discrete set lists render configurable safe selection controls',
    [['72_selection.html', 15]]],
  ['Table labels follow actual device sources and preserve manual overrides',
    [['73_table_labels.html', 27]]],
  ['Table design uses neutral cards and preserves responsive live readings',
    [['81_table_design.html', 104]]],
  ['SolarFlow design preserves live flows in a theme-aware diagram',
    [['82_solarflow_design.html', 220], ['82_solarflow_design.html?reduced=1', 221]]],
  ['Widget design follows page themes and live Liquid Glass appearance',
    [['83_widget_theme_design.html', 600]]],
  ['All remaining widget designs inherit themes and preserve responsive content',
    [['84_widget_design.html', 600]]],
  ['Solar und Energiefluss configures cross-device sources and preserves responsive live data',
    [['85_solar_energy.html', 100], ['85_solar_energy.html?width=390', 100],
      ['85_solar_energy.html?width=768&reduced=1', 100]]],
  ['Solar und Energiefluss fills large scaled shared-canvas tiles in live view and editor',
    [['113_solar_fill.html', 100]]],
  ['widget selection sorts and previews every widget without live services',
    [['114_widget_previews.html', 100], ['114_widget_previews.html?width=390', 100]]],
  ['graph supports multiple log series and previews every chart type',
    [['115_graph.html', 10], ['115_graph.html?width=390', 10]]],
  ['condition wizard validates rules and previews current readings',
    [['117_condition_wizard.html', 15], ['117_condition_wizard.html?touch=1', 15]]],
  ['conditions integrate with widgets and text and HTML editors',
    [['118_condition_integration.html', 39], ['118_condition_integration.html?touch=1', 38]]],
  ['All widget dialogs use consistent desktop and responsive widths with full-width table units',
    [['75_dialog_layout.html?width=1440', 51], ['75_dialog_layout.html?width=390', 51],
      ['75_dialog_layout.html?width=852', 51]]],
  ['Chart configuration distinguishes absent logging from an empty history interval',
    [['76_chart_empty.html', 9]]],
  ['Free HTML permits passive layouts and SVG with validated live image sources',
    [['78_freehtml.html', 180]]],
  ['Local vehicle map preserves zoom and follows live coordinates',
    [['80_vehicle_map.html', 28]]],
  ['All mobile widget types grow with content and retain scrolling during live updates', [
    ['86_mobile_widgets.html?mode=preview&cms-device=mobile&width=393', 2000],
    ['86_mobile_widgets.html?mode=preview&cms-device=mobile&width=834', 2000],
    ['86_mobile_widgets.html?mode=preview&cms-device=mobile&width=852&landscape=1', 2000],
    ['86_mobile_widgets.html?mode=touch-test', 2000],
  ]],
  ['mobile device preview fits the raster without horizontal overflow', [
    ['56_mobile_viewport.html?mode=preview&cms-device=mobile', 200],
    ['56_mobile_viewport.html?mode=preview&cms-device=mobile&landscape=1', 200],
  ]],
  ['touch devices fit the raster without horizontal overflow', [['56_mobile_viewport.html?mode=touch-test', 200]]],
  ['viewport safe edges and desktop resize preserve usable responsive rows', [['63_responsive_edges.html', 200]]],
]) test(name, {
  skip: chrome ? false : 'Chrome not installed; set CHROME_BIN to run the browser regression',
  timeout: 90000,
}, async () => {
  const server = await testServer();
  const profile = await mkdtemp(join(root, 't/.cms-titles-'));
  const child = spawn(chrome, ['--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1440,1000', 'about:blank']);
  let stderr = '';
  child.stdout.resume();
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const closed = new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
  const timeout = setTimeout(() => child.kill('SIGTERM'), 60000);
  try {
    for (const [fixture, minimum] of fixtures) {
      const interactive = fixture === '110_pin_editor.html' || fixture === '104_pin_badges.html?input=1' || fixture === '108_pin_interactions.html?input=1' || [
        '49_link_widget.html', '51_asset_manager.html', '61_asset_image.html', '62_page_modal.html',
        '63_responsive_edges.html', '65_widget_dialogs.html', '88_volvoconnect.html',
        '89_volvoconnect_order.html', '96_popup_scroll.html', '119_eventmonitor.html'].includes(fixture.split('?')[0]);
      const interact = !interactive ? undefined : async command => {
        const evaluate = async expression => {
          const reply = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, timeout: 20000 });
          assert.ok(!reply.exceptionDetails, JSON.stringify(reply));
          return reply.result.value;
        };
        await evaluate(`new Promise(resolve => { const timer=setInterval(() => {
          const output=document.querySelector('#result');
          if (!output.dataset.ready && !output.dataset.result) return;
          clearInterval(timer); resolve();
        },25); })`);
        const failure = await evaluate(`document.querySelector('#result').dataset.result === 'fail'
          ? document.querySelector('#result').textContent : null`);
        assert.equal(failure, null, failure);
        if (fixture === '119_eventmonitor.html') {
          await evaluate(`(async () => {
            history.replaceState(null, '', '/www/fhem-cms/CMS/index.html');
            const {createEventMonitorLink} = await import('/www/fhem-cms/js/eventmonitor-link.js');
            const button = createEventMonitorLink({cmsDevice:'CMS'});
            button.id = 'monitor-launcher'; document.body.append(button);
          })()`);
          const click = async selector => {
            const point = await evaluate(`(() => {
              const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
              return {x:rect.x + rect.width / 2, y:rect.y + rect.height / 2};
            })()`);
            await command('Input.dispatchMouseEvent', {type:'mousePressed', ...point, button:'left', clickCount:1});
            await command('Input.dispatchMouseEvent', {type:'mouseReleased', ...point, button:'left', clickCount:1});
          };
          await click('#monitor-launcher');
          await evaluate(`new Promise(resolve => {
            const timer = setInterval(() => {
              const frame = document.querySelector('.cms-eventmonitor-frame');
              if (!frame?.contentDocument?.querySelector('[data-filter]')) return;
              clearInterval(timer); resolve();
            }, 25);
          })`);
          await evaluate(`document.querySelector('.cms-eventmonitor-frame').contentDocument.querySelector('[data-filter]').focus()`);
          await command('Input.dispatchKeyEvent', {type:'keyDown', key:'Escape', code:'Escape', windowsVirtualKeyCode:27});
          await command('Input.dispatchKeyEvent', {type:'keyUp', key:'Escape', code:'Escape', windowsVirtualKeyCode:27});
          await pause(100);
          assert.equal(await evaluate(`Boolean(document.querySelector('.cms-eventmonitor-modal'))`), false,
            'Escape inside the actual monitor frame closes the parent popup');
          await click('#monitor-launcher');
          const port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]);
          await click('.cms-eventmonitor-modal header a');
          let targets = [];
          for (let i = 0; i < 50; i++) {
            targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
            if (targets.some(target => target.url.includes('/www/fhem-cms/eventmonitor.html?device=CMS')
              && !target.url.includes('embedded'))) break;
            await pause(50);
          }
          assert.ok(targets.some(target => target.url.includes('/www/fhem-cms/eventmonitor.html?device=CMS')
            && !target.url.includes('embedded')), 'a real separate browser page opens');
          assert.equal(await evaluate(`Boolean(document.querySelector('.cms-eventmonitor-modal[open]'))`), false,
            'opening the separate page closes the popup');
          const closeStandalone = async (target, method) => {
            const socket = new WebSocket(target.webSocketDebuggerUrl);
            await new Promise((resolve, reject) => {
              socket.addEventListener('open', resolve, {once: true});
              socket.addEventListener('error', reject, {once: true});
            });
            let id = 0;
            const pending = new Map();
            socket.addEventListener('message', event => {
              const message = JSON.parse(event.data);
              const call = pending.get(message.id);
              if (!call) return;
              pending.delete(message.id);
              if (message.error) call.reject(new Error(JSON.stringify(message.error)));
              else call.resolve(message.result);
            });
            socket.addEventListener('close', () => {
              for (const call of pending.values()) call.reject(new Error('Monitor window closed'));
              pending.clear();
            });
            const send = (name, params) => new Promise((resolve, reject) => {
              pending.set(++id, {resolve, reject});
              socket.send(JSON.stringify({id, method: name, params}));
            });
            try {
              const ready = await send('Runtime.evaluate', {expression: `new Promise(resolve => {
                const timer = setInterval(() => {
                  const button = document.querySelector('[data-close]');
                  if (!button?.querySelector('svg') || button.hidden) return;
                  clearInterval(timer); resolve(getComputedStyle(button).display !== 'none');
                }, 25);
              })`, awaitPromise: true, returnByValue: true, timeout: 10000});
              assert.equal(ready.result.value, true, 'standalone monitor shows its X');
              if (method === 'click') {
                await send('Runtime.evaluate', {expression: `setTimeout(() => document.querySelector('[data-close]').click(), 50)`});
              } else {
                try {
                  await send('Input.dispatchKeyEvent', {
                    type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27,
                  });
                } catch (error) {
                  if (error.message !== 'Monitor window closed') throw error;
                }
              }
              for (let i = 0; i < 50; i++) {
                const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
                if (!pages.some(page => page.id === target.id)) return;
                await pause(50);
              }
              assert.fail(`standalone monitor did not close via ${method}`);
            } finally { socket.close(); }
          };
          const target = targets.find(entry => entry.url.includes('/www/fhem-cms/eventmonitor.html?device=CMS')
            && !entry.url.includes('embedded'));
          await closeStandalone(target, 'click');
          await click('#monitor-launcher');
          await click('.cms-eventmonitor-modal header a');
          let secondTarget;
          for (let i = 0; i < 50; i++) {
            const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
            secondTarget = pages.find(entry => entry.url.includes('/www/fhem-cms/eventmonitor.html?device=CMS')
              && !entry.url.includes('embedded'));
            if (secondTarget) break;
            await pause(50);
          }
          assert.ok(secondTarget, 'second standalone monitor opens');
          await closeStandalone(secondTarget, 'Escape');
          return;
        }
        if (fixture === '110_pin_editor.html') {
          const point = () => evaluate('window.pinEditorTest.point()');
          const writes = () => evaluate('window.pinEditorTest.writes()');
          const key = async (key, code, windowsVirtualKeyCode) => {
            await command('Input.dispatchKeyEvent', {type:'keyDown',key,code,windowsVirtualKeyCode});
            await command('Input.dispatchKeyEvent', {type:'keyUp',key,code,windowsVirtualKeyCode});
          };
          let start = await point();
          await command('Input.dispatchMouseEvent',{type:'mousePressed',...start,button:'left',clickCount:1});
          await command('Input.dispatchMouseEvent',{type:'mouseReleased',...start,button:'left',clickCount:1});
          assert.equal(await evaluate('window.pinEditorTest.selected()'),true,'first mouse tap selects the Pin');
          start = await point();
          await command('Input.dispatchMouseEvent',{type:'mousePressed',...start,button:'left',clickCount:1});
          await command('Input.dispatchMouseEvent',{type:'mouseMoved',x:start.x+64,y:start.y+40,button:'left',buttons:1});
          assert.match(await evaluate('window.pinEditorTest.tooltip()'),/X: 60\.00% \| Y: 60\.00%/);
          await command('Input.dispatchMouseEvent',{type:'mouseReleased',x:start.x+64,y:start.y+40,button:'left',clickCount:1});
          assert.deepEqual((await writes()).at(-1).position,{centerX:60,centerY:60},'scaled drag persists image percentages');
          await evaluate('window.pinEditorTest.reset()');
          start = await point();
          await command('Input.dispatchMouseEvent',{type:'mousePressed',...start,button:'left',clickCount:1});
          await command('Input.dispatchMouseEvent',{type:'mouseMoved',x:start.x+60,y:start.y,button:'left',buttons:1});
          await key('Escape','Escape',27);
          await command('Input.dispatchMouseEvent',{type:'mouseReleased',x:start.x+60,y:start.y,button:'left',clickCount:1});
          assert.equal((await writes()).length,0,'Escape cancels without saving');
          await evaluate('window.pinEditorTest.reset(); window.pinEditorTest.focus()');
          await key('ArrowRight','ArrowRight',39);
          assert.deepEqual((await writes()).at(-1).position,{centerX:50.08,centerY:50},'keyboard moves one Canvas pixel');
          await evaluate('window.pinEditorTest.reset()');
          await command('Emulation.setTouchEmulationEnabled',{enabled:true});
          start = await point();
          await command('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...start,id:1}]});
          await command('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start.x+32,y:start.y+20,id:1}]});
          await command('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
          assert.deepEqual((await writes()).at(-1).position,{centerX:55,centerY:55},'real touch drag persists once');
          await evaluate('window.pinEditorTest.reset()');
          start = await point();
          await command('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...start,id:1}]});
          await command('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start.x+32,y:start.y,id:1}]});
          await command('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
          assert.equal((await writes()).length,0,'touch cancellation never saves');
          await command('Emulation.setTouchEmulationEnabled',{enabled:false});
          await evaluate('window.pinEditorTest.image()');
          start = await point();
          await command('Input.dispatchMouseEvent',{type:'mousePressed',...start,button:'left',clickCount:1});
          await command('Input.dispatchMouseEvent',{type:'mouseMoved',x:start.x+40,y:start.y,button:'left',buttons:1});
          await command('Input.dispatchMouseEvent',{type:'mouseReleased',x:start.x+40,y:start.y,button:'left',clickCount:1});
          assert.deepEqual((await writes()).at(-1).position,{centerX:10,centerY:50},
            'scaled dragging uses the actual contained image, not its Canvas margins');
          for (const [x,y] of [[0,0],[100,0],[0,100],[100,100]]) {
            await evaluate(`window.pinEditorTest.edge(${x},${y})`);
          }
          await evaluate('window.pinEditorTest.finish()');
          return;
        }
        if (fixture === '108_pin_interactions.html?input=1') {
          const point = () => evaluate('window.pinGestures.point("switch")');
          const writes = () => evaluate('window.pinGestures.writes()');
          const popup = () => evaluate('window.pinGestures.popup()');
          const mouse = async (duration, move = 0) => {
            const start = await point();
            await command('Input.dispatchMouseEvent', {type: 'mousePressed', ...start, button: 'left', clickCount: 1});
            if (move) await command('Input.dispatchMouseEvent',
              {type: 'mouseMoved', x: start.x + move, y: start.y, button: 'left', buttons: 1});
            await pause(duration);
            await command('Input.dispatchMouseEvent',
              {type: 'mouseReleased', x: start.x + move, y: start.y, button: 'left', clickCount: 1});
            await pause(80);
          };
          await mouse(50);
          assert.equal(await writes(), 1, 'real short mouse tap sends once');
          assert.equal(await popup(), false);
          await evaluate('window.pinGestures.reset()');
          await mouse(450);
          assert.equal(await writes(), 0, 'real hold never sends a command');
          assert.equal(await popup(), true, 'mouse hold opens full card');
          await evaluate('window.pinGestures.assertX(); window.pinGestures.close()');
          await mouse(450, 8);
          assert.equal(await writes(), 0);
          assert.equal(await popup(), false, 'movement cancels tap and hold');
          await command('Emulation.setTouchEmulationEnabled', {enabled: true});
          let start = await point();
          await command('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{...start, id: 1}]});
          await command('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
          await pause(80);
          assert.equal(await writes(), 1, 'real touch tap sends once');
          await evaluate('window.pinGestures.reset()');
          start = await point();
          await command('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{...start, id: 1}]});
          await pause(450);
          await command('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
          await pause(80);
          assert.equal(await writes(), 0, 'touch hold does not leak a click');
          assert.equal(await popup(), true, `touch hold opens full card: ${JSON.stringify(await evaluate('window.pinGestures.events()'))}`);
          await evaluate('window.pinGestures.close()');
          start = await point();
          await command('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{...start, id: 1}]});
          await command('Input.dispatchTouchEvent', {type: 'touchCancel', touchPoints: []});
          await pause(450);
          assert.equal(await writes(), 0, 'touch cancellation never sends');
          assert.equal(await popup(), false, 'touch cancellation removes hold timer');
          await command('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{...start, id: 1}]});
          await command('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x:start.x+10,y:start.y,id:1}]});
          await pause(450);
          await command('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
          assert.equal(await writes(), 0, 'touch movement never sends');
          assert.equal(await popup(), false, 'touch movement cancels hold');
          await command('Emulation.setTouchEmulationEnabled', {enabled: false});
          await command('Input.dispatchKeyEvent', {type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9});
          await command('Input.dispatchKeyEvent', {type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9});
          await command('Input.dispatchKeyEvent', {type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', windowsVirtualKeyCode: 13});
          await command('Input.dispatchKeyEvent', {type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13});
          assert.equal(await writes(), 0, 'keyboard opens full card without sending');
          assert.equal(await popup(), true);
          await command('Input.dispatchKeyEvent', {type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27});
          await command('Input.dispatchKeyEvent', {type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27});
          await pause(80);
          assert.equal(await popup(), false, 'native Escape cleans popup');
          await evaluate('window.pinGestures.finish()');
          return;
        }
        if (fixture === '104_pin_badges.html?input=1') {
          const point = await evaluate('window.pinInput.point("w0")');
          await command('Input.dispatchMouseEvent', {type:'mousePressed',...point,button:'left',clickCount:1});
          await command('Input.dispatchMouseEvent', {type:'mouseReleased',...point,button:'left',clickCount:1});
          assert.equal(await evaluate('Boolean(document.querySelector(".cms-pin-widget-popup[open] cms-value"))'), true,
            'real mouse opens the normal widget');
          const escape = async () => {
            await command('Input.dispatchKeyEvent', {type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
            await command('Input.dispatchKeyEvent', {type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
            await pause(80);
            assert.equal(await evaluate('document.querySelector(".cms-pin-widget-popup") === null'), true,
              'native Escape closes and removes the popup');
          };
          await escape();
          await command('Input.dispatchKeyEvent', {type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
          await command('Input.dispatchKeyEvent', {type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
          assert.equal(await evaluate(`document.activeElement?.localName === 'cms-pin-badge'
            && document.activeElement.shadowRoot.activeElement?.matches(':focus-visible')`), true,
          'actual Tab exposes visible pin focus');
          await command('Input.dispatchKeyEvent', {type:'keyDown',key:'Enter',code:'Enter',text:'\r',windowsVirtualKeyCode:13});
          await command('Input.dispatchKeyEvent', {type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
          assert.equal(await evaluate('document.querySelectorAll(".cms-pin-widget-popup[open]").length'), 1,
            'keyboard activation opens exactly one popup');
          await escape();
          await command('Emulation.setTouchEmulationEnabled', {enabled:true});
          const touch = await evaluate('window.pinInput.point("w0")');
          await command('Input.dispatchTouchEvent', {type:'touchStart',touchPoints:[{...touch,id:1}]});
          await command('Input.dispatchTouchEvent', {type:'touchEnd',touchPoints:[]});
          await pause(100);
          assert.equal(await evaluate('document.querySelectorAll(".cms-pin-widget-popup[open]").length'), 1,
            'real emulated touch opens exactly one popup');
          await escape();
          await command('Emulation.setTouchEmulationEnabled', {enabled:false});
          await evaluate('window.pinInput.finish()');
          return;
        }
        if (fixture === '96_popup_scroll.html') {
          const position = name => evaluate(`window.popupScroll.position('${name}')`);
          const wheel = async (target, deltaY) => {
            const point = await evaluate(`window.popupScroll.point('${target}')`);
            await command('Input.dispatchMouseEvent', {type:'mouseWheel', ...point, deltaX:0, deltaY});
            await pause(200);
          };
          await evaluate('window.popupScroll.open()');
          const initial = await position('page');
          assert.equal(await evaluate('window.popupScroll.touchBlocked(-40)'), true, 'touch at top is blocked');
          assert.equal(await evaluate('window.popupScroll.touchBlocked(40)'), false, 'touch into content is allowed');
          await wheel('inner', 3000);
          assert.ok(await position('inner') > 0, 'dialog content itself scrolls');
          assert.equal(await evaluate('window.popupScroll.touchBlocked(40)'), true, 'touch at bottom is blocked');
          await wheel('inner', 800);
          assert.equal(await position('page'), initial, 'bottom of modal does not scroll page');
          await wheel('inner', -3000);
          await wheel('inner', -800);
          assert.equal(await position('page'), initial, 'top of modal does not scroll page');
          await evaluate('window.popupScroll.nest()');
          await wheel('nested', 800);
          assert.equal(await position('page'), initial, 'short stacked dialog blocks page scroll');
          assert.equal(await position('inner'), 0, 'short stacked dialog blocks underlying dialog scroll');
          await evaluate('window.popupScroll.closeNested(); window.popupScroll.close(); window.popupScroll.openGeometry()');
          await wheel('geometry', 3000);
          assert.ok(await position('geometry') > 0, 'Freeform popover itself scrolls');
          await wheel('geometry', 800);
          assert.equal(await position('page'), initial, 'bottom of Freeform popover does not scroll page');
          await evaluate('window.popupScroll.closeGeometry(); window.popupScroll.finish()');
          return;
        }
        if (fixture.startsWith('89_volvoconnect_order.html')) {
          const touch = fixture.includes('touch=1');
          await evaluate('window.popupOrderTest.host().openDetails(); window.popupOrderTest.prepareFullWidth()');
          await evaluate('window.popupOrderTest.$(\'[data-group="state"] [data-drag-card]\').scrollIntoView({block:"center"})');
          const fullWidthDrag = await evaluate(`(() => {
            const {$}=window.popupOrderTest,r=$('[data-group="state"] [data-drag-card]').getBoundingClientRect();
            return {x:r.x+r.width/2,y:r.y+r.height/2};
          })()`);
          const beginDrag = async point => {
            if (touch) {
              await command('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...point,id:1}]});
              await new Promise(resolve=>setTimeout(resolve,350));
              await command('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:point.x+20,y:point.y,id:1}]});
            } else {
              await command('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
              await command('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
              await command('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x+20,y:point.y,button:'left',buttons:1});
            }
            assert.equal(await evaluate('Boolean(window.popupOrderTest.host().drag)'),true,'GridStack starts drag after movement threshold');
            assert.equal(await evaluate('Boolean(window.popupOrderTest.$(".grid-stack-placeholder .placeholder-content"))'),true,
              'same real GridStack placeholder as main widgets');
          };
          const moveDrag = async point => {
            if (touch) await command('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...point,id:1}]});
            else await command('Input.dispatchMouseEvent',{type:'mouseMoved',...point,button:'left',buttons:1});
          };
          const endDrag = async (point,cancel=false) => {
            if (touch) await command('Input.dispatchTouchEvent',{type:cancel?'touchCancel':'touchEnd',touchPoints:[]});
            else {
              if (cancel) {
                await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
                await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
              }
              await command('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
            }
            await new Promise(resolve=>setTimeout(resolve,60));
          };
          await beginDrag(fullWidthDrag);
          const topDrop = await evaluate(`(() => {
            const {$}=window.popupOrderTest,b=$('[data-detail-body]');b.scrollTop=0;
            const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+10};
          })()`);
          await moveDrag(topDrop);
          await endDrag(topDrop);
          assert.equal(await evaluate('window.popupOrderTest.order()[0]'),'state',
            'full-width energy returns to first position with real drag');
          assert.equal(await evaluate(`(() => {const {$}=window.popupOrderTest,c=$('[data-group="state"]');
            return [...$('#top').children].every(other=>c.getBoundingClientRect().top<=other.getBoundingClientRect().top+1);})()`),
            true,'full-width card is visually at the top after drop');
          await evaluate('window.popupOrderTest.host().cancelArrangement(); window.popupOrderTest.host().startArrangement()');
          for (const cancelled of [true,false]) {
            await evaluate('window.popupOrderTest.$(\'[data-group="state"] [data-resize-card]\').scrollIntoView({block:"center"})');
            await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
            const point = await evaluate(`(() => {
              const {host,$} = window.popupOrderTest;
              const r=$('[data-group="state"] [data-resize-card]').getBoundingClientRect();
              return {x:r.x+r.width/2,y:r.y+r.height/2};
            })()`);
            assert.equal(await evaluate(`Boolean(window.popupOrderTest.host().shadowRoot.elementFromPoint(${point.x},${point.y})
              ?.closest('[data-resize-card]'))`),true,`${fixture}: resize corner is reachable after scrolling`);
            if (touch) await command('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...point,id:1}]});
            else {
              await command('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
              await command('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
            }
            assert.equal(await evaluate('Boolean(window.popupOrderTest.host().resize)'), true,
              `${fixture}: real ${touch?'touch':'mouse'} starts ${cancelled?'cancelled':'completed'} corner resize`);
            const before = await evaluate('JSON.stringify(window.popupOrderTest.host().pendingSizes.state)');
            const geometryBefore = await evaluate('window.popupOrderTest.geometry()');
            const orderBefore = await evaluate('window.popupOrderTest.host().pendingCardOrder');
            await evaluate('window.popupOrderTest.host().data=window.popupOrderTest.host().snapshot');
            assert.equal(await evaluate('Boolean(window.popupOrderTest.host().resize)'), true,
              'live update preserves active resize');
            const target = {x:point.x+70,y:point.y-96};
            if (touch) {
              await command('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...target,id:1}]});
              await command('Input.dispatchTouchEvent',{type:cancelled?'touchCancel':'touchEnd',touchPoints:[]});
            } else {
              await command('Input.dispatchMouseEvent',{type:'mouseMoved',...target,button:'left',buttons:1});
              if (cancelled) {
                await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
                await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
              }
              await command('Input.dispatchMouseEvent',{type:'mouseReleased',...target,button:'left',clickCount:1});
            }
            assert.equal(await evaluate('Boolean(window.popupOrderTest.host().resize)'), false,
              'resize releases pointer capture');
            if (cancelled) assert.equal(await evaluate('JSON.stringify(window.popupOrderTest.host().pendingSizes.state)'),before,
              'Escape or touch cancel restores sizes before gesture');
            else assert.notEqual(await evaluate('JSON.stringify(window.popupOrderTest.host().pendingSizes.state)'),before,
              'actual corner gesture changes card size');
            if (cancelled) {
              assert.deepEqual(await evaluate('window.popupOrderTest.geometry()'),geometryBefore,
                'cancelled resize restores displaced card positions');
              assert.deepEqual(await evaluate('window.popupOrderTest.host().pendingCardOrder'),orderBefore,
                'cancelled resize restores card order');
            }
            assert.equal(await evaluate('window.popupOrderTest.writes()'),0,'resize never writes before apply');
          }
          await evaluate('window.popupOrderTest.$(\'[data-group="state"] [data-resize-card]\').focus()');
          const heightBefore = await evaluate('window.popupOrderTest.host().pendingSizes.state.h');
          await command('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40});
          await command('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40});
          assert.equal(await evaluate('window.popupOrderTest.host().pendingSizes.state.h'),heightBefore+1,
            'real keyboard resizes focused card corner');
          await evaluate('window.popupOrderTest.host().cancelArrangement(); window.popupOrderTest.host().startArrangement()');
          let droppedGeometry;
          const dragGallery = async (cancel = false) => {
            const units = await evaluate('window.popupOrderTest.prepareFreeDrag()');
            const before = await evaluate('window.popupOrderTest.geometry()');
            await evaluate('window.popupOrderTest.$(\'[data-group="gallery"] [data-drag-card]\').scrollIntoView({block:"center"})');
            const points = await evaluate(`(() => {
              const {$} = window.popupOrderTest;
              const a=$('[data-group="gallery"] [data-drag-card]').getBoundingClientRect();
              return {from:{x:a.x+a.width/2,y:a.y+a.height/2}};
            })()`);
            await beginDrag(points.from);
            await evaluate('(() => {const h=window.popupOrderTest.host(),data=structuredClone(h.snapshot); data[0].readings.state_batteryChargeLevel="85"; h.data=data;})()');
            assert.equal(await evaluate('Boolean(window.popupOrderTest.host().drag)'), true, 'live update preserves active drag');
            points.to={x:points.from.x+20+units.dx*units.colWidth,y:points.from.y+units.dy*units.rowHeight};
            if (units.mobile) points.to=await evaluate(`(() => {
              const b=window.popupOrderTest.$('[data-detail-body]');b.scrollTop=0;
              const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+10};
            })()`);
            await moveDrag(points.to);
            if (cancel && !units.mobile) {
              const edge = await evaluate(`(() => {
                const b=window.popupOrderTest.$('[data-detail-body]'),r=b.getBoundingClientRect();
                return {x:r.x+r.width/2,y:r.bottom-5,scroll:b.scrollTop};
              })()`);
              await moveDrag({x:edge.x,y:edge.y});
              await new Promise(resolve=>setTimeout(resolve,200));
              assert.ok(await evaluate('window.popupOrderTest.$("[data-detail-body]").scrollTop') > edge.scroll,
                'native GridStack autoscrolls inside the popup at its lower edge');
            }
            await endDrag(points.to,cancel);
            if (cancel) {
              assert.deepEqual(await evaluate('window.popupOrderTest.geometry()'),before,
                'Escape/touchcancel restores every displaced card coordinate');
              assert.equal(await evaluate('Boolean(window.popupOrderTest.host().pendingCardOrder)'), true,
                'cancelled drag leaves arrangement editor open');
              return;
            }
            const position = await evaluate('window.popupOrderTest.host().pendingPositions.gallery');
            if (units.mobile) assert.equal(await evaluate('window.popupOrderTest.host().pendingCardOrder[0]'),
              'gallery','mobile full-content cards use GridStack collisions for reordering');
            else assert.deepEqual(position,{x:units.dx,y:units.dy},'free drop snaps to exact x/y instead of reordering');
            droppedGeometry=await evaluate('window.popupOrderTest.geometry()');
            assert.equal(await evaluate('Boolean(window.popupOrderTest.host().drag)'), false, 'drop releases drag');
          };
          await dragGallery(true);
          await dragGallery();
          assert.equal(await evaluate('window.popupOrderTest.writes()'), 0, 'drag never writes');
          await command('Input.dispatchKeyEvent', {type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
          await command('Input.dispatchKeyEvent', {type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
          assert.equal(await evaluate('Boolean(window.popupOrderTest.host().pendingCardOrder)'), false, 'Escape cancels unsaved arrangement');
          assert.equal(await evaluate('window.popupOrderTest.$("[data-details]").open'), true, 'Escape leaves details open');
          await evaluate('window.popupOrderTest.host().startArrangement()');
          await evaluate('window.popupOrderTest.$(\'[data-group="gallery"] [data-drag-card]\').focus()');
          await command('Input.dispatchKeyEvent', {type:'keyDown',key:'ArrowUp',code:'ArrowUp',windowsVirtualKeyCode:38});
          await command('Input.dispatchKeyEvent', {type:'keyUp',key:'ArrowUp',code:'ArrowUp',windowsVirtualKeyCode:38});
          assert.equal(await evaluate('window.popupOrderTest.order()[2]'), 'gallery', 'real keyboard moves card');
          await evaluate('window.popupOrderTest.host().cancelArrangement(); window.popupOrderTest.host().startArrangement()');
          await dragGallery();
          await evaluate('window.popupOrderTest.host().toggleCard("doors")');
          await evaluate('window.popupOrderTest.host().saveArrangement()');
          const saved=await evaluate('window.popupOrderTest.snapshot().draft.pages[0].widgets[0]');
          if (!touch) assert.deepEqual(saved.cardPositions.gallery,
            (({x,y})=>({x,y}))(droppedGeometry.find(item=>item.id==='gallery')), 'editor persists exact free position');
          await evaluate('window.popupOrderTest.host().startArrangement()');
          assert.deepEqual(await evaluate('window.popupOrderTest.geometry()'),droppedGeometry,'all free coordinates survive Apply and reopening');
          await evaluate('window.popupOrderTest.host().cancelArrangement()');
          await evaluate('window.popupOrderTest.finish()');
          return;
        }
        if (fixture === '88_volvoconnect.html') {
          await evaluate(`(() => {
            const {host,mount} = window.volvoPopupRegression;
            mount.style.width = '343px';
            mount.style.marginTop = '600px';
            document.body.style.minHeight = '2400px';
            mount.append(host);
            host.shadowRoot.querySelector('[data-info]').focus({preventScroll:true});
            window.scrollTo(0,450);
            window.volvoPopupRegression.scroll = window.scrollY;
          })()`);
          const key = async (key, code, windowsVirtualKeyCode, text) => {
            await command('Input.dispatchKeyEvent', {type:'keyDown', key, code, windowsVirtualKeyCode,
              ...(text ? {text,unmodifiedText:text} : {})});
            await command('Input.dispatchKeyEvent', {type:'keyUp', key, code, windowsVirtualKeyCode});
          };
          const open = () => evaluate('window.volvoPopupRegression.host.shadowRoot.querySelector("[data-details]").open');
          await key('Enter','Enter',13,'\r');
          assert.equal(await open(), true, 'Enter on info opens the detail modal');
          for (let index = 0; index < 12; index++) {
            await key('Tab','Tab',9);
            assert.equal(await evaluate(`Boolean(window.volvoPopupRegression.host.shadowRoot
              .activeElement?.closest('[data-details]'))`), true, 'modal traps keyboard focus');
          }
          await key('Escape','Escape',27);
          assert.equal(await open(), false, 'real Escape closes the full popup');
          assert.equal(await evaluate(`window.volvoPopupRegression.host.shadowRoot.activeElement
            .hasAttribute('data-info')`), true, 'Escape restores focus to info');
          assert.equal(await evaluate('window.scrollY === window.volvoPopupRegression.scroll'), true,
            'Escape never jumps to the page start');
          await key('Enter','Enter',13,'\r');
          assert.equal(await open(), true, 'popup reopens using restored focus');
          await command('Input.dispatchMouseEvent', {type:'mousePressed',x:1,y:1,button:'left',clickCount:1});
          await command('Input.dispatchMouseEvent', {type:'mouseReleased',x:1,y:1,button:'left',clickCount:1});
          assert.equal(await open(), false, 'real backdrop click closes the popup');
          await key('Enter','Enter',13,'\r');
          await evaluate(`window.volvoPopupRegression.host.shadowRoot.querySelector('[data-close-details]').focus()`);
          await key('Enter','Enter',13,'\r');
          assert.equal(await open(), false, 'close button works from the keyboard');
          await evaluate('window.volvoPopupRegression.host.shadowRoot.querySelector("[data-open-actions]").focus()');
          await key('Enter','Enter',13,'\r');
          assert.equal(await evaluate('window.volvoPopupRegression.host.shadowRoot.querySelector("[data-actions-dialog]").open'),
            true, 'keyboard opens separate action modal');
          await key('Escape','Escape',27);
          assert.equal(await evaluate('window.volvoPopupRegression.host.shadowRoot.querySelector("[data-actions-dialog]").open'),
            false, 'Escape closes action modal');
          assert.equal(await evaluate('window.volvoPopupRegression.host.shadowRoot.activeElement.hasAttribute("data-open-actions")'),
            true, 'action modal returns focus to launcher');
          assert.equal(await evaluate('window.scrollY === window.volvoPopupRegression.scroll'), true,
            'action modal never resets page scroll');
          await evaluate('window.volvoPopupRegression.host.remove()');
          return;
        }
        if (fixture === '63_responsive_edges.html') {
          for (const [width, height, mobile, left, right, bottom] of [
            [768, 900, false, 0, 0, 0], [1000, 900, false, 0, 0, 0],
            [1280, 900, false, 0, 0, 0], [1440, 900, false, 0, 0, 0],
            [1920, 1080, false, 0, 0, 0], [2560, 1440, false, 0, 0, 0],
            [768, 900, false, 0, 0, 0], [393, 852, true, 0, 0, 34],
            [852, 393, true, 59, 59, 21], [852, 393, true, 59, 0, 21],
            [393, 852, true, 0, 0, 34], [834, 1194, true, 0, 0, 20],
            [1194, 834, true, 0, 0, 20],
          ]) {
            await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
            await command('Emulation.setTouchEmulationEnabled', { enabled: mobile });
            const insets = { top: mobile && width < 600 && width < height ? 59 : 0, left, right, bottom };
            await command('Emulation.setSafeAreaInsetsOverride', { insets });
            const measured = await evaluate(`window.viewportRegression.measure(${JSON.stringify({ width, insets, mobile })})`);
            assert.ok(measured.width > 0);
          }
          await evaluate('window.viewportRegression.finish()');
          return;
        } else if (fixture.startsWith('61_asset_image.html')) {
          const touch = fixture.endsWith('?touch=1');
          const drag = async (from, to, cancel = false) => {
            const points = await evaluate(`window.imageRegression.points(${JSON.stringify(from)},${JSON.stringify(to)})`);
            if (touch) {
              await command('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...points.from, id: 1 }] });
              await command('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...points.to, id: 1 }] });
              await command('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] });
            } else {
              await command('Input.dispatchMouseEvent', { type: 'mouseMoved', ...points.from });
              await command('Input.dispatchMouseEvent', { type: 'mousePressed', ...points.from, button: 'left', clickCount: 1 });
              await command('Input.dispatchMouseEvent', { type: 'mouseMoved', ...points.to, button: 'left', buttons: 1 });
              if (cancel) await evaluate('window.imageRegression.cancelGesture()');
              await command('Input.dispatchMouseEvent', { type: 'mouseReleased', ...points.to, button: 'left', clickCount: 1 });
            }
          };
          const checkCrop = (crop, message) => evaluate(
            `window.imageRegression.assertCrop(${JSON.stringify(crop)},${JSON.stringify(message)})`);
          await drag([70, 40], [90, 50], true);
          await checkCrop({ x: 20, y: 10, w: 100, h: 60 }, 'Pointer-Abbruch stellt die Auswahl wieder her');
          await drag([70, 40], [90, 50]);
          await checkCrop({ x: 40, y: 20, w: 100, h: 60 }, 'Pointer verschiebt den Ausschnitt');
          await drag([140, 80], [160, 90]);
          await checkCrop({ x: 40, y: 20, w: 120, h: 70 }, 'Eckgriff vergrößert den Ausschnitt');
          await drag([40, 20], [50, 30]);
          await checkCrop({ x: 50, y: 30, w: 110, h: 60 }, 'Eckgriff verkleinert den Ausschnitt');
          await drag([100, 60], [-100, -100]);
          await checkCrop({ x: 0, y: 0, w: 110, h: 60 }, 'Pointer-Verschieben bleibt im Quellbild');
          await evaluate('window.imageRegression.lock()');
          await drag([110, 60], [160, 80]);
          await checkCrop({ x: 0, y: 0, w: 160, h: 87 }, 'Pointer-Skalieren erhält das Seitenverhältnis');
          await evaluate('window.imageRegression.lock()');
          await drag([199, 1], [100, 99]);
          await checkCrop({ x: 100, y: 1, w: 99, h: 98 }, 'Pointer zieht einen neuen Ausschnitt auf');
          for (const [handle, key, keyCode] of [['n', 'ArrowUp', 38], ['e', 'ArrowRight', 39], ['s', 'ArrowDown', 40]]) {
            await evaluate(`document.querySelector('[data-asset-manager]').shadowRoot.querySelector('[data-handle="${handle}"]').focus()`);
            await command('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: keyCode });
            await command('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: keyCode });
          }
          await evaluate('window.imageRegression.finish()');
          return;
        } else if (fixture === '62_page_modal.html') {
          await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
          await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
          await evaluate('window.modalRegression.afterClose()');
          await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
          await evaluate('window.modalRegression.open("lg")');
          await command('Input.dispatchMouseEvent', { type: 'mousePressed', x: 1, y: 1, button: 'left', clickCount: 1 });
          await command('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 1, y: 1, button: 'left', clickCount: 1 });
          await evaluate('window.modalRegression.afterClose()');
          await command('Emulation.clearDeviceMetricsOverride');
          await evaluate('window.modalRegression.open("md")');
          await evaluate('document.querySelector(".cms-page-modal > header button").click()');
          await evaluate('window.modalRegression.afterClose()');
          await evaluate('window.modalRegression.open()');
          await evaluate('window.modalRegression.navigateAway()');
          await evaluate('window.modalRegression.finish()');
          return;
        } else if (fixture === '51_asset_manager.html') {
          const click = async selector => {
            const point = await evaluate(`window.assetRegression.point(${JSON.stringify(selector)})`);
            await command('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
            await command('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
            await command('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
            await pause(100);
          };
          const ids = await evaluate('({folder:window.assetRegression.folder,image:window.assetRegression.image})');
          await click(`[data-open-folder="${ids.folder}"]`);
          await click(`[data-asset-id="${ids.image}"]`);
          await click('[data-choose-destination]');
          await click(`[data-folder-picker] [data-open-folder="${'d'.repeat(32)}"]`);
          await click('[data-folder-accept]');
          await click('[data-mkdir]');
          await command('Input.insertText', { text: 'Mausordner' });
          await click('[data-folder-create-accept]');
          const files = [join(profile, 'PointerDrop1.png'), join(profile, 'PointerDrop2.png')];
          for (const file of files) await writeFile(file, pngFixture());
          const point = await evaluate('window.assetRegression.point("[data-assets]")');
          const data = { items: [], files, dragOperationsMask: 1 };
          await command('Input.dispatchDragEvent', { type: 'dragEnter', ...point, data });
          await command('Input.dispatchDragEvent', { type: 'dragOver', ...point, data });
          await command('Input.dispatchDragEvent', { type: 'drop', ...point, data });
          await pause(150);
          await evaluate('window.assetRegression.finish()');
          return;
        } else if (fixture === '65_widget_dialogs.html') {
          await evaluate(`new Promise(resolve => {
            const timer = setInterval(() => {
              if (!window.dialogRegression && !document.querySelector('#result').dataset.result) return;
              clearInterval(timer); resolve();
            }, 25);
          })`);
          const failure = await evaluate(`document.querySelector('#result').dataset.result === 'fail'
            ? document.querySelector('#result').textContent : null`);
          assert.equal(failure, null, failure);
          const checkDialogFits = async (name) => {
            for (const [width, height, mobile, label] of [
              [390, 844, true, 'phone'],
              [768, 1024, false, 'tablet'],
              [1280, 900, false, 'desktop'],
            ]) {
              await command('Emulation.setDeviceMetricsOverride', {
                width, height, deviceScaleFactor: 1, mobile,
              });
              await evaluate(`window.dialogRegression.${name}.openConfig()`);
              const dimensions = await evaluate(`(() => {
                const dialog = window.dialogRegression.${name}.shadowRoot.querySelector('[data-dialog]');
                const rect = dialog.getBoundingClientRect();
                return { width: rect.width, viewport: innerWidth, scroll: dialog.scrollWidth, client: dialog.clientWidth };
              })()`);
              assert.ok(dimensions.width <= dimensions.viewport, `${name} dialog fits a ${label} viewport`);
              assert.ok(dimensions.scroll <= dimensions.client + 1,
                `${name} dialog has no horizontal overflow on a ${label}`);
              await evaluate(`window.dialogRegression.${name}.closeConfig(false)`);
            }
          };
          await checkDialogFits('chart');
          await checkDialogFits('table');
          await evaluate('window.dialogRegression.chart.openConfig()');
          const summary = await evaluate(`(() => {
            const group = window.dialogRegression.chartGroups[2];
            group.open = false;
            group.querySelector('summary').focus();
            return true;
          })()`);
          assert.equal(summary, true);
          await command('Input.dispatchKeyEvent', {
            type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', unmodifiedText: '\r',
            windowsVirtualKeyCode: 13,
          });
          await command('Input.dispatchKeyEvent', {
            type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13,
          });
          assert.equal(await evaluate('window.dialogRegression.chartGroups[2].open'), true,
            'Enter opens a focused disclosure group');
          await command('Input.dispatchKeyEvent', {
            type: 'keyDown', key: ' ', code: 'Space', text: ' ', unmodifiedText: ' ',
            windowsVirtualKeyCode: 32,
          });
          await command('Input.dispatchKeyEvent', {
            type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32,
          });
          assert.equal(await evaluate('window.dialogRegression.chartGroups[2].open'), false,
            'Space closes a focused disclosure group');
          await evaluate('window.dialogRegression.finish()');
          return;
        }
        const move = async (point, dx, dy) => {
          await command('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
          await command('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
          for (let step = 1; step <= 12; step++) {
            await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x + dx * step / 12,
              y: point.y + dy * step / 12, button: 'left', buttons: 1 });
            await pause(30);
          }
          await command('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x + dx,
            y: point.y + dy, button: 'left', clickCount: 1 });
          await pause(350);
        };
        let points = await evaluate('window.linkRegression.points("drag")');
        await move(points.drag, 4 * points.cell, 0);
        points = await evaluate('window.linkRegression.points("resize")');
        await move(points.resize, 2 * points.cell, points.cellHeight);
        await evaluate('window.linkRegression.finish()');
      };
      const data = await browserResult(profile,
        `http://127.0.0.1:${server.address().port}/t/${fixture}`, child, interact,
        fixture === '111_close_buttons.html'
          ? command => command('Emulation.setFocusEmulationEnabled', { enabled: true })
          : fixture === '102_widget_editor_tools.html?touch=1'
          ? async command => {
            await command('Emulation.setDeviceMetricsOverride', {
              width:820, height:1180, deviceScaleFactor:1, mobile:true,
            });
            await command('Emulation.setTouchEmulationEnabled', {enabled:true});
          }
          : fixture.startsWith('89_volvoconnect_order.html')
          ? async command => {
            const touch = fixture.includes('touch=1');
            await command('Emulation.setDeviceMetricsOverride', {
              width:touch ? 393 : 1440,height:touch ? 852 : fixture.includes('height=600') ? 600 : 1000,
              deviceScaleFactor:1,mobile:touch,
            });
            await command('Emulation.setTouchEmulationEnabled', {enabled:touch});
          }
          : fixture.startsWith('82_solarflow_design.html')
          ? command => command('Emulation.setEmulatedMedia', { features: [{
            name: 'prefers-reduced-motion', value: fixture.includes('reduced=1') ? 'reduce' : 'no-preference',
          }] })
          : fixture.startsWith('99_widget_typography.html')
          ? command => command('Emulation.setDeviceMetricsOverride', {
            width:Number(new URLSearchParams(fixture.split('?')[1]).get('width') || 1440),
            height:1000,deviceScaleFactor:1,mobile:fixture.includes('cms-device='),
          })
          : fixture.startsWith('85_solar_energy.html') || fixture.startsWith('86_mobile_widgets.html')
          ? async command => {
            const mobile = fixture.startsWith('86_mobile_widgets.html');
            await command('Emulation.setDeviceMetricsOverride', {
              width: Number(new URLSearchParams(fixture.split('?')[1]).get('width') || (mobile ? 393 : 1440)),
              height: fixture.includes('landscape=1') ? 393 : 1000, deviceScaleFactor: 1, mobile,
            });
            if (fixture.endsWith('?mode=touch-test')) {
              await command('Emulation.setTouchEmulationEnabled', { enabled: true });
            }
            await command('Emulation.setEmulatedMedia', { features: [{
              name: 'prefers-reduced-motion', value: fixture.includes('reduced=1') ? 'reduce' : 'no-preference',
            }] });
          }
          : fixture.startsWith('117_condition_wizard.html?touch=1')
            || fixture.startsWith('118_condition_integration.html?touch=1')
          ? async command => {
            await command('Emulation.setDeviceMetricsOverride', {
              width:390, height:844, deviceScaleFactor:1, mobile:true,
            });
            await command('Emulation.setTouchEmulationEnabled', {enabled:true});
          }
          : fixture.startsWith('114_widget_previews.html')
          ? command => command('Emulation.setDeviceMetricsOverride', {
            width:Number(new URLSearchParams(fixture.split('?')[1]).get('width') || 1440),
            height:1000,deviceScaleFactor:1,mobile:false,
          })
          : fixture.startsWith('95_weather.html')
          ? command => command('Emulation.setDeviceMetricsOverride', {
            width: Number(new URLSearchParams(fixture.split('?')[1]).get('width') || 1440),
            height: 850, deviceScaleFactor: 1, mobile: false,
          })
          : fixture.startsWith('75_dialog_layout.html')
          ? command => command('Emulation.setDeviceMetricsOverride', {
            width: Number(new URLSearchParams(fixture.split('?')[1]).get('width')),
            height: fixture.includes('width=852') ? 393 : 1000, deviceScaleFactor: 1, mobile: false,
          })
          : fixture.startsWith('61_asset_image.html')
          ? async command => {
            const touch = fixture.endsWith('?touch=1');
            await command('Emulation.setDeviceMetricsOverride', {
              width: touch ? 390 : 1280, height: touch ? 844 : 900, deviceScaleFactor: 1, mobile: touch,
            });
            await command('Emulation.setTouchEmulationEnabled', { enabled: touch });
          }
          : fixture.includes('landscape=1')
          ? command => command('Emulation.setDeviceMetricsOverride', {
            width: 852, height: 393, deviceScaleFactor: 1, mobile: true,
          })
          : fixture.endsWith('?mode=touch-test')
            ? command => command('Emulation.setTouchEmulationEnabled', { enabled: true }) : undefined);
      assert.ok(data.checks >= minimum, `${fixture}: complete regression coverage (${data.checks})`);
      console.log(`${fixture}: ${data.checks} browser checks`);
      if (fixture.startsWith('85_solar_energy.html')) console.log(`Solar flow font heights: ${JSON.stringify(data.flowFontHeights)}`);
      if (fixture.startsWith('99_widget_typography.html')) {
        console.log(JSON.stringify(data.measurements.filter(row =>
          row.scale === 1 && ['cms-table', 'cms-thermostat', 'cms-solar-energy'].includes(row.widget))));
        console.log(`Feedback screen sizes: ${JSON.stringify(data.measurements.filter(row =>
          row.layout === 'freeform' && row.width === 600 && [.5, 1].includes(row.scale)
          && ['cms-calllist', 'cms-solar-energy', 'solarflow-value', 'cms-text'].includes(row.widget)))}`);
      }
    }
  } catch (error) {
    throw new Error(`${error.message}\nChrome stderr:\n${stderr}`, { cause: error });
  } finally {
    child.kill('SIGTERM');
    await closed;
    clearTimeout(timeout);
    await rm(profile, { recursive: true, force: true });
    await new Promise((resolve) => server.close(resolve));
  }
});

test('editor tools require activation and Freeform navigation supports real pointer gestures', {
  skip: chrome ? false : 'Chrome not installed; set CHROME_BIN to run the browser regression',
  timeout: 45000,
}, async () => {
  const server = await testServer();
  const profile = await mkdtemp(join(root, 't/.cms-hover-'));
  const child = spawn(chrome, ['--headless=new', '--no-first-run', '--no-default-browser-check',
    '--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4',
    '--disable-background-networking', '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1440,1000', 'about:blank']);
  let stderr = '';
  child.stdout.resume();
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const closed = new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
  const timeout = setTimeout(() => child.kill('SIGTERM'), 35000);
  try {
    const interact = async (command) => {
      const evaluate = async (expression) => {
        const reply = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, timeout: 15000 });
        assert.ok(!reply.exceptionDetails, JSON.stringify(reply));
        return reply.result.value;
      };
      await evaluate(`new Promise(resolve => {
        const timer = setInterval(() => {
          const output = document.querySelector('#result');
          if (!output.dataset.ready && !output.dataset.result) return;
          clearInterval(timer); resolve();
        }, 25);
      })`);
      const check = async (phase, index = 0) => {
        await evaluate(`document.dispatchEvent(new CustomEvent('regression-check', {detail:${JSON.stringify({ phase, index })}}))`);
        const error = await evaluate(`document.querySelector('#result').dataset.result === 'fail'
          ? document.querySelector('#result').textContent : null`);
        assert.equal(error, null, `${phase}/${index}: ${error}`);
      };
      await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 });
      await pause(50);
      await check('initial');
      for (const index of [0, 1]) {
        await evaluate(`document.querySelector('#hover-item-${index}').scrollIntoView({block:'center'})`);
        await pause(100);
        const point = await evaluate(`(() => { const r = document.querySelector('#hover-item-${index}').getBoundingClientRect();
          return {x:r.x + r.width / 2, y:r.y + r.height / 2}; })()`);
        await command('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
        await pause(50);
        await check('hover', index);
        await command('Input.dispatchMouseEvent', {type:'mousePressed', ...point, button:'left', clickCount:1});
        await command('Input.dispatchMouseEvent', {type:'mouseReleased', ...point, button:'left', clickCount:1});
        await check('selected', index);
        // Larger action targets may cover the original centre; deselect on unobscured content.
        const content = await evaluate(`(() => { const r = document.querySelector('#hover-item-${index}').getBoundingClientRect();
          return {x:r.x + 25, y:r.y + r.height / 2}; })()`);
        await command('Input.dispatchMouseEvent', {type:'mousePressed', ...content, button:'left', clickCount:1});
        await command('Input.dispatchMouseEvent', {type:'mouseReleased', ...content, button:'left', clickCount:1});
        await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 });
        await pause(50);
        await check('leave');
        await evaluate(`(() => { const button = document.querySelector('#hover-item-${index} .cms-widget-drag');
          const focusable = [...document.querySelectorAll('button,a[href],select,input')].filter(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
          focusable[focusable.indexOf(button) - 1].focus(); })()`);
        await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
        await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
        await check('focus', index);
        await command('Input.dispatchKeyEvent', {type:'keyDown', key:'Enter', code:'Enter', text:'\r', windowsVirtualKeyCode:13});
        await command('Input.dispatchKeyEvent', {type:'keyUp', key:'Enter', code:'Enter', windowsVirtualKeyCode:13});
        await check('selected', index);
        await command('Input.dispatchKeyEvent', {type:'keyDown', key:'Tab', code:'Tab', windowsVirtualKeyCode:9});
        await command('Input.dispatchKeyEvent', {type:'keyUp', key:'Tab', code:'Tab', windowsVirtualKeyCode:9});
        assert.equal(await evaluate(`document.activeElement.matches('#hover-item-${index} .cms-widget-config')
          && getComputedStyle(document.activeElement).outlineStyle !== 'none'`), true, 'Tab reaches the visible action focus');
        await command('Input.dispatchKeyEvent', {type:'keyDown', key:'Escape', code:'Escape', windowsVirtualKeyCode:27});
        await check('leave');
        await evaluate(`document.querySelector('#outside').focus()`);
        await check('leave');
      }
      await command('Emulation.setTouchEmulationEnabled', { enabled: true });
      await pause(50);
      await check('touch');
      const touchPoint = await evaluate(`(() => {const r=document.querySelector('#hover-item-1').getBoundingClientRect();
        return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
      await command('Input.dispatchTouchEvent', {type:'touchStart',touchPoints:[touchPoint]});
      await command('Input.dispatchTouchEvent', {type:'touchEnd',touchPoints:[]});
      await pause(50);
      await check('selected', 1);
      await command('Input.dispatchKeyEvent', {type:'keyDown', key:'Escape', code:'Escape', windowsVirtualKeyCode:27});
      await check('leave');
      await command('Emulation.setTouchEmulationEnabled', { enabled: false });
      await check('finish');
    };
    const result = await browserResult(profile,
      `http://127.0.0.1:${server.address().port}/t/41_editor_hover.html`, child, interact);
    assert.ok(result.checks >= 70);
    await browserResult(profile, `http://127.0.0.1:${server.address().port}/t/93_freeform.html?grid`, child, async command => {
      const ready = await command('Runtime.evaluate', {expression:
        `new Promise(resolve => { const timer = setInterval(() => {
          if (document.querySelector('#result')?.textContent !== 'grid ready') return;
          clearInterval(timer); resolve();
        },25); })`, awaitPromise:true, timeout:30000});
      assert.ok(!ready.exceptionDetails, JSON.stringify(ready));
      await command('Runtime.evaluate', {expression:
        `document.querySelector('.grid-stack-item:not(.cms-responsive-navigation) > .grid-stack-item-content').click()`});
      await command('Input.dispatchKeyEvent', {type:'keyDown', key:'Escape', code:'Escape', windowsVirtualKeyCode:27});
      const {result} = await command('Runtime.evaluate', {expression:
        `!document.querySelector('.cms-widget-selected') && !document.activeElement.matches('.cms-widget-drag')`,
        returnByValue:true});
      assert.equal(result.value, true, 'Grid Escape clears selection and the focused move outline');
      await command('Runtime.evaluate', {expression:
        `Object.assign(document.querySelector('#result'), {textContent:'{"checks":1}'}).dataset.result='pass'`});
    });
    await browserResult(profile, `http://127.0.0.1:${server.address().port}/t/93_freeform.html?navigation`, child, async command => {
      const read = async expression => {
        const reply = await command('Runtime.evaluate', {expression, awaitPromise:true, returnByValue:true});
        assert.ok(!reply.exceptionDetails, JSON.stringify(reply));
        return reply.result.value;
      };
      const point = selector => read(`(() => {
        const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
        return {x:r.x+r.width/2,y:r.y+r.height/2};
      })()`);
      const mouse = (type, p, buttons) => command('Input.dispatchMouseEvent',
        {type, ...p, button:'left', buttons, clickCount:1});
      await read(`new Promise(resolve => {
        const timer = setInterval(() => {
          if (document.querySelector('#result').textContent === 'pending') return;
          clearInterval(timer); resolve();
        },25);
      })`);
      assert.equal(await read(`document.querySelector('#result').textContent`), 'navigation ready');
      const center = await point('.cms-freeform-navigation');
      await mouse('mouseMoved', center, 0);
      assert.equal(await read(`document.elementFromPoint(${center.x},${center.y})?.closest('.cms-freeform-navigation')?.className`),
        'cms-freeform-navigation', `Navigation hit at ${JSON.stringify(center)}`);
      await mouse('mousePressed', center, 1);
      await mouse('mouseReleased', center, 0);
      await pause(40);
      assert.equal(await read(`document.querySelectorAll('.cms-freeform-handles button').length`), 8);
      const handle = await point('.cms-freeform-handles [data-dir=se]');
      await mouse('mousePressed', handle, 1);
      await mouse('mouseMoved', {x:handle.x+40,y:handle.y+20}, 1);
      await pause(40);
      assert.match(await read(`document.querySelector('.cms-freeform-handles .cms-widget-dimensions')?.textContent`), /\d+ × \d+ px/);
      await mouse('mouseReleased', {x:handle.x+40,y:handle.y+20}, 0);
      const saved = await read(`JSON.parse(document.querySelector('#result').dataset.saved)`);
      assert.equal(saved.id, '__nav');
      assert.ok(saved.rect.w > 500 && saved.rect.h > 55);
      const move = await point('.cms-freeform-navigation .cms-widget-drag');
      await mouse('mousePressed', move, 1);
      await mouse('mouseMoved', {x:move.x+40,y:move.y}, 1);
      await mouse('mouseReleased', {x:move.x+40,y:move.y}, 0);
      assert.ok(await read(`JSON.parse(document.querySelector('#result').dataset.saved).rect.x > 50`));
      await command('Input.dispatchKeyEvent', {type:'keyDown', key:'ArrowRight', code:'ArrowRight', windowsVirtualKeyCode:39});
      assert.equal(await read(`JSON.parse(document.querySelector('#result').dataset.saved).rect.x`), 51);
      await read(`Object.assign(document.querySelector('#result'), {textContent:'{}'}).dataset.result='pass'`);
    });
    await browserResult(profile, `http://127.0.0.1:${server.address().port}/t/93_freeform.html`, child);
    const mobileUrl = `http://127.0.0.1:${server.address().port}/t/94_freeform_mobile.html`;
    const setViewport = (width, height) => command => command('Emulation.setDeviceMetricsOverride',
      {width, height, deviceScaleFactor:1, mobile:false});
    const responsiveUrl = `http://127.0.0.1:${server.address().port}/t/93_freeform.html?responsive`;
    const measure = async (command, width, height) => {
        await setViewport(width, height)(command);
        const {result} = await command('Runtime.evaluate', {expression: `new Promise(resolve => setTimeout(() => {
          const viewport = document.querySelector('.cms-freeform-viewport');
          const canvas = document.querySelector('.cms-freeform-canvas').getBoundingClientRect();
          const burger = document.querySelector('.cms-freeform-compact-navigation .cms-nav-burger');
          const links = [...viewport.querySelectorAll('.cms-freeform-navigation .cms-nav-link')];
          const bounds = viewport.getBoundingClientRect();
          const background = getComputedStyle(viewport);
          resolve({width: viewport.clientWidth, canvasWidth: canvas.width, bottom: canvas.bottom,
            left: bounds.left, frameBottom: bounds.bottom, image: background.backgroundImage,
            imageSize: background.backgroundSize, imagePosition: background.backgroundPosition,
            imageRepeat: background.backgroundRepeat,
            horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
              || viewport.scrollWidth > viewport.clientWidth,
            stacked: viewport.classList.contains('cms-freeform-stack'), burger: burger?.offsetHeight ?? 0,
            targets: links.map(link => link.getBoundingClientRect().height)});
        }, 120))`, awaitPromise:true, returnByValue:true});
        return result.value;
    };
    const assertPortraitBackground = view => {
      assert.match(view.image, /data:image\/svg\+xml/);
      assert.equal(view.imageSize, 'cover');
      assert.equal(view.imagePosition, '50% 50%');
      assert.equal(view.imageRepeat, 'no-repeat');
    };
    const finishResponsive = command => command('Runtime.evaluate', {expression:
      `Object.assign(document.querySelector('#result'), {textContent:'{}'}).dataset.result='pass'`});
    await browserResult(profile, responsiveUrl, child, async command => {
      const resize = (width, height) => measure(command, width, height);
      const desktop = await resize(1440, 800);
      assert.ok(Math.abs(desktop.width - desktop.canvasWidth) < 1 && desktop.bottom > 800 && !desktop.burger);
      for (const [width, height] of [[932, 430], [1100, 760]]) {
        const landscape = await resize(width, height);
        assert.ok(!landscape.stacked && Math.abs(landscape.width - landscape.canvasWidth) < 1
          && landscape.left <= 1 && landscape.width >= width - 16
          && landscape.bottom > height && !landscape.burger && !landscape.horizontalOverflow
          && landscape.targets.length === 2 && landscape.targets.every(size => size >= 23.99),
        `${width} × ${height}: full width, vertical overflow and usable inline navigation`);
      }
      assert.equal(desktop.image, 'none', 'desktop keeps the background on the canvas');
      const tallLandscape = await resize(1000, 990);
      assert.match(tallLandscape.image, /data:image\/svg\+xml/);
      assert.equal(tallLandscape.imagePosition, '50% 0%');
      assert.ok(tallLandscape.bottom < 990 && tallLandscape.frameBottom >= 990, 'background fills below a short canvas');
      const portrait = await resize(820, 1180);
      assert.ok(portrait.stacked && portrait.burger >= 44);
      assertPortraitBackground(portrait);
      const phone = await resize(430, 932);
      assert.ok(phone.stacked && Math.abs(phone.width - phone.canvasWidth) < 1 && phone.burger >= 44);
      assertPortraitBackground(phone);
      await command('Runtime.evaluate', {expression:
        `document.querySelector('.cms-nav-link').textContent = 'Sehr langer Seitenname '.repeat(30)`});
      const cramped = await resize(932, 430);
      assert.ok(cramped.burger >= 44 && cramped.targets.length === 0, 'long navigation falls back to the burger');
      await command('Runtime.evaluate', {expression:
        `document.querySelector('.cms-nav-link').textContent = 'Start'`});
      const fitsAgain = await resize(932, 430);
      assert.ok(!fitsAgain.burger && fitsAgain.targets.length === 2, 'inline navigation returns once links fit');
      const restored = await resize(1440, 800);
      assert.deepEqual(restored, desktop);
      await finishResponsive(command);
    });
    await browserResult(profile, `${responsiveUrl}&tablet`, child, async command => {
      const landscape = await measure(command, 1180, 820);
      assert.ok(!landscape.stacked && landscape.left <= 1 && landscape.width >= 1164
        && Math.abs(landscape.width - landscape.canvasWidth) < 1
        && !landscape.burger && landscape.targets.length === 2
        && !landscape.horizontalOverflow, 'iPad Air: shared Grid canvas fills the width and shows its links');
      const portrait = await measure(command, 820, 1180);
      assert.ok(portrait.stacked && !portrait.horizontalOverflow);
      assertPortraitBackground(portrait);
      await finishResponsive(command);
    });
    const mobile = await browserResult(profile, mobileUrl, child, undefined, setViewport(820, 1180));
    assert.ok(mobile.checks > 1000);
    const landscape = await browserResult(profile, mobileUrl, child, undefined, setViewport(1000, 700));
    assert.ok(landscape.checks > 10);
  } catch (error) {
    throw new Error(`${error.message}\nChrome stderr:\n${stderr}`, { cause: error });
  } finally {
    child.kill('SIGTERM');
    await closed;
    clearTimeout(timeout);
    await rm(profile, { recursive: true, force: true });
    await new Promise((resolve) => server.close(resolve));
  }
});

test('real editor pointer drag and resize preserve appearance on a full-width canvas', {
  skip: chrome ? false : 'Chrome not installed; set CHROME_BIN to run the browser regression',
  timeout: 45000,
}, async () => {
  const server = await testServer();
  const profile = await mkdtemp(join(root, 't/.cms-editor-'));
  await mkdir(join(profile, 'Default'));
  await writeFile(join(profile, 'Default', 'Preferences'), JSON.stringify({
    partition: { default_zoom_level: { x: Math.log(1.25) / Math.log(1.2) } },
  }));
  const child = spawn(chrome, ['--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--force-device-scale-factor=1', '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1100,1000', 'about:blank']);
  child.stdout.resume();
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const closed = new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
  const timeout = setTimeout(() => child.kill('SIGTERM'), 35000);
  try {
    const interact = async (command) => {
      const evaluate = async (expression) => {
        const reply = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 15000 });
        assert.ok(!reply.exceptionDetails, JSON.stringify(reply));
        return reply.result.value;
      };
      const readiness = await evaluate(`new Promise(resolve => {
        const timer = setInterval(() => {
          const output = document.querySelector('#result');
          if (!output.dataset.ready && !output.dataset.result) return;
          clearInterval(timer); resolve({ready:output.dataset.ready, text:output.textContent});
        }, 25);
      })`);
      assert.equal(readiness.ready, 'true', readiness.text);
      for (const [id, selector, dx, dy, writes] of [
        ['__nav', '.ui-resizable-se', 8, 2, 1],
        ['__nav', '.ui-resizable-se', -4, -1, 2],
        ['__nav', '.ui-resizable-se', 4, 1, 3],
        ['value', '.cms-widget-drag', 2, 1, 4], ['value', '.ui-resizable-se', 1, 1, 5],
      ]) {
        if (writes === 5) {
          await evaluate(`document.querySelector('.cms-schema5-workspace').scrollLeft = 100`);
          await pause(100);
        }
        const point = await evaluate(`(() => {
          const grid = document.querySelector('.cms-grid-editable');
          const widget = [...grid.children].find(el => el.gridstackNode?.id === '${id}');
          if (!widget.classList.contains('cms-widget-selected')) widget.click();
          const handle = widget.querySelector('${selector}');
          const rect = handle.getBoundingClientRect();
          return { x:'${selector}' === '.ui-resizable-se' ? rect.right - 2 : rect.x + rect.width/2,
            y:'${selector}' === '.ui-resizable-se' ? rect.bottom - 2 : rect.y + rect.height/2,
            cell:grid.getBoundingClientRect().width/grid.gridstack.getColumn() };
        })()`);
        await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
        if (selector === '.cms-widget-drag') {
          await pause(100);
          const hit = await evaluate(`(() => {
            const grid = document.querySelector('.cms-grid-editable');
            const widget = [...grid.children].find(el => el.gridstackNode?.id === '${id}');
            const handle = widget.querySelector('.cms-widget-drag');
            const target = document.elementFromPoint(${point.x}, ${point.y});
            return target?.closest('.grid-stack-item') === widget
              && target?.closest('.cms-widget-drag') === handle;
          })()`);
          assert.equal(hit, true, 'drag handle receives the initial pointer press');
        }
        await command('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
        if (selector === '.cms-widget-drag') {
          // Gridstack sets its drag origin only after crossing the 3px activation threshold.
          point.x += 4;
          await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, button: 'left', buttons: 1 });
          await pause(25);
        }
        for (let step = 1; step <= 12; step++) {
          await command('Input.dispatchMouseEvent', { type: 'mouseMoved',
            x: point.x + point.cell * dx * step / 12, y: point.y + point.cell * dy * step / 12,
            button: 'left', buttons: 1 });
          await pause(25);
        }
        await command('Input.dispatchMouseEvent', { type: 'mouseReleased',
          x: point.x + point.cell * dx, y: point.y + point.cell * dy, button: 'left', clickCount: 1 });
        await evaluate(`new Promise(resolve => {
          const timer = setInterval(() => {
            if (Number(document.querySelector('#result').dataset.writes) < ${writes}
              || document.querySelector('.cms-grid-editable')?.inert) return;
            clearInterval(timer); resolve();
          }, 25);
        })`);
        await pause(300);
      }
      await evaluate(`document.querySelector('#finish').click()`);
    };
    const result = await browserResult(profile,
      `http://127.0.0.1:${server.address().port}/t/38_editor_scaling.html`, child, interact);
    assert.equal(result.writes, 5);
    assert.ok(result.checks >= 20);
  } catch (error) {
    throw new Error(`${error.message}\nChrome stderr:\n${stderr}`, { cause: error });
  } finally {
    child.kill('SIGTERM');
    await closed;
    clearTimeout(timeout);
    await rm(profile, { recursive: true, force: true });
    await new Promise((resolve) => server.close(resolve));
  }
});

test('real browser zoom and resizing scale widgets and navigation without writes', {
  skip: chrome ? false : 'Chrome not installed; set CHROME_BIN to run the browser regression',
  timeout: 180000,
}, async () => {
  const server = await testServer();
  const profiles = await mkdtemp(join(root, 't/.cms-scaling-'));
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
          `http://127.0.0.1:${server.address().port}/t/35_schema5_scaling.html`, child);
        assert.equal(child.exitCode, null, stderr);
      } catch (error) {
        throw new Error(`${error.message}\nChrome stderr:\n${stderr}`, { cause: error });
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
      assert.equal(data.editorScroll.overflow, 'auto', 'only the editing workspace scrolls');
      assert.ok(!data.editorScroll.pageOverflow, 'editor canvas never overflows the document');
      assert.ok(data.initial.flowing || Math.abs(data.editorInitial.widget.width - data.initial.widget.width) < 2,
        `editor uses the same widget width as the view: ${JSON.stringify({view:data.initial.widget, editor:data.editorInitial.widget})}`);
      const [editorWide, editorNarrow] = data.editorResize;
      assert.ok(editorWide.widget.width > editorNarrow.widget.width * 1.1, 'editor widgets follow window size');
      assert.ok(editorWide.widget.height > editorNarrow.widget.height * 1.1, 'editor height follows window size');
      assert.ok(Math.abs(data.editorInitial.root.width - data.editorScroll.client) < 1,
        'editor uses the full available content width at every zoom');
      assert.ok(data.editorScroll.width <= data.editorScroll.client + 1,
        'zoomed editing canvas fits without horizontal scrolling');
      assert.ok(data.longCompact && data.openLinks, `long navigation opens and stays usable at zoom ${zoom}`);
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
    for (const data of results.values()) {
      assert.ok(Math.abs(data.initial.root.width - data.editorInitial.root.width) < 1,
        'view and editor share the full-width canvas even when the view wraps');
      assert.ok(data.editorInitial.widgetFont > 0 && data.initial.widgetFont > 0,
        'widget text remains rendered with real browser zoom');
      for (const dimension of ['width', 'height']) {
        assert.ok(Math.abs(data.editorInitial.widget[dimension] / data.editorInitial.root.width
          - results.get(1).editorInitial.widget[dimension] / results.get(1).editorInitial.root.width) < .001,
          `saved widget ${dimension} proportion stays constant as zoom changes the available CSS width`);
      }
    }
    const rowCount = (zoom) => results.get(zoom).initial.widgets.slice(0, 4)
      .filter((item) => Math.abs(item.y - results.get(zoom).initial.widgets[0].y) < 1).length;
    assert.ok(results.get(2).initial.flowing, 'zoomed live view uses responsive flow without changing the saved editor raster');
    console.log(JSON.stringify([...results].map(([zoom, data]) => ({
      zoom, viewport: data.initial.viewport, widget: data.initial.widget.width,
      button: data.initial.link.width, rowCount: rowCount(zoom),
    }))));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(profiles, { recursive: true, force: true });
  }
});
