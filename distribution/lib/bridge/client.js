import net from 'node:net';
import crypto from 'node:crypto';
import { BridgeError } from './errors.js';
import { encodeFrame, FrameDecoder } from './framing.js';
import {
  validateReadyFrame,
  validateResponseFrame,
  validateEventFrame,
  validatePositiveFiniteNumber,
  MAX_ACTIVE_REQUESTS,
} from './validation.js';

/**
 * Connects to the native toolbox Named Pipe server and performs protocol handshake.
 *
 * @param {object} options
 * @param {string} options.pipePath - Full Windows Named Pipe path (e.g. \\.\pipe\dsh-toolbox-<uuid>)
 * @param {string} options.instanceId - Instance UUID to negotiate and verify during handshake
 * @param {AbortSignal} [options.signal] - Optional signal to abort the connection and handshake
 * @param {number} [options.timeoutMs=5000] - Handshake timeout in milliseconds (positive finite number)
 * @param {number} [options.cancelTimeoutMs=1500] - Grace period to await terminal response after cancellation (positive finite number)
 * @returns {Promise<{
 *   request: (method: string, params?: any, options?: { signal?: AbortSignal, timeoutMs?: number, onEvent?: (event: object) => void }) => Promise<any>,
 *   close: () => Promise<void>,
 *   capabilities: ReadonlyArray<string>,
 *   readonly isClosed: boolean
 * }>}
 */
