import test from 'node:test'
import assert from 'node:assert/strict'
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import { createImageTools } from '../src/features/images.js'

const INPUT = 'D:\\Code\\dsh-toolbox\\artifacts\\input.png'
const OUTPUT = 'D:\\Code\\dsh-toolbox\\artifacts\\output.webp'

function createFakeBridge(handler = () => ({ outputPath: OUTPUT, format: 'webp' })) {
  const calls = []
  return {
    calls,
    async request(method, params, options) {
      calls.push({ method, params, options })
      return handler(method, params, options)
    },
  }
}

function imageTool(bridge, options) {
  return createImageTools(bridge, options)[0]
}

function freshSignal() {
  return new AbortController().signal
}

test('createImageTools exposes one image conversion tool', () => {
  const tools = createImageTools(createFakeBridge(), { authorizePaths: async () => true })
  assert.deepEqual(tools.map(entry => entry.name), ['toolbox_image_convert'])
  assert.equal(tools[0].output.schema.additionalProperties, false)
})

test('createImageTools rejects a missing or malformed bridge', () => {
  assert.throws(() => createImageTools(null), TypeError)
  assert.throws(() => createImageTools({}), TypeError)
})

test('image conversion authorizes paths before the media.convert_image request', async () => {
  const events = []
  const bridge = createFakeBridge(() => {
    events.push('bridge')
    return { outputPath: OUTPUT, format: 'webp' }
  })
  const tool = imageTool(bridge, {
    authorizePaths: async request => {
      events.push('authorize')
      assert.deepEqual(request.inputPath, INPUT)
      assert.deepEqual(request.outputPath, OUTPUT)
      assert.equal(request.format, 'webp')
      assert.equal(request.signal, signal)
      return true
    },
  })
  const signal = freshSignal()

  const value = await tool.execute({ inputPath: INPUT, outputPath: OUTPUT, format: 'webp' }, { signal })

  assert.deepEqual(events, ['authorize', 'bridge'])
  assert.equal(bridge.calls.length, 1)
  assert.equal(bridge.calls[0].method, 'media.convert_image')
  assert.deepEqual(bridge.calls[0].params, {
    inputPath: INPUT,
    outputPath: OUTPUT,
    format: 'webp',
  })
  assert.equal(bridge.calls[0].options.signal, signal)
  assert.deepEqual(value, { outputPath: OUTPUT, format: 'webp' })
  assert.deepEqual(validateJsonSchemaValue(tool.output.schema, value), [])
})

test('missing authorizer fails closed without calling the bridge', async () => {
  const bridge = createFakeBridge()
  const tool = imageTool(bridge)

  await assert.rejects(
    tool.execute({ inputPath: INPUT, outputPath: OUTPUT, format: 'webp' }, { signal: freshSignal() }),
    error => error.code === 'ACCESS_DENIED',
  )
  assert.equal(bridge.calls.length, 0)
})

test('non-function authorizer fails closed without calling the bridge', async () => {
  const bridge = createFakeBridge()
  const tool = imageTool(bridge, { authorizePaths: true })

  await assert.rejects(
    tool.execute({ inputPath: INPUT, outputPath: OUTPUT, format: 'webp' }, { signal: freshSignal() }),
    error => error.code === 'ACCESS_DENIED',
  )
  assert.equal(bridge.calls.length, 0)
})

test('authorization denial fails closed without calling the bridge', async () => {
  const bridge = createFakeBridge()
  const tool = imageTool(bridge, { authorizePaths: async () => false })

  await assert.rejects(
    tool.execute({ inputPath: INPUT, outputPath: OUTPUT, format: 'png' }, { signal: freshSignal() }),
    error => error.code === 'ACCESS_DENIED',
  )
  assert.equal(bridge.calls.length, 0)
})

test('a truthy but non-true authorizer decision is denied', async () => {
  const bridge = createFakeBridge()
  const tool = imageTool(bridge, { authorizePaths: async () => 1 })

  await assert.rejects(
    tool.execute({ inputPath: INPUT, outputPath: OUTPUT, format: 'png' }, { signal: freshSignal() }),
    error => error.code === 'ACCESS_DENIED',
  )
  assert.equal(bridge.calls.length, 0)
})

test('authorizer exceptions propagate and never call the bridge', async () => {
  const failure = Object.assign(new Error('outside authorized roots'), { code: 'ACCESS_DENIED' })
  const bridge = createFakeBridge()
  const tool = imageTool(bridge, { authorizePaths: async () => { throw failure } })

  await assert.rejects(
    tool.execute({ inputPath: INPUT, outputPath: OUTPUT, format: 'png' }, { signal: freshSignal() }),
    error => error === failure,
  )
  assert.equal(bridge.calls.length, 0)
})

