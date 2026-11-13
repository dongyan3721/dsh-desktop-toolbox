/**
 * Host loader entry for the human-visible toolbox client package.
 *
 * The Client half is `./client` (see package.json#exports). The Host half is
 * intentionally a re-export of the narrow adapter owned by dsh-toolbox so the
 * desktop service is consumed in one place. Codex must expose
 * `dsh-toolbox/human-entry` from the main package.
 */

export const name = 'dsh-toolbox-client'
export { inject, apply, HUMAN_ENTRY_CHANNEL } from 'dsh-toolbox/human-entry'
