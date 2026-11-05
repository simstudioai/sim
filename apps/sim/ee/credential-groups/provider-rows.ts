import type { ComponentType } from 'react'
import type { OrganizationAccountsSettings } from '@/lib/api/contracts/organization-accounts'
import { getManagedMcpConnectorIcon } from '@/lib/credential-groups/managed-mcp-connector-icons'
import {
  MANAGED_MCP_CONNECTOR_IDS,
  MANAGED_MCP_CONNECTORS,
  type ManagedMcpConnectorId,
} from '@/lib/credential-groups/managed-mcp-connectors'
import {
  type CredentialGroupProvider,
  getCredentialGroupProviderService,
} from '@/lib/credential-groups/providers'

type Group = NonNullable<OrganizationAccountsSettings['credentialGroup']>

export type OrganizationAccountProviderChoice =
  | { kind: 'oauth'; provider: CredentialGroupProvider }
  | { kind: 'mcp'; connectorId: ManagedMcpConnectorId }

interface ProviderEntry {
  name: string
  icon: ComponentType<{ className?: string }>
  choice: OrganizationAccountProviderChoice
}

function mcpConnectorLabel(connectorId: ManagedMcpConnectorId) {
  return connectorId === 'hubspot' || connectorId === 'zoom'
    ? `${MANAGED_MCP_CONNECTORS[connectorId].name} (member access)`
    : MANAGED_MCP_CONNECTORS[connectorId].name
}

/** Providers already in the group, by name. Databricks counts once it is enabled. */
export function organizationAccountProviderRows(
  group: Group,
  visibleProviders?: readonly CredentialGroupProvider[]
): Array<ProviderEntry & { id: string }> {
  return [
    ...group.options
      .filter((option) => !visibleProviders || visibleProviders.includes(option.provider))
      .map((option) => {
        const service = getCredentialGroupProviderService(option.provider)
        return {
          id: option.id,
          name: service.name,
          icon: service.icon,
          choice: { kind: 'oauth', provider: option.provider } as const,
        }
      }),
    ...group.mcpServers
      .filter((server) => server.managedConnectorId !== 'databricks' || server.enabled)
      .map((server) => ({
        id: server.id,
        name: mcpConnectorLabel(server.managedConnectorId),
        icon: getManagedMcpConnectorIcon(server.managedConnectorId),
        choice: { kind: 'mcp', connectorId: server.managedConnectorId } as const,
      })),
  ].sort((left, right) => left.name.localeCompare(right.name))
}

/** Providers the group can still add, by name, narrowed to a lowercased query. */
export function organizationAccountCatalogEntries(
  group: Group,
  availableProviders: readonly CredentialGroupProvider[],
  availableMcpConnectors: readonly ManagedMcpConnectorId[] = MANAGED_MCP_CONNECTOR_IDS,
  query = ''
): ProviderEntry[] {
  return [
    ...availableProviders
      .filter((provider) => !group.options.some((option) => option.provider === provider))
      .map((provider) => ({
        ...getCredentialGroupProviderService(provider),
        choice: { kind: 'oauth', provider } as const,
      })),
    ...availableMcpConnectors
      .filter(
        (id) =>
          !group.mcpServers.some(
            (server) => server.managedConnectorId === id && (id !== 'databricks' || server.enabled)
          )
      )
      .map((connectorId) => ({
        name: mcpConnectorLabel(connectorId),
        icon: getManagedMcpConnectorIcon(connectorId),
        choice: { kind: 'mcp', connectorId } as const,
      })),
  ]
    .filter((provider) => provider.name.toLowerCase().includes(query))
    .sort((left, right) => left.name.localeCompare(right.name))
}
