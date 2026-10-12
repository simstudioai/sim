import { getManagedMcpConnectorIcon } from '@/lib/credential-groups/managed-mcp-connector-icons'
import {
  getManagedMcpConnector,
  type ManagedMcpConnectorId,
} from '@/lib/credential-groups/managed-mcp-connectors'
import {
  findCredentialGroupProviderFromProviderId,
  isCredentialGroupStandardOAuthProvider,
} from '@/lib/credential-groups/providers'
import { getConnectorAccessAvailability } from '@/lib/sim-search/connectors'
import {
  isManagedSearchMcpProvider,
  type ManagedSearchMcpProvider,
} from '@/lib/sim-search/live/managed-mcp-config'
import {
  LIVE_SEARCH_PROVIDER_CATALOG,
  LIVE_SEARCH_PROVIDER_IDS,
  type LiveSearchProviderId,
  supportsLiveSearchMode,
} from '@/lib/sim-search/live/provider-catalog'
import { CONNECTOR_META_REGISTRY } from '@/connectors/registry'
import type { ConnectorMeta } from '@/connectors/types'

/** Fixed member OAuth servers; a REST token cannot stand in for these search grants. */
export function liveSearchMcpConnector(type: string): ManagedSearchMcpProvider | null {
  return isManagedSearchMcpProvider(type) ? type : null
}

/** Live retrieval has its own catalog and does not advertise unimplemented knowledge-base indexing. */
export const LIVE_SEARCH_SOURCE_TYPES: readonly (readonly [
  LiveSearchProviderId,
  Pick<ConnectorMeta, 'id' | 'name' | 'icon' | 'description'>,
])[] = LIVE_SEARCH_PROVIDER_IDS.map((type) => {
  const managed = liveSearchMcpConnector(type)
  const meta = managed
    ? { ...getManagedMcpConnector(managed), icon: getManagedMcpConnectorIcon(managed) }
    : CONNECTOR_META_REGISTRY[type]
  return [type, meta] as const
}).sort(([, left], [, right]) => left.name.localeCompare(right.name))

export function liveSearchMemberAccountProvider(type: string) {
  if (liveSearchMcpConnector(type)) return null
  const providerId = LIVE_SEARCH_PROVIDER_IDS.find((id) => id === type)
  if (!providerId || !supportsLiveSearchMode(providerId, 'member')) return null
  for (const id of LIVE_SEARCH_PROVIDER_CATALOG[providerId].credentialProviderIds) {
    const provider = findCredentialGroupProviderFromProviderId(id)
    if (provider && isCredentialGroupStandardOAuthProvider(provider)) return provider
  }
  return null
}

export function getLiveSearchAccessAvailability(
  type: LiveSearchProviderId,
  integrationAvailability: Parameters<typeof getConnectorAccessAvailability>[1],
  context: Parameters<typeof getConnectorAccessAvailability>[2] & {
    availableMcpConnectors?: readonly ManagedMcpConnectorId[]
  }
) {
  const meta = CONNECTOR_META_REGISTRY[type]
  const access = meta
    ? getConnectorAccessAvailability(meta, integrationAvailability, context)
    : { admin: false, members: false }
  return {
    admin: access.admin && supportsLiveSearchMode(type, 'service_account'),
    members:
      supportsLiveSearchMode(type, 'member') &&
      (liveSearchMcpConnector(type)
        ? context.isIntegrationAvailabilityReady &&
          context.memberAccessAvailable &&
          ((type !== 'hubspot' && type !== 'zoom') ||
            context.availableMcpConnectors?.includes(type) === true)
        : access.members),
  }
}
