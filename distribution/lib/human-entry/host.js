/**
 * Narrow Host adapter for the human-visible toolbox entry.
 *
 * The adapter is not a model tool and does not own the desktop runtime. It
 * consumes the proposed `toolboxDesktop` service (supplied by Codex) and
 * exposes only the three human-entry operations over the installed
 * `@deepseek-ai/dsh-client-connection` generic RPC channel.
 */

import { validateConsoleRequest } from './console.js'

export const name = 'dsh-toolbox-human-entry'
export const inject = ['connection']

/** Generic Connection RPC channel shared with the browser client bundle. */
export const HUMAN_ENTRY_CHANNEL = '/api'
export const HUMAN_ENTRY_PREFIX = 'toolbox-human/'

export const HUMAN_ENTRY_ENDPOINTS = Object.freeze(['status', 'showMain', 'openPanel', 'console'])

async function controlEnvelope(request) {
  const reader = request.body?.getReader()
  if (!reader) throw new Error('missing request body')
  const chunks = []
  let size = 0
  try {
    while (true) {
      request.signal.throwIfAborted()
      const item = await reader.read()
      if (item.done) break
      size += item.value.length
      if (size > 4096) { await reader.cancel(); return undefined }
      chunks.push(item.value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
}

function exactRoute(endpoint, handler) {
  const method = `${HUMAN_ENTRY_PREFIX}${endpoint}`
  return {
    path: `${HUMAN_ENTRY_CHANNEL}/${method}`,
    methods: ['POST'],
    requestBody: 'streaming',
    async fetch(request) {
      if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') return new Response('JSON required', { status: 415 })
      let envelope
      try { envelope = await controlEnvelope(request) }
      catch (error) { if (request.signal.aborted) throw error; return new Response('invalid request', { status: 400 }) }
      if (envelope === undefined) return new Response('request too large', { status: 413 })
      if (!envelope || envelope.type !== 'client-request' || envelope.method !== method
        || typeof envelope.rpcId !== 'string' || envelope.rpcId.length < 1 || envelope.rpcId.length > 128) return new Response('invalid request', { status: 400 })
      return Response.json({ type: 'server-response', rpcId: envelope.rpcId, result: await handler(endpoint, envelope.payload, request.signal) })
    },
  }
}

const MAX_MODULE_ID_SCALARS = 80
const MAX_ERROR_MESSAGE_CHARS = 300

const STABLE_ERROR_CODES = new Set([
  'INVALID_REQUEST',
  'UNSUPPORTED',
  'DISABLED',
  'CANCELLED',
  'TIMEOUT',
  'NOT_FOUND',
  'CONFLICT',
  'ACCESS_DENIED',
  'DEPENDENCY_MISSING',
  'OUTCOME_UNKNOWN',
  'NATIVE_UNAVAILABLE',
  'NATIVE_START_FAILED',
  'NATIVE_START_TIMEOUT',
  'NATIVE_INTEGRITY',
  'DESKTOP_PROTOCOL',
  'DESKTOP_CAPABILITIES',
  'DESKTOP_SHUTDOWN_FAILED',
  'INTERNAL',
])

function rpcSuccess(value) {
  return { ok: true, value }
}

function rpcFailure(code, message, details = {}) {
  return { ok: false, error: { code, message, details } }
}

function requestFailure(message) {
  return rpcFailure('INVALID_REQUEST', message)
}

function hasOnlyKeys(value, allowed) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) return false
  }
  return true
}

function plainPayload(payload) {
  if (payload === undefined || payload === null) return {}
  if (typeof payload !== 'object' || Array.isArray(payload)) return undefined
  return payload
}

function validateEmptyPayload(payload) {
  const value = plainPayload(payload)
  if (value === undefined || !hasOnlyKeys(value, [])) {
    return { error: requestFailure('arguments must be an empty object') }
  }
  return undefined
}

function validateModuleId(value) {
  if (typeof value !== 'string') return { error: requestFailure('moduleId must be a string') }
  let scalars = 0
  for (const character of value) {
    const codePoint = character.codePointAt(0)
    if (codePoint >= 0xD800 && codePoint <= 0xDFFF) {
      return { error: requestFailure('moduleId must not contain unpaired surrogates') }
    }
    if (codePoint < 0x20) {
      return { error: requestFailure('moduleId must not contain control characters') }
    }
    scalars += 1
    if (scalars > MAX_MODULE_ID_SCALARS) {
      return { error: requestFailure(`moduleId must be at most ${MAX_MODULE_ID_SCALARS} Unicode scalars`) }
    }
  }
  if (scalars === 0) return { error: requestFailure('moduleId must not be empty') }
  return { value }
}

function validateOpenPanelPayload(payload) {
  const value = plainPayload(payload)
  if (value === undefined || !hasOnlyKeys(value, ['moduleId']) || !Object.hasOwn(value, 'moduleId')) {
    return { error: requestFailure('arguments must be { moduleId: string }') }
  }
  return validateModuleId(value.moduleId)
}

