import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createAgentToolRegistry } from '../src/agent/registry.js'
import { apply } from '../src/agent/index.js'
import {
  createAgentImagePublisher,
  MAX_AGENT_IMAGE_BYTES,
  validateArtifactDescriptor,
} from '../src/agent/image.js'

const PNG_BYTES = new Uint8Array(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z1wAAAABJRU5ErkJggg==',
  'base64',
))
const IMAGE_REF = {
  attachmentId: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
  mediaType: 'image/png',
  bytes: PNG_BYTES.byteLength,
  width: 1,
  height: 1,
  name: 'toolbox-screenshot.png',
}
const DESCRIPTOR = {
  artifact_id: 'artifact-1',
  mime_type: 'image/png',
  byte_length: PNG_BYTES.byteLength,
  width: 1,
  height: 1,
}

function createTools() {
  const definitions = new Map()
  return {
    definitions,
    register(definition) {
      if (definitions.has(definition.name)) throw new Error(`duplicate ${definition.name}`)
      definitions.set(definition.name, definition)
      return () => definitions.delete(definition.name)
    },
  }
}

function access(id) {
  return { id, agent_supported: true, agent_allowed: true, agent_effective: true }
}

function createDesktop(handler) {
  const listeners = new Set()
  return {
    snapshot: {
      revision: 1,
      modules: ['screenshot', 'screen_ink'].map(access),
      methods: ['agent.screenshot.monitors', 'agent.screenshot.capture', 'agent.ink.snapshot'],
    },
    accessCalls: 0,
    calls: [],
    async getAgentAccess() {
      this.accessCalls += 1
      return this.snapshot
    },
    async agentCall(method, params, options = {}) {
      this.calls.push({ method, params, options })
      options.signal?.throwIfAborted?.()
      return handler(method, params, options)
    },
    onAgentAccessChanged(listener) {
      listeners.add(listener)
      listener(this.snapshot)
      return () => listeners.delete(listener)
    },
  }
}

function freshSignal() {
  return new AbortController().signal
}

test('image publisher calls the actual attachment saveImage contract and rechecks access', async () => {
  const events = []
  const publisher = createAgentImagePublisher({
    attachments: {
      async saveImage(input) {
        events.push('save')
        assert.ok(input.data instanceof Uint8Array)
        assert.equal(input.mediaType, 'image/png')
        assert.equal(input.name, 'toolbox-screenshot.png')
        return IMAGE_REF
      },
    },
    artifactReader: {
      async read(descriptor, options) {
        events.push('read')
        assert.deepEqual(descriptor, DESCRIPTOR)
        assert.ok(options.signal instanceof AbortSignal)
        return { data: PNG_BYTES, mediaType: 'image/png' }
      },
    },
  })

  const value = await publisher.publish({
    moduleId: 'screenshot',
    actionId: 'capture',
    descriptor: DESCRIPTOR,
    signal: freshSignal(),
    async ensureAuthorized() {
      events.push('auth')
    },
  })

  assert.deepEqual(events, ['auth', 'read', 'auth', 'save', 'auth'])
  assert.deepEqual(value, { artifact: DESCRIPTOR, image: IMAGE_REF })
  assert.equal(Object.hasOwn(value, 'path'), false)
})

test('image access revocation before read or save prevents publication', async () => {
  let reads = 0
  let saves = 0
  const publisher = createAgentImagePublisher({
    attachments: {
      async saveImage() {
        saves += 1
        return IMAGE_REF
      },
    },
    artifactReader: {
      async read() {
        reads += 1
        return PNG_BYTES
      },
    },
  })

  await assert.rejects(
    publisher.publish({
      moduleId: 'screenshot',
      descriptor: DESCRIPTOR,
      signal: freshSignal(),
      async ensureAuthorized() {
        throw Object.assign(new Error('revoked'), { code: 'AGENT_ACCESS_DENIED' })
      },
    }),
    error => error.code === 'AGENT_ACCESS_DENIED',
  )
  assert.equal(reads, 0)
  assert.equal(saves, 0)

  let authCalls = 0
  await assert.rejects(
    publisher.publish({
      moduleId: 'screenshot',
      descriptor: DESCRIPTOR,
      signal: freshSignal(),
      async ensureAuthorized() {
        authCalls += 1
        if (authCalls === 2) throw Object.assign(new Error('revoked'), { code: 'AGENT_ACCESS_DENIED' })
      },
    }),
    error => error.code === 'AGENT_ACCESS_DENIED',
  )
  assert.equal(reads, 1)
  assert.equal(saves, 0)
})

