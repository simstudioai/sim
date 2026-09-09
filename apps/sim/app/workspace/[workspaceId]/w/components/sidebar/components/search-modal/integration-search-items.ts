import type { ComponentType } from 'react'
import { blockTypeToIconMap, INTEGRATIONS, resolveCredentialDisplay } from '@/lib/integrations'
import {
  CONNECT_MODE,
  CONNECT_QUERY_PARAM,
} from '@/app/workspace/[workspaceId]/integrations/connect-route'
import type { IntegrationSearchItem } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/search-modal/utils'
import type { WorkspaceCredential } from '@/hooks/queries/credentials'

/** Fallback brand color for credentials whose integration metadata cannot be resolved. */
const FALLBACK_BG_COLOR = '#6B7280'

/**
 * Module-level base array of resolvable integrations (entries without a
 * registered icon are dropped, matching the catalog's `if (!Icon) return null`
 * guard). Workspace-independent; `href` is injected per call.
 */
const INTEGRATION_BASES: readonly {
  id: string
  name: string
  icon: ComponentType<{ className?: string }>
  bgColor: string
  slug: string
  /**
   * Whether the detail page has a credential the deep link can pre-open a modal
   * for. Read from the catalog's credential services rather than `authType`,
   * because an integration can be `api-key` there and still authenticate with a
   * stored service account (NetSuite, Snowflake, Harmonic, Claude Platform).
   */
  hasCredentialService: boolean
  blockType: string
}[] = INTEGRATIONS.flatMap((integration) => {
  const icon = blockTypeToIconMap[integration.type]
  if (!icon) return []
  return [
    {
      id: integration.slug,
      name: integration.name,
      icon,
      bgColor: integration.bgColor,
      slug: integration.slug,
      hasCredentialService: Boolean(
        integration.oauthServiceId ?? integration.serviceAccountServiceId
      ),
      blockType: integration.type,
    },
  ]
})

/**
 * Builds the full integration catalog as search items for a given workspace.
 * An integration with a credential links to the detail page carrying the connect
 * mode `getConnectMode` picks for it, so that modal auto-opens (via the detail
 * page's `useEffect` on `CONNECT_QUERY_PARAM`). Everything else — and anything
 * with no connect flow currently on offer — links to the plain detail page.
 */
export function buildIntegrationSearchItems(
  workspaceId: string,
  isBlockAllowed: (blockType: string) => boolean = () => true,
  getConnectMode: (
    blockType: string
  ) => (typeof CONNECT_MODE)[keyof typeof CONNECT_MODE] | null = () => CONNECT_MODE.oauth
): IntegrationSearchItem[] {
  return INTEGRATION_BASES.filter((base) => isBlockAllowed(base.blockType)).map((base) => {
    const connectMode = base.hasCredentialService ? getConnectMode(base.blockType) : null
    const connectSuffix = connectMode ? `?${CONNECT_QUERY_PARAM}=${connectMode}` : ''
    return {
      id: base.id,
      name: base.name,
      icon: base.icon,
      bgColor: base.bgColor,
      href: `/workspace/${workspaceId}/integrations/${base.slug}${connectSuffix}`,
    }
  })
}

/**
 * Builds search items for the user's connected OAuth / service-account
 * credentials. Each item links to its credential detail page. Credentials
 * without a resolvable OAuth service are silently dropped (same guard as
 * `integrations.tsx`'s `connectedItems` memo).
 */
export function buildConnectedAccountSearchItems(
  credentials: readonly WorkspaceCredential[],
  workspaceId: string
): IntegrationSearchItem[] {
  return credentials.flatMap((credential) => {
    if (credential.type !== 'oauth' && credential.type !== 'service_account') return []

    const display = resolveCredentialDisplay(credential)
    if (!display.service || !display.icon) return []

    return [
      {
        id: credential.id,
        name: credential.displayName,
        icon: display.icon,
        bgColor: display.integration?.bgColor ?? FALLBACK_BG_COLOR,
        href: `/workspace/${workspaceId}/integrations/connected/${credential.id}`,
      },
    ]
  })
}
