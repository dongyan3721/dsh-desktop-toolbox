import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHumanConsoleTransport } from '../../dsh-toolbox-client/src/human-console.js'

function createConnection(handler = async () => ({ ok: true, value: {} })) {
  const calls = []
  return {
    calls,
    connection: {
      rpc: {
        async call(channel, endpoint, payload, signal) {
          calls.push({ channel, endpoint, payload, signal })
          return await handler(channel, endpoint, payload, signal)
        },
      },
    },
  }
}

test('embedded transport sends a minimal snapshot request without opening the native main window', async () => {
  const { calls, connection } = createConnection(async (_channel, endpoint, payload) => {
    assert.equal(endpoint, 'toolbox-human/console')
    assert.deepEqual(payload, { action: 'snapshot', args: {} })
    return {
      ok: true,
      value: {
        target_os: 'windows',
        module_catalog: [{
          id: 'screenshot',
          name: 'Screenshot',
          enabled: true,
          available: true,
          supported: true,
          agent_supported: true,
          agent_allowed: false,
          private_record: 'must not cross the client projection',
        }],
        config: { general: { language: 'zh-CN', theme: 'dark', secret: 'private' } },
        clipboard_history: ['private'],
      },
    }
  })
  const transport = createHumanConsoleTransport(connection)

  const snapshot = await transport('kernel_get_status')

  assert.deepEqual(snapshot, {
    target_os: 'windows',
    module_catalog: [{
      id: 'screenshot',
      name: 'Screenshot',
      enabled: true,
      available: true,
      supported: true,
      agent_supported: true,
      agent_allowed: false,
    }],
    config: { general: { language: 'zh-CN', theme: 'dark' } },
  })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].endpoint, 'toolbox-human/console')
  transport.dispose()
})

test('module and Agent switches map to distinct actions and preserve concurrent responses', async () => {
  const pending = []
  const { calls, connection } = createConnection((_channel, _endpoint, payload) => new Promise(resolve => {
    pending.push({ action: payload.action, resolve })
  }))
  const transport = createHumanConsoleTransport(connection)
  const human = transport('kernel_set_module_enabled', { module_id: 'screenshot', enabled: false })
  const agent = transport('kernel_set_agent_access', { module_id: 'sticky_note', allowed: true })

  assert.deepEqual(calls.map(call => call.payload), [
    { action: 'setModuleEnabled', args: { moduleId: 'screenshot', enabled: false } },
    { action: 'setAgentAccess', args: { moduleId: 'sticky_note', allowed: true } },
  ])
  pending[1].resolve({ ok: true, value: ['agent-catalog'] })
  pending[0].resolve({ ok: true, value: ['module-catalog'] })
  assert.deepEqual(await Promise.all([human, agent]), [['module-catalog'], ['agent-catalog']])
  transport.dispose()
})

test('concrete panels and native main window use explicit existing endpoints', async () => {
  const { calls, connection } = createConnection(async (_channel, endpoint) => ({
    ok: true,
    value: endpoint === 'toolbox-human/showMain' ? { opened: true } : { opened: true },
  }))
  const transport = createHumanConsoleTransport(connection)
  assert.equal(calls.length, 0, 'mounting the transport does not show the main window')

  await transport('kernel_open_feature', { module_id: 'sticky_note' })
  await transport('toolbox_open_native_main')
  assert.deepEqual(calls.map(({ endpoint, payload }) => ({ endpoint, payload })), [
    { endpoint: 'toolbox-human/openPanel', payload: { moduleId: 'sticky_note' } },
    { endpoint: 'toolbox-human/showMain', payload: {} },
  ])
  await assert.rejects(transport('kernel_open_feature', { module_id: 'random' }), { code: 'INVALID_REQUEST' })
  transport.dispose()
})

