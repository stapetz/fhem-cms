import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectImage, fetchEditableImage } from '../www/fhem-cms/js/asset-image.js';
import { pngFixture } from './lib/asset-exif-fixtures.js';

const gif = Uint8Array.from(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'));
const png = Uint8Array.from(pngFixture());
const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0, 11, 8, 0, 20, 0, 10, 1, 1, 0x11, 0, 0xff, 0xd9]);

test('image inspection permits bounded static images and rejects animations and malformed input', () => {
  assert.deepEqual(inspectImage(png), { width: 1, height: 1, type: 'image/png' });
  assert.deepEqual(inspectImage(gif), { width: 1, height: 1, type: 'image/gif' });
  assert.deepEqual(inspectImage(jpeg), { width: 10, height: 20, type: 'image/jpeg' });
  const imageStart = gif.indexOf(0x2c);
  const animatedGif = Uint8Array.from([...gif.slice(0, -1), ...gif.slice(imageStart, -1), 0x3b]);
  assert.throws(() => inspectImage(animatedGif), /Animierte GIFs/);
  const animatedPng = Uint8Array.from([...png.slice(0, 33), 0, 0, 0, 0, 0x61, 0x63, 0x54, 0x4c, 0, 0, 0, 0, ...png.slice(33)]);
  assert.throws(() => inspectImage(animatedPng), /Animierte Bilder/);
  for (const bytes of [gif.slice(0, -2), png.slice(0, -1), jpeg.slice(0, 8)]) assert.throws(() => inspectImage(bytes));
  const large = Uint8Array.from(png);
  new DataView(large.buffer).setUint32(16, 8193);
  assert.throws(() => inspectImage(large), /Bearbeitungsgrenze/);
  new DataView(large.buffer).setUint32(16, 5000);
  new DataView(large.buffer).setUint32(20, 5000);
  assert.throws(() => inspectImage(large), /16 Megapixel/);
  const oversizedFrame = Uint8Array.from(gif);
  oversizedFrame[imageStart + 5] = 2;
  assert.throws(() => inspectImage(oversizedFrame), /beschädigt/);
});

test('fetch requires matching catalog size and reports failures', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(png, { status: 200 });
    const image = await fetchEditableImage({ image: true, bytes: png.length, href: 'media/test.png' });
    assert.equal(image.type, 'image/png');
    assert.equal(image.blob.size, png.length);
    await assert.rejects(fetchEditableImage({ image: true, bytes: png.length - 1 }), /größer/);
    await assert.rejects(fetchEditableImage({ image: true, bytes: png.length + 1 }), /stimmt nicht/);
    globalThis.fetch = async () => new Response('', { status: 404 });
    await assert.rejects(fetchEditableImage({ image: true, bytes: 1 }), /nicht geladen/);
  } finally { globalThis.fetch = original; }
});