test('image publication is cancelled without saving', async () => {
  let saves = 0
  const controller = new AbortController()
  const publisher = createAgentImagePublisher({
    attachments: {
      async saveImage() {
        saves += 1
        return IMAGE_REF
      },
    },
    artifactReader: {
      async read(_descriptor, { signal }) {
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
      },
    },
  })
  const pending = publisher.publish({
    moduleId: 'screenshot',
    descriptor: DESCRIPTOR,
    signal: controller.signal,
    async ensureAuthorized() {},
  })
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(saves, 0)
})

test('native image descriptors are bounded before any transfer', async () => {
  let reads = 0
  const publisher = createAgentImagePublisher({
    attachments: { async saveImage() { return IMAGE_REF } },
    artifactReader: {
      async read() {
        reads += 1
        return PNG_BYTES
      },
    },
  })
  const invalid = [
    [{ ...DESCRIPTOR, mime_type: 'image/jpeg' }, 'UNSUPPORTED'],
    [{ ...DESCRIPTOR, byte_length: MAX_AGENT_IMAGE_BYTES + 1 }, 'UNSUPPORTED'],
    [{ ...DESCRIPTOR, width: 0 }, 'INTERNAL'],
    [{ ...DESCRIPTOR, width: 9000, height: 9000 }, 'UNSUPPORTED'],
    [{ ...DESCRIPTOR, artifact_id: '' }, 'INTERNAL'],
    [{ ...DESCRIPTOR, artifact_id: 'bad\u0001id' }, 'INTERNAL'],
  ]
  for (const [descriptor, code] of invalid) {
    await assert.rejects(
      publisher.publish({
        moduleId: 'screenshot',
        descriptor,
        signal: freshSignal(),
        async ensureAuthorized() {},
      }),
      error => error.code === code,
    )
  }
  assert.equal(reads, 0)
})

test('A3 image caps are exactly 16MiB and 16M pixels', () => {
  const boundary = {
    ...DESCRIPTOR,
    byte_length: 1,
    width: 4000,
    height: 4000,
  }
  assert.deepEqual(validateArtifactDescriptor(boundary), {
    artifact_id: 'artifact-1',
    mime_type: 'image/png',
    byte_length: 1,
    width: 4000,
    height: 4000,
  })
  assert.throws(
    () => validateArtifactDescriptor({ ...boundary, width: 4001 }),
    error => error.code === 'UNSUPPORTED',
  )
  assert.throws(
    () => validateArtifactDescriptor({ ...boundary, byte_length: MAX_AGENT_IMAGE_BYTES + 1 }),
    error => error.code === 'UNSUPPORTED',
  )
})

test('artifact bytes must match the descriptor and image refs are sanitized', async () => {
  const publisher = createAgentImagePublisher({
    attachments: {
      async saveImage() {
        return { ...IMAGE_REF, extra: 'not-model-visible' }
      },
    },
    artifactReader: {
      async read() {
        return new Uint8Array(PNG_BYTES.byteLength + 1)
      },
    },
  })
  await assert.rejects(
    publisher.publish({
      moduleId: 'screenshot',
      descriptor: DESCRIPTOR,
      signal: freshSignal(),
      async ensureAuthorized() {},
    }),
    error => error.code === 'INTERNAL',
  )

  const good = createAgentImagePublisher({
    attachments: {
      async saveImage() {
        return { ...IMAGE_REF, extra: 'not-model-visible' }
      },
    },
    artifactReader: { async read() { return PNG_BYTES } },
  })
  const value = await good.publish({
    moduleId: 'screenshot',
    descriptor: DESCRIPTOR,
    signal: freshSignal(),
    async ensureAuthorized() {},
  })
  assert.deepEqual(value.image, IMAGE_REF)
  assert.equal(Object.hasOwn(value.image, 'extra'), false)
})

test('a committed capture survives late cancellation as a truthful partial result', async () => {
  const controller = new AbortController()
  const tools = createTools()
  let reads = 0
  let saves = 0
  const desktop = createDesktop(() => {
    controller.abort()
    return DESCRIPTOR
  })
  const registry = createAgentToolRegistry({
    tools,
    desktop,
    imagePublisher: createAgentImagePublisher({
      attachments: { async saveImage() { saves += 1; return IMAGE_REF } },
      artifactReader: { async read() { reads += 1; return PNG_BYTES } },
    }),
  })
  await registry.start(freshSignal())
  const tool = tools.definitions.get('toolbox_screenshot')

  const value = await tool.execute({
    action: 'capture',
    monitor_id: 0,
    region: { x: 0, y: 0, width: 1, height: 1 },
  }, { signal: controller.signal })

  assert.deepEqual(value, {
    artifact: DESCRIPTOR,
    image: null,
    publication: 'cancelled',
  })
  assert.equal(reads, 0)
  assert.equal(saves, 0)
  assert.equal(desktop.calls.length, 1, 'no automatic retry after late cancellation')
  const content = tool.output.render({ action: 'capture' }, value)
  assert.equal(content.length, 1)
  assert.match(content[0].text, /已捕获/)
  assert.equal(content.some(block => block.type === 'image'), false)
  registry.dispose()
})