test('preferences use the closed actions and reject arbitrary general configuration', async () => {
  const { calls, connection } = createConnection(async (_channel, _endpoint, payload) => ({
    ok: true,
    value: { saved: payload.args },
  }))
  const transport = createHumanConsoleTransport(connection)
  await transport('kernel_update_general_config', { language: 'ja-JP', theme: 'dark' })
  assert.deepEqual(calls[0].payload, {
    action: 'updateGeneral',
    args: { language: 'ja-JP', theme: 'dark' },
  })
  await assert.rejects(
    transport('kernel_update_general_config', { data_dir: 'D:\\private' }),
    error => error.code === 'INVALID_REQUEST',
  )
  assert.equal(calls.length, 1)
  transport.dispose()
})

test('embedded shortcuts remain readable but editing requires native WebView focus', async () => {
  const { calls, connection } = createConnection(async (_channel, _endpoint, payload) => ({
    ok: true,
    value: { shortcuts: [{ spec: { action_id: 'screenshot:capture' }, editable: true }] },
  }))
  const transport = createHumanConsoleTransport(connection)

  const result = await transport('kernel_get_shortcut_preferences')
  assert.equal(result.shortcuts[0].editable, false)
  assert.equal(calls[0].payload.action, 'getShortcutPreferences')
  await assert.rejects(
    transport('kernel_set_shortcut_recording', { recording: true }),
    error => error.code === 'NATIVE_FOCUS_REQUIRED',
  )
  assert.equal(calls.length, 1, 'native keyboard recording is not fabricated over Client RPC')
  transport.dispose()
})

test('service disconnect and native failures remain failures, not successful fallbacks', async () => {
  const { connection: disconnected } = createConnection(async () => ({
    ok: false,
    error: { code: 'NATIVE_UNAVAILABLE', message: 'native service disconnected' },
  }))
  const transport = createHumanConsoleTransport(disconnected)
  await assert.rejects(transport('kernel_get_status'), error => error.code === 'NATIVE_UNAVAILABLE')
  transport.dispose()

  const { connection: rejected } = createConnection(async () => ({
    ok: false,
    error: { code: 'DISABLED', message: 'module is disabled' },
  }))
  const failedToggle = createHumanConsoleTransport(rejected)
  await assert.rejects(
    failedToggle('kernel_set_module_enabled', { module_id: 'screenshot', enabled: false }),
    error => error.code === 'DISABLED',
  )
  failedToggle.dispose()
})

test('unmount aborts in-flight RPCs and unknown IPC is rejected locally', async () => {
  let receivedSignal
  const { calls, connection } = createConnection((_channel, _endpoint, _payload, signal) => {
    receivedSignal = signal
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
  })
  const transport = createHumanConsoleTransport(connection)
  const pending = transport('kernel_get_status')
  assert.equal(calls.length, 1)
  transport.dispose()
  await assert.rejects(pending)
  assert.equal(receivedSignal.aborted, true)
  await assert.rejects(transport('kernel_get_status'), { code: 'CANCELLED' })

  const noCalls = createConnection()
  const closed = createHumanConsoleTransport(noCalls.connection)
  await assert.rejects(closed('ipc', { cmd: 'kernel_shutdown' }), { code: 'UNSUPPORTED' })
  assert.equal(noCalls.calls.length, 0)
  closed.dispose()
})

test('embedded dashboard keeps native shortcuts and the independent window explicitly reachable', async () => {
  const source = await readFile(
    new URL('../../../native/YourAllIn1Helper/src-ui/src/components/Dashboard.vue', import.meta.url),
    'utf8',
  )
  assert.match(source, /快捷键录入需要原生窗口焦点/)
  assert.match(source, /v-if="embedded" class="footer-link" @click="openNativeMain"/)
  assert.match(source, /v-else class="footer-link quit" @click="shutdownDaemon"/)
  const mounted = source.match(/onMounted\(async \(\) => \{([\s\S]*?)\n\}\);/)[1]
  assert.doesNotMatch(mounted, /openNativeMain|showMain/)
})
