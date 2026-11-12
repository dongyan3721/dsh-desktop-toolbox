import net from 'node:net';
import crypto from 'node:crypto';
import { BridgeError } from './errors.js';
import { encodeFrame, FrameDecoder } from './framing.js';

/**
 * Connects to the native toolbox Named Pipe server and performs protocol handshake.
 *
 * @param {object} options
 * @param {string} options.pipePath - Full Windows Named Pipe path (e.g. \\.\pipe\dsh-toolbox-<uuid>)
 * @param {string} options.instanceId - Instance UUID to negotiate and verify during handshake
 * @param {AbortSignal} [options.signal] - Optional signal to abort the connection and handshake
 * @param {number} [options.timeoutMs=5000] - Handshake timeout in milliseconds
 * @returns {Promise<{
 *   request: (method: string, params?: any, options?: { signal?: AbortSignal, timeoutMs?: number, onEvent?: (event: object) => void }) => Promise<any>,
 *   close: () => Promise<void>,
 *   capabilities: ReadonlyArray<string>,
 *   readonly isClosed: boolean
 * }>}
 */
export async function connectBridge({ pipePath, instanceId, signal, timeoutMs = 5000 }) {
  if (!pipePath || typeof pipePath !== 'string') {
    throw new BridgeError('pipePath must be a non-empty string', 'INVALID_REQUEST');
  }
  if (!instanceId || typeof instanceId !== 'string') {
    throw new BridgeError('instanceId must be a non-empty string', 'INVALID_REQUEST');
  }

  if (signal?.aborted) {
    const err = new BridgeError(signal.reason?.message || 'Connection aborted', 'CANCELLED');
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

    const failAllPending = (err) => {
      for (const req of activeRequests.values()) {
        req.cleanup();
        req.reject(err);
      }
      activeRequests.clear();
    };

    const failConnection = (err) => {
      if (isClosed) return;
      isClosed = true;
      failAllPending(err);
      if (!socket.destroyed) {
        socket.destroy();
      }
    };

    if (typeof timeoutMs === 'number' && timeoutMs > 0) {
      handshakeTimer = setTimeout(() => {
        cleanupHandshake();
        const err = new BridgeError(`Bridge handshake timed out after ${timeoutMs}ms`, 'TIMEOUT');
        socket.destroy();
        reject(err);
      }, timeoutMs);
    }

    if (signal) {
      handshakeAbortListener = () => {
        cleanupHandshake();
        const err = new BridgeError(signal.reason?.message || 'Bridge connection aborted', 'CANCELLED');
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
          // Expect ready frame
          if (frame.v !== 1) {
            cleanupHandshake();
            socket.destroy();
            return reject(new BridgeError(`Unsupported protocol version: ${frame.v}`, 'HANDSHAKE_FAILED'));
          }

          if (frame.type !== 'ready') {
            cleanupHandshake();
            socket.destroy();
            return reject(new BridgeError(`Expected ready frame, got: ${frame.type}`, 'HANDSHAKE_FAILED'));
          }

          if (frame.instanceId !== instanceId) {
            cleanupHandshake();
            socket.destroy();
            return reject(
              new BridgeError(`Instance ID mismatch: expected ${instanceId}, got ${frame.instanceId}`, 'HANDSHAKE_FAILED')
            );
          }

          if (!Array.isArray(frame.capabilities)) {
            cleanupHandshake();
            socket.destroy();
            return reject(
              new BridgeError('Invalid ready frame: capabilities must be an array of strings', 'HANDSHAKE_FAILED')
            );
          }

          isHandshaken = true;
          capabilities = Object.freeze([...frame.capabilities]);
          cleanupHandshake();
          return resolve(client);
        }

        // Post-handshake messages
        if (frame.type === 'response') {
          if (frame.v !== 1) {
            failConnection(new BridgeError(`Protocol version mismatch in response: ${frame.v}`, 'PROTOCOL_ERROR'));
            return;
          }

          if (typeof frame.id !== 'string') {
            failConnection(new BridgeError('Response missing valid string id', 'PROTOCOL_ERROR'));
            return;
          }

          if (typeof frame.ok !== 'boolean') {
            failConnection(new BridgeError('Malformed response: ok must be a boolean', 'PROTOCOL_ERROR'));
            return;
          }

          const pending = activeRequests.get(frame.id);
          if (!pending) {
            // Already cancelled, timed out, or unknown request. Safe to ignore.
            continue;
          }

          pending.cleanup();
          activeRequests.delete(frame.id);

          if (frame.ok === true) {
            pending.resolve(frame.result);
          } else {
            const errCode = frame.error?.code || 'INTERNAL';
            const errMsg = frame.error?.message || 'Bridge request failed';
            pending.reject(new BridgeError(errMsg, errCode, frame.error?.details));
          }
        } else if (frame.type === 'event') {
          if (frame.v !== 1) {
            failConnection(new BridgeError(`Protocol version mismatch in event: ${frame.v}`, 'PROTOCOL_ERROR'));
            return;
          }

          if (typeof frame.id !== 'string') {
            failConnection(new BridgeError('Event missing valid string id', 'PROTOCOL_ERROR'));
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
        const bridgeErr = new BridgeError(`Connection failed: ${err.message}`, 'DISCONNECTED');
        bridgeErr.cause = err;
        reject(bridgeErr);
      } else {
        const bridgeErr = new BridgeError(`Socket error: ${err.message}`, 'DISCONNECTED');
        bridgeErr.cause = err;
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
     * Executes a request over the bridge and awaits the terminal response.
     */
    async function request(method, params = {}, { signal: reqSignal, timeoutMs: reqTimeoutMs, onEvent } = {}) {
      if (isClosed || socket.destroyed || !socket.writable) {
        throw new BridgeError('Bridge client is closed or disconnected', isClosed ? 'CLOSED' : 'DISCONNECTED');
      }

      if (typeof method !== 'string' || !method) {
        throw new BridgeError('method must be a non-empty string', 'INVALID_REQUEST');
      }

      if (reqSignal?.aborted) {
        const err = new BridgeError(reqSignal.reason?.message || `Request '${method}' cancelled`, 'CANCELLED');
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
        let timer = null;
        let abortHandler = null;

        const cleanup = () => {
          if (timer) {
            clearTimeout(timer);
            timer = null;
          }
          if (abortHandler && reqSignal) {
            reqSignal.removeEventListener('abort', abortHandler);
            abortHandler = null;
          }
        };

        if (typeof reqTimeoutMs === 'number' && reqTimeoutMs > 0) {
          timer = setTimeout(() => {
            sendCancelFrame(id);
            cleanup();
            activeRequests.delete(id);
            rej(new BridgeError(`Request '${method}' timed out after ${reqTimeoutMs}ms`, 'TIMEOUT'));
          }, reqTimeoutMs);
        }

        if (reqSignal) {
          abortHandler = () => {
            sendCancelFrame(id);
            cleanup();
            activeRequests.delete(id);
            const err = new BridgeError(reqSignal.reason?.message || `Request '${method}' cancelled`, 'CANCELLED');
            err.name = 'AbortError';
            rej(err);
          };
          reqSignal.addEventListener('abort', abortHandler, { once: true });
        }

        activeRequests.set(id, {
          resolve: res,
          reject: rej,
          cleanup,
          onEvent,
        });

        socket.write(frame, (err) => {
          if (err) {
            cleanup();
            activeRequests.delete(id);
            rej(new BridgeError(`Failed to send request frame: ${err.message}`, 'DISCONNECTED'));
          }
        });
      });
    }

    /**
     * Idempotently and gracefully closes the bridge connection and rejects pending calls.
     */
    async function close() {
      if (closePromise) {
        return closePromise;
      }

      isClosed = true;

      closePromise = new Promise((res) => {
        // Reject all pending calls
        const closeError = new BridgeError('Bridge client was closed', 'CLOSED');
        failAllPending(closeError);

        if (socket.destroyed || socket.closed) {
          res();
          return;
        }

        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          socket.removeListener('close', finish);
          socket.removeListener('error', finish);
          res();
        };

        socket.once('close', finish);
        socket.once('error', finish);

        socket.end();

        const forceDestroyTimer = setTimeout(() => {
          if (!socket.destroyed) {
            socket.destroy();
          }
          finish();
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
