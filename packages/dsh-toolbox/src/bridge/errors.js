/**
 * Bridge error class with stable protocol error codes and optional causeCode.
 */
export class BridgeError extends Error {
  /**
   * @param {string} message - Sanitized error message (no credentials or private content)
   * @param {string} [code='INTERNAL'] - Stable error code per protocol
   * @param {object} [options] - Additional error options
   * @param {string} [options.causeCode] - Underlying cause code (e.g. CANCELLED, TIMEOUT, DISCONNECTED)
   * @param {any} [options.details] - Structured error details
   * @param {Error} [options.cause] - Original error cause
   */
  constructor(message, code = 'INTERNAL', options = undefined) {
    super(message);
    this.name = 'BridgeError';
    this.code = code;

    if (options && typeof options === 'object') {
      if (options.causeCode !== undefined) {
        this.causeCode = options.causeCode;
      }
      if (options.details !== undefined) {
        this.details = options.details;
      }
      if (options.cause !== undefined) {
        this.cause = options.cause;
      }
    }

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, BridgeError);
    }
  }
}
