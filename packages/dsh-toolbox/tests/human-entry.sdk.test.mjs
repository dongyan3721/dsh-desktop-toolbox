import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { installConnection } from '../../../vendor/harness-reference/@deepseek-ai/dsh-client-connection/lib/client.node.js'
import { createHumanEntryHandler } from '../src/human-entry/host.js'
import * as HumanEntry from '../src/human-entry/host.js'
import { Context } from '@deepseek-ai/cordis'
import { HostConnectionService } from '../../../vendor/harness-reference/@deepseek-ai/dsh-client-connection/lib/index.js'

/**
 * Integration tests against the actual installed 0.2.2-rc.1 Node Client
 * Connection bundle plus the real Host adapter and client bundle. Only the
 * HTTP carrier is substituted; envelope generation, rpcId validation, response
 * parsing and error-shape checks are the SDK implementation.
 */

const clientBundleUrl = new URL('../../dsh-toolbox-client/client.js', import.meta.url)

test('actual Host Connection registers and releases the RPC route in a strict Cordis plugin fiber', async () => {
  const ctx = new Context()
  const routes = new Set()
  try {
    await ctx.plugin({
      name: 'test-http-carrier',
      apply(carrierCtx) {
        carrierCtx.provide('webServer', {
          register(route) {
            routes.add(route)
            return () => routes.delete(route)
          },
        })
      },
    })
    await ctx.plugin({ name: 'test-host-connection', apply(connectionCtx) { new HostConnectionService(connectionCtx, [], {}) } })
    ctx.provide('toolboxDesktop', { async showMain() { return { opened: true } } })
    const shared = ctx.get('connection').createSharedFetchHandler('/api')
    const fiber = await ctx.plugin(HumanEntry)
    await fiber.await()
    const client = await loadClientBundle()
    const connection = installActualConnection((input, init) => shared.fetch(new Request(new URL(input, 'http://fixture/'), init), ctx.get('connection').browserPeer))
    assert.deepEqual(await client.callHumanEntry(connection, 'showMain', {}, freshSignal()), { opened: true })
    const owner = ctx.get('connection').browserPeer
    const url = 'http://fixture/api/toolbox-human/showMain'
    const post = (body, contentType = 'application/json') => new Request(url, { method: 'POST', headers: { 'content-type': contentType }, body })
    assert.equal((await shared.fetch(post('{'), owner)).status, 400)
    assert.equal((await shared.fetch(post('x'.repeat(4097)), owner)).status, 413)
    assert.equal((await shared.fetch(post('{}', 'text/plain'), owner)).status, 415)
    assert.equal((await shared.fetch(post(JSON.stringify({ type: 'client-request', rpcId: 'id', method: 'wrong', payload: {} })), owner)).status, 400)
    assert.equal((await shared.fetch(post('{}'), { principal: { kind: 'non-owner-fixture' } })).status, 403)
    const cancelled = new AbortController(); cancelled.abort()
    await assert.rejects(shared.fetch(new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: cancelled.signal }), owner), { name: 'AbortError' })
    await fiber.dispose()
    const after = await shared.fetch(new Request('http://fixture/api/toolbox-human/showMain', { method: 'POST' }), ctx.get('connection').browserPeer)
    assert.equal(after.status, 404)
  } finally { await ctx.fiber.dispose() }
})

async function loadClientBundle() {
  const source = await readFile(clientBundleUrl, 'utf8')
  let registration
  new Function('window', source)({
    __ModuleLoader__: {
      load(value) {
        registration = value
      },
    },
  })
  assert.ok(registration)
  const react = {
    createElement() { return null },
    useState(value) { return [value, () => {}] },
    useRef() { return { current: null } },
    useCallback(callback) { return callback },
    useEffect() {},
  }
  return registration.factory(specifier => {
    if (specifier === 'react') return react
    throw new Error(`unexpected platform module request: ${specifier}`)
  })
}

function jsonResponse(value) {
  return {
    ok: true,
    headers: {
      get(name) {
        return name.toLowerCase() === 'content-type' ? 'application/json' : null
      },
    },
    async json() {
      return value
    },
  }
}

function createFetch(handler, { rewriteRpcId } = {}) {
  return async (_input, init) => {
    const request = JSON.parse(init.body)
    const result = await handler(request.method.replace(/^toolbox-human\//u, ''), request.payload, init.signal)
    return jsonResponse({
      type: 'server-response',
      rpcId: rewriteRpcId ?? request.rpcId,
      result,
    })
  }
}

function installActualConnection(fetchImpl) {
  const provided = new Map()
  installConnection({
    provide(name, value) {
      provided.set(name, value)
    },
  }, {
    transport: { fetch: fetchImpl },
  })
  const connection = provided.get('connection')
  assert.ok(connection, 'actual SDK must provide ctx.connection')
  return connection
}

function freshSignal() {
  return new AbortController().signal
}

test('actual SDK Connection carries a successful Host adapter result to the client helper', async () => {
  let serviceSignal
  const service = {
    async showMain({ signal }) {
      serviceSignal = signal
      return { opened: true }
    },
  }
  const handler = createHumanEntryHandler(() => service)
  const connection = installActualConnection(createFetch(handler))
  const client = await loadClientBundle()
  const signal = freshSignal()

  const value = await client.callHumanEntry(connection, 'showMain', {}, signal)

  assert.deepEqual(value, { opened: true })
  assert.equal(serviceSignal, signal)
})

test('actual SDK Connection exposes a structured failure envelope', async () => {
  const handler = createHumanEntryHandler(() => undefined)
  const connection = installActualConnection(createFetch(handler))

  const result = await connection.rpc.call('/toolbox-human', 'showMain', {}, freshSignal())

  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'DEPENDENCY_MISSING')
  assert.equal(result.error.message, 'toolboxDesktop service is not available')
  assert.deepEqual(result.error.details, {})
})

test('actual SDK Connection preserves OUTCOME_UNKNOWN and causeCode for the client error object', async () => {
  const service = {
    async showMain() {
      throw Object.assign(new Error('native outcome unknown'), {
        code: 'OUTCOME_UNKNOWN',
        causeCode: 'CANCELLED',
      })
    },
  }
  const connection = installActualConnection(createFetch(createHumanEntryHandler(() => service)))
  const client = await loadClientBundle()

  let failure
  try {
    await client.callHumanEntry(connection, 'showMain', {}, freshSignal())
  } catch (error) {
    failure = error
  }

  assert.ok(failure instanceof Error)
  assert.equal(failure.code, 'OUTCOME_UNKNOWN')
  assert.equal(failure.message, 'native outcome unknown')
  assert.deepEqual(failure.details, { causeCode: 'CANCELLED' })
})

test('actual SDK Connection rejects a mismatched rpcId instead of treating it as success', async () => {
  const handler = createHumanEntryHandler(() => ({
    async showMain() {
      return { opened: true }
    },
  }))
  const connection = installActualConnection(createFetch(handler, { rewriteRpcId: 'wrong-id' }))
  const client = await loadClientBundle()

  await assert.rejects(
    connection.rpc.call('/toolbox-human', 'showMain', {}, freshSignal()),
    /rpcId mismatch/,
  )
  await assert.rejects(
    client.callHumanEntry(connection, 'showMain', {}, freshSignal()),
    /rpcId mismatch/,
  )
})
