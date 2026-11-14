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
import { createAgentImagePublisher } from './image.js'

export const name = 'dsh-toolbox-agent-tools'
export const inject = ['tools']

/**
 * Create the dynamic registry for the injected toolboxDesktop service.
 * @param {object} ctx - scoped Cordis context containing tools/toolboxDesktop.
 * @param {object} [imagePublisher] - explicit publisher override for focused tests.
 * @returns {import('./registry.js').AgentToolRegistry}
 */
export function createAgentToolsForContext(ctx, imagePublisher) {
  const get = typeof ctx.get === 'function' ? name => ctx.get(name) : name => ctx[name]
  const desktop = ctx.toolboxDesktop ?? get('toolboxDesktop')
  const tools = ctx.tools ?? get('tools')
  const provided = imagePublisher ?? get('toolboxAgentImages')
  return createAgentToolRegistry({ tools, desktop, imagePublisher: provided })
}

/**
 * Image actions depend on two services that may arrive after the Agent entry.
 * A Cordis injection scope activates them when both appear and withdraws them
 * when either is removed, without restarting the desktop runtime.
 */
function applyImageServices(desktopCtx, registry) {
  desktopCtx.inject(['attachments', 'toolboxArtifacts'], imageCtx => {
    const get = typeof imageCtx.get === 'function' ? name => imageCtx.get(name) : name => imageCtx[name]
    let publisher
    try {
      publisher = createAgentImagePublisher({
        attachments: get('attachments'),
        artifactReader: get('toolboxArtifacts'),
      })
    } catch {
      return
    }
    registry.setImagePublisher(publisher)
    imageCtx.effect(
      () => () => registry.setImagePublisher(undefined),
      'dsh-toolbox agent image services',
    )
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
    applyImageServices(desktopCtx, registry)
    void registry.start().catch(() => registry.dispose())
  })
}
