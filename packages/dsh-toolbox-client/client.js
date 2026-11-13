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

    function codedError(code, message) {
      const error = new Error(message)
      error.code = code
      return error
    }

    function errorCode(error) {
      return typeof error?.code === 'string' ? error.code : 'INTERNAL'
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
      throw codedError(code, safeMessage(error?.message) || '桌面服务请求失败')
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
      hint: {
        margin: '0 0 20px',
        lineHeight: 1.6,
        opacity: 0.7,
        fontSize: 13,
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
          setState({
            kind: 'error',
            code: errorCode(error),
            message: safeMessage(error?.message) || '打开桌面工具箱失败',
          })
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
        message = '已请求打开桌面工具箱。'
      } else {
        message = `无法打开桌面工具箱（${state.code}）：${state.message}`
      }

      return h('section', { style: styles.page, 'aria-live': 'polite' },
        h('h1', { style: styles.title }, '桌面工具箱'),
        h('p', { style: styles.text }, message),
        h('p', { style: styles.hint }, '这里打开的是原来的桌面工具箱窗口；本页面不发起模型请求。'),
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
