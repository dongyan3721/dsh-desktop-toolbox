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
  MAX_ACTIVE_REQUESTS,
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

test('handshake failure on bad capabilities: not array, empty string, or duplicates', async () => {
  const testCases = [
    { capabilities: 'status', label: 'not array' },
    { capabilities: ['status', ''], label: 'empty string' },
    { capabilities: ['status', 'status'], label: 'duplicates' },
    { capabilities: ['status'], extra: 'unknownField', label: 'unknown field' },
  ];

  for (const tc of testCases) {
    const fixture = createPipeServer();
    await fixture.ready();
    const instanceId = crypto.randomUUID();

    fixture.server.on('connection', (socket) => {
      const decoder = new FrameDecoder();
      socket.on('data', (chunk) => {
        for (const frame of decoder.push(chunk)) {
          if (frame.type === 'hello') {
            const readyMsg = {
              v: 1,
              type: 'ready',
              instanceId,
              capabilities: tc.capabilities,
            };
            if (tc.extra) readyMsg.extra = tc.extra;
            socket.write(encodeFrame(readyMsg));
          }
        }
      });
    });

    try {
      await assert.rejects(
        connectBridge({ pipePath: fixture.pipePath, instanceId }),
        (err) => err instanceof BridgeError && err.code === 'HANDSHAKE_FAILED',
        `Should reject for: ${tc.label}`
      );
    } finally {
      await fixture.close();
    }
  }
});

test('handshake timeout when server never responds', async () => {
  const fixture = createPipeServer();
  await fixture.ready();
  const instanceId = crypto.randomUUID();

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
  setTimeout(() => controller.abort(), 20);

  try {
    await assert.rejects(
      connectBridge({ pipePath: fixture.pipePath, instanceId, signal: controller.signal }),
      (err) => err.name === 'AbortError' && err.code === 'CANCELLED' && err.causeCode === 'CANCELLED'
    );
  } finally {
    await fixture.close();
  }
});

test('validates timeoutMs and cancelTimeoutMs parameters as positive finite numbers', async () => {
  const invalidTimeouts = [-1, 0, NaN, Infinity, '1000'];
  for (const t of invalidTimeouts) {
    assert.rejects(
      connectBridge({ pipePath: '\\\\.\\pipe\\test', instanceId: 'id', timeoutMs: t }),
      (err) => err instanceof BridgeError && err.code === 'INVALID_REQUEST'
    );
    assert.rejects(
      connectBridge({ pipePath: '\\\\.\\pipe\\test', instanceId: 'id', cancelTimeoutMs: t }),
      (err) => err instanceof BridgeError && err.code === 'INVALID_REQUEST'
    );
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

test('rejects response frames with contradictory or malformed envelopes', async () => {
  const badFrames = [
    { v: 1, type: 'response', id: '1', ok: true }, // missing result
    { v: 1, type: 'response', id: '1', ok: true, result: 1, error: { code: 'E', message: 'm' } }, // contradictory error
    { v: 1, type: 'response', id: '1', ok: true, result: 1, extraField: 'bad' }, // unknown field
    { v: 1, type: 'response', id: '1', ok: false }, // missing error
    { v: 1, type: 'response', id: '1', ok: false, error: { code: 'E', message: 'm' }, result: 1 }, // contradictory result
    { v: 1, type: 'response', id: '1', ok: false, error: 'not-an-object' }, // bad error type
    { v: 1, type: 'response', id: '1', ok: false, error: { message: 'missing-code' } }, // missing code
  ];

  for (const badFrame of badFrames) {
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
            const frameToSend = { ...badFrame, id: frame.id };
            socket.write(encodeFrame(frameToSend));
          }
        }
      });
    });

    try {
      const bridge = await connectBridge({ pipePath: fixture.pipePath, instanceId });
      await assert.rejects(
        bridge.request('test', {}),
        (err) => err instanceof BridgeError && (err.code === 'PROTOCOL_ERROR' || err.code === 'OUTCOME_UNKNOWN')
      );
      await bridge.close();
    } finally {
      await fixture.close();
    }
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
      (err) => err.name === 'AbortError' && err.code === 'CANCELLED' && err.causeCode === 'CANCELLED'
    );

    assert.equal(requestFrameCount, 0);
    await bridge.close();
  } finally {
    await fixture.close();
  }
});

