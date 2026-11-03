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
  authType: string
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
      authType: integration.authType,
      blockType: integration.type,
    },
  ]
})

/**
 * Builds the integrations the viewer can use as search items for a given
 * workspace. `isUsable` is required, not defaulted, so a caller cannot list the
 * whole catalog by omission; pass the `useIntegrationAccess` verdict. OAuth
 * integrations link to the detail page with `?connect=oauth` so the connect
 * modal auto-opens; non-OAuth integrations link to the plain detail page.
 */
export function buildIntegrationSearchItems(
  workspaceId: string,
  isUsable: (blockType: string) => boolean,
  getConnectMode: (
    blockType: string
  ) => (typeof CONNECT_MODE)[keyof typeof CONNECT_MODE] | null = () => CONNECT_MODE.oauth
): IntegrationSearchItem[] {
  return INTEGRATION_BASES.filter((base) => isUsable(base.blockType)).map((base) => {
    const connectMode = base.authType === 'oauth' ? getConnectMode(base.blockType) : null
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
