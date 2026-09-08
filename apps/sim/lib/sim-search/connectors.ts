import type { ComponentType } from 'react'
import type { IntegrationAvailabilityResponse } from '@/lib/api/contracts/common'
import { findCredentialGroupProviderFromProviderId } from '@/lib/credential-groups/providers'
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
   * Block type lending the brand tile and integration policy:
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
    if (!canConnectPersonally(meta)) return []
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
 * Every source an admin may set up for Sim Search, alphabetical by name: the
 * connectors that either mirror their source's permissions or connect per person.
 */
export const SEARCH_SOURCE_TYPES: readonly (readonly [string, ConnectorMeta])[] = Object.entries(
  CONNECTOR_META_REGISTRY
)
  .filter(([, meta]) => meta.search && (meta.mirrorsSourceAcls || canConnectPersonally(meta)))
  .sort(([, left], [, right]) => left.name.localeCompare(right.name))

/**
 * Whether a source connects per person on Sim Search: it authenticates with
 * OAuth and its listing reflects who may read each document, so each member's
 * own crawl is the permission check. A source that fails this is a workspace
 * connector an admin sets up from a knowledge base.
 */
export function canConnectPersonally(meta: ConnectorMeta): boolean {
  return (
    meta.search === true && meta.auth.mode === 'oauth' && meta.permissionScopedListing !== undefined
  )
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

export interface OAuthServiceAvailabilityContext {
  oauthServiceAvailability: ReadonlyMap<string, boolean>
  isIntegrationAvailabilityReady: boolean
}

export interface SearchConnectorAvailabilityContext extends OAuthServiceAvailabilityContext {
  /** Whether per-member access is on for the workspace. */
  memberAccessAvailable: boolean
  /** Whether someone already connected this source in the workspace. */
  hasConnection: boolean
  /** Whether the viewer may turn a source on for the workspace; the first connect needs an admin. */
  canCreate: boolean
}

type SearchIntegrationAvailability = Pick<IntegrationAvailabilityResponse, 'oauthAvailable'> &
  Partial<Pick<IntegrationAvailabilityResponse, 'state'>>

interface ConnectorAccessAvailabilityContext extends OAuthServiceAvailabilityContext {
  memberAccessAvailable: boolean
  mirroredAccessAvailable: boolean
}

interface ConnectorAccessAvailability {
  admin: boolean
  members: boolean
}

/** Central sources that identify readers through OAuth still need a usable member sign-in path. */
export function getConnectorAccessAvailability(
  meta: ConnectorMeta,
  integrationAvailability: ReadonlyMap<string, SearchIntegrationAvailability>,
  context: ConnectorAccessAvailabilityContext
): ConnectorAccessAvailability {
  if (!context.isIntegrationAvailabilityReady) return { admin: false, members: false }
  const service =
    meta.auth.mode === 'oauth'
      ? (getServiceConfigByServiceId(meta.auth.provider) ??
        getServiceConfigByProviderId(meta.auth.provider))
      : null
  const blockType = service
    ? (getIntegrationsForCredentialProvider(service.providerId)[0]?.type ?? meta.id)
    : meta.id
  const deployment = integrationAvailability.get(blockType.toLowerCase())
  const deploymentAvailable =
    deployment?.state !== 'unavailable' && deployment?.state !== 'misconfigured'
  const identityAvailable = Boolean(
    context.memberAccessAvailable &&
      service &&
      findCredentialGroupProviderFromProviderId(service.providerId) &&
      isSearchConnectorAvailable(
        { type: meta.id, blockType, providerId: service.providerId },
        integrationAvailability,
        context
      )
  )

  return {
    admin: Boolean(
      context.mirroredAccessAvailable &&
        meta.mirrorsSourceAcls &&
        deploymentAvailable &&
        (!meta.requiresMemberIdentity || identityAvailable)
    ),
    members: Boolean(meta.permissionScopedListing && identityAvailable),
  }
}

/** Why a source cannot be connected on this surface right now; null when it can. */
export function searchConnectorUnavailableReason(
  connector: SearchConnector,
  integrationAvailability: ReadonlyMap<string, SearchIntegrationAvailability>,
  context: SearchConnectorAvailabilityContext
): string | null {
  if (!context.isIntegrationAvailabilityReady) return 'Source availability is not loaded yet'
  if (!isSearchConnectorAvailable(connector, integrationAvailability, context)) {
    return `${connector.meta.name} is unavailable in this deployment`
  }
  if (!context.memberAccessAvailable) return 'Per-member access is not available in this workspace'
  if (!context.hasConnection && !context.canCreate) {
    return `Ask a workspace admin to connect ${connector.meta.name} first`
  }
  return null
}

/**
 * Slack members authorize through the workspace's custom app. Other sources
 * use the deployment's OAuth client. The custom-app path remains available on
 * a limited deployment, matching the Integrations setup surface.
 */
export function isSearchConnectorAvailable(
  connector: Pick<SearchConnector, 'type' | 'blockType' | 'providerId'>,
  integrationAvailability: ReadonlyMap<string, SearchIntegrationAvailability>,
  context: OAuthServiceAvailabilityContext
): boolean {
  if (!context.isIntegrationAvailabilityReady) return false
  const availability = integrationAvailability.get(connector.blockType.toLowerCase())
  if (connector.type === 'slack') {
    return availability?.state === 'ready' || availability?.state === 'limited'
  }
  return context.oauthServiceAvailability.get(connector.providerId.toLowerCase()) === true
}
