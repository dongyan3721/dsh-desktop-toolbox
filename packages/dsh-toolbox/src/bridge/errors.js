/**
 * Bridge error class with stable protocol error codes.
 */
export class BridgeError extends Error {
  /**
   * @param {string} message
   * @param {string} [code='INTERNAL']
   * @param {any} [details]
   */
  constructor(message, code = 'INTERNAL', details = undefined) {
    super(message);
    this.name = 'BridgeError';
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, BridgeError);
    }
  }
}
