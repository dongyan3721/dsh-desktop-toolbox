import test from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeFrame,
  FrameDecoder,
  BridgeError,
  HEADER_LENGTH,
  MAX_FRAME_LENGTH,
  MIN_FRAME_LENGTH,
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

test('encodeFrame rejects out-of-bounds frames', () => {
  assert.throws(
    () => encodeFrame(''),
    (err) => err instanceof BridgeError && err.code === 'PROTOCOL_ERROR'
  );

  assert.throws(
    () => encodeFrame(undefined),
    (err) => err instanceof BridgeError && err.code === 'INVALID_REQUEST'
  );

  const hugePayload = 'a'.repeat(MAX_FRAME_LENGTH + 1);
  assert.throws(
    () => encodeFrame(hugePayload),
    (err) => err instanceof BridgeError && err.code === 'PROTOCOL_ERROR'
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

test('FrameDecoder handles partial frames split across multiple chunks', () => {
  const decoder = new FrameDecoder();
  const payload = { v: 1, type: 'request', id: 'req-split', method: 'notes.search', params: { query: 'test' } };
  const frame = encodeFrame(payload);

  // Split into 1-byte, 2-byte, 5-byte chunks
  const chunk1 = frame.subarray(0, 1); // partial header
  const chunk2 = frame.subarray(1, 3); // partial header
  const chunk3 = frame.subarray(3, 8); // rest of header + start of payload
  const chunk4 = frame.subarray(8); // rest of payload

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

test('FrameDecoder rejects malformed JSON payload', () => {
  const decoder = new FrameDecoder();
  const badJson = Buffer.from('{not-valid-json', 'utf8');
  const frame = Buffer.alloc(4 + badJson.length);
  frame.writeUInt32LE(badJson.length, 0);
  badJson.copy(frame, 4);

  assert.throws(
    () => decoder.push(frame),
    (err) => err instanceof BridgeError && err.code === 'PROTOCOL_ERROR' && err.message.includes('Malformed frame payload')
  );
});

test('FrameDecoder rejects non-object JSON payload', () => {
  const decoder = new FrameDecoder();
  const badPayload = Buffer.from('42', 'utf8');
  const frame = Buffer.alloc(4 + badPayload.length);
  frame.writeUInt32LE(badPayload.length, 0);
  badPayload.copy(frame, 4);

  assert.throws(
    () => decoder.push(frame),
    (err) => err instanceof BridgeError && err.code === 'PROTOCOL_ERROR' && err.message.includes('expected JSON object')
  );
});
