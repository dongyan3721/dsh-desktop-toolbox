/**
 * Closed A2 module/action table. This list must never grow implicitly; the six
 * human-only modules are absent by design.
 */

const actions = (entries) => Object.freeze(entries.map(entry => Object.freeze(entry)))

export const MODULE_SPECS = Object.freeze({
  screenshot: Object.freeze({
    id: 'screenshot',
    toolName: 'toolbox_screenshot',
    label: '截图',
    description: '查看已授权的显示器信息，或捕获指定显示器的物理像素区域。截图需要用户开启功能并单独授权 Agent 访问。',
    actions: actions([
      { id: 'monitors', method: 'agent.screenshot.monitors', image: false },
      { id: 'capture', method: 'agent.screenshot.capture', image: true },
    ]),
  }),
  clipboard: Object.freeze({
    id: 'clipboard',
    toolName: 'toolbox_clipboard',
    label: '剪贴板',
    description: '查询或读取已授权的剪贴板文本历史，或显式写入一段文本。不会自动粘贴，也不会读取图片或其他非文本内容。',
    actions: actions([
      { id: 'list', method: 'agent.clipboard.list', image: false },
      { id: 'read_text', method: 'agent.clipboard.read_text', image: false },
      { id: 'write_text', method: 'agent.clipboard.write_text', image: false },
    ]),
  }),
  screen_ink: Object.freeze({
    id: 'screen_ink',
    toolName: 'toolbox_screen_ink',
    label: '屏幕注释',
    description: '操作已授权的共享屏幕注释会话：查看状态、开始/结束、切换穿透、清空、绘制结构化笔画或获取当前画布快照。',
    actions: actions([
      { id: 'status', method: 'agent.ink.status', image: false },
      { id: 'start', method: 'agent.ink.start', image: false },
      { id: 'stop', method: 'agent.ink.stop', image: false },
      { id: 'passthrough', method: 'agent.ink.passthrough', image: false },
      { id: 'clear', method: 'agent.ink.clear', image: false },
      { id: 'draw', method: 'agent.ink.draw', image: false },
      { id: 'snapshot', method: 'agent.ink.snapshot', image: true },
    ]),
  }),
  app_usage: Object.freeze({
    id: 'app_usage',
    toolName: 'toolbox_usage',
    label: '应用使用时长',
    description: '查询已授权的应用使用时长共享统计，包括状态、日期范围概览、按应用统计和按小时统计。不会开启或修改采样设置。',
    actions: actions([
      { id: 'status', method: 'agent.usage.status', image: false },
      { id: 'overview', method: 'agent.usage.overview', image: false },
      { id: 'apps', method: 'agent.usage.apps', image: false },
      { id: 'hourly', method: 'agent.usage.hourly', image: false },
    ]),
  }),
  sticky_note: Object.freeze({
    id: 'sticky_note',
    toolName: 'toolbox_notes',
    label: '便笺',
    description: '搜索、读取、创建、更新或显式打开已授权的桌面便笺。更新必须带 expected_updated_at，冲突不会覆盖用户编辑。',
    actions: actions([
      { id: 'search', method: 'agent.notes.search', image: false },
      { id: 'read', method: 'agent.notes.read', image: false },
      { id: 'create', method: 'agent.notes.create', image: false },
      { id: 'update', method: 'agent.notes.update', image: false },
      { id: 'open', method: 'agent.notes.open', image: false },
    ]),
  }),
})

export const SUPPORTED_MODULE_IDS = Object.freeze(Object.keys(MODULE_SPECS))

export function findModuleSpec(moduleId) {
  return MODULE_SPECS[moduleId]
}

export function actionSpec(moduleId, actionId) {
  return MODULE_SPECS[moduleId]?.actions.find(action => action.id === actionId)
}
