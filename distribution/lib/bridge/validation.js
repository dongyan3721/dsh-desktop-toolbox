import { BridgeError } from './errors.js';

export const MAX_ACTIVE_REQUESTS = 32;
export const MAX_UNMATCHED_CANCELLATIONS = 1000;

/**
 * Validates that a number is a positive finite number.
 * @param {any} value
 * @param {string} name
 * @returns {number}
 */
export function validatePositiveFiniteNumber(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new BridgeError(`${name} must be a positive finite number`, 'INVALID_REQUEST');
  }
  return value;
}

/**
 * Validates that an object has no keys other than allowedKeys.
 * @param {object} obj
 * @param {string[]} allowedKeys
 * @param {string} errorMsg
 * @param {string} [code='PROTOCOL_ERROR']
 */
function assertExactKeys(obj, allowedKeys, errorMsg, code = 'PROTOCOL_ERROR') {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      throw new BridgeError(errorMsg, code);
    }
  }
}

/**
 * Validates a server ready frame.
 * @param {any} frame
 * @param {string} expectedInstanceId
 */
export function validateReadyFrame(frame, expectedInstanceId) {
  if (typeof frame !== 'object' || frame === null || Array.isArray(frame)) {
    throw new BridgeError('Ready frame must be a JSON object', 'HANDSHAKE_FAILED');
  }

  assertExactKeys(
    frame,
    ['v', 'type', 'instanceId', 'capabilities'],
    'Unknown fields in ready frame',
    'HANDSHAKE_FAILED'
  );

  if (frame.v !== 1) {
    throw new BridgeError(`Unsupported protocol version: ${frame.v}`, 'HANDSHAKE_FAILED');
  }

  if (frame.type !== 'ready') {
    throw new BridgeError(`Expected ready frame, got: ${frame.type}`, 'HANDSHAKE_FAILED');
  }

  if (typeof frame.instanceId !== 'string' || !frame.instanceId) {
    throw new BridgeError('Ready frame missing valid instanceId', 'HANDSHAKE_FAILED');
  }

  if (frame.instanceId !== expectedInstanceId) {
    throw new BridgeError('Instance ID mismatch', 'HANDSHAKE_FAILED');
  }

  if (!Array.isArray(frame.capabilities)) {
    throw new BridgeError('Ready frame capabilities must be an array', 'HANDSHAKE_FAILED');
  }

  const seen = new Set();
  for (const cap of frame.capabilities) {
    if (typeof cap !== 'string' || cap.length === 0) {
      throw new BridgeError('Ready frame capabilities must be non-empty strings', 'HANDSHAKE_FAILED');
    }
    if (seen.has(cap)) {
      throw new BridgeError(`Duplicate capability in ready frame: ${cap}`, 'HANDSHAKE_FAILED');
    }
    seen.add(cap);
  }
}

/**
 * Validates a server response frame.
 * @param {any} frame
 */
export function validateResponseFrame(frame) {
  if (typeof frame !== 'object' || frame === null || Array.isArray(frame)) {
    throw new BridgeError('Response frame must be a JSON object', 'PROTOCOL_ERROR');
  }

  if (frame.v !== 1) {
    throw new BridgeError(`Unsupported protocol version in response: ${frame.v}`, 'PROTOCOL_ERROR');
  }

  if (frame.type !== 'response') {
    throw new BridgeError(`Expected response frame, got: ${frame.type}`, 'PROTOCOL_ERROR');
  }

  if (typeof frame.id !== 'string' || frame.id.length === 0) {
    throw new BridgeError('Response frame missing valid string id', 'PROTOCOL_ERROR');
  }

  if (typeof frame.ok !== 'boolean') {
    throw new BridgeError('Response frame ok must be a boolean', 'PROTOCOL_ERROR');
  }

  if (frame.ok === true) {
    assertExactKeys(
      frame,
      ['v', 'type', 'id', 'ok', 'result'],
      'Success response contains invalid or unknown fields'
    );
    if (!('result' in frame)) {
      throw new BridgeError('Success response missing result field', 'PROTOCOL_ERROR');
    }
    if ('error' in frame) {
      throw new BridgeError('Success response cannot contain error field', 'PROTOCOL_ERROR');
    }
  } else {
    assertExactKeys(
      frame,
      ['v', 'type', 'id', 'ok', 'error'],
      'Error response contains invalid or unknown fields'
    );
    if (!('error' in frame)) {
      throw new BridgeError('Error response missing error field', 'PROTOCOL_ERROR');
    }
    if ('result' in frame) {
      throw new BridgeError('Error response cannot contain result field', 'PROTOCOL_ERROR');
    }
    if (typeof frame.error !== 'object' || frame.error === null || Array.isArray(frame.error)) {
      throw new BridgeError('Error response error field must be an object', 'PROTOCOL_ERROR');
    }
    if (typeof frame.error.code !== 'string' || frame.error.code.length === 0) {
      throw new BridgeError('Error response error.code must be a non-empty string', 'PROTOCOL_ERROR');
    }
    if (typeof frame.error.message !== 'string') {
      throw new BridgeError('Error response error.message must be a string', 'PROTOCOL_ERROR');
    }
  }
}

/**
 * Validates a server event frame.
 * @param {any} frame
 */
export function validateEventFrame(frame) {
  if (typeof frame !== 'object' || frame === null || Array.isArray(frame)) {
    throw new BridgeError('Event frame must be a JSON object', 'PROTOCOL_ERROR');
  }

  assertExactKeys(
    frame,
    ['v', 'type', 'id', 'event', 'data'],
    'Event frame contains unknown fields'
  );

  if (frame.v !== 1) {
    throw new BridgeError(`Unsupported protocol version in event: ${frame.v}`, 'PROTOCOL_ERROR');
  }

  if (frame.type !== 'event') {
    throw new BridgeError(`Expected event frame, got: ${frame.type}`, 'PROTOCOL_ERROR');
  }

  if (typeof frame.id !== 'string' || frame.id.length === 0) {
    throw new BridgeError('Event frame missing valid string id', 'PROTOCOL_ERROR');
  }

  if (typeof frame.event !== 'string' || frame.event.length === 0) {
    throw new BridgeError('Event frame missing valid event string', 'PROTOCOL_ERROR');
  }

  if (!('data' in frame)) {
    throw new BridgeError('Event frame missing data field', 'PROTOCOL_ERROR');
  }
}
