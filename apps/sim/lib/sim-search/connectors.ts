import type { ComponentType } from 'react'
import { getIntegrationsForCredentialProvider } from '@/lib/integrations/credential-display'
import {
  getCanonicalScopesForProvider,
  getServiceConfigByProviderId,
  getServiceConfigByServiceId,
} from '@/lib/oauth'
import { CONNECTOR_META_REGISTRY } from '@/connectors/registry'
import type { ConnectorConfigField, ConnectorMeta } from '@/connectors/types'

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
  /** Required config a person supplies on the source's first connect; empty for one-click sources. */
  setupFields: readonly ConnectorConfigField[]
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
        setupFields: personalSetupFields(meta),
      },
    ]
  })
  .sort((a, b) => a.meta.name.localeCompare(b.meta.name))

/**
 * Whether a source connects per person on Sim Search: it authenticates with
 * OAuth and its listing reflects who may read each document, so each member's
 * own crawl is the permission check. A source that fails this is a workspace
 * connector an admin sets up from a knowledge base.
 */
export function canConnectPersonally(meta: ConnectorMeta): boolean {
  return meta.auth.mode === 'oauth' && meta.permissionScopedListing !== undefined
}

/**
 * The fields a person fills in before a source's first connect: its required
 * config beyond the listing caps members mode clears. A selector needs a
 * credential the source does not have yet, so a selector's typed twin stands
 * in for it (Confluence's space key, Jira's project key).
 */
export function personalSetupFields(meta: ConnectorMeta): ConnectorConfigField[] {
  const capFieldIds = new Set(meta.permissionScopedListing?.capFieldIds ?? [])
  return meta.configFields.filter(
    (field) => field.required && field.type !== 'selector' && !capFieldIds.has(field.id)
  )
}

/** The setup fields a source config leaves empty. */
export function missingSetupFields(
  meta: ConnectorMeta,
  sourceConfig: Record<string, string>
): ConnectorConfigField[] {
  return personalSetupFields(meta).filter((field) => !sourceConfig[field.id]?.trim())
}

/** The name a connector shows, from its registry entry. */
export function connectorDisplayName(connectorType: string): string {
  return CONNECTOR_META_REGISTRY[connectorType]?.name ?? connectorType
}

/** Why a source cannot be connected on this surface right now; null when it can. */
export function searchConnectorUnavailableReason(
  connector: SearchConnector,
  integrationAvailability: ReadonlyMap<string, { oauthAvailable: boolean }>,
  memberAccessAvailable: boolean
): string | null {
  if (!isSearchConnectorAvailable(connector, integrationAvailability)) {
    return `${connector.meta.name} is unavailable in this deployment`
  }
  return memberAccessAvailable ? null : 'Per-member access is not available in this workspace'
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
