/**
 * Shared validation and result helpers for the four Agent-authorized modules.
 * No module may accept paths, identities, arbitrary methods, or script input.
 */

export function agentError(code, message) {
  return Object.assign(new Error(message), { code })
}

export function invalidRequest(message) {
  return agentError('INVALID_REQUEST', message)
}

export function throwIfAborted(signal) {
  signal?.throwIfAborted?.()
}

export function assertKnownKeys(value, allowed) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidRequest('arguments must be an object')
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw invalidRequest(`unknown argument: ${key}`)
  }
}

export function requireString(value, field, {
  minScalars = 0,
  maxScalars,
  nonWhitespace = false,
  allowLineControls = false,
} = {}) {
  if (typeof value !== 'string') throw invalidRequest(`${field} must be a string`)
  let scalars = 0
  for (const character of value) {
    const codePoint = character.codePointAt(0)
    if (codePoint >= 0xD800 && codePoint <= 0xDFFF) {
      throw invalidRequest(`${field} must not contain unpaired surrogates`)
    }
    if (codePoint < 0x20) {
      const allowedLineControl = allowLineControls
        && (codePoint === 0x09 || codePoint === 0x0A || codePoint === 0x0D)
      if (!allowedLineControl) throw invalidRequest(`${field} must not contain control characters`)
    }
    scalars += 1
    if (maxScalars !== undefined && scalars > maxScalars) {
      throw invalidRequest(`${field} must be at most ${maxScalars} Unicode scalars`)
    }
  }
  if (scalars < minScalars) {
    throw invalidRequest(`${field} must be at least ${minScalars} Unicode scalars`)
  }
  if (nonWhitespace && value.trim() === '') {
    throw invalidRequest(`${field} must contain non-whitespace text`)
  }
  return value
}

export function requireInteger(value, field, minimum, maximum) {
  if (!Number.isSafeInteger(value)) throw invalidRequest(`${field} must be a safe integer`)
  if (value < minimum) throw invalidRequest(`${field} must be at least ${minimum}`)
  if (maximum !== undefined && value > maximum) throw invalidRequest(`${field} must be at most ${maximum}`)
  return value
}

export function requireNumber(value, field, minimum, maximum) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw invalidRequest(`${field} must be a finite number`)
  }
  if (minimum !== undefined && value < minimum) throw invalidRequest(`${field} must be at least ${minimum}`)
  if (maximum !== undefined && value > maximum) throw invalidRequest(`${field} must be at most ${maximum}`)
  return value
}

export function requireBoolean(value, field) {
  if (typeof value !== 'boolean') throw invalidRequest(`${field} must be a boolean`)
  return value
}

export function requireArray(value, field, minimum, maximum) {
  if (!Array.isArray(value)) throw invalidRequest(`${field} must be an array`)
  if (value.length < minimum) throw invalidRequest(`${field} must contain at least ${minimum} item(s)`)
  if (maximum !== undefined && value.length > maximum) {
    throw invalidRequest(`${field} must contain at most ${maximum} item(s)`)
  }
  return value
}

export function jsonSafe(value) {
  if (value === undefined) return null
  let serialized
  try {
    serialized = JSON.stringify(value)
  } catch {
    throw agentError('INTERNAL', 'agent result is not JSON-safe')
  }
  if (serialized === undefined) throw agentError('INTERNAL', 'agent result is not JSON-safe')
  return JSON.parse(serialized)
}

export function renderJson(value, maxChars = 12000) {
  let text
  try {
    text = JSON.stringify(value)
  } catch {
    text = '[unavailable]'
  }
  if (text === undefined) text = 'null'
  if (text.length > maxChars) text = `${text.slice(0, maxChars)}\n…[truncated]`
  return [{ type: 'text', text }]
}

export function renderText(text) {
  return [{ type: 'text', text }]
}

/**
 * Project a publisher-owned image result into the SDK's actual image block.
 * A bare path or an unknown object never becomes an image block.
 */
export function renderAgentImage(value, label) {
  if (value !== null && typeof value === 'object' && value.publication === 'cancelled'
    && value.artifact !== null && typeof value.artifact === 'object') {
    return renderText(`${label}已捕获，但取消后未发布图像。`)
  }
  const image = value !== null && typeof value === 'object' ? value.image : undefined
  if (image === null || typeof image !== 'object' || Array.isArray(image)
    || typeof image.attachmentId !== 'string' || image.attachmentId === '') {
    return renderJson(value)
  }
  const dimensions = Number.isSafeInteger(image.width) && Number.isSafeInteger(image.height)
    ? `（${image.width}×${image.height}px）`
    : ''
  const original = image.originalDimensions
  const scaled = original !== null && typeof original === 'object'
    && Number.isSafeInteger(original.width) && Number.isSafeInteger(original.height)
    ? `，原始尺寸 ${original.width}×${original.height}px`
    : ''
  return [
    { type: 'text', text: `${label}${dimensions}${scaled}` },
    { type: 'image', attachment: image },
  ]
}

/** Validate a real calendar date in YYYY-MM-DD form without timezone drift. */
export function requireDate(value, field) {
  if (typeof value !== 'string') throw invalidRequest(`${field} must be a YYYY-MM-DD string`)
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value)
  if (match === null) throw invalidRequest(`${field} must use YYYY-MM-DD`)
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) {
    throw invalidRequest(`${field} is not a real date`)
  }
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw invalidRequest(`${field} is not a real date`)
  }
  return { value, epochDay: Math.floor(date.getTime() / 86_400_000) }
}

export function requireDateRange(startDate, endDate) {
  const start = requireDate(startDate, 'start_date')
  const end = requireDate(endDate, 'end_date')
  if (end.epochDay < start.epochDay) throw invalidRequest('end_date must not be before start_date')
  if (end.epochDay - start.epochDay > 30) throw invalidRequest('date range must span at most 31 inclusive days')
  return { start_date: start.value, end_date: end.value }
}
