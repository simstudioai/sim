import type { ComponentType } from 'react'
import { getIntegrationsForCredentialProvider } from '@/lib/integrations/credential-display'
import {
  getCanonicalScopesForProvider,
  getServiceConfigByProviderId,
  getServiceConfigByServiceId,
} from '@/lib/oauth'
import { CONNECTOR_META_REGISTRY } from '@/connectors/registry'
import type { ConnectorMeta } from '@/connectors/types'

/**
 * A knowledge-base connector offered on the Sim Search surface: the connector's
 * client-safe meta paired with the OAuth service a user connects it through.
 * Only OAuth connectors qualify — an API-key connector has nowhere to keep a
 * personal key outside a knowledge base, so it stays a knowledge-base flow.
 */
export interface SearchConnector {
  /** `CONNECTOR_META_REGISTRY` key — the id a knowledge base reports in `connectorTypes`. */
  type: string
  meta: ConnectorMeta
  /** Canonical OAuth provider id the connection is stored under. */
  providerId: string
  /**
   * Scopes listed in the connect modal — the provider's canonical set, which is
   * what the knowledge-base connector flow requests for the same provider.
   */
  requiredScopes: readonly string[]
  /** The OAuth service's own name and mark, for the connect modal. */
  serviceName: string
  serviceIcon: ComponentType<{ className?: string }>
  /**
   * Block type lending the brand tile and the deployment-availability lookup:
   * the first catalog integration on the provider, else the connector type.
   */
  blockType: string
}

/**
 * Every Sim Search connector, alphabetical by name. Built once at module load.
 *
 * A connector names its service by service id (`confluence`) or, for Gmail, by
 * the provider id (`google-email`); the knowledge-base connector flow accepts
 * both through `getProviderIdFromServiceId`'s raw fallback, so the lookup here
 * tries the service id first and the provider id second.
 */
export const SEARCH_CONNECTORS: readonly SearchConnector[] = Object.entries(CONNECTOR_META_REGISTRY)
  .flatMap(([type, meta]): SearchConnector[] => {
    if (meta.auth.mode !== 'oauth') return []
    const service =
      getServiceConfigByServiceId(meta.auth.provider) ??
      getServiceConfigByProviderId(meta.auth.provider)
    if (!service) return []
    return [
      {
        type,
        meta,
        providerId: service.providerId,
        requiredScopes: getCanonicalScopesForProvider(service.providerId),
        serviceName: service.name,
        serviceIcon: service.icon as ComponentType<{ className?: string }>,
        blockType: getIntegrationsForCredentialProvider(service.providerId)[0]?.type ?? type,
      },
    ]
  })
  .sort((a, b) => a.meta.name.localeCompare(b.meta.name))

/**
 * Provider ids some Sim Search connector connects through. Several connectors
 * share one (Jira and Jira Service Management both use `jira`), so a credential
 * is matched to the surface by provider rather than to a single connector.
 */
const SEARCH_PROVIDER_IDS: ReadonlySet<string> = new Set(
  SEARCH_CONNECTORS.map((connector) => connector.providerId)
)

/** Whether a stored credential's provider powers a Sim Search connector. */
export function isSearchConnectorProvider(providerId: string | null): boolean {
  return providerId !== null && SEARCH_PROVIDER_IDS.has(providerId)
}
