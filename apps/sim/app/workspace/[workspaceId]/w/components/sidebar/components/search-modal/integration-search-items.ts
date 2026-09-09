import type { ComponentType } from 'react'
import { blockTypeToIconMap, INTEGRATIONS, resolveCredentialDisplay } from '@/lib/integrations'
import {
  CONNECT_MODE,
  CONNECT_QUERY_PARAM,
  type ConnectMode,
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
   * The connect flow this integration would offer knowing only the catalog, or
   * `null` when it has no credential at all. Derived from the credential
   * services rather than `authType`, because an integration can be `api-key`
   * there and still authenticate with a stored service account (NetSuite,
   * Snowflake, Harmonic, Claude Platform). Used as the deep link while
   * deployment availability is unknown, where assuming OAuth would send those
   * four to a page that has no OAuth flow to open.
   */
  catalogConnectMode: ConnectMode | null
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
      catalogConnectMode: integration.oauthServiceId
        ? CONNECT_MODE.oauth
        : integration.serviceAccountServiceId
          ? CONNECT_MODE.serviceAccount
          : null,
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
 *
 * `getConnectMode` receives the catalog's own answer as its second argument, to
 * return verbatim when deployment availability cannot be read; returning `null`
 * means the deployment offers no connect flow, which is not the same thing.
 */
export function buildIntegrationSearchItems(
  workspaceId: string,
  isBlockAllowed: (blockType: string) => boolean = () => true,
  getConnectMode: (blockType: string, catalogConnectMode: ConnectMode) => ConnectMode | null = (
    _blockType,
    catalogConnectMode
  ) => catalogConnectMode
): IntegrationSearchItem[] {
  return INTEGRATION_BASES.filter((base) => isBlockAllowed(base.blockType)).map((base) => {
    const connectMode = base.catalogConnectMode
      ? getConnectMode(base.blockType, base.catalogConnectMode)
      : null
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
