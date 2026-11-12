import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import crypto from 'node:crypto';
import { getEventListeners } from 'node:events';
import {
  connectBridge,
  BridgeError,
  encodeFrame,
  FrameDecoder,
} from '../src/bridge/index.js';

function createPipeServer() {
  const pipePath = `\\\\.\\pipe\\dsh-test-pipe-${crypto.randomUUID()}`;
  let serverSocket = null;
  const connections = new Set();

  const server = net.createServer((socket) => {
    serverSocket = socket;
    connections.add(socket);
    socket.on('close', () => connections.delete(socket));
  });

  const listenPromise = new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(pipePath, () => resolve());
  });

  return {
    pipePath,
    server,
    ready: () => listenPromise,
    getSocket: () => serverSocket,
    waitForConnection: () =>
      new Promise((resolve) => {
        if (serverSocket && !serverSocket.destroyed) {
          resolve(serverSocket);
        } else {
          server.once('connection', (sock) => resolve(sock));
        }
      }),
    close: async () => {
      for (const sock of connections) {
        sock.destroy();
      }
      connections.clear();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

test('successful connection, handshake, and capabilities exchange', async () => {
  const fixture = createPipeServer();
  await fixture.ready();
  const instanceId = crypto.randomUUID();

  fixture.server.on('connection', (socket) => {
    const decoder = new FrameDecoder();
    socket.on('data', (chunk) => {
      for (const frame of decoder.push(chunk)) {
        if (frame.type === 'hello') {
          assert.equal(frame.v, 1);
          assert.equal(frame.instanceId, instanceId);
          socket.write(
            encodeFrame({
              v: 1,
              type: 'ready',
              instanceId,
              capabilities: ['status', 'notes.create', 'notes.search'],
            })
          );
        }
      }
    });
  });

  try {
    const bridge = await connectBridge({ pipePath: fixture.pipePath, instanceId });
    assert.equal(bridge.isClosed, false);
    assert.deepEqual([...bridge.capabilities], ['status', 'notes.create', 'notes.search']);
    await bridge.close();
  } finally {
    await fixture.close();
  }
});

test('handshake failure on version mismatch', async () => {
  const fixture = createPipeServer();
  await fixture.ready();
  const instanceId = crypto.randomUUID();

  fixture.server.on('connection', (socket) => {
    const decoder = new FrameDecoder();
    socket.on('data', (chunk) => {
      for (const frame of decoder.push(chunk)) {
        if (frame.type === 'hello') {
          // Send bad version
          socket.write(
            encodeFrame({
              v: 2,
              type: 'ready',
              instanceId,
              capabilities: ['status'],
            })
          );
        }
      }
    });
  });

  try {
    await assert.rejects(
      connectBridge({ pipePath: fixture.pipePath, instanceId }),
      (err) => err instanceof BridgeError && err.code === 'HANDSHAKE_FAILED' && err.message.includes('version')
    );
  } finally {
    await fixture.close();
  }
});

test('handshake failure on instanceId mismatch', async () => {
  const fixture = createPipeServer();
  await fixture.ready();
  const instanceId = crypto.randomUUID();

  fixture.server.on('connection', (socket) => {
    const decoder = new FrameDecoder();
    socket.on('data', (chunk) => {
      for (const frame of decoder.push(chunk)) {
        if (frame.type === 'hello') {
          // Wrong instance ID
          socket.write(
            encodeFrame({
              v: 1,
              type: 'ready',
              instanceId: 'wrong-instance-id',
              capabilities: ['status'],
            })
          );
        }
      }
    });
  });

  try {
    await assert.rejects(
      connectBridge({ pipePath: fixture.pipePath, instanceId }),
      (err) => err instanceof BridgeError && err.code === 'HANDSHAKE_FAILED' && err.message.includes('mismatch')
    );
  } finally {
    await fixture.close();
  }
});

test('handshake failure when server responds with non-ready frame', async () => {
  const fixture = createPipeServer();
  await fixture.ready();
  const instanceId = crypto.randomUUID();

  fixture.server.on('connection', (socket) => {
    const decoder = new FrameDecoder();
    socket.on('data', (chunk) => {
      for (const frame of decoder.push(chunk)) {
        if (frame.type === 'hello') {
          socket.write(
            encodeFrame({
              v: 1,
              type: 'error',
              instanceId,
            })
          );
        }
      }
    });
  });

  try {
    await assert.rejects(
      connectBridge({ pipePath: fixture.pipePath, instanceId }),
      (err) => err instanceof BridgeError && err.code === 'HANDSHAKE_FAILED' && err.message.includes('Expected ready')
    );
  } finally {
    await fixture.close();
  }
});

test('handshake timeout when server never responds', async () => {
  const fixture = createPipeServer();
  await fixture.ready();
  const instanceId = crypto.randomUUID();

  // Accept socket but do not write ready
  try {
    await assert.rejects(
      connectBridge({ pipePath: fixture.pipePath, instanceId, timeoutMs: 60 }),
      (err) => err instanceof BridgeError && err.code === 'TIMEOUT' && err.message.includes('timed out')
    );
  } finally {
    await fixture.close();
  }
});

test('handshake aborted via AbortSignal', async () => {
  const fixture = createPipeServer();
  await fixture.ready();
  const instanceId = crypto.randomUUID();

  const controller = new AbortController();
  // Abort shortly after connecting
  setTimeout(() => controller.abort(), 20);

  try {
    await assert.rejects(
      connectBridge({ pipePath: fixture.pipePath, instanceId, signal: controller.signal }),
      (err) => err.name === 'AbortError' && err.code === 'CANCELLED'
    );
  } finally {
    await fixture.close();
  }
});

test('request and response roundtrip with ok: true', async () => {
  const fixture = createPipeServer();
  await fixture.ready();
  const instanceId = crypto.randomUUID();

  fixture.server.on('connection', (socket) => {
    const decoder = new FrameDecoder();
    socket.on('data', (chunk) => {
      for (const frame of decoder.push(chunk)) {
        if (frame.type === 'hello') {
          socket.write(encodeFrame({ v: 1, type: 'ready', instanceId, capabilities: ['notes.create'] }));
        } else if (frame.type === 'request') {
          assert.equal(frame.method, 'notes.create');
          assert.deepEqual(frame.params, { title: 'Note 1', content_md: 'Body', open: false });
          socket.write(
            encodeFrame({
              v: 1,
              type: 'response',
              id: frame.id,
              ok: true,
              result: { id: 'note-uuid-1', title: 'Note 1' },
            })
          );
        }
      }
    });
  });

  try {
    const bridge = await connectBridge({ pipePath: fixture.pipePath, instanceId });
    const res = await bridge.request('notes.create', { title: 'Note 1', content_md: 'Body', open: false });
    assert.deepEqual(res, { id: 'note-uuid-1', title: 'Note 1' });
    await bridge.close();
  } finally {
    await fixture.close();
  }
});

test('request and response error with ok: false maps to BridgeError with stable code', async () => {
  const fixture = createPipeServer();
  await fixture.ready();
  const instanceId = crypto.randomUUID();

  fixture.server.on('connection', (socket) => {
    const decoder = new FrameDecoder();
    socket.on('data', (chunk) => {
      for (const frame of decoder.push(chunk)) {
        if (frame.type === 'hello') {
          socket.write(encodeFrame({ v: 1, type: 'ready', instanceId, capabilities: ['notes.create'] }));
        } else if (frame.type === 'request') {
          socket.write(
            encodeFrame({
              v: 1,
              type: 'response',
              id: frame.id,
              ok: false,
              error: { code: 'UNSUPPORTED', message: 'open:true not supported in first wave' },
            })
          );
        }
      }
    });
  });

  try {
    const bridge = await connectBridge({ pipePath: fixture.pipePath, instanceId });
    await assert.rejects(
      bridge.request('notes.create', { open: true }),
      (err) =>
        err instanceof BridgeError &&
        err.code === 'UNSUPPORTED' &&
        err.message.includes('open:true not supported')
    );
    await bridge.close();
  } finally {
    await fixture.close();
  }
});

test('concurrent requests maintain ID mapping and resolve correctly out of order', async () => {
  const fixture = createPipeServer();
  await fixture.ready();
  const instanceId = crypto.randomUUID();

  const receivedRequests = [];

  fixture.server.on('connection', (socket) => {
    const decoder = new FrameDecoder();
    socket.on('data', (chunk) => {
      for (const frame of decoder.push(chunk)) {
        if (frame.type === 'hello') {
          socket.write(encodeFrame({ v: 1, type: 'ready', instanceId, capabilities: ['test'] }));
        } else if (frame.type === 'request') {
          receivedRequests.push(frame);
          if (receivedRequests.length === 3) {
            // Respond in reverse order: 2, 1, 0
            for (let i = 2; i >= 0; i--) {
              const req = receivedRequests[i];
              socket.write(
                encodeFrame({
                  v: 1,
                  type: 'response',
                  id: req.id,
                  ok: true,
                  result: { index: req.params.index, echo: req.params.val },
                })
              );
            }
          }
        }
      }
    });
  });

  try {
    const bridge = await connectBridge({ pipePath: fixture.pipePath, instanceId });
    const promises = [
      bridge.request('test', { index: 0, val: 'zero' }),
      bridge.request('test', { index: 1, val: 'one' }),
      bridge.request('test', { index: 2, val: 'two' }),
    ];

    const results = await Promise.all(promises);
    assert.deepEqual(results[0], { index: 0, echo: 'zero' });
    assert.deepEqual(results[1], { index: 1, echo: 'one' });
    assert.deepEqual(results[2], { index: 2, echo: 'two' });
    await bridge.close();
  } finally {
    await fixture.close();
  }
});

test('request cancellation sends cancel frame and rejects with CANCELLED/AbortError', async () => {
  const fixture = createPipeServer();
  await fixture.ready();
  const instanceId = crypto.randomUUID();

  let serverSocket = null;
  let receivedCancelId = null;

  fixture.server.on('connection', (socket) => {
    serverSocket = socket;
    const decoder = new FrameDecoder();
    socket.on('data', (chunk) => {
      for (const frame of decoder.push(chunk)) {
        if (frame.type === 'hello') {
          socket.write(encodeFrame({ v: 1, type: 'ready', instanceId, capabilities: ['long_op'] }));
        } else if (frame.type === 'cancel') {
          receivedCancelId = frame.id;
          // Send delayed response to verify client ignores late response safely
          socket.write(
            encodeFrame({
              v: 1,
              type: 'response',
              id: frame.id,
              ok: false,
              error: { code: 'CANCELLED', message: 'Operation cancelled' },
            })
          );
        }
      }
    });
  });

  try {
    const bridge = await connectBridge({ pipePath: fixture.pipePath, instanceId });
    const controller = new AbortController();

    const reqPromise = bridge.request('long_op', {}, { signal: controller.signal });
    // Abort active request
    controller.abort();

    await assert.rejects(reqPromise, (err) => err.name === 'AbortError' && err.code === 'CANCELLED');
    // Allow roundtrip to receive cancel frame on server
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(receivedCancelId !== null);

    await bridge.close();
  } finally {
    await fixture.close();
  }
});

test('pre-aborted signal rejects immediately without sending request frame', async () => {
  const fixture = createPipeServer();
  await fixture.ready();
  const instanceId = crypto.randomUUID();

  let requestFrameCount = 0;

  fixture.server.on('connection', (socket) => {
    const decoder = new FrameDecoder();
    socket.on('data', (chunk) => {
      for (const frame of decoder.push(chunk)) {
        if (frame.type === 'hello') {
          socket.write(encodeFrame({ v: 1, type: 'ready', instanceId, capabilities: ['status'] }));
        } else if (frame.type === 'request') {
          requestFrameCount++;
        }
      }
    });
  });

  try {
    const bridge = await connectBridge({ pipePath: fixture.pipePath, instanceId });
    const abortedSignal = AbortSignal.abort();

    await assert.rejects(
      bridge.request('status', {}, { signal: abortedSignal }),
      (err) => err.name === 'AbortError' && err.code === 'CANCELLED'
    );

    assert.equal(requestFrameCount, 0);
    await bridge.close();
  } finally {
    await fixture.close();
  }
});

test('request timeout sends cancel frame and rejects with TIMEOUT', async () => {
  const fixture = createPipeServer();
  await fixture.ready();
  const instanceId = crypto.randomUUID();

  let receivedCancelId = null;

  fixture.server.on('connection', (socket) => {
    const decoder = new FrameDecoder();
    socket.on('data', (chunk) => {
      for (const frame of decoder.push(chunk)) {
        if (frame.type === 'hello') {
          socket.write(encodeFrame({ v: 1, type: 'ready', instanceId, capabilities: ['hang'] }));
        } else if (frame.type === 'cancel') {
          receivedCancelId = frame.id;
        }
      }
    });
  });

  try {
    const bridge = await connectBridge({ pipePath: fixture.pipePath, instanceId });
    await assert.rejects(
      bridge.request('hang', {}, { timeoutMs: 50 }),
      (err) => err instanceof BridgeError && err.code === 'TIMEOUT' && err.message.includes('timed out')
    );

    await new Promise((r) => setTimeout(r, 50));
    assert.ok(receivedCancelId !== null);
    await bridge.close();
  } finally {
    await fixture.close();
  }
});

test('server sudden disconnection rejects pending requests with DISCONNECTED', async () => {
  const fixture = createPipeServer();
  await fixture.ready();
  const instanceId = crypto.randomUUID();

  let serverSocket = null;

  fixture.server.on('connection', (socket) => {
    serverSocket = socket;
    const decoder = new FrameDecoder();
    socket.on('data', (chunk) => {
      for (const frame of decoder.push(chunk)) {
        if (frame.type === 'hello') {
          socket.write(encodeFrame({ v: 1, type: 'ready', instanceId, capabilities: ['test'] }));
        } else if (frame.type === 'request') {
          // Abruptly destroy socket
          socket.destroy();
        }
      }
    });
  });

  try {
    const bridge = await connectBridge({ pipePath: fixture.pipePath, instanceId });
    await assert.rejects(
      bridge.request('test', {}),
      (err) => err instanceof BridgeError && err.code === 'DISCONNECTED'
    );

    // Subsequent call rejects immediately
    await assert.rejects(
      bridge.request('test', {}),
      (err) => err instanceof BridgeError && (err.code === 'DISCONNECTED' || err.code === 'CLOSED')
    );

    await bridge.close();
  } finally {
    await fixture.close();
  }
});

test('close() is idempotent, rejects pending requests with CLOSED, and cleans up', async () => {
  const fixture = createPipeServer();
  await fixture.ready();
  const instanceId = crypto.randomUUID();

  fixture.server.on('connection', (socket) => {
    const decoder = new FrameDecoder();
    socket.on('data', (chunk) => {
      for (const frame of decoder.push(chunk)) {
        if (frame.type === 'hello') {
          socket.write(encodeFrame({ v: 1, type: 'ready', instanceId, capabilities: ['test'] }));
        }
      }
    });
  });

  try {
    const bridge = await connectBridge({ pipePath: fixture.pipePath, instanceId });
    // Start pending request and attach assertion
    const pendingReq = bridge.request('test', {});
    const pendingAssertion = assert.rejects(
      pendingReq,
      (err) => err instanceof BridgeError && err.code === 'CLOSED'
    );

    // Close while request is pending
    const closePromise1 = bridge.close();
    const closePromise2 = bridge.close();

    // Idempotent close
    await Promise.all([closePromise1, closePromise2]);
    assert.equal(bridge.isClosed, true);

    await pendingAssertion;

    // Calls after close reject with CLOSED
    await assert.rejects(
      bridge.request('test', {}),
      (err) => err instanceof BridgeError && err.code === 'CLOSED'
    );
  } finally {
    await fixture.close();
  }
});

test('progress event delivery to onEvent callback', async () => {
  const fixture = createPipeServer();
  await fixture.ready();
  const instanceId = crypto.randomUUID();

  fixture.server.on('connection', (socket) => {
    const decoder = new FrameDecoder();
    socket.on('data', (chunk) => {
      for (const frame of decoder.push(chunk)) {
        if (frame.type === 'hello') {
          socket.write(encodeFrame({ v: 1, type: 'ready', instanceId, capabilities: ['media.convert_image'] }));
        } else if (frame.type === 'request') {
          // Send progress event
          socket.write(
            encodeFrame({
              v: 1,
              type: 'event',
              id: frame.id,
              event: 'progress',
              data: { percent: 50 },
            })
          );
          // Then send terminal response
          setTimeout(() => {
            socket.write(
              encodeFrame({
                v: 1,
                type: 'response',
                id: frame.id,
                ok: true,
                result: { outputPath: 'out.png', format: 'png' },
              })
            );
          }, 30);
        }
      }
    });
  });

  try {
    const bridge = await connectBridge({ pipePath: fixture.pipePath, instanceId });
    const events = [];

    const result = await bridge.request(
      'media.convert_image',
      { inputPath: 'in.bmp', outputPath: 'out.png', format: 'png' },
      {
        onEvent: (evt) => events.push(evt),
      }
    );

    assert.deepEqual(result, { outputPath: 'out.png', format: 'png' });
    assert.equal(events.length, 1);
    assert.equal(events[0].event, 'progress');
    assert.deepEqual(events[0].data, { percent: 50 });

    await bridge.close();
  } finally {
    await fixture.close();
  }
});

test('request properly cleans up signal abort listeners on completion and on abort', async () => {
  const fixture = createPipeServer();
  await fixture.ready();
  const instanceId = crypto.randomUUID();

  fixture.server.on('connection', (socket) => {
    const decoder = new FrameDecoder();
    socket.on('data', (chunk) => {
      for (const frame of decoder.push(chunk)) {
        if (frame.type === 'hello') {
          socket.write(encodeFrame({ v: 1, type: 'ready', instanceId, capabilities: ['status'] }));
        } else if (frame.type === 'request') {
          socket.write(encodeFrame({ v: 1, type: 'response', id: frame.id, ok: true, result: {} }));
        }
      }
    });
  });

  try {
    const bridge = await connectBridge({ pipePath: fixture.pipePath, instanceId });
    const controller = new AbortController();

    // 1. Normal resolution removes listener
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
    await bridge.request('status', {}, { signal: controller.signal });
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);

    // 2. Cancellation removes listener
    const controller2 = new AbortController();
    const reqPromise = bridge.request('status', {}, { signal: controller2.signal });
    assert.equal(getEventListeners(controller2.signal, 'abort').length, 1);
    controller2.abort();
    await assert.rejects(reqPromise, (err) => err.code === 'CANCELLED');
    assert.equal(getEventListeners(controller2.signal, 'abort').length, 0);

    await bridge.close();
  } finally {
    await fixture.close();
  }
});

test('malformed frame received post-handshake triggers PROTOCOL_ERROR and connection teardown', async () => {
  const fixture = createPipeServer();
  await fixture.ready();
  const instanceId = crypto.randomUUID();

  fixture.server.on('connection', (socket) => {
    const decoder = new FrameDecoder();
    socket.on('data', (chunk) => {
      for (const frame of decoder.push(chunk)) {
        if (frame.type === 'hello') {
          socket.write(encodeFrame({ v: 1, type: 'ready', instanceId, capabilities: ['test'] }));
        } else if (frame.type === 'request') {
          // Send malformed frame (length header of 0)
          const badBuf = Buffer.alloc(4);
          badBuf.writeUInt32LE(0, 0);
          socket.write(badBuf);
        }
      }
    });
  });

  try {
    const bridge = await connectBridge({ pipePath: fixture.pipePath, instanceId });
    await assert.rejects(
      bridge.request('test', {}),
      (err) => err instanceof BridgeError && err.code === 'PROTOCOL_ERROR'
    );
    await bridge.close();
  } finally {
    await fixture.close();
  }
});
