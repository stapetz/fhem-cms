import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractExif, loadAssetExif } from '../www/fhem-cms/js/asset-exif.js';
import { jpegFixture, pngFixture, tiffFixture } from './lib/asset-exif-fixtures.js';

test('EXIF extraction reads JPEG/PNG, both byte orders, nested date and GPS without changing pixels', () => {
  for (const little of [true, false]) {
    for (const wrap of [jpegFixture, pngFixture]) {
      const bytes = wrap(tiffFixture(little));
      const before = bytes.slice();
      const rows = extractExif(bytes);
      assert.deepEqual(rows.map(row => row.value), ['Test Camera', '2026:11:10 12:34:56', '52/1 (52), 30/1 (30), 15/2 (7.5)']);
      assert.match(rows[1].name, /Aufnahmedatum/);
      assert.match(rows[2].name, /GPS: Breitengrad/);
      assert.deepEqual(bytes, before);
    }
  }
  assert.deepEqual(extractExif(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])), []);
  assert.deepEqual(extractExif(new TextEncoder().encode('GIF89a')), []);
});

test('EXIF rejects truncated markers, offsets, IFD cycles and oversized counts explicitly', () => {
  for (const bytes of [
    Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, 0, 0]),
    Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, 0, 99]),
    jpegFixture(Uint8Array.of(0, 0)),
    pngFixture().subarray(0, 40),
  ]) assert.throws(() => extractExif(bytes), /beschädigt/);
  for (const mutate of [
    view => view.setUint32(18, 99999, true),
    view => view.setUint32(46, 8, true),
    view => view.setUint32(14, 0xffffffff, true),
    view => view.setUint16(8, 1025, true),
  ]) {
    const bytes = tiffFixture();
    mutate(new DataView(bytes.buffer));
    assert.throws(() => extractExif(jpegFixture(bytes)), /beschädigt|1024/);
  }
});

test('EXIF loader uses local credentials, reports HTTP errors and supports cancellation', async () => {
  const original = globalThis.fetch;
  try {
    let options;
    globalThis.fetch = async (href, request) => {
      assert.equal(href, `media/${'a'.repeat(32)}.png`);
      options = request;
      return new Response(pngFixture());
    };
    const signal = new AbortController().signal;
    assert.equal((await loadAssetExif(`media/${'a'.repeat(32)}.png`, { signal })).length, 3);
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.signal, signal);
    await assert.rejects(() => loadAssetExif('https://outside.test/a.png'), /Bildadresse/);
    globalThis.fetch = async () => new Response('', { status: 404 });
    await assert.rejects(() => loadAssetExif(`media/${'a'.repeat(32)}.png`), /HTTP 404/);
    let cancelled = false;
    globalThis.fetch = async () => new Response(new ReadableStream({
      pull(controller) { controller.enqueue(new Uint8Array(1048576)); },
      cancel() { cancelled = true; },
    }));
    await assert.rejects(() => loadAssetExif(`media/${'a'.repeat(32)}.png`), /50 MiB/);
    assert.equal(cancelled, true, 'oversized response is cancelled rather than retained');
    globalThis.fetch = async () => { throw new DOMException('Aborted', 'AbortError'); };
    await assert.rejects(() => loadAssetExif(`media/${'a'.repeat(32)}.png`), { name: 'AbortError' });
  } finally { globalThis.fetch = original; }
});
