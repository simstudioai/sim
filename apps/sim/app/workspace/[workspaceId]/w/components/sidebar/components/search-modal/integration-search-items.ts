import type { ComponentType } from 'react'
import { blockTypeToIconMap, INTEGRATIONS } from '@/lib/integrations'
import { getServiceConfigByProviderId } from '@/lib/oauth'
import {
  CONNECT_MODE,
  CONNECT_QUERY_PARAM,
} from '@/app/workspace/[workspaceId]/integrations/connect-route'
import {
  FALLBACK_BG_COLOR,
  type IntegrationSearchItem,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/components/search-modal/utils'
import type { WorkspaceCredential } from '@/hooks/queries/credentials'

/**
 * Module-level lookup of integration metadata by OAuth service display name
 * (case-insensitive). Mirrors the same map in `integrations.tsx`.
 */
const INTEGRATION_BY_LOWER_NAME = new Map(INTEGRATIONS.map((i) => [i.name.toLowerCase(), i]))

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
    },
  ]
})

/**
 * Builds the full integration catalog as search items for a given workspace.
 * OAuth integrations link directly to the detail page with `?connect=oauth` so
 * the connect modal auto-opens (via the detail page's `useEffect` on
 * `CONNECT_QUERY_PARAM`). Non-OAuth integrations link to the plain detail page.
 */
export function buildIntegrationSearchItems(workspaceId: string): IntegrationSearchItem[] {
  return INTEGRATION_BASES.map((base) => {
    const connectSuffix =
      base.authType === 'oauth' ? `?${CONNECT_QUERY_PARAM}=${CONNECT_MODE.oauth}` : ''
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
    if (!credential.providerId) return []

    const service = getServiceConfigByProviderId(credential.providerId)
    if (!service) return []

    const integration = INTEGRATION_BY_LOWER_NAME.get(service.name.toLowerCase())

    return [
      {
        id: credential.id,
        name: credential.displayName,
        icon: service.icon as ComponentType<{ className?: string }>,
        bgColor: integration?.bgColor ?? FALLBACK_BG_COLOR,
        href: `/workspace/${workspaceId}/integrations/connected/${credential.id}`,
      },
    ]
  })
}
