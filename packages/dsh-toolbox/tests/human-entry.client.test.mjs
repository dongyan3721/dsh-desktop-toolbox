import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const clientBundleUrl = new URL('../../dsh-toolbox-client/client.js', import.meta.url)

function createFakeReact() {
  const state = []
  const refs = []
  const effects = []
  let index = 0

  return {
    __state: state,
    __refs: refs,
    __effects: effects,
    __reset() {
      index = 0
      effects.length = 0
    },
    __resetAll() {
      state.length = 0
      refs.length = 0
      effects.length = 0
      index = 0
    },
    createElement(type, props, ...children) {
      return { type, props: { ...props, children } }
    },
    useState(initial) {
      const slot = index++
      if (!(slot in state)) state[slot] = initial
      return [state[slot], next => {
        state[slot] = typeof next === 'function' ? next(state[slot]) : next
      }]
    },
    useRef(initial) {
      const slot = index++
      if (!(slot in refs)) refs[slot] = { current: initial }
      return refs[slot]
    },
    useCallback(callback) {
      index += 1
      return callback
    },
    useEffect(effect) {
      index += 1
      effects.push(effect)
    },
  }
}

async function loadClientBundle() {
  const source = await readFile(clientBundleUrl, 'utf8')
  let registration
  const fakeWindow = {
    localStorage: { getItem: () => null, setItem() {} },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    __ModuleLoader__: {
      load(value) {
        registration = value
      },
    },
  }
  // The bundle is a loader registration file, not an ESM module.
  new Function('window', 'localStorage', source)(fakeWindow, fakeWindow.localStorage)
  assert.ok(registration, 'bundle must register with __ModuleLoader__')

  const react = createFakeReact()
  const moduleExports = registration.factory((specifier) => {
    if (specifier === 'react') return react
    throw new Error(`unexpected platform module request: ${specifier}`)
  })
  return { registration, react, moduleExports }
}

function createSlots() {
  const registrations = []
  return {
    registrations,
    slots: {
      inject(_name, register) {
        return register()
      },
      register(options, component) {
        registrations.push({ options, component })
        return () => {}
      },
    },
  }
}

function createDeferredSlots() {
  const pending = []
  const registrations = []
  return {
    registrations,
    slots: {
      inject(name, register) {
        let disposed = false
        pending.push({
          name,
          run() {
            if (!disposed) register()
          },
        })
        return () => {
          disposed = true
        }
      },
      register(options, component) {
        registrations.push({ options, component })
        return () => {}
      },
    },
    declare(name) {
      for (const item of pending) {
        if (item.name === name) item.run()
      }
    },
  }
}

