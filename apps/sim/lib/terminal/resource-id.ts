const TERMINAL_RESOURCE_PREFIX = 'terminal:'

/**
 * The resource id for a live shell. Native terminal ids and browser tab ids
 * are both small per-chat counters, and the strip resolves resources by id
 * alone, so a shell's resource carries a namespace the page's does not.
 */
export function terminalResourceId(terminalId: string): string {
  return `${TERMINAL_RESOURCE_PREFIX}${terminalId}`
}

/** The native terminal id behind a terminal resource. */
export function terminalIdFromResourceId(resourceId: string): string {
  return resourceId.startsWith(TERMINAL_RESOURCE_PREFIX)
    ? resourceId.slice(TERMINAL_RESOURCE_PREFIX.length)
    : resourceId
}