test('dispatched cancellation: server confirms CANCELLED, client rejects CANCELLED', async () => {
  const fixture = createPipeServer();
  await fixture.ready();
  const instanceId = crypto.randomUUID();

  let receivedCancelId = null;

  fixture.server.on('connection', (socket) => {
    const decoder = new FrameDecoder();
    socket.on('data', (chunk) => {
      for (const frame of decoder.push(chunk)) {
        if (frame.type === 'hello') {
          socket.write(encodeFrame({ v: 1, type: 'ready', instanceId, capabilities: ['notes.create'] }));
        } else if (frame.type === 'cancel') {
          receivedCancelId = frame.id;
          // Server acknowledges cancellation
          socket.write(
            encodeFrame({
              v: 1,
              type: 'response',
              id: frame.id,
              ok: false,
              error: { code: 'CANCELLED', message: 'Mutation cancelled prior to commit' },
            })
          );
        }
      }
    });
  });

  try {
    const bridge = await connectBridge({ pipePath: fixture.pipePath, instanceId, cancelTimeoutMs: 1000 });
    const controller = new AbortController();

    const reqPromise = bridge.request('notes.create', { title: 'Test' }, { signal: controller.signal });
    // Abort after dispatch
    controller.abort();

    await assert.rejects(
      reqPromise,
      (err) => err instanceof BridgeError && err.code === 'CANCELLED' && err.message.includes('prior to commit')
    );
    assert.ok(receivedCancelId !== null);

    await bridge.close();
  } finally {
    await fixture.close();
  }
});

test('dispatched cancellation: server committed before cancel, client resolves canonical success', async () => {
  const fixture = createPipeServer();
  await fixture.ready();
  const instanceId = crypto.randomUUID();

  let receivedCancelId = null;

  fixture.server.on('connection', (socket) => {
    const decoder = new FrameDecoder();
    socket.on('data', (chunk) => {
      for (const frame of decoder.push(chunk)) {
        if (frame.type === 'hello') {
          socket.write(encodeFrame({ v: 1, type: 'ready', instanceId, capabilities: ['notes.create'] }));
        } else if (frame.type === 'cancel') {
          receivedCancelId = frame.id;
          // Mutation was already committed before cancel arrived; server returns authoritative success
          socket.write(
            encodeFrame({
              v: 1,
              type: 'response',
              id: frame.id,
              ok: true,
              result: { id: 'note-committed-1', title: 'Committed Note' },
            })
          );
        }
      }
    });
  });

  try {
    const bridge = await connectBridge({ pipePath: fixture.pipePath, instanceId, cancelTimeoutMs: 1000 });
    const controller = new AbortController();

    const reqPromise = bridge.request('notes.create', { title: 'Committed Note' }, { signal: controller.signal });
    controller.abort();

    // Round 2 protocol: signal must NOT overwrite authoritative successful write!
    const result = await reqPromise;
    assert.deepEqual(result, { id: 'note-committed-1', title: 'Committed Note' });
    assert.ok(receivedCancelId !== null);

    await bridge.close();
  } finally {
    await fixture.close();
  }
});

test('dispatched cancellation: server silent, cancel grace expires, rejects OUTCOME_UNKNOWN and tears down', async () => {
  const fixture = createPipeServer();
  await fixture.ready();
  const instanceId = crypto.randomUUID();

  fixture.server.on('connection', (socket) => {
    const decoder = new FrameDecoder();
    socket.on('data', (chunk) => {
      for (const frame of decoder.push(chunk)) {
        if (frame.type === 'hello') {
          socket.write(encodeFrame({ v: 1, type: 'ready', instanceId, capabilities: ['notes.create'] }));
        }
        // Server ignores cancel frame and stays silent
      }
    });
  });

  try {
    const bridge = await connectBridge({ pipePath: fixture.pipePath, instanceId, cancelTimeoutMs: 80 });
    const controller = new AbortController();

    const reqPromise = bridge.request('notes.create', { title: 'Hanging Note' }, { signal: controller.signal });
    controller.abort();

    await assert.rejects(
      reqPromise,
      (err) =>
        err instanceof BridgeError &&
        err.code === 'OUTCOME_UNKNOWN' &&
        err.causeCode === 'CANCELLED' &&
        err.message.includes('outcome unknown')
    );

    assert.equal(bridge.isClosed, true);
  } finally {
    await fixture.close();
  }
});

