import test from 'node:test'
import assert from 'node:assert/strict'
import {
  apply,
  createHumanEntryHandler,
  HUMAN_ENTRY_CHANNEL,
  inject,
  name,
} from '../src/human-entry/host.js'

function freshSignal() {
  return new AbortController().signal
}

function createDesktop(overrides = {}) {
  const calls = []
  return {
    calls,
    async status(signal) {
      calls.push({ method: 'status', signal })
      return { available: true, desktop: true }
    },
    async showMain(options) {
      calls.push({ method: 'showMain', options })
      return { opened: true, window: 'main' }
    },
    async openPanel(moduleId, options) {
      calls.push({ method: 'openPanel', moduleId, options })
      return { opened: true }
    },
    ...overrides,
  }
}

test('human-entry host adapter exposes its channel and required services', () => {
  assert.equal(name, 'dsh-toolbox-human-entry')
  assert.deepEqual(inject, ['connection'])
  assert.equal(HUMAN_ENTRY_CHANNEL, '/api')
})

test('status maps to toolboxDesktop.status(signal)', async () => {
  const desktop = createDesktop()
  const handler = createHumanEntryHandler(() => desktop)
  const signal = freshSignal()

  const result = await handler('status', {}, signal)

  assert.deepEqual(result, { ok: true, value: { available: true, desktop: true } })
  assert.equal(desktop.calls.length, 1)
  assert.equal(desktop.calls[0].method, 'status')
  assert.equal(desktop.calls[0].signal, signal)
})

test('showMain maps to toolboxDesktop.showMain({ signal })', async () => {
  const desktop = createDesktop()
  const handler = createHumanEntryHandler(() => desktop)
  const signal = freshSignal()

  const result = await handler('showMain', {}, signal)

  assert.deepEqual(result, { ok: true, value: { opened: true, window: 'main' } })
  assert.equal(desktop.calls[0].method, 'showMain')
  assert.equal(desktop.calls[0].options.signal, signal)
})

test('openPanel maps moduleId and signal without changing valid text', async () => {
  const desktop = createDesktop()
  const handler = createHumanEntryHandler(() => desktop)
  const signal = freshSignal()

  const result = await handler('openPanel', { moduleId: '功能设置😀' }, signal)

  assert.deepEqual(result, { ok: true, value: { opened: true } })
  assert.deepEqual(desktop.calls[0], {
    method: 'openPanel',
    moduleId: '功能设置😀',
    options: { signal },
  })
})

test('invalid payloads fail closed before the desktop service is called', async () => {
  const desktop = createDesktop()
  const handler = createHumanEntryHandler(() => desktop)

  const cases = [
    ['status', { extra: true }],
    ['status', []],
    ['showMain', 'not-an-object'],
    ['openPanel', {}],
    ['openPanel', { moduleId: '' }],
    ['openPanel', { moduleId: 7 }],
    ['openPanel', { moduleId: 'line\nbreak' }],
    ['openPanel', { moduleId: 'bad\uD800' }],
    ['openPanel', { moduleId: '😀'.repeat(81) }],
    ['openPanel', { moduleId: 'valid', extra: true }],
  ]

  for (const [endpoint, payload] of cases) {
    const result = await handler(endpoint, payload, freshSignal())
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'INVALID_REQUEST')
    assert.deepEqual(result.error.details, {})
  }
  assert.equal(desktop.calls.length, 0)
})

test('unknown endpoints are rejected without calling the desktop service', async () => {
  const desktop = createDesktop()
  const handler = createHumanEntryHandler(() => desktop)

  const result = await handler('launchMissiles', {}, freshSignal())

  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'UNSUPPORTED')
  assert.equal(desktop.calls.length, 0)
})

test('missing toolboxDesktop and missing methods are reported as stable failures', async () => {
  const missingService = createHumanEntryHandler(() => undefined)
  const missingResult = await missingService('showMain', {}, freshSignal())
  assert.equal(missingResult.ok, false)
  assert.equal(missingResult.error.code, 'DEPENDENCY_MISSING')

  const incomplete = createHumanEntryHandler(() => ({ status: async () => ({}) }))
  const incompleteResult = await incomplete('showMain', {}, freshSignal())
  assert.equal(incompleteResult.ok, false)
  assert.equal(incompleteResult.error.code, 'UNSUPPORTED')
})

test('service errors keep stable codes and sanitize messages', async () => {
  const denied = createDesktop({
    async showMain() {
      throw Object.assign(new Error('outside\tallowed\nroots'), { code: 'ACCESS_DENIED' })
    },
  })
  const deniedResult = await createHumanEntryHandler(() => denied)('showMain', {}, freshSignal())
  assert.equal(deniedResult.ok, false)
  assert.equal(deniedResult.error.code, 'ACCESS_DENIED')
  assert.equal(deniedResult.error.message, 'outside allowed roots')
  assert.deepEqual(deniedResult.error.details, {})

  const unknown = createDesktop({
    async showMain() {
      throw Object.assign(new Error('secret path C:\\private'), { code: 'NOT_A_STABLE_CODE' })
    },
  })
  const unknownResult = await createHumanEntryHandler(() => unknown)('showMain', {}, freshSignal())
  assert.equal(unknownResult.ok, false)
  assert.equal(unknownResult.error.code, 'INTERNAL')
  assert.equal(unknownResult.error.message, 'desktop service request failed')
  assert.equal(unknownResult.error.message.includes('private'), false)
})

