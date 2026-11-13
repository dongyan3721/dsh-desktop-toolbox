/**
 * A2 Agent tool assembly.
 *
 * This module owns only the four supported module tools. It reuses the
 * Codex-owned toolboxDesktop service and never starts a native owner, a
 * headless kernel, or another database. Tool visibility follows the native
 * advertised methods plus the effective access snapshot; every execution
 * rechecks the same snapshot before calling the service.
 */

import { createAgentToolRegistry } from './registry.js'

export const name = 'dsh-toolbox-agent-tools'
export const inject = ['tools']

/**
 * Create the dynamic registry for the injected toolboxDesktop service.
 * @param {object} ctx - scoped Cordis context containing tools/toolboxDesktop.
 * @returns {import('./registry.js').AgentToolRegistry}
 */
export function createAgentToolsForContext(ctx) {
  const desktop = ctx.toolboxDesktop ?? ctx.get?.('toolboxDesktop')
  const tools = ctx.tools ?? ctx.get?.('tools')
  return createAgentToolRegistry({
    tools,
    desktop,
    // Image publication is added by the SDK image stage. JSON actions remain
    // available even when no artifact publisher is wired.
    imagePublisher: ctx.toolboxAgentImages ?? ctx.get?.('toolboxAgentImages'),
  })
}

/**
 * Cordis function plugin. The registry activates only while toolboxDesktop is
 * present and is disposed with the injected service scope.
 *
 * @param {object} ctx - Host plugin context.
 */
export function apply(ctx) {
  ctx.inject(['toolboxDesktop'], (desktopCtx) => {
    const registry = createAgentToolsForContext(desktopCtx)
    desktopCtx.effect(() => () => registry.dispose(), 'dsh-toolbox agent tools')
    void registry.start().catch(() => registry.dispose())
  })
}