test('request timeout: server silent, cancel grace expires, rejects OUTCOME_UNKNOWN with causeCode TIMEOUT', async () => {
  const fixture = createPipeServer();
  await fixture.ready();
  const instanceId = crypto.randomUUID();

  fixture.server.on('connection', (socket) => {
    const decoder = new FrameDecoder();
    socket.on('data', (chunk) => {
      for (const frame of decoder.push(chunk)) {
        if (frame.type === 'hello') {
          socket.write(encodeFrame({ v: 1, type: 'ready', instanceId, capabilities: ['notes.create'] }));
        }
      }
    });
  });

  try {
    const bridge = await connectBridge({ pipePath: fixture.pipePath, instanceId, cancelTimeoutMs: 60 });

    await assert.rejects(
      bridge.request('notes.create', {}, { timeoutMs: 40 }),
      (err) =>
        err instanceof BridgeError &&
        err.code === 'OUTCOME_UNKNOWN' &&
        err.causeCode === 'TIMEOUT' &&
        err.message.includes('outcome unknown')
    );

    assert.equal(bridge.isClosed, true);
  } finally {
    await fixture.close();
  }
});

test('request timeout: server committed before cancel, returns authoritative success during grace', async () => {
  const fixture = createPipeServer();
  await fixture.ready();
  const instanceId = crypto.randomUUID();

  fixture.server.on('connection', (socket) => {
    const decoder = new FrameDecoder();
    socket.on('data', (chunk) => {
      for (const frame of decoder.push(chunk)) {
        if (frame.type === 'hello') {
          socket.write(encodeFrame({ v: 1, type: 'ready', instanceId, capabilities: ['notes.create'] }));
        } else if (frame.type === 'cancel') {
          // Timeout caused cancel frame, but server returns committed success within cancelTimeoutMs
          socket.write(
            encodeFrame({
              v: 1,
              type: 'response',
              id: frame.id,
              ok: true,
              result: { id: 'note-timeout-success', committed: true },
            })
          );
        }
      }
    });
  });

  try {
    const bridge = await connectBridge({ pipePath: fixture.pipePath, instanceId, cancelTimeoutMs: 1000 });
    const res = await bridge.request('notes.create', { val: 1 }, { timeoutMs: 50 });
    assert.deepEqual(res, { id: 'note-timeout-success', committed: true });
    await bridge.close();
  } finally {
    await fixture.close();
  }
});

test('request timeout: server acknowledges cancel during grace period, rejects CANCELLED', async () => {
  const fixture = createPipeServer();
  await fixture.ready();
  const instanceId = crypto.randomUUID();

  fixture.server.on('connection', (socket) => {
    const decoder = new FrameDecoder();
    socket.on('data', (chunk) => {
      for (const frame of decoder.push(chunk)) {
        if (frame.type === 'hello') {
          socket.write(encodeFrame({ v: 1, type: 'ready', instanceId, capabilities: ['notes.create'] }));
        } else if (frame.type === 'cancel') {
          socket.write(
            encodeFrame({
              v: 1,
              type: 'response',
              id: frame.id,
              ok: false,
              error: { code: 'CANCELLED', message: 'Timed out call cancelled before mutation' },
            })
          );
        }
      }
    });
  });

  try {
    const bridge = await connectBridge({ pipePath: fixture.pipePath, instanceId, cancelTimeoutMs: 1000 });
    await assert.rejects(
      bridge.request('notes.create', {}, { timeoutMs: 50 }),
      (err) => err instanceof BridgeError && err.code === 'CANCELLED'
    );
    await bridge.close();
  } finally {
    await fixture.close();
  }
});

