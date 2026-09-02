import type { ComponentType } from 'react'
import { getIntegrationsForCredentialProvider } from '@/lib/integrations/credential-display'
import {
  getCanonicalScopesForProvider,
  getServiceConfigByProviderId,
  getServiceConfigByServiceId,
} from '@/lib/oauth'
import { CONNECTOR_META_REGISTRY } from '@/connectors/registry'
import type { ConnectorMeta } from '@/connectors/types'

/** The workspace knowledge base Sim Search indexes into, one per workspace, created on first connect. */
export const SIM_SEARCH_KNOWLEDGE_BASE_NAME = 'Sim Search'

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
   * Every provider id a credential for this service may carry: the canonical
   * id plus any additional authorization server (Salesforce sandbox). A
   * credential under any of them counts as connected.
   */
  providerIds: readonly string[]
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
        providerIds: [service.providerId, ...(service.additionalProviderIds ?? [])],
        requiredScopes: getCanonicalScopesForProvider(service.providerId),
        serviceName: service.name,
        serviceIcon: service.icon as ComponentType<{ className?: string }>,
        blockType: getIntegrationsForCredentialProvider(service.providerId)[0]?.type ?? type,
      },
    ]
  })
  .sort((a, b) => a.meta.name.localeCompare(b.meta.name))

/**
 * Whether a source connects with one click on Sim Search: it crawls per
 * member, and nothing in its config is required beyond the listing caps
 * members mode clears. A source that needs a site or space (Confluence,
 * Jira) is set up from a knowledge base, where an admin can name it.
 */
export function canConnectPersonally(meta: ConnectorMeta): boolean {
  if (meta.auth.mode !== 'oauth' || !meta.permissionScopedListing) return false
  const capFieldIds = new Set(meta.permissionScopedListing.capFieldIds)
  return meta.configFields.every((field) => !field.required || capFieldIds.has(field.id))
}

/**
 * Whether this deployment can connect the connector. The OAuth path
 * specifically: an integration's `state` can read `limited` on a
 * service-account-only deployment, but a connector authenticates with OAuth
 * alone. A connector with no availability entry is assumed connectable.
 */
export function isSearchConnectorAvailable(
  connector: SearchConnector,
  integrationAvailability: ReadonlyMap<string, { oauthAvailable: boolean }>
): boolean {
  const availability = integrationAvailability.get(connector.blockType.toLowerCase())
  return availability ? availability.oauthAvailable : true
}