test('NativeOwner and desktop stable codes are preserved instead of becoming INTERNAL', async () => {
  const codes = [
    'OUTCOME_UNKNOWN',
    'NATIVE_UNAVAILABLE',
    'NATIVE_START_FAILED',
    'NATIVE_START_TIMEOUT',
    'NATIVE_INTEGRITY',
    'DESKTOP_PROTOCOL',
    'DESKTOP_CAPABILITIES',
    'DESKTOP_SHUTDOWN_FAILED',
  ]

  for (const code of codes) {
    const desktop = createDesktop({
      async showMain() {
        throw Object.assign(new Error(`failure ${code}`), { code })
      },
    })
    const result = await createHumanEntryHandler(() => desktop)('showMain', {}, freshSignal())
    assert.equal(result.ok, false)
    assert.equal(result.error.code, code)
    assert.equal(result.error.message, `failure ${code}`)
    assert.deepEqual(result.error.details, {})
  }
})

test('OUTCOME_UNKNOWN causeCode is retained in debug details', async () => {
  const desktop = createDesktop({
    async showMain() {
      throw Object.assign(new Error('outcome unknown'), {
        code: 'OUTCOME_UNKNOWN',
        causeCode: 'CANCELLED',
      })
    },
  })

  const result = await createHumanEntryHandler(() => desktop)('showMain', {}, freshSignal())
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'OUTCOME_UNKNOWN')
  assert.deepEqual(result.error.details, { causeCode: 'CANCELLED' })
})

test('AbortError and pre-aborted requests report CANCELLED', async () => {
  const aborted = new AbortController()
  aborted.abort()
  let called = 0
  const desktop = createDesktop({
    async status() {
      called += 1
      return {}
    },
  })
  const handler = createHumanEntryHandler(() => desktop)

  const preAborted = await handler('status', {}, aborted.signal)
  assert.equal(preAborted.ok, false)
  assert.equal(preAborted.error.code, 'CANCELLED')
  assert.equal(called, 0)

  const throwing = createDesktop({
    async status() {
      throw new DOMException('Aborted', 'AbortError')
    },
  })
  const abortResult = await createHumanEntryHandler(() => throwing)('status', {}, freshSignal())
  assert.equal(abortResult.ok, false)
  assert.equal(abortResult.error.code, 'CANCELLED')
})

test('results are JSON-safe and show/open results must confirm opened:true', async () => {
  const undefinedStatus = createDesktop({
    async status() {
      return undefined
    },
  })
  const statusResult = await createHumanEntryHandler(() => undefinedStatus)('status', {}, freshSignal())
  assert.deepEqual(statusResult, { ok: true, value: null })

  const bigint = createDesktop({
    async status() {
      return { value: 1n }
    },
  })
  const bigintResult = await createHumanEntryHandler(() => bigint)('status', {}, freshSignal())
  assert.equal(bigintResult.ok, false)
  assert.equal(bigintResult.error.code, 'INTERNAL')

  const notOpened = createDesktop({
    async showMain() {
      return { opened: false }
    },
  })
  const notOpenedResult = await createHumanEntryHandler(() => notOpened)('showMain', {}, freshSignal())
  assert.equal(notOpenedResult.ok, false)
  assert.equal(notOpenedResult.error.code, 'INTERNAL')
})

test('apply registers exact Connection routes and disposes them with the plugin', async () => {
  const desktop = createDesktop()
  const registrations = []
  const disposers = []
  const connection = {
    fetch: {
      register(route) {
        registrations.push(route)
        return () => {
          route.disposed = true
        }
      },
    },
  }
  const ctx = {
    get(serviceName) {
      if (serviceName === 'connection') return connection
      if (serviceName === 'toolboxDesktop') return desktop
      return undefined
    },
    effect(factory) {
      const disposer = factory()
      disposers.push(disposer)
      return disposer
    },
  }

  apply(ctx)

  assert.equal(registrations.length, 4)
  assert.equal(registrations[1].path, '/api/toolbox-human/showMain')
  assert.equal(registrations[1].requestBody, 'streaming')

  const response = await registrations[1].fetch(new Request('http://fixture/api/toolbox-human/showMain', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: 'fixture-id', method: 'toolbox-human/showMain', payload: {} }) }))
  assert.deepEqual(await response.json(), { type: 'server-response', rpcId: 'fixture-id', result: { ok: true, value: { opened: true, window: 'main' } } })
  assert.equal(desktop.calls[0].method, 'showMain')

  assert.equal(disposers.length, 4)
  for (const dispose of disposers) dispose()
  assert.ok(registrations.every(route => route.disposed))
})

test('apply refuses to load without the Host connection service', () => {
  assert.throws(
    () => apply({ get: () => undefined, connection: undefined, effect: () => {} }),
    /connection service/,
  )
})