test('image conversion schema and domain checks reject invalid input before authorization', async () => {
  let authorized = 0
  const bridge = createFakeBridge()
  const tool = imageTool(bridge, { authorizePaths: async () => { authorized += 1; return true } })

  await assert.rejects(
    tool.execute({ inputPath: INPUT, outputPath: OUTPUT, format: 'gif' }, { signal: freshSignal() }),
    error => error.code === 'INVALID_ARGS',
  )
  await assert.rejects(
    tool.execute({ inputPath: INPUT, format: 'png' }, { signal: freshSignal() }),
    error => error.code === 'INVALID_ARGS',
  )
  await assert.rejects(
    tool.execute({ inputPath: '   ', outputPath: OUTPUT, format: 'png' }, { signal: freshSignal() }),
    error => error.code === 'INVALID_REQUEST',
  )
  await assert.rejects(
    tool.execute({ inputPath: INPUT, outputPath: OUTPUT, format: 'png', overwrite: true }, { signal: freshSignal() }),
    error => error.code === 'INVALID_REQUEST',
  )
  assert.equal(authorized, 0)
  assert.equal(bridge.calls.length, 0)
})

test('image conversion propagates bridge errors unchanged', async () => {
  const failure = Object.assign(new Error('output exists'), { code: 'CONFLICT' })
  const bridge = createFakeBridge(() => { throw failure })
  const tool = imageTool(bridge, { authorizePaths: async () => true })

  await assert.rejects(
    tool.execute({ inputPath: INPUT, outputPath: OUTPUT, format: 'png' }, { signal: freshSignal() }),
    error => error === failure,
  )
  assert.equal(bridge.calls.length, 1)
})

test('image conversion rejects an invalid native result', async () => {
  const bridge = createFakeBridge(() => ({ outputPath: OUTPUT, format: 'gif' }))
  const tool = imageTool(bridge, { authorizePaths: async () => true })

  await assert.rejects(
    tool.execute({ inputPath: INPUT, outputPath: OUTPUT, format: 'png' }, { signal: freshSignal() }),
    error => error.code === 'INTERNAL',
  )
})

test('pre-aborted image conversion skips authorization and the bridge', async () => {
  let authorized = 0
  const bridge = createFakeBridge()
  const tool = imageTool(bridge, { authorizePaths: async () => { authorized += 1; return true } })
  const controller = new AbortController()
  controller.abort()

  await assert.rejects(
    tool.execute({ inputPath: INPUT, outputPath: OUTPUT, format: 'png' }, { signal: controller.signal }),
    { name: 'AbortError' },
  )
  assert.equal(authorized, 0)
  assert.equal(bridge.calls.length, 0)
})

test('cancellation during authorization prevents the bridge request', async () => {
  const controller = new AbortController()
  const bridge = createFakeBridge()
  const tool = imageTool(bridge, {
    authorizePaths: async () => {
      controller.abort()
      return true
    },
  })

  await assert.rejects(
    tool.execute({ inputPath: INPUT, outputPath: OUTPUT, format: 'png' }, { signal: controller.signal }),
    { name: 'AbortError' },
  )
  assert.equal(bridge.calls.length, 0)
})

test('cancellation during the bridge request is forwarded through exec.signal', async () => {
  let receivedSignal
  const bridge = {
    request(_method, _params, options) {
      receivedSignal = options.signal
      return new Promise((_resolve, reject) => {
        if (options.signal.aborted) {
          reject(options.signal.reason)
          return
        }
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
      })
    },
  }
  const tool = imageTool(bridge, { authorizePaths: async () => true })
  const controller = new AbortController()

  const pending = tool.execute(
    { inputPath: INPUT, outputPath: OUTPUT, format: 'png' },
    { signal: controller.signal },
  )
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(receivedSignal, controller.signal)
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
})

test('image renderer is pure and does not authorize or call the bridge', () => {
  let authorized = 0
  const bridge = createFakeBridge()
  const tool = imageTool(bridge, { authorizePaths: async () => { authorized += 1; return true } })

  const content = tool.output.render(
    { inputPath: INPUT, outputPath: OUTPUT, format: 'webp' },
    { outputPath: OUTPUT, format: 'webp' },
  )

  assert.equal(content[0].type, 'text')
  assert.match(content[0].text, /output\.webp/)
  assert.equal(authorized, 0)
  assert.equal(bridge.calls.length, 0)
})
