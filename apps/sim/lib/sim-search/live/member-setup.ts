import { db } from '@sim/db'
import { credentialGroup, mcpServers } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { resourceScopeCondition } from '@/lib/core/resource-scope.server'
import { requireManagedMcpConnectorUrl } from '@/lib/credential-groups/managed-mcp-connectors'
import {
  createManagedMcpConnector,
  ManagedMcpConnectorError,
  type ValidatedManagedMcpConnectorInput,
  validateManagedMcpConnectorInput,
} from '@/lib/credential-groups/managed-mcp-service'
import { ensureWorkspaceAccountsGroup } from '@/lib/credential-groups/service'
import type { DbTransaction } from '@/lib/db/types'
import type { ManagedSearchMcpProvider } from '@/lib/sim-search/live/managed-mcp-config'
import { isSearchProviderEnabled } from '@/lib/sim-search/live/provider-rollout'

/**
 * A search provider ready for source approval. `validated` is set only when approval will create
 * the provider's server.
 */
export interface SearchMcpProviderSetup {
  provider: ManagedSearchMcpProvider
  validated: ValidatedManagedMcpConnectorInput | null
}

function toSetupError(error: unknown): never {
  if (error instanceof ManagedMcpConnectorError)
    throw new OrchestrationError(
      error.code === 'bad_gateway' ? 'internal' : error.code,
      error.message
    )
  throw error
}

async function hasProviderServer(
  organizationId: string,
  provider: ManagedSearchMcpProvider
): Promise<boolean> {
  const [existing] = await db
    .select({ id: mcpServers.id })
    .from(mcpServers)
    .innerJoin(credentialGroup, eq(credentialGroup.id, mcpServers.credentialGroupId))
    .where(
      and(
        resourceScopeCondition(credentialGroup, { kind: 'organization', organizationId }),
        eq(mcpServers.organizationId, organizationId),
        eq(mcpServers.managedConnectorId, provider),
        isNull(mcpServers.deletedAt)
      )
    )
    .limit(1)
  return existing !== undefined
}

/**
 * Runs before source approval opens its transaction. A provider whose server does not exist yet
 * has that server checked here, because the check resolves DNS and must not run while the
 * transaction holds the accounts lock; an already-configured provider needs no check. A failed
 * check looks again first, since a concurrent approval may have created the server meanwhile.
 */
export async function prepareSearchMcpProvider(
  organizationId: string,
  provider: ManagedSearchMcpProvider
): Promise<SearchMcpProviderSetup> {
  if (!(await isSearchProviderEnabled(provider, { kind: 'organization', organizationId })))
    throw new OrchestrationError('forbidden', 'Zoom Search is not available for this organization')
  if (await hasProviderServer(organizationId, provider)) return { provider, validated: null }
  try {
    return {
      provider,
      validated: await validateManagedMcpConnectorInput({ connectorId: provider }),
    }
  } catch (error) {
    if (await hasProviderServer(organizationId, provider)) return { provider, validated: null }
    toSetupError(error)
  }
}

/** Joins source approval's transaction, serializing concurrent setup through the accounts lock. */
export async function addOrganizationSearchMcpProvider(
  organizationId: string,
  userId: string,
  { provider, validated }: SearchMcpProviderSetup,
  executor: DbTransaction
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
    if (!(await isSearchProviderEnabled(provider, { kind: 'organization', organizationId })))
      throw new OrchestrationError(
        'forbidden',
        'Zoom Search is not available for this organization'
      )
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
  /** The server was removed after preparation found it; a retry prepares it again. */
  if (!validated)
    throw new OrchestrationError(
      'conflict',
      'Connected accounts changed while adding this source. Try again.'
    )
  await createManagedMcpConnector(
    { organizationId, credentialGroupId: group.id, userId, validated },
    executor
  ).catch(toSetupError)
  return { groupId: group.id, changed: true }
}
