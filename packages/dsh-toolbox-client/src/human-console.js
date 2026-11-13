const HUMAN_ENTRY_CHANNEL = '/api'
const CONSOLE_ENDPOINT = 'toolbox-human/console'
const PANEL_ENDPOINT = 'toolbox-human/openPanel'
const MAIN_ENDPOINT = 'toolbox-human/showMain'

const MODULE_IDS = new Set([
  'screenshot',
  'clipboard',
  'screen_ink',
  'sticky_note',
  'app_usage',
  'script_runner',
  'translator',
  'media_proc',
  'window_pin',
  'password_vault',
])
const AGENT_MODULE_IDS = new Set(['screenshot', 'clipboard', 'screen_ink', 'app_usage', 'sticky_note'])

function requireModuleId(value, supported = MODULE_IDS) {
  if (typeof value !== 'string' || !supported.has(value)) {
    throw codedError('INVALID_REQUEST', '模块标识无效')
  }
  return value
}

function requireShortcutArgs(args) {
  if (typeof args.action_id !== 'string' || args.action_id.length === 0
    || (args.hotkey !== null && typeof args.hotkey !== 'string')) {
    throw codedError('INVALID_REQUEST', '快捷键参数无效')
  }
  return { actionId: args.action_id, hotkey: args.hotkey }
}

function codedError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function safeMessage(value) {
  if (typeof value !== 'string') return ''
  return value.replace(/[\u0000-\u001F\u007F]/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, 300)
}

async function call(connection, endpoint, payload, signal) {
  if (connection === null || typeof connection !== 'object'
    || connection.rpc === null || typeof connection.rpc?.call !== 'function') {
    throw codedError('DEPENDENCY_MISSING', 'Harness Connection 不可用')
  }

  const result = await connection.rpc.call(HUMAN_ENTRY_CHANNEL, endpoint, payload, signal)
  signal?.throwIfAborted?.()
  if (result === null || typeof result !== 'object' || Array.isArray(result)
    || typeof result.ok !== 'boolean') {
    throw codedError('INTERNAL', '桌面服务返回了无效响应')
  }
  if (result.ok) return result.value

  const error = result.error
  const code = typeof error?.code === 'string' ? error.code : 'INTERNAL'
  throw codedError(code, safeMessage(error?.message) || '桌面服务请求失败')
}

async function consoleCall(connection, action, args, signal) {
  return await call(connection, CONSOLE_ENDPOINT, { action, args }, signal)
}

function requireRecord(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw codedError('INTERNAL', `${label} 响应无效`)
  }
  return value
}

function assertBoolean(value, name) {
  if (typeof value !== 'boolean') throw codedError('INVALID_REQUEST', `${name} 必须是布尔值`)
}

function requireOpened(value, label) {
  const result = requireRecord(value, label)
  if (result.opened !== true) throw codedError('INTERNAL', `${label}未确认打开`)
  return result
}

function requireShortcuts(value) {
  const result = requireRecord(value, '快捷键设置')
  if (!Array.isArray(result.shortcuts)) throw codedError('INTERNAL', '快捷键设置响应无效')
  return result.shortcuts
}