test('client package manifest exposes a loadable web client half', async () => {
  const packageUrl = new URL('../../dsh-toolbox-client/package.json', import.meta.url)
  const manifest = JSON.parse(await readFile(packageUrl, 'utf8'))

  assert.equal(manifest.dsh.client.platform, 'web')
  assert.deepEqual(manifest.dsh.client.inject, [])
  assert.equal(typeof manifest.exports['./client'], 'string')
  assert.equal(manifest.exports['./client'], './client.js')
  assert.ok(manifest.files.includes('client.js'))
  assert.ok(manifest.files.includes('index.js'))
  assert.ok(manifest.files.includes('cordis.patch.yml'))
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')

  const bundle = await readFile(new URL(`../../dsh-toolbox-client/${manifest.exports['./client'].slice(2)}`, import.meta.url), 'utf8')
  assert.match(bundle, /window\.__ModuleLoader__\.load\(/)
  const patch = await readFile(new URL('../../dsh-toolbox-client/cordis.patch.yml', import.meta.url), 'utf8')
  assert.match(patch, /name: dsh-toolbox-client/)
})

test('client bundle registers the expected sidebar and main panel ids', async () => {
  const { registration, moduleExports } = await loadClientBundle()

  assert.equal(registration.id, 'dsh-toolbox-client')
  assert.equal(typeof moduleExports.apply, 'function')
  assert.deepEqual(moduleExports.inject, ['slots', 'connection'])
  assert.equal(moduleExports.PANEL_ID, 'toolbox')
  assert.equal(moduleExports.HUMAN_ENTRY_CHANNEL, '/api')
})

test('client apply registers one sidebar icon and one matching main panel', async () => {
  const { moduleExports } = await loadClientBundle()
  const { registrations, slots } = createSlots()
  const connection = { rpc: { call: async () => ({ ok: true, value: {} }) } }

  moduleExports.apply({ slots, connection })

  assert.equal(registrations.length, 2)
  const main = registrations.find(entry => entry.options.name === 'main')
  const sidebar = registrations.find(entry => entry.options.name === 'sidebar.panellist')
  assert.ok(main)
  assert.ok(sidebar)
  assert.equal(main.options.key, 'toolbox')
  assert.equal(sidebar.options.id, 'toolbox')
  assert.equal(sidebar.options.label, '工具箱')
  assert.equal(typeof main.component, 'function')
  assert.equal(typeof sidebar.component, 'function')

  const icon = sidebar.component({ size: 16 })
  assert.equal(icon.type, 'svg')
  assert.equal(icon.props.width, 16)
})

test('mounting the Harness panel does not call showMain', async () => {
  const { moduleExports, react } = await loadClientBundle()
  const { registrations, slots } = createSlots()
  const calls = []
  const connection = {
    rpc: {
      async call(channel, endpoint, payload, signal) {
        calls.push({ channel, endpoint, payload, signal })
        return { ok: true, value: { opened: true, window: 'main' } }
      },
    },
  }
  moduleExports.apply({ slots, connection })
  const panel = registrations.find(entry => entry.options.name === 'main').component

  react.__reset()
  const tree = panel({ connection })
  assert.equal(calls.length, 0, 'effect must not run during render')
  assert.equal(tree.type, 'div')
  assert.equal(tree.props.className, 'dsh-toolbox-embedded')

  react.__effects[0]()
  assert.equal(calls.length, 0, 'mounting the embedded view must not show the native window')
})

test('apply waits for slot declarations instead of registering early', async () => {
  const { moduleExports } = await loadClientBundle()
  const deferred = createDeferredSlots()
  const connection = { rpc: { call: async () => ({ ok: true, value: {} }) } }

  moduleExports.apply({ slots: deferred.slots, connection })
  assert.equal(deferred.registrations.length, 0)

  deferred.declare('main')
  assert.equal(deferred.registrations.length, 1)
  assert.equal(deferred.registrations[0].options.name, 'main')

  deferred.declare('sidebar.panellist')
  assert.equal(deferred.registrations.length, 2)
  assert.equal(deferred.registrations[1].options.name, 'sidebar.panellist')
})

test('slot declaration and injection match the actual sidebar client bundle', async () => {
  const sidebar = await readFile(
    new URL('../../../vendor/harness-reference/@deepseek-ai/dsh-client-ui-sidebar/lib/client.js', import.meta.url),
    'utf8',
  )
  const ours = await readFile(clientBundleUrl, 'utf8')

  assert.match(sidebar, /"sidebar\.panellist":\s*\{\s*kind:\s*"list"/)
  assert.match(sidebar, /ctx\.slots\.inject\("sidebar",\s*\(\)\s*=>\s*ctx\.slots\.register\(\{/)
  assert.match(ours, /ctx\.slots\.inject\('main',/)
  assert.match(ours, /ctx\.slots\.inject\('sidebar\.panellist',/)
})

test('callHumanEntry maps success and propagates stable failures', async () => {
  const { moduleExports } = await loadClientBundle()
  const signal = new AbortController().signal
  const connection = {
    rpc: {
      async call(channel, endpoint, payload, receivedSignal) {
        assert.equal(channel, '/api')
        assert.equal(endpoint, 'toolbox-human/openPanel')
        assert.deepEqual(payload, { moduleId: 'preferences' })
        assert.equal(receivedSignal, signal)
        return { ok: true, value: { opened: true } }
      },
    },
  }

  const value = await moduleExports.callHumanEntry(
    connection,
    'openPanel',
    { moduleId: 'preferences' },
    signal,
  )
  assert.deepEqual(value, { opened: true })

  const denied = {
    rpc: {
      async call() {
        return { ok: false, error: { code: 'ACCESS_DENIED', message: 'denied', details: {} } }
      },
    },
  }
  await assert.rejects(
    moduleExports.callHumanEntry(denied, 'showMain', {}, signal),
    error => error.code === 'ACCESS_DENIED' && error.message === 'denied',
  )
})

test('callHumanEntry rejects invalid envelopes and aborted calls', async () => {
  const { moduleExports } = await loadClientBundle()
  const invalid = { rpc: { async call() { return { value: true } } } }
  await assert.rejects(
    moduleExports.callHumanEntry(invalid, 'status', {}, freshSignal()),
    error => error.code === 'INTERNAL',
  )

  const missing = { rpc: {} }
  await assert.rejects(
    moduleExports.callHumanEntry(missing, 'status', {}, freshSignal()),
    error => error.code === 'DEPENDENCY_MISSING',
  )

  const controller = new AbortController()
  const aborting = {
    rpc: {
      async call() {
        controller.abort()
        return { ok: true, value: {} }
      },
    },
  }
  await assert.rejects(
    moduleExports.callHumanEntry(aborting, 'status', {}, controller.signal),
    { name: 'AbortError' },
  )
})

test('client bundle carries the original dashboard instead of a status-only placeholder', async () => {
  const source = await readFile(clientBundleUrl, 'utf8')
  assert.match(source, /mountEmbeddedDashboard/)
  assert.match(source, /快捷键录入需要原生窗口焦点/)
  assert.match(source, /setAgentAccess/)
  assert.match(source, /attachShadow/)
  assert.doesNotMatch(source, /logo\.svg/)
  assert.doesNotMatch(source, /require\(['"](?:node:|fs|path|child_process|vue)/)
  assert.doesNotMatch(source, /process\.env/)
  assert.doesNotMatch(source, /callHumanEntry\(connection,\s*['"]showMain['"]/)
})

function freshSignal() {
  return new AbortController().signal
}