function sanitizeMessage(value) {
  if (typeof value !== 'string') return undefined
  const cleaned = value
    .replace(/[\u0000-\u001F\u007F]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
  if (cleaned === '') return undefined
  return cleaned.slice(0, MAX_ERROR_MESSAGE_CHARS)
}

function failureFromError(error, signal) {
  if (signal?.aborted === true || error?.name === 'AbortError') {
    return rpcFailure('CANCELLED', 'request cancelled')
  }
  const stableCode = typeof error?.code === 'string' && STABLE_ERROR_CODES.has(error.code)
  const code = stableCode ? error.code : 'INTERNAL'
  const message = stableCode
    ? (sanitizeMessage(error?.message) ?? 'desktop service request failed')
    : 'desktop service request failed'
  const causeCode = typeof error?.causeCode === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/u.test(error.causeCode)
    ? error.causeCode
    : undefined
  return rpcFailure(code, message, causeCode === undefined ? {} : { causeCode })
}

function jsonSafe(value) {
  if (value === undefined) return null
  const serialized = JSON.stringify(value)
  if (serialized === undefined) throw new Error('desktop service returned a non-JSON value')
  return JSON.parse(serialized)
}

function requireDesktop(getDesktop) {
  const desktop = getDesktop()
  if (desktop === null || typeof desktop !== 'object') {
    return { error: rpcFailure('DEPENDENCY_MISSING', 'toolboxDesktop service is not available') }
  }
  return { desktop }
}

function requireMethod(desktop, method) {
  if (typeof desktop[method] !== 'function') {
    return { error: rpcFailure('UNSUPPORTED', `toolboxDesktop.${method} is not available`) }
  }
  return { method: desktop[method] }
}

function confirmOpened(value, operation) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || value.opened !== true) {
    throw new Error(`toolboxDesktop.${operation} did not confirm opening`)
  }
  return value
}

/**
 * Build the RPC handler as a pure function over a service getter.
 * Exported for focused tests; production uses the Cordis `apply()` below.
 *
 * @param {() => object | undefined} getDesktop - current toolboxDesktop service.
 * @returns {(endpoint: string, payload: unknown, signal?: AbortSignal) => Promise<object>}
 */
export function createHumanEntryHandler(getDesktop) {
  if (typeof getDesktop !== 'function') throw new TypeError('createHumanEntryHandler requires a service getter')

  return async function handleHumanEntry(endpoint, payload, signal) {
    if (signal?.aborted === true) return rpcFailure('CANCELLED', 'request cancelled')
    if (typeof endpoint !== 'string' || !HUMAN_ENTRY_ENDPOINTS.includes(endpoint)) {
      return rpcFailure('UNSUPPORTED', 'unknown toolbox human-entry endpoint')
    }

    let request
    if (endpoint === 'console') {
      try { request = { value: validateConsoleRequest(payload) } }
      catch { return requestFailure('invalid toolbox console request') }
    } else if (endpoint === 'openPanel') {
      request = validateOpenPanelPayload(payload)
    } else {
      request = validateEmptyPayload(payload)
    }
    if (request?.error !== undefined) return request.error

    const desktopResult = requireDesktop(getDesktop)
    if (desktopResult.error !== undefined) return desktopResult.error
    const methodResult = requireMethod(desktopResult.desktop, endpoint)
    if (methodResult.error !== undefined) return methodResult.error

    try {
      let value
      if (endpoint === 'console') {
        value = await methodResult.method.call(desktopResult.desktop, request.value, { signal })
      } else if (endpoint === 'status') {
        value = await methodResult.method.call(desktopResult.desktop, signal)
      } else if (endpoint === 'showMain') {
        value = confirmOpened(
          await methodResult.method.call(desktopResult.desktop, { signal }),
          'showMain',
        )
      } else {
        value = confirmOpened(
          await methodResult.method.call(desktopResult.desktop, request.value, { signal }),
          'openPanel',
        )
      }
      return rpcSuccess(jsonSafe(value))
    } catch (error) {
      return failureFromError(error, signal)
    }
  }
}

/**
 * Cordis function plugin. The Entry is enabled only when Host Connection is
 * present; requests without `toolboxDesktop` fail with DEPENDENCY_MISSING.
 *
 * @param {object} ctx - Host plugin context.
 */
export function apply(ctx) {
  const connection = ctx.connection ?? ctx.get?.('connection')
  if (connection === null || typeof connection !== 'object'
    || connection.fetch === null || typeof connection.fetch !== 'object'
    || typeof connection.fetch.register !== 'function') {
    throw new Error('dsh-toolbox human entry requires the Host connection service')
  }

  const handler = createHumanEntryHandler(() => ctx.get?.('toolboxDesktop'))
  for (const endpoint of HUMAN_ENTRY_ENDPOINTS) ctx.effect(
    () => connection.fetch.register(exactRoute(endpoint, handler)),
    `dsh-toolbox human-entry ${endpoint}`,
  )
}