test('registry registers image actions only with a publisher and renders the real image block', async () => {
  const tools = createTools()
  const desktop = createDesktop((method) => {
    if (method === 'agent.screenshot.capture') return DESCRIPTOR
    if (method === 'agent.ink.snapshot') return DESCRIPTOR
    return { ok: true }
  })
  const publisher = createAgentImagePublisher({
    attachments: { async saveImage() { return IMAGE_REF } },
    artifactReader: { async read() { return PNG_BYTES } },
  })
  const registry = createAgentToolRegistry({ tools, desktop, imagePublisher: publisher })
  await registry.start(freshSignal())

  const screenshot = tools.definitions.get('toolbox_screenshot')
  const ink = tools.definitions.get('toolbox_screen_ink')
  assert.deepEqual(screenshot.parameters.properties.action.enum, ['monitors', 'capture'])
  assert.deepEqual(ink.parameters.properties.action.enum, ['snapshot'])

  const capture = await screenshot.execute({
    action: 'capture',
    monitor_id: 0,
    region: { x: 0, y: 0, width: 1, height: 1 },
  }, { signal: freshSignal() })
  assert.deepEqual(capture, { artifact: DESCRIPTOR, image: IMAGE_REF })
  const captureContent = screenshot.output.render(
    { action: 'capture' },
    capture,
  )
  assert.equal(captureContent[0].type, 'text')
  assert.equal(captureContent[0].text.includes('C:\\'), false)
  assert.deepEqual(captureContent[1], { type: 'image', attachment: IMAGE_REF })

  const snapshot = await ink.execute({ action: 'snapshot' }, { signal: freshSignal() })
  const snapshotContent = ink.output.render({ action: 'snapshot' }, snapshot)
  assert.deepEqual(snapshotContent[1], { type: 'image', attachment: IMAGE_REF })
  assert.ok(desktop.accessCalls >= 8, 'each image publication rechecks access before read, save, and publication')

  registry.dispose()
})

test('assembly wires ctx.attachments and toolboxArtifacts into image actions', async () => {
  const tools = createTools()
  const desktop = createDesktop(() => DESCRIPTOR)
  const services = {
    attachments: { async saveImage() { return IMAGE_REF } },
    toolboxArtifacts: { async read() { return PNG_BYTES } },
  }
  const effects = []
  const ctx = {
    tools,
    get(name) {
      if (name === 'toolboxDesktop') return desktop
      if (name === 'tools') return tools
      return services[name]
    },
    inject(_services, callback) {
      callback({ ...ctx, toolboxDesktop: desktop })
      return () => {}
    },
    effect(factory) {
      const dispose = factory()
      effects.push(dispose)
      return dispose
    },
  }

  apply(ctx)
  await new Promise(resolve => setImmediate(resolve))
  const screenshot = tools.definitions.get('toolbox_screenshot')
  assert.ok(screenshot)
  assert.deepEqual(screenshot.parameters.properties.action.enum, ['monitors', 'capture'])
  for (const dispose of effects) if (typeof dispose === 'function') dispose()
})

test('a path-only result is never rendered as an image', async () => {
  const tools = createTools()
  const registry = createAgentToolRegistry({
    tools,
    desktop: createDesktop(() => DESCRIPTOR),
    imagePublisher: createAgentImagePublisher({
      attachments: { async saveImage() { return IMAGE_REF } },
      artifactReader: { async read() { return PNG_BYTES } },
    }),
  })
  await registry.start(freshSignal())
  const tool = tools.definitions.get('toolbox_screenshot')

  const content = tool.output.render(
    { action: 'capture' },
    { path: 'C:\\private\\shot.png' },
  )
  assert.equal(content.length, 1)
  assert.equal(content[0].type, 'text')
  assert.match(content[0].text, /shot\.png/)
  assert.equal(content.some(block => block.type === 'image'), false)
  registry.dispose()
})

test('the installed SDK confirms the image block and attachment reference shape', async () => {
  const sdk = await readFile(
    new URL('../../../vendor/harness-reference/@deepseek-ai/dsh-tool-fs/lib/index.js', import.meta.url),
    'utf8',
  )

  assert.match(sdk, /type: "text",\s*text: formatImageReadOutput/)
  assert.match(sdk, /type: "image",\s*attachment: imageRefFromValue\(value\.image\)/)
  assert.match(sdk, /attachmentId: \{\s*type: "string",\s*required: true/)
  assert.match(sdk, /mediaType: \{[\s\S]*?"image\/png"/)
  assert.match(sdk, /attachments\.saveImage\(\{\s*data,\s*mediaType,\s*name:/)
})
