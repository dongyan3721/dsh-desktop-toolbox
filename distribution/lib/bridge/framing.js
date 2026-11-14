import { BridgeError } from './errors.js';

export const MIN_FRAME_LENGTH = 1;
export const MAX_FRAME_LENGTH = 4 * 1024 * 1024; // 4 MiB (4,194,304 bytes)
export const HEADER_LENGTH = 4;

const textDecoder = new TextDecoder('utf-8', { fatal: true });
const ESCAPED_SURROGATE_RE = /\\u[dD][89a-fA-F][0-9a-fA-F]{2}/;

function containsUnpairedSurrogates(val) {
  if (typeof val === 'string') {
    return !val.isWellFormed();
  }
  if (typeof val === 'object' && val !== null) {
    if (Array.isArray(val)) {
      for (let i = 0; i < val.length; i++) {
        if (containsUnpairedSurrogates(val[i])) return true;
      }
    } else {
      for (const k of Object.keys(val)) {
        if (containsUnpairedSurrogates(k) || containsUnpairedSurrogates(val[k])) return true;
      }
    }
  }
  return false;
}

/**
 * Encodes a JSON object into a framed Buffer.
 * Frame structure: 4-byte unsigned little-endian length prefix followed by UTF-8 JSON.
 *
 * @param {object} message
 * @returns {Buffer}
 */
export function encodeFrame(message) {
  if (typeof message !== 'object' || message === null || Array.isArray(message)) {
    throw new BridgeError('Message must be a non-null JSON object', 'INVALID_REQUEST');
  }

  if (containsUnpairedSurrogates(message)) {
    throw new BridgeError('Message contains unpaired Unicode surrogates', 'INVALID_REQUEST');
  }

  let jsonStr;
  try {
    jsonStr = JSON.stringify(message);
  } catch (err) {
    throw new BridgeError(`Failed to serialize message to JSON: ${err.message}`, 'INVALID_REQUEST');
  }

  if (ESCAPED_SURROGATE_RE.test(jsonStr)) {
    throw new BridgeError('Message contains unpaired Unicode surrogates', 'INVALID_REQUEST');
  }

  const payloadBuf = Buffer.from(jsonStr, 'utf8');
  const payloadLength = payloadBuf.byteLength;

  if (payloadLength < MIN_FRAME_LENGTH || payloadLength > MAX_FRAME_LENGTH) {
    throw new BridgeError(
      `Frame length ${payloadLength} out of bounds (${MIN_FRAME_LENGTH}..${MAX_FRAME_LENGTH})`,
      'PROTOCOL_ERROR'
    );
  }

  const frameBuf = Buffer.allocUnsafe(HEADER_LENGTH + payloadLength);
  frameBuf.writeUInt32LE(payloadLength, 0);
  payloadBuf.copy(frameBuf, HEADER_LENGTH);
  return frameBuf;
}

/**
 * Streaming decoder for 4-byte unsigned little-endian length prefixed UTF-8 JSON frames.
 * Enforces strict UTF-8 decoding, rejects array/non-object envelopes, and handles partial/coalesced frames.
 */
export class FrameDecoder {
  constructor() {
    this.buffer = Buffer.alloc(0);
  }

  /**
   * Pushes incoming data chunk into the decoder and extracts any complete frames.
   *
   * @param {Buffer|Uint8Array} chunk
   * @returns {Array<object>} Decoded message objects
   * @throws {BridgeError} On framing violations (zero/oversized length, invalid UTF-8, malformed JSON, or non-object envelope)
   */
  push(chunk) {
    if (!chunk || chunk.length === 0) {
      return [];
    }

    const chunkBuf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    this.buffer = this.buffer.length === 0 ? chunkBuf : Buffer.concat([this.buffer, chunkBuf]);

    const frames = [];

    while (this.buffer.length >= HEADER_LENGTH) {
      const payloadLength = this.buffer.readUInt32LE(0);

      if (payloadLength < MIN_FRAME_LENGTH || payloadLength > MAX_FRAME_LENGTH) {
        this.buffer = Buffer.alloc(0);
        throw new BridgeError(
          `Invalid frame length: ${payloadLength} (allowed: ${MIN_FRAME_LENGTH}..${MAX_FRAME_LENGTH})`,
          'PROTOCOL_ERROR'
        );
      }

      const totalLength = HEADER_LENGTH + payloadLength;
      if (this.buffer.length < totalLength) {
        // Incomplete frame, wait for additional chunks
        break;
      }

      const payloadBuf = this.buffer.subarray(HEADER_LENGTH, totalLength);
      this.buffer = this.buffer.subarray(totalLength);

      let text;
      try {
        text = textDecoder.decode(payloadBuf);
      } catch {
        this.buffer = Buffer.alloc(0);
        throw new BridgeError('Malformed frame payload: invalid UTF-8 sequence', 'PROTOCOL_ERROR');
      }

      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        this.buffer = Buffer.alloc(0);
        throw new BridgeError('Malformed frame payload: invalid JSON', 'PROTOCOL_ERROR');
      }

      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        this.buffer = Buffer.alloc(0);
        throw new BridgeError('Frame payload must be a JSON object', 'PROTOCOL_ERROR');
      }

      frames.push(parsed);
    }

    return frames;
  }

  /**
   * Resets internal buffer state.
   */
  reset() {
    this.buffer = Buffer.alloc(0);
  }
}
