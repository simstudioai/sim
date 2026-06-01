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