export async function connectBridge({
  pipePath,
  instanceId,
  signal,
  timeoutMs = 5000,
  cancelTimeoutMs = 1500,
}) {
  if (!pipePath || typeof pipePath !== 'string') {
    throw new BridgeError('pipePath must be a non-empty string', 'INVALID_REQUEST');
  }
  if (!instanceId || typeof instanceId !== 'string') {
    throw new BridgeError('instanceId must be a non-empty string', 'INVALID_REQUEST');
  }

  validatePositiveFiniteNumber(timeoutMs, 'timeoutMs');
  validatePositiveFiniteNumber(cancelTimeoutMs, 'cancelTimeoutMs');

  if (signal?.aborted) {
    const err = new BridgeError(signal.reason?.message || 'Connection aborted', 'CANCELLED', {
      causeCode: 'CANCELLED',
    });
    err.name = 'AbortError';
    throw err;
  }

  return new Promise((resolve, reject) => {
    let isHandshaken = false;
    let isClosed = false;
    let closePromise = null;
    let capabilities = [];

    const activeRequests = new Map();
    const decoder = new FrameDecoder();
    const socket = net.connect({ path: pipePath });

    let handshakeTimer = null;
    let handshakeAbortListener = null;

    const cleanupHandshake = () => {
      if (handshakeTimer) {
        clearTimeout(handshakeTimer);
        handshakeTimer = null;
      }
      if (handshakeAbortListener && signal) {
        signal.removeEventListener('abort', handshakeAbortListener);
        handshakeAbortListener = null;
      }
    };

    const failConnection = (err) => {
      if (isClosed) return;
      isClosed = true;

      for (const req of activeRequests.values()) {
        req.cleanup();
        const causeCode = req.state === 'cancelling'
          ? (req.cancelCauseCode || 'DISCONNECTED')
          : 'DISCONNECTED';
        const unknownErr = new BridgeError(
          'Transport disconnected before terminal response received; outcome unknown',
          'OUTCOME_UNKNOWN',
          { causeCode, cause: err }
        );
        req.reject(unknownErr);
      }
      activeRequests.clear();

      if (!socket.destroyed) {
        socket.destroy();
      }
    };

    handshakeTimer = setTimeout(() => {
      cleanupHandshake();
      const err = new BridgeError(`Bridge handshake timed out after ${timeoutMs}ms`, 'TIMEOUT');
      socket.destroy();
      reject(err);
    }, timeoutMs);

    if (signal) {
      handshakeAbortListener = () => {
        cleanupHandshake();
        const err = new BridgeError(signal.reason?.message || 'Bridge connection aborted', 'CANCELLED', {
          causeCode: 'CANCELLED',
        });
        err.name = 'AbortError';
        socket.destroy();
        reject(err);
      };
      signal.addEventListener('abort', handshakeAbortListener, { once: true });
    }

    socket.on('connect', () => {
      try {
        const helloFrame = encodeFrame({
          v: 1,
          type: 'hello',
          instanceId,
        });
        socket.write(helloFrame);
      } catch (err) {
        cleanupHandshake();
        socket.destroy();
        reject(err);
      }
    });

    socket.on('data', (chunk) => {
      let frames;
      try {
        frames = decoder.push(chunk);
      } catch (err) {
        if (!isHandshaken) {
          cleanupHandshake();
          socket.destroy();
          return reject(err);
        }
        return failConnection(err);
      }

      for (const frame of frames) {
        if (!isHandshaken) {
          try {
            validateReadyFrame(frame, instanceId);
          } catch (err) {
            cleanupHandshake();
            socket.destroy();
            return reject(err);
          }

          isHandshaken = true;
          capabilities = Object.freeze([...frame.capabilities]);
          cleanupHandshake();
          resolve(client);
          // Do NOT return here: continue processing subsequent frames in this same data batch!
          continue;
        }

        // Post-handshake frame routing
        if (frame.type === 'response') {
          try {
            validateResponseFrame(frame);
          } catch (err) {
            failConnection(err);
            return;
          }

          const pending = activeRequests.get(frame.id);
          if (!pending) {
            // Late response for an already settled request (e.g. grace expired) or unknown request.
            continue;
          }

          pending.state = 'settled';
          pending.cleanup();
          activeRequests.delete(frame.id);

          if (frame.ok === true) {
            // Authoritative success resolves canonical result, even if cancellation was requested
            pending.resolve(frame.result);
          } else {
            // Server error propagates actual error (including CANCELLED if server acknowledged cancel)
            const errCode = frame.error?.code || 'INTERNAL';
            const errMsg = frame.error?.message || 'Bridge request failed';
            pending.reject(new BridgeError(errMsg, errCode, { details: frame.error?.details }));
          }
        } else if (frame.type === 'event') {
          try {
            validateEventFrame(frame);
          } catch (err) {
            failConnection(err);
            return;
          }

          const pending = activeRequests.get(frame.id);
          if (pending && typeof pending.onEvent === 'function') {
            try {
              pending.onEvent(frame);
            } catch {
              // Ignore event handler errors
            }
          }
        } else {
          failConnection(new BridgeError(`Unexpected frame type: ${frame.type}`, 'PROTOCOL_ERROR'));
          return;
        }
      }
    });

    socket.on('error', (err) => {
      if (!isHandshaken) {
        cleanupHandshake();
        const bridgeErr = new BridgeError(`Connection failed: ${err.message}`, 'DISCONNECTED', { cause: err });
        reject(bridgeErr);
      } else {
        const bridgeErr = new BridgeError(`Socket error: ${err.message}`, 'DISCONNECTED', { cause: err });
        failConnection(bridgeErr);
      }
    });

    socket.on('close', () => {
      if (!isHandshaken) {
        cleanupHandshake();
        reject(new BridgeError('Connection closed before handshake completed', 'DISCONNECTED'));
      } else if (!isClosed) {
        const err = new BridgeError('Bridge connection disconnected', 'DISCONNECTED');
        failConnection(err);
      }
    });

    function sendCancelFrame(id) {
      if (isClosed || socket.destroyed || !socket.writable) return;
      try {
        const cancelFrame = encodeFrame({ v: 1, type: 'cancel', id });
        socket.write(cancelFrame);
      } catch {
        // Ignore failure to write cooperative cancel
      }
    }

    /**
     * Executes a request over the bridge and awaits the authoritative terminal response.
     */
    async function request(method, params = {}, { signal: reqSignal, timeoutMs: reqTimeoutMs, onEvent } = {}) {
      if (isClosed || socket.destroyed || !socket.writable) {
        throw new BridgeError('Bridge client is closed or disconnected', isClosed ? 'CLOSED' : 'DISCONNECTED');
      }

      if (typeof method !== 'string' || !method) {
        throw new BridgeError('method must be a non-empty string', 'INVALID_REQUEST');
      }

      if (reqTimeoutMs !== undefined) {
        validatePositiveFiniteNumber(reqTimeoutMs, 'timeoutMs');
      }

      if (activeRequests.size >= MAX_ACTIVE_REQUESTS) {
        throw new BridgeError('Active request limit exceeded', 'RESOURCE_LIMIT_EXCEEDED');
      }

      // Pre-dispatch cancellation check (guaranteed not executed)
      if (reqSignal?.aborted) {
        const err = new BridgeError(reqSignal.reason?.message || `Request '${method}' cancelled`, 'CANCELLED', {
          causeCode: 'CANCELLED',
        });
        err.name = 'AbortError';
        throw err;
      }

      const id = crypto.randomUUID();

      let frame;
      try {
        frame = encodeFrame({
          v: 1,
          type: 'request',
          id,
          method,
          params: params ?? {},
        });
      } catch (err) {
        throw err;
      }

      return new Promise((res, rej) => {
        const reqEntry = {
          id,
          method,
          resolve: res,
          reject: rej,
          onEvent,
          state: 'active', // 'active' | 'cancelling' | 'settled'
          cancelCauseCode: null,
          requestTimer: null,
          cancelTimer: null,
          abortListener: null,
          cleanup() {
            if (this.requestTimer) {
              clearTimeout(this.requestTimer);
              this.requestTimer = null;
            }
            if (this.cancelTimer) {
              clearTimeout(this.cancelTimer);
              this.cancelTimer = null;
            }
            if (this.abortListener && reqSignal) {
              reqSignal.removeEventListener('abort', this.abortListener);
              this.abortListener = null;
            }
          },
        };

        const triggerCancel = (causeCode) => {
          if (reqEntry.state !== 'active') return;
          reqEntry.state = 'cancelling';
          reqEntry.cancelCauseCode = causeCode;

          // Clear request timeout & remove abort listener
          if (reqEntry.requestTimer) {
            clearTimeout(reqEntry.requestTimer);
            reqEntry.requestTimer = null;
          }
          if (reqEntry.abortListener && reqSignal) {
            reqSignal.removeEventListener('abort', reqEntry.abortListener);
            reqEntry.abortListener = null;
          }

          // Send one cancel frame
          sendCancelFrame(id);

          // Wait up to cancelTimeoutMs for authoritative terminal response
          reqEntry.cancelTimer = setTimeout(() => {
            if (reqEntry.state !== 'cancelling') return;
            reqEntry.state = 'settled';
            reqEntry.cleanup();
            activeRequests.delete(id);

            const outcomeErr = new BridgeError(
              `Request '${method}' outcome unknown: cancellation grace timed out`,
              'OUTCOME_UNKNOWN',
              { causeCode }
            );
            rej(outcomeErr);
            failConnection(outcomeErr);
          }, cancelTimeoutMs);
        };

        if (typeof reqTimeoutMs === 'number') {
          reqEntry.requestTimer = setTimeout(() => {
            triggerCancel('TIMEOUT');
          }, reqTimeoutMs);
        }

        if (reqSignal) {
          reqEntry.abortListener = () => {
            triggerCancel('CANCELLED');
          };
          reqSignal.addEventListener('abort', reqEntry.abortListener, { once: true });
        }

        activeRequests.set(id, reqEntry);

        // Frame is now handed to the transport for dispatch
        socket.write(frame, (err) => {
          if (err) {
            reqEntry.cleanup();
            activeRequests.delete(id);
            // Once handed to write, failure to complete write means outcome is unknown
            rej(
              new BridgeError(
                `Failed to send request frame: ${err.message}; outcome unknown`,
                'OUTCOME_UNKNOWN',
                { causeCode: 'DISCONNECTED', cause: err }
              )
            );
          }
        });
      });
    }

    /**
     * Idempotently closes the bridge connection, waits for the actual socket 'close' event,
     * and clears all timers, listeners, and pending calls.
     */
    async function close() {
      if (closePromise) {
        return closePromise;
      }

      isClosed = true;

      closePromise = new Promise((res) => {
        // Dispatched in-flight calls during close must report OUTCOME_UNKNOWN (causeCode: 'CLOSED')
        for (const req of activeRequests.values()) {
          req.cleanup();
          req.reject(
            new BridgeError('Bridge client was closed; operation outcome unknown', 'OUTCOME_UNKNOWN', {
              causeCode: 'CLOSED',
            })
          );
        }
        activeRequests.clear();

        // If socket already fully closed, resolve immediately
        if (socket.closed) {
          res();
          return;
        }

        let forceDestroyTimer = null;
        let settled = false;

        const finish = () => {
          if (settled) return;
          settled = true;
          if (forceDestroyTimer) {
            clearTimeout(forceDestroyTimer);
            forceDestroyTimer = null;
          }
          socket.removeListener('close', finish);
          socket.removeListener('error', onError);
          res();
        };

        const onError = () => {
          // Do NOT resolve here; ensure destroy is called and await actual 'close'
          if (!socket.destroyed) {
            socket.destroy();
          }
        };

        socket.once('close', finish);
        socket.on('error', onError);

        socket.end();

        forceDestroyTimer = setTimeout(() => {
          if (!socket.destroyed) {
            socket.destroy();
          }
          // Do NOT resolve here; wait for actual socket 'close' event!
        }, 1000);
        forceDestroyTimer.unref?.();
      });

      return closePromise;
    }

    const client = {
      request,
      close,
      get capabilities() {
        return capabilities;
      },
      get isClosed() {
        return isClosed;
      },
    };
  });
}
