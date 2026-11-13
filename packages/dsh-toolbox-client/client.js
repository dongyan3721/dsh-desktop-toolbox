window.__ModuleLoader__.load({
  id: 'dsh-toolbox-client',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement

    const HUMAN_ENTRY_CHANNEL = '/toolbox-human'
    const PANEL_ID = 'toolbox'
    const PANEL_LABEL = '工具箱'

    const HUMAN_ERROR_MESSAGES = {
      DEPENDENCY_MISSING: '桌面服务尚未就绪。请确认工具箱已安装，然后重启 Harness。',
      NATIVE_UNAVAILABLE: '桌面工具箱当前不可用。请重新打开 Harness，或在设置中重新启用工具箱。',
      NATIVE_START_FAILED: '桌面工具箱启动失败。请确认没有另一个工具箱实例占用数据目录，然后重试。',
      NATIVE_START_TIMEOUT: '桌面工具箱启动超时。请稍后重试；若持续失败，请重启 Harness。',
      NATIVE_INTEGRITY: '桌面工具箱程序校验失败。请重新安装发布包。',
      DESKTOP_PROTOCOL: '桌面工具箱与当前 Harness 版本不匹配。请更新后重试。',
      DESKTOP_CAPABILITIES: '当前桌面程序缺少必要功能。请重新安装发布包。',
      DESKTOP_SHUTDOWN_FAILED: '上次关闭未完成，可能有未保存内容。请查看桌面工具箱窗口后再重试。',
      OUTCOME_UNKNOWN: '操作结果未确认。请查看桌面工具箱窗口是否已经打开，再决定是否重试。',
      CANCELLED: '操作已取消。',
      TIMEOUT: '操作超时。请稍后重试。',
      UNSUPPORTED: '当前版本不支持此操作。请更新工具箱。',
      DISABLED: '工具箱功能已关闭。请在设置中启用。',
      ACCESS_DENIED: '没有权限执行此操作。',
      INVALID_REQUEST: '请求无效。请重试；若持续失败，请重启 Harness。',
      INTERNAL: '桌面工具箱出现异常。请重试；若持续失败，请重启 Harness。',
    }
    const DEFAULT_ERROR_MESSAGE = '桌面工具箱暂时无法打开。请稍后重试。'

    function codedError(code, message) {
      const error = new Error(message)
      error.code = code
      return error
    }

    function errorCode(error) {
      return typeof error?.code === 'string' ? error.code : 'INTERNAL'
    }

    function humanErrorMessage(error) {
      return HUMAN_ERROR_MESSAGES[errorCode(error)] ?? DEFAULT_ERROR_MESSAGE
    }

    function safeMessage(value) {
      if (typeof value !== 'string') return ''
      return value
        .replace(/[\u0000-\u001F\u007F]/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim()
        .slice(0, 300)
    }

    /**
     * Call one human-entry endpoint over the installed generic Connection RPC.
     * No retries: the desktop service owns idempotence for show/open actions.
     */
    async function callHumanEntry(connection, endpoint, payload, signal) {
      if (connection === undefined || connection === null
        || connection.rpc === undefined || connection.rpc === null
        || typeof connection.rpc.call !== 'function') {
        throw codedError('DEPENDENCY_MISSING', 'Harness Connection 不可用')
      }
      const result = await connection.rpc.call(HUMAN_ENTRY_CHANNEL, endpoint, payload, signal)
      signal?.throwIfAborted?.()
      if (result === null || typeof result !== 'object' || Array.isArray(result)
        || typeof result.ok !== 'boolean') {
        throw codedError('INTERNAL', '桌面服务返回了无效响应')
      }
      if (result.ok === true) return result.value
      const error = result.error
      const code = typeof error?.code === 'string' ? error.code : 'INTERNAL'
      const failure = codedError(code, safeMessage(error?.message) || '桌面服务请求失败')
      if (error?.details !== null && typeof error?.details === 'object' && !Array.isArray(error.details)) {
        failure.details = { ...error.details }
      }
      throw failure
    }

    const styles = {
      page: {
        boxSizing: 'border-box',
        maxWidth: 640,
        margin: '0 auto',
        padding: '32px 24px',
        color: 'inherit',
        font: 'inherit',
      },
      title: {
        margin: '0 0 12px',
        fontSize: 22,
        fontWeight: 600,
      },
      text: {
        margin: '0 0 12px',
        lineHeight: 1.6,
      },
      button: {
        minHeight: 32,
        padding: '0 14px',
        borderRadius: 8,
        border: '1px solid currentColor',
        background: 'transparent',
        color: 'inherit',
        font: 'inherit',
        cursor: 'pointer',
      },
    }

    function ToolboxIcon({ size = 16 }) {
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 16 16',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.5,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
        focusable: 'false',
      },
        h('rect', { x: 2, y: 5, width: 12, height: 9, rx: 1.5 }),
        h('path', { d: 'M5 5V3.5A1.5 1.5 0 0 1 6.5 2h3A1.5 1.5 0 0 1 11 3.5V5' }),
        h('path', { d: 'M2 8h12' }),
        h('path', { d: 'M7 8v2h2V8' }),
      )
    }

    function ToolboxPanel({ connection }) {
      const [state, setState] = React.useState({ kind: 'opening' })
      const controllerRef = React.useRef(null)

      const open = React.useCallback(async () => {
        controllerRef.current?.abort()
        const controller = new AbortController()
        controllerRef.current = controller
        setState({ kind: 'opening' })
        try {
          const value = await callHumanEntry(connection, 'showMain', {}, controller.signal)
          if (controller.signal.aborted) return
          if (value === null || typeof value !== 'object' || value.opened !== true) {
            throw codedError('INTERNAL', '桌面服务未确认打开')
          }
          setState({ kind: 'opened' })
        } catch (error) {
          if (controller.signal.aborted) return
          const failure = error instanceof Error ? error : codedError('INTERNAL', '打开桌面工具箱失败')
          setState({ kind: 'error', error: failure })
        }
      }, [connection])

      React.useEffect(() => {
        void open()
        return () => {
          controllerRef.current?.abort()
        }
      }, [open])

      let message
      if (state.kind === 'opening') {
        message = '正在打开桌面工具箱…'
      } else if (state.kind === 'opened') {
        message = '桌面工具箱已打开。'
      } else {
        message = humanErrorMessage(state.error)
      }

      return h('section', { style: styles.page, 'aria-live': 'polite' },
        h('h1', { style: styles.title }, '桌面工具箱'),
        h('p', { style: styles.text }, message),
        h('button', {
          type: 'button',
          style: styles.button,
          onClick: () => {
            void open()
          },
        }, state.kind === 'error' ? '重试' : '重新打开'),
      )
    }

    function apply(ctx) {
      const connection = ctx.connection ?? ctx.get?.('connection')

      ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: PANEL_ID,
        inject: () => ({ connection }),
      }, ToolboxPanel))

      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: 0,
        label: PANEL_LABEL,
      }, ToolboxIcon))
    }

    exports.apply = apply
    exports.inject = ['slots', 'connection']
    exports.PANEL_ID = PANEL_ID
    exports.HUMAN_ENTRY_CHANNEL = HUMAN_ENTRY_CHANNEL
    exports.callHumanEntry = callHumanEntry
    return module.exports
  },
})
