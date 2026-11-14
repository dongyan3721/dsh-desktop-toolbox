import { defineTool } from '@deepseek-ai/dsh-tools'

/**
 * Tool factory for the first-wave image conversion method.
 *
 * File access is authorized before any bridge request. The authorizer is
 * injected by the integration layer because this package must not implement its
 * own file policy and must not bypass the Harness file/workspace policy.
 */

const SUPPORTED_FORMATS = ['png', 'jpeg', 'webp', 'bmp', 'ico']

const IMAGE_CONVERT_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    outputPath: { type: 'string', required: true },
    format: { type: 'string', enum: SUPPORTED_FORMATS, required: true },
  },
}

function fail(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function invalidRequest(message) {
  return fail('INVALID_REQUEST', message)
}

function accessDenied(message) {
  return fail('ACCESS_DENIED', message)
}

function requireBridge(bridge) {
  if (bridge === null || typeof bridge !== 'object' || typeof bridge.request !== 'function') {
    throw new TypeError('createImageTools requires a bridge client with request(method, params, options)')
  }
  return bridge
}

function requireSignal(exec) {
  const signal = exec?.signal
  if (signal === null || typeof signal !== 'object' || typeof signal.throwIfAborted !== 'function') {
    throw new TypeError('tool execution requires an AbortSignal in exec.signal')
  }
  return signal
}

function assertKnownArguments(input, allowed) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw invalidRequest('arguments must be an object')
  }
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) throw invalidRequest(`unknown argument: ${key}`)
  }
}

/**
 * Reject path text that cannot round-trip through JSON/UTF-8 or Windows paths.
 * Valid non-ASCII path text is preserved unchanged.
 */
function pathTextViolation(value) {
  if (typeof value !== 'string') return 'must be a string'
  if (value.trim() === '') return 'must not be empty'
  for (const character of value) {
    const codePoint = character.codePointAt(0)
    if (codePoint >= 0xD800 && codePoint <= 0xDFFF) return 'must not contain unpaired surrogates'
    if (codePoint < 0x20) return 'must not contain control characters'
  }
  return null
}

function requirePath(value, field) {
  const violation = pathTextViolation(value)
  if (violation) throw invalidRequest(`${field} ${violation}`)
  return value
}

function requireFormat(value) {
  if (typeof value !== 'string' || !SUPPORTED_FORMATS.includes(value)) {
    throw invalidRequest(`format must be one of: ${SUPPORTED_FORMATS.join(', ')}`)
  }
  return value
}

function normalizeImageResult(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw fail('INTERNAL', 'native bridge returned an invalid image conversion result')
  }
  if (pathTextViolation(value.outputPath) !== null || typeof value.format !== 'string'
    || !SUPPORTED_FORMATS.includes(value.format)) {
    throw fail('INTERNAL', 'native bridge returned an invalid image conversion result')
  }
  return { outputPath: value.outputPath, format: value.format }
}

function requireAuthorizer(options) {
  const authorizePaths = options?.authorizePaths
  if (typeof authorizePaths !== 'function') {
    throw accessDenied('图片路径授权未配置，已拒绝执行')
  }
  return authorizePaths
}

export function createImageTools(bridge, options = {}) {
  requireBridge(bridge)

  return [
    defineTool({
      name: 'toolbox_image_convert',
      description: '把已授权的本地图片转换为 png、jpeg、webp、bmp 或 ico。输入与输出路径必须先通过宿主文件策略授权；目标文件已存在时不会覆盖。',
      parameters: {
        inputPath: { type: 'string', required: true, description: '已存在且已授权的输入图片绝对路径' },
        outputPath: { type: 'string', required: true, description: '已授权的新输出图片绝对路径；不能覆盖已有文件' },
        format: {
          type: 'string',
          enum: SUPPORTED_FORMATS,
          required: true,
          description: '输出格式：png、jpeg、webp、bmp 或 ico',
        },
      },
      output: {
        schema: IMAGE_CONVERT_RESULT_SCHEMA,
        render(_args, value) {
          return [{ type: 'text', text: `已将图片转换为 ${value.format}：${value.outputPath}` }]
        },
      },
      async execute(input, exec) {
        const signal = requireSignal(exec)
        signal.throwIfAborted()
        assertKnownArguments(input, ['inputPath', 'outputPath', 'format'])
        const inputPath = requirePath(input.inputPath, 'inputPath')
        const outputPath = requirePath(input.outputPath, 'outputPath')
        const format = requireFormat(input.format)

        const authorizePaths = requireAuthorizer(options)
        const allowed = await authorizePaths({ inputPath, outputPath, format, signal })
        // Cancellation during authorization must not send a request.
        signal.throwIfAborted()
        if (allowed !== true) throw accessDenied('图片路径授权被拒绝，未执行转换')

        // Once dispatched, the bridge owns the terminal outcome. Do not
        // re-check the signal here: an authoritative success stays successful.
        const result = await bridge.request(
          'media.convert_image',
          { inputPath, outputPath, format },
          { signal },
        )
        return normalizeImageResult(result)
      },
    }),
  ]
}
