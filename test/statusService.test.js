const test = require('node:test');
const assert = require('node:assert/strict');

const { decodeHexToAscii, decodeMetadata } = require('../src/stream/statusService');

test('decodeHexToAscii decodes ASCII hex strings', () => {
  assert.equal(decodeHexToAscii('48656c6c6f20576f726c64'), 'Hello World');
});

test('decodeHexToAscii decodes UTF-8 multibyte characters', () => {
  assert.equal(decodeHexToAscii('e38182f09f8eb5'), 'あ🎵');
});

test('decodeHexToAscii decodes accented UTF-8 artist names', () => {
  assert.equal(decodeHexToAscii('4265796f6e63c3a9'), 'Beyoncé');
});

test('decodeHexToAscii sanitizes whitespace before decoding', () => {
  assert.equal(decodeHexToAscii('48 65 6c 6c 6f'), 'Hello');
});

test('decodeHexToAscii strips null-byte padding after decoding', () => {
  assert.equal(decodeHexToAscii('48656c6c6f0000'), 'Hello');
});

test('decodeHexToAscii returns original for odd-length hex strings', () => {
  assert.equal(decodeHexToAscii('48656c6c6f2'), '48656c6c6f2');
});

test('decodeHexToAscii returns original for invalid hex symbols', () => {
  assert.equal(decodeHexToAscii('48ZZ6c6c6f'), '48ZZ6c6c6f');
});

test('decodeHexToAscii preserves null/undefined/empty semantics', () => {
  assert.equal(decodeHexToAscii(null), null);
  assert.equal(decodeHexToAscii(undefined), undefined);
  assert.equal(decodeHexToAscii(''), '');
});

test('decodeMetadata preserves null/empty semantics for Title/Artist/Album', () => {
  const metadata = decodeMetadata({
    Title: null,
    Artist: '',
    Album: undefined,
    Other: '48656c6c6f'
  });

  assert.equal(metadata.Title, null);
  assert.equal(metadata.Artist, '');
  assert.equal(metadata.Album, undefined);
  assert.equal(metadata.Other, '48656c6c6f');
});

test('decodeMetadata annotates decode errors and preserves original value', () => {
  const metadata = decodeMetadata({
    Title: '48656c6c6f',
    Artist: 'ff',
    Album: '416c62756d'
  });

  assert.equal(metadata.Title, 'Hello');
  assert.equal(metadata.Artist, 'ff');
  assert.equal(metadata.Album, 'Album');
  assert.equal(metadata.decodeError, true);
  assert.deepEqual(metadata.decodeErrors, [{ field: 'Artist', error: 'invalid-utf8' }]);
});
