export { connectBridge } from './client.js';
export { BridgeError } from './errors.js';
export {
  encodeFrame,
  FrameDecoder,
  MIN_FRAME_LENGTH,
  MAX_FRAME_LENGTH,
  HEADER_LENGTH,
} from './framing.js';
export {
  validateReadyFrame,
  validateResponseFrame,
  validateEventFrame,
  validatePositiveFiniteNumber,
  MAX_ACTIVE_REQUESTS,
  MAX_UNMATCHED_CANCELLATIONS,
} from './validation.js';