test('coalesced ready and response frames in same data batch are both processed without frame dropping', async () => {
  const fixture = createPipeServer();
  await fixture.ready();
  const instanceId = crypto.randomUUID();

  let capturedReqId = null;

  fixture.server.on('connection', (socket) => {
    const decoder = new FrameDecoder();
    socket.on('data', (chunk) => {
      for (const frame of decoder.push(chunk)) {
        if (frame.type === 'hello') {
          // Send ready frame along with a pre-created response frame in the EXACT SAME WRITE/CHUNK!
          const readyFrame = encodeFrame({ v: 1, type: 'ready', instanceId, capabilities: ['status'] });
          // We will wait for request first, then send coalesced chunk?
          // Even better: client sends request right after connect, or server sends ready chunk that has multiple frames
          socket.write(readyFrame);
        } else if (frame.type === 'request') {
          // Send response + progress event in a single coalesced chunk
          capturedReqId = frame.id;
          const eventFrame = encodeFrame({ v: 1, type: 'event', id: frame.id, event: 'progress', data: { p: 1 } });
          const resFrame = encodeFrame({ v: 1, type: 'response', id: frame.id, ok: true, result: { done: true } });
          socket.write(Buffer.concat([eventFrame, resFrame]));
        }
      }
    });
  });

  try {
    const bridge = await connectBridge({ pipePath: fixture.pipePath, instanceId });
    const events = [];
    const res = await bridge.request('status', {}, { onEvent: (e) => events.push(e) });
    assert.deepEqual(res, { done: true });
    assert.equal(events.length, 1);
    await bridge.close();
  } finally {
    await fixture.close();
  }
});

test('server sudden disconnection rejects in-flight request with OUTCOME_UNKNOWN and causeCode DISCONNECTED', async () => {
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
          // Abruptly destroy socket while request was dispatched
          socket.destroy();
        }
      }
    });
  });

  try {
    const bridge = await connectBridge({ pipePath: fixture.pipePath, instanceId });
    await assert.rejects(
      bridge.request('test', {}),
      (err) =>
        err instanceof BridgeError &&
        err.code === 'OUTCOME_UNKNOWN' &&
        err.causeCode === 'DISCONNECTED'
    );

    // Subsequent call rejects immediately with CLOSED or DISCONNECTED
    await assert.rejects(
      bridge.request('test', {}),
      (err) => err instanceof BridgeError && (err.code === 'CLOSED' || err.code === 'DISCONNECTED')
    );

    await bridge.close();
  } finally {
    await fixture.close();
  }
});

test('close() is idempotent, clears forceDestroyTimer, rejects dispatched pending with OUTCOME_UNKNOWN', async () => {
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
    const pendingReq = bridge.request('test', {});
    const pendingAssertion = assert.rejects(
      pendingReq,
      (err) => err instanceof BridgeError && err.code === 'OUTCOME_UNKNOWN' && err.causeCode === 'CLOSED'
    );

    const closePromise1 = bridge.close();
    const closePromise2 = bridge.close();

    await Promise.all([closePromise1, closePromise2]);
    assert.equal(bridge.isClosed, true);

    await pendingAssertion;

    // Calls initiated after close reject with CLOSED
    await assert.rejects(
      bridge.request('test', {}),
      (err) => err instanceof BridgeError && err.code === 'CLOSED'
    );
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
          if (frame.method === 'status') {
            socket.write(encodeFrame({ v: 1, type: 'response', id: frame.id, ok: true, result: {} }));
          }
        } else if (frame.type === 'cancel') {
          socket.write(
            encodeFrame({
              v: 1,
              type: 'response',
              id: frame.id,
              ok: false,
              error: { code: 'CANCELLED', message: 'Cancelled' },
            })
          );
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
    const reqPromise = bridge.request('cancel_me', {}, { signal: controller2.signal });
    controller2.abort();
    // After abort listener fires, it cleans itself up
    assert.equal(getEventListeners(controller2.signal, 'abort').length, 0);
    await assert.rejects(reqPromise, (err) => err.code === 'CANCELLED');

    await bridge.close();
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
          socket.write(
            encodeFrame({
              v: 1,
              type: 'event',
              id: frame.id,
              event: 'progress',
              data: { percent: 50 },
            })
          );
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
      (err) => err instanceof BridgeError && (err.code === 'PROTOCOL_ERROR' || err.code === 'OUTCOME_UNKNOWN')
    );
    await bridge.close();
  } finally {
    await fixture.close();
  }
});

test('rejects requests when MAX_ACTIVE_REQUESTS limit is exceeded', async () => {
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
    // Simulate active requests map being full
    const promises = [];
    for (let i = 0; i < MAX_ACTIVE_REQUESTS; i++) {
      promises.push(bridge.request('test', { i }).catch(() => {}));
    }

    // Next request must be rejected immediately due to limit
    await assert.rejects(
      bridge.request('test', {}),
      (err) => err instanceof BridgeError && err.code === 'RESOURCE_LIMIT_EXCEEDED'
    );

    await bridge.close();
    await Promise.all(promises);
  } finally {
    await fixture.close();
  }
});
