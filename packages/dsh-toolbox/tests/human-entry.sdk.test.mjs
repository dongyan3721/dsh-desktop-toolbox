import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { installConnection } from '../../../vendor/harness-reference/@deepseek-ai/dsh-client-connection/lib/client.node.js'
import { createHumanEntryHandler } from '../src/human-entry/host.js'

/**
 * Integration tests against the actual installed 0.2.2-rc.1 Node Client
 * Connection bundle plus the real Host adapter and client bundle. Only the
 * HTTP carrier is substituted; envelope generation, rpcId validation, response
 * parsing and error-shape checks are the SDK implementation.
 */

const clientBundleUrl = new URL('../../dsh-toolbox-client/client.js', import.meta.url)

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
    const result = await handler(request.method, request.payload, init.signal)
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
