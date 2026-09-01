/**
 * Shared protocol for deep-linking to an integration detail page with a
 * pre-opened connect modal. Owned by the integrations route; consumed by
 * the detail page's `?connect=oauth|service-account` query handler.
 */

export const CONNECT_QUERY_PARAM = 'connect' as const

export const CONNECT_MODE = {
  oauth: 'oauth',
  serviceAccount: 'service-account',
} as const

export type ConnectMode = (typeof CONNECT_MODE)[keyof typeof CONNECT_MODE]

interface ConnectModeAvailability {
  oauth: boolean
  serviceAccount: boolean
}

/** `null` lets callers preserve the deep-link while deployment and block visibility hydrate. */
export function resolveAvailableConnectMode(
  connectMode: ConnectMode,
  availability: ConnectModeAvailability
): ConnectMode | null {
  if (connectMode === CONNECT_MODE.oauth && availability.oauth) return connectMode
  if (connectMode === CONNECT_MODE.serviceAccount && availability.serviceAccount) {
    return connectMode
  }
  return null
}
