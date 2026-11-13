import test from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeFrame,
  FrameDecoder,
  BridgeError,
  HEADER_LENGTH,
  MAX_FRAME_LENGTH,
} from '../src/bridge/index.js';

test('encodeFrame produces valid 4-byte unsigned LE length header followed by UTF-8 JSON', () => {
  const payload = { v: 1, type: 'hello', instanceId: 'test-uuid-1' };
  const encoded = encodeFrame(payload);

  assert.ok(encoded.length > HEADER_LENGTH);
  const lengthHeader = encoded.readUInt32LE(0);
  assert.equal(lengthHeader, encoded.length - HEADER_LENGTH);

  const parsed = JSON.parse(encoded.subarray(HEADER_LENGTH).toString('utf8'));
  assert.deepEqual(parsed, payload);
});

test('encodeFrame rejects invalid input types and out-of-bounds frames', () => {
  assert.throws(
    () => encodeFrame(''),
    (err) => err instanceof BridgeError && err.code === 'INVALID_REQUEST'
  );

  assert.throws(
    () => encodeFrame(undefined),
    (err) => err instanceof BridgeError && err.code === 'INVALID_REQUEST'
  );

  assert.throws(
    () => encodeFrame([1, 2, 3]),
    (err) => err instanceof BridgeError && err.code === 'INVALID_REQUEST'
  );

  assert.throws(
    () => encodeFrame(null),
    (err) => err instanceof BridgeError && err.code === 'INVALID_REQUEST'
  );

  const hugePayload = { big: 'a'.repeat(MAX_FRAME_LENGTH + 1) };
  assert.throws(
    () => encodeFrame(hugePayload),
    (err) => err instanceof BridgeError && err.code === 'PROTOCOL_ERROR'
  );
});

test('encodeFrame rejects unpaired Unicode surrogates', () => {
  // \uD800 without low surrogate
  const badObj = { text: 'bad \uD800 string' };
  assert.throws(
    () => encodeFrame(badObj),
    (err) => err instanceof BridgeError && err.code === 'INVALID_REQUEST' && err.message.includes('surrogate')
  );
});

test('FrameDecoder handles single complete frame', () => {
  const decoder = new FrameDecoder();
  const payload = { v: 1, type: 'ready', instanceId: 'inst-1', capabilities: ['status'] };
  const frame = encodeFrame(payload);

  const decoded = decoder.push(frame);
  assert.equal(decoded.length, 1);
  assert.deepEqual(decoded[0], payload);
});

test('FrameDecoder handles partial frames split across multibyte UTF-8 boundaries', () => {
  const decoder = new FrameDecoder();
  // Chinese character '中' is 3 bytes in UTF-8: 0xE4 0xB8 0xAD
  const payload = { v: 1, type: 'request', id: 'req-split', method: 'notes.search', params: { query: '中文测试' } };
  const frame = encodeFrame(payload);

  // Split chunks right in the middle of UTF-8 characters and header
  const chunk1 = frame.subarray(0, 2); // partial header
  const chunk2 = frame.subarray(2, 4); // rest of header
  const chunk3 = frame.subarray(4, 25); // partial payload (splitting multibyte)
  const chunk4 = frame.subarray(25); // rest of payload

  assert.deepEqual(decoder.push(chunk1), []);
  assert.deepEqual(decoder.push(chunk2), []);
  assert.deepEqual(decoder.push(chunk3), []);
  const result = decoder.push(chunk4);

  assert.equal(result.length, 1);
  assert.deepEqual(result[0], payload);
});

test('FrameDecoder handles coalesced frames in a single chunk', () => {
  const decoder = new FrameDecoder();
  const msg1 = { v: 1, type: 'response', id: '1', ok: true, result: { a: 1 } };
  const msg2 = { v: 1, type: 'response', id: '2', ok: true, result: { b: 2 } };
  const msg3 = { v: 1, type: 'event', id: '3', event: 'progress', data: { step: 1 } };

  const combined = Buffer.concat([encodeFrame(msg1), encodeFrame(msg2), encodeFrame(msg3)]);
  const decoded = decoder.push(combined);

  assert.equal(decoded.length, 3);
  assert.deepEqual(decoded[0], msg1);
  assert.deepEqual(decoded[1], msg2);
  assert.deepEqual(decoded[2], msg3);
});

test('FrameDecoder rejects zero-length frame header', () => {
  const decoder = new FrameDecoder();
  const badHeader = Buffer.alloc(4);
  badHeader.writeUInt32LE(0, 0);

  assert.throws(
    () => decoder.push(badHeader),
    (err) => err instanceof BridgeError && err.code === 'PROTOCOL_ERROR' && err.message.includes('0')
  );
});

test('FrameDecoder rejects oversized frame header exceeding 4MiB', () => {
  const decoder = new FrameDecoder();
  const badHeader = Buffer.alloc(4);
  badHeader.writeUInt32LE(MAX_FRAME_LENGTH + 1, 0);

  assert.throws(
    () => decoder.push(badHeader),
    (err) => err instanceof BridgeError && err.code === 'PROTOCOL_ERROR' && err.message.includes('Invalid frame length')
  );
});

test('FrameDecoder rejects invalid UTF-8 sequence with fatal decoder', () => {
  const decoder = new FrameDecoder();
  // 0xFF is an illegal UTF-8 byte
  const invalidUtf8 = Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]);
  const frame = Buffer.alloc(4 + invalidUtf8.length);
  frame.writeUInt32LE(invalidUtf8.length, 0);
  invalidUtf8.copy(frame, 4);

  assert.throws(
    () => decoder.push(frame),
    (err) => err instanceof BridgeError && err.code === 'PROTOCOL_ERROR' && err.message === 'Malformed frame payload: invalid UTF-8 sequence'
  );
});

test('FrameDecoder rejects malformed JSON payload without echoing private contents', () => {
  const decoder = new FrameDecoder();
  const badJson = Buffer.from('{not-valid-json-secret-123', 'utf8');
  const frame = Buffer.alloc(4 + badJson.length);
  frame.writeUInt32LE(badJson.length, 0);
  badJson.copy(frame, 4);

  assert.throws(
    () => decoder.push(frame),
    (err) =>
      err instanceof BridgeError &&
      err.code === 'PROTOCOL_ERROR' &&
      err.message === 'Malformed frame payload: invalid JSON' &&
      !err.message.includes('secret-123')
  );
});

test('FrameDecoder rejects JSON array envelopes', () => {
  const decoder = new FrameDecoder();
  const arrayPayload = Buffer.from('[{"v":1,"type":"ready"}]', 'utf8');
  const frame = Buffer.alloc(4 + arrayPayload.length);
  frame.writeUInt32LE(arrayPayload.length, 0);
  arrayPayload.copy(frame, 4);

  assert.throws(
    () => decoder.push(frame),
    (err) =>
      err instanceof BridgeError &&
      err.code === 'PROTOCOL_ERROR' &&
      err.message === 'Frame payload must be a JSON object'
  );
});

test('FrameDecoder rejects non-object JSON primitive payloads', () => {
  const decoder = new FrameDecoder();
  const badPayload = Buffer.from('"just-a-string"', 'utf8');
  const frame = Buffer.alloc(4 + badPayload.length);
  frame.writeUInt32LE(badPayload.length, 0);
  badPayload.copy(frame, 4);

  assert.throws(
    () => decoder.push(frame),
    (err) =>
      err instanceof BridgeError &&
      err.code === 'PROTOCOL_ERROR' &&
      err.message === 'Frame payload must be a JSON object'
  );
});