function createTransport(connection) {
  let disposed = false
  const active = new Set()

  /** @param {string} cmd @param {Record<string, any>} [args] */
  async function invoke(cmd, args = {}) {
    if (cmd === 'kernel_set_shortcut_recording' && args.recording === false) return undefined
    if (disposed) throw codedError('CANCELLED', '内嵌主控台已卸载')
    const controller = new AbortController()
    active.add(controller)
    try {
      switch (cmd) {
        case 'kernel_get_status': {
          const value = requireRecord(await consoleCall(connection, 'snapshot', {}, controller.signal), '主控台快照')
          const config = requireRecord(value.config, '一般设置')
          const general = requireRecord(config.general, '一般设置')
          if (typeof value.target_os !== 'string' || !Array.isArray(value.module_catalog)
            || typeof general.language !== 'string' || typeof general.theme !== 'string') {
            throw codedError('INTERNAL', '主控台快照缺少必要字段')
          }
          const module_catalog = value.module_catalog.map((module) => {
            const source = requireRecord(module, '模块目录')
            const fields = ['number', 'id', 'name', 'available', 'enabled', 'supported', 'unavailable_reason', 'agent_supported', 'agent_allowed', 'agent_effective']
            return Object.fromEntries(fields.filter((key) => Object.hasOwn(source, key)).map((key) => [key, source[key]]))
          })
          return {
            target_os: value.target_os,
            module_catalog,
            config: { general: { language: general.language, theme: general.theme } },
          }
        }
        case 'kernel_set_module_enabled':
          requireModuleId(args.module_id)
          assertBoolean(args.enabled, 'enabled')
          return await requireCatalog(await consoleCall(connection, 'setModuleEnabled', { moduleId: args.module_id, enabled: args.enabled }, controller.signal))
        case 'kernel_set_agent_access':
          requireModuleId(args.module_id, AGENT_MODULE_IDS)
          assertBoolean(args.allowed, 'allowed')
          return await requireCatalog(await consoleCall(connection, 'setAgentAccess', { moduleId: args.module_id, allowed: args.allowed }, controller.signal))
        case 'kernel_open_feature':
          return requireOpened(await call(connection, PANEL_ENDPOINT, { moduleId: requireModuleId(args.module_id) }, controller.signal), '功能窗口')
        case 'toolbox_open_native_main': {
          const opened = requireRecord(await call(connection, MAIN_ENDPOINT, {}, controller.signal), '原生主窗口')
          if (opened.opened !== true) throw codedError('INTERNAL', '原生主窗口未确认打开')
          return opened
        }
        case 'kernel_open_manual':
          return await consoleCall(connection, 'openManual', {}, controller.signal)
        case 'kernel_get_shortcut_preferences': {
          const value = requireRecord(await consoleCall(connection, 'getShortcutPreferences', {}, controller.signal), '快捷键设置')
          return {
            ...value,
            shortcuts: requireShortcuts(value).map((shortcut) => ({
              ...requireRecord(shortcut, '快捷键设置'),
              editable: false,
            })),
          }
        }
        case 'kernel_check_shortcut':
          return await consoleCall(connection, 'checkShortcut', requireShortcutArgs(args), controller.signal)
        case 'kernel_check_shortcuts': {
          const value = requireRecord(await consoleCall(connection, 'checkAllShortcuts', {}, controller.signal), '快捷键扫描')
          if (!Array.isArray(value.checks)) throw codedError('INTERNAL', '快捷键扫描响应无效')
          return value
        }
        case 'kernel_update_shortcut': {
          const value = await consoleCall(connection, 'updateShortcut', requireShortcutArgs(args), controller.signal)
          requireShortcuts(value)
          return value
        }
        case 'kernel_update_general_config': {
          const keys = Object.keys(args)
          if (keys.length === 0 || keys.some(key => !['language', 'theme'].includes(key))
            || (args.language !== undefined && typeof args.language !== 'string')
            || (args.theme !== undefined && typeof args.theme !== 'string')) {
            throw codedError('INVALID_REQUEST', '一般设置参数无效')
          }
          return await consoleCall(connection, 'updateGeneral', {
            ...(args.language !== undefined ? { language: args.language } : {}),
            ...(args.theme !== undefined ? { theme: args.theme } : {}),
          }, controller.signal)
        }
        case 'kernel_set_shortcut_recording':
          throw codedError('NATIVE_FOCUS_REQUIRED', '快捷键录入需要原生窗口焦点。请打开独立主窗口后进入偏好设置。')
        default:
          throw codedError('UNSUPPORTED', `内嵌主控台不支持 IPC 命令: ${String(cmd)}`)
      }
    } finally {
      active.delete(controller)
    }
  }

  /** @returns {void} */
  invoke.dispose = () => {
    if (disposed) return
    disposed = true
    for (const controller of active) controller.abort()
    active.clear()
  }

  return invoke
}

function requireCatalog(value) {
  if (!Array.isArray(value)) throw codedError('INTERNAL', '模块目录更新未返回规范状态')
  return value
}

export function createHumanConsoleTransport(connection) {
  return createTransport(connection)
}
