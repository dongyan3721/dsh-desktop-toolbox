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

function resolveImagePublisher(ctx) {
  const get = typeof ctx.get === 'function' ? name => ctx.get(name) : name => ctx[name]
  const provided = get('toolboxAgentImages')
  if (provided !== undefined) return provided
  const attachments = get('attachments')
  const artifacts = get('toolboxArtifacts')
  if (attachments === undefined || artifacts === undefined) return undefined
  try {
    return createAgentImagePublisher({ attachments, artifactReader: artifacts })
  } catch {
    return undefined
  }
}

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
    // Image actions register only when the durable attachment store and the
    // Codex-owned artifact reader are both present. JSON actions do not depend
    // on either service.
    imagePublisher: resolveImagePublisher(ctx),
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
