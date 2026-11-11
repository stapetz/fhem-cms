import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { test } from 'node:test';
import { FhemClient } from '../www/fhem-cms/js/fhem-client.js';

test('asset client roundtrips chunked files, administration and deletion through persistent Perl', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cms-assets-client-'));
  await mkdir(join(dir, 'www/fhem-cms/CMS/media'), { recursive: true });
  await mkdir(join(dir, 'fhem-cms-data/CMS'), { recursive: true });
  const config = { schemaVersion: 5, theme: 'dark', settings: { layoutMode: 'grid', gridColumns: 12 },
    navigation: { orientation: 'horizontal', grid: { col: 1, row: 1, w: 12, h: 1 } },
    pages: [{ id: 'start', title: 'Start', widgets: [] }] };
  await writeFile(join(dir, 'fhem-cms-data/CMS/config.json'), JSON.stringify(config));
  const source = `
    use strict; use warnings; use JSON::PP (); use MIME::Base64 ();
    our %attr; sub Log3 {} sub InternalTimer {} sub RemoveInternalTimer {}
    require './FHEM/01_FHEMCMS.pm'; $attr{global}{modpath}=$ARGV[0]; $|=1;
    while (my $line=<STDIN>) {
      my $command=JSON::PP->new->decode($line);
      my $result = $command eq 'get CMS assets'
        ? FHEMCMS_AssetsDispatch('CMS',{op=>'list'})
        : $command =~ /\\Aset CMS assets ([A-Za-z0-9+\\/=]+)\\z/
          ? FHEMCMS_AssetsDispatch('CMS',$1) : die 'unexpected command';
      print JSON::PP->new->encode($result)."\\n";
    }`;
  const child = spawn('perl', ['-e', source, dir]);
  const lines = createInterface({ input: child.stdout });
  let pending = null;
  let stderr = '';
  child.stderr.on('data', data => { stderr += data; });
  lines.on('line', line => { const resolve = pending; pending = null; resolve(JSON.parse(line)); });
  const exited = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', code => { if (pending) pending(Promise.reject(new Error(stderr))); resolve(code); });
  });
  const client = new FhemClient('CMS', new URL('http://localhost/fhem'));
  client.command = command => new Promise(resolve => {
    assert.equal(pending, null);
    pending = resolve;
    child.stdin.write(`${JSON.stringify(command)}\n`);
  });
  const act = request => client.assetAction(request);
  try {
    let state = await act({ op: 'list' });
    const first = state.token;
    let result = await act({ op: 'mkdir', token: state.token, name: 'Dokumente', parent: 'root' });
    state = result.state;
    const folder = state.folders[0].id;
    await assert.rejects(() => act({ op: 'mkdir', token: first, name: 'alt', parent: 'root' }), /geaendert/);
    const bytes = `%PDF-1.7\n${'content '.repeat(20000)}`;
    let progress = 0;
    result = await client.uploadAsset(new File([bytes], 'Energie.pdf'), folder, state.token, {
      onProgress: (done, total) => { assert.ok(done > progress && done <= total); progress = done; },
    });
    assert.equal(progress, bytes.length);
    state = result.state;
    const document = state.assets.find(asset => asset.id === result.selected);
    assert.equal(document.folder, folder);
    assert.equal(document.name, 'Energie.pdf');
    assert.equal(document.image, false);
    assert.equal(await readFile(join(dir, 'fhem-cms-data/CMS/assets', document.file), 'utf8'), bytes);
    assert.match(document.href, /^\.\.\/\.\.\/fhemcms-assets\/CMS\/[0-9a-f]{32}$/);
    result = await client.uploadAsset(new File([bytes], 'Again.pdf'), 'root', state.token);
    assert.equal(result.duplicate, true);
    assert.equal(result.selected, document.id);
    const controller = new AbortController();
    await assert.rejects(() => client.uploadAsset(new File([bytes], 'Abort.pdf'), 'root', state.token, {
      signal: controller.signal, onProgress: () => controller.abort(),
    }), /abgebrochen/);
    result = await client.uploadAsset(new File(['hello'], 'Good.txt'), folder, state.token);
    state = result.state;
    assert.equal(state.assets.length, 2, 'cancel leaves no stored partial file');
    const imageBytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, ...Array(24).fill(0)]);
    result = await client.uploadAsset(new File([imageBytes], 'Image.png'), folder, state.token);
    state = result.state;
    const image = state.assets.find(asset => asset.image);
    assert.match(image.href, /^media\//);
    result = await client.uploadAsset(new File([imageBytes, 'variant'], 'Variant.png'), folder, state.token,
      { variantOf: image.id });
    state = result.state;
    const variant = state.assets.find(asset => asset.id === result.selected);
    assert.equal(variant.variantOf, image.id, 'variant association survives client and backend roundtrip');
    state = (await act({ op: 'mkdir', token: state.token, name: 'Bilder', parent: folder })).state;
    const imageFolder = state.folders.find(item => item.name === 'Bilder').id;
    state = (await act({ op: 'move', token: state.token, id: image.id, name: 'Verschoben.png', folder: imageFolder })).state;
    state = await act({ op: 'list' });
    const movedImage = state.assets.find(asset => asset.id === image.id);
    assert.equal(movedImage.folder, imageFolder, 'image move persists across independent backend read');
    assert.equal(movedImage.name, 'Verschoben.png');
    assert.equal(movedImage.href, image.href, 'image move preserves existing widget URL');
    assert.equal(state.assets.find(asset => asset.id === variant.id).folder, imageFolder,
      'variant moves with original');
    await assert.rejects(() => act({ op: 'rmdir', token: state.token, id: imageFolder }), /leere/);
    state = await act({ op: 'list' });
    assert.ok(state.assets.some(asset => asset.id === image.id), 'nonempty folder refusal keeps image');
    assert.ok(state.folders.some(item => item.id === imageFolder), 'nonempty folder refusal keeps folder');
    const policy = structuredClone(state.policy);
    policy.types.pdf = false;
    policy.types.epub = true;
    state = (await act({ op: 'policy', policy, token: state.token })).state;
    await assert.rejects(() => client.uploadAsset(new File([bytes], 'Blocked.pdf'), folder, state.token), /gesperrt/);
    const stored = JSON.stringify({ ...config, pages: [{ ...config.pages[0], widgets: [{
      id: 'text', type: 'text', html: `<p><a href="${document.href}">PDF</a><img src="${image.href}"></p>`,
      grid: { col: 1, row: 2, w: 4, h: 4 },
    }] }] });
    await writeFile(join(dir, 'fhem-cms-data/CMS/draft.json'), stored);
    const usage = await act({ op: 'usage', id: document.id });
    assert.equal(usage.usage[0].source, 'Entwurf');
    await assert.rejects(() => act({ op: 'delete', token: state.token, id: document.id }), error => {
      assert.equal(error.usage[0].widget, 'text'); return /verwendet/.test(error.message);
    });
    await assert.rejects(() => act({ op: 'delete', token: state.token, id: image.id }), /verwendet/);
    const variantDraft = stored.replace(image.href, variant.href);
    await writeFile(join(dir, 'fhem-cms-data/CMS/draft.json'), variantDraft);
    await assert.rejects(() => act({ op: 'delete', token: state.token, id: variant.id }), /verwendet/);
    state = (await act({ op: 'delete', token: state.token, id: image.id })).state;
    assert.ok(!Object.hasOwn(state.assets.find(asset => asset.id === variant.id), 'variantOf'),
      'deleting unreferenced original detaches a referenced variant without deleting it');
    await assert.rejects(() => act({ op: 'delete', token: state.token, id: variant.id }), /verwendet/);
    await writeFile(join(dir, 'fhem-cms-data/CMS/draft.json'), JSON.stringify(config));
    state = (await act({ op: 'delete', token: state.token, id: document.id })).state;
    assert.equal(state.assets.some(asset => asset.id === document.id), false);
    assert.equal(JSON.parse(await readFile(join(dir, 'fhem-cms-data/CMS/config.json'))).pages[0].widgets.length, 0,
      'asset actions never publish/change Live');
  } finally {
    child.stdin.end();
    assert.equal(await exited, 0, stderr);
    lines.close();
    await rm(dir, { recursive: true, force: true });
  }
});
