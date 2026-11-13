/**
 * Narrow Host adapter for the human-visible toolbox entry.
 *
 * The adapter is not a model tool and does not own the desktop runtime. It
 * consumes the proposed `toolboxDesktop` service (supplied by Codex) and
 * exposes only the three human-entry operations over the installed
 * `@deepseek-ai/dsh-client-connection` generic RPC channel.
 */

export const name = 'dsh-toolbox-human-entry'
// Connection's scoped rpc.handle() registers through the caller's webServer.
export const inject = ['connection', 'webServer']

/** Generic Connection RPC channel shared with the browser client bundle. */
export const HUMAN_ENTRY_CHANNEL = '/toolbox-human'

export const HUMAN_ENTRY_ENDPOINTS = Object.freeze(['status', 'showMain', 'openPanel'])

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
    if (endpoint === 'openPanel') {
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
      if (endpoint === 'status') {
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
  const connection = ctx.get?.('connection') ?? ctx.connection
  if (connection === null || typeof connection !== 'object'
    || connection.rpc === null || typeof connection.rpc !== 'object'
    || typeof connection.rpc.handle !== 'function') {
    throw new Error('dsh-toolbox human entry requires the Host connection service')
  }

  const handler = createHumanEntryHandler(() => ctx.get?.('toolboxDesktop'))
  ctx.effect(
    () => connection.rpc.handle(HUMAN_ENTRY_CHANNEL, (endpoint, payload, signal) => handler(endpoint, payload, signal)),
    'dsh-toolbox human-entry RPC channel',
  )
}
