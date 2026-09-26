import { mcpServers } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { requireManagedMcpConnectorUrl } from '@/lib/credential-groups/managed-mcp-connectors'
import {
  createManagedMcpConnector,
  ManagedMcpConnectorError,
} from '@/lib/credential-groups/managed-mcp-service'
import { ensureWorkspaceAccountsGroup } from '@/lib/credential-groups/service'
import type { DbOrTx } from '@/lib/db/types'
import type { ManagedSearchMcpProvider } from '@/lib/sim-search/live/managed-mcp-config'

/** Joins source approval's transaction, serializing concurrent setup through the accounts lock. */
export async function addOrganizationSearchMcpProvider(
  organizationId: string,
  userId: string,
  provider: ManagedSearchMcpProvider,
  executor: DbOrTx
): Promise<{ groupId: string; changed: boolean }> {
  const group = await ensureWorkspaceAccountsGroup(
    { kind: 'organization', organizationId },
    userId,
    undefined,
    executor
  )
  const [existing] = await executor
    .select({
      id: mcpServers.id,
      enabled: mcpServers.enabled,
      url: mcpServers.url,
      authType: mcpServers.authType,
      transport: mcpServers.transport,
    })
    .from(mcpServers)
    .where(
      and(
        eq(mcpServers.organizationId, organizationId),
        eq(mcpServers.credentialGroupId, group.id),
        eq(mcpServers.managedConnectorId, provider),
        isNull(mcpServers.deletedAt)
      )
    )
    .limit(1)
  if (existing) {
    if (!existing.enabled)
      throw new OrchestrationError(
        'validation',
        'This connection is disabled. Enable it in Connected accounts before adding the source.'
      )
    if (
      existing.url !== requireManagedMcpConnectorUrl(provider) ||
      existing.authType !== 'oauth' ||
      existing.transport !== 'streamable-http'
    )
      throw new OrchestrationError(
        'validation',
        'Update this provider in Connected accounts before adding the source.'
      )
    return { groupId: group.id, changed: group.created }
  }
  try {
    await createManagedMcpConnector(
      {
        organizationId,
        credentialGroupId: group.id,
        userId,
        input: { connectorId: provider },
      },
      executor
    )
  } catch (error) {
    if (error instanceof ManagedMcpConnectorError)
      throw new OrchestrationError(
        error.code === 'bad_gateway' ? 'internal' : error.code,
        error.message
      )
    throw error
  }
  return { groupId: group.id, changed: true }
}
