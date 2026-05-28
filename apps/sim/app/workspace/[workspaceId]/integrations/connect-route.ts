/**
 * Shared protocol for deep-linking to an integration detail page with a
 * pre-opened connect modal. Owned by the integrations route; consumed by
 * the detail page itself and by external entry points (e.g. suggested
 * actions on the workspace home).
 */

export const CONNECT_QUERY_PARAM = 'connect' as const

export const CONNECT_MODE = {
  oauth: 'oauth',
  serviceAccount: 'service-account',
} as const

export type ConnectMode = (typeof CONNECT_MODE)[keyof typeof CONNECT_MODE]

/** Builds the deep-link URL for an integration's connect flow. */
export function integrationConnectHref(
  workspaceId: string,
  slug: string,
  mode: ConnectMode = CONNECT_MODE.oauth
): string {
  return `/workspace/${workspaceId}/integrations/${slug}?${CONNECT_QUERY_PARAM}=${mode}`
}
