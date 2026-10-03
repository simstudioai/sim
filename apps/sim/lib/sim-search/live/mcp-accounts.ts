import { db } from '@sim/db'
import { credential, credentialGroup, credentialGroupEnrollment, mcpServers } from '@sim/db/schema'
import { and, eq, inArray, isNull, or } from 'drizzle-orm'
import { type ResourceOwner, resourceScopeFromOwner } from '@/lib/core/resource-scope'
import {
  resourceScopeCondition,
  sameResourceScopeCondition,
} from '@/lib/core/resource-scope.server'
import { requireOrganizationAccountsWorkspaceAccess } from '@/lib/credential-groups/application/organization-workspace-access'
import { MANAGED_MCP_CONNECTORS } from '@/lib/credential-groups/managed-mcp-connectors'
import {
  loadScopedManagedMcpRuntimeCredential,
  ManagedMcpCredentialError,
} from '@/lib/credentials/managed-mcp'
import { resolveKnowledgeWorkspaceContext } from '@/lib/knowledge/application/contexts'
import { NativeSearchError } from '@/lib/sim-search/live/http'
import {
  isManagedSearchMcpProvider,
  MANAGED_SEARCH_MCP_READ_TOOLS,
  type ManagedSearchMcpProvider,
} from '@/lib/sim-search/live/managed-mcp-config'
import { isSearchProviderEnabled } from '@/lib/sim-search/live/provider-rollout'
import type { LiveAccount } from '@/lib/sim-search/live/types'

/** Only the caller's grants at fixed trusted providers qualify; org grants obey current workspace policy. */
async function listOwnManagedMcpAccounts(
  owner: ResourceOwner,
  userId: string,
  providers: readonly ManagedSearchMcpProvider[]
) {
  if (!providers.length) return []
  const scope = resourceScopeFromOwner(owner)
  const workspace =
    scope.kind === 'workspace'
      ? await resolveKnowledgeWorkspaceContext({ workspaceId: scope.workspaceId })
      : undefined
  const orgId = workspace?.workspaceOrganizationId
  const enabledProviders =
    providers.includes('zoom') && !(await isSearchProviderEnabled('zoom', scope))
      ? providers.filter((provider) => provider !== 'zoom')
      : providers
  if (!enabledProviders.length) return []
  const rows = await db
    .select({
      id: credential.id,
      displayName: credential.displayName,
      workspaceId: credential.workspaceId,
      organizationId: credential.organizationId,
      groupId: credentialGroup.id,
      connectorId: mcpServers.managedConnectorId,
    })
    .from(credential)
    .innerJoin(
      credentialGroupEnrollment,
      eq(credentialGroupEnrollment.id, credential.credentialGroupEnrollmentId)
    )
    .innerJoin(credentialGroup, eq(credentialGroup.id, credentialGroupEnrollment.credentialGroupId))
    .innerJoin(mcpServers, eq(mcpServers.id, credential.mcpServerId))
    .where(
      and(
        or(
          resourceScopeCondition(credential, scope),
          ...(orgId
            ? [resourceScopeCondition(credential, { kind: 'organization', organizationId: orgId })]
            : [])
        ),
        sameResourceScopeCondition(credential, credentialGroup),
        sameResourceScopeCondition(credential, mcpServers),
        eq(mcpServers.credentialGroupId, credentialGroup.id),
        or(
          ...enabledProviders.map((provider) =>
            and(
              eq(mcpServers.managedConnectorId, provider),
              eq(mcpServers.url, MANAGED_MCP_CONNECTORS[provider].url)
            )
          )
        ),
        eq(mcpServers.enabled, true),
        isNull(mcpServers.deletedAt),
        eq(credential.type, 'managed_mcp'),
        eq(credentialGroupEnrollment.userId, userId),
        inArray(credential.managedOauthStatus, ['active', 'needs_reauth']),
        isNull(credential.revokedAt),
        eq(credentialGroup.status, 'active'),
        inArray(credentialGroupEnrollment.status, ['in_progress', 'completed'])
      )
    )
  const visible: typeof rows = []
  for (const row of rows) {
    if (
      !row.connectorId ||
      !isManagedSearchMcpProvider(row.connectorId) ||
      !enabledProviders.includes(row.connectorId)
    )
      continue
    if (workspace && row.organizationId) {
      try {
        await requireOrganizationAccountsWorkspaceAccess(
          {
            ...workspace,
            organizationId: row.organizationId,
            credentialGroupId: row.groupId,
          },
          `mcp:${row.connectorId}`
        )
      } catch {
        continue
      }
    }
    visible.push(row)
  }
  return visible
}

export async function listManagedMcpSearchAccounts(
  owner: ResourceOwner,
  userId: string,
  denied: ReadonlySet<string> = new Set()
): Promise<LiveAccount[]> {
  const providers = Object.keys(MANAGED_SEARCH_MCP_READ_TOOLS)
    .filter(isManagedSearchMcpProvider)
    .filter((provider) => !denied.has(provider))
  return (await listOwnManagedMcpAccounts(owner, userId, providers)).flatMap((row) => {
    if (!row.connectorId || !isManagedSearchMcpProvider(row.connectorId)) return []
    return [
      {
        id: row.id,
        displayName: row.displayName,
        provider: row.connectorId,
        providerId: `mcp:${row.connectorId}`,
        type: 'managed_mcp' as const,
        scopes: [],
      },
    ]
  })
}

export async function loadOwnManagedMcpRuntime(
  owner: ResourceOwner,
  userId: string,
  credentialId: string,
  provider: ManagedSearchMcpProvider
) {
  const label = MANAGED_MCP_CONNECTORS[provider].name
  const row = (await listOwnManagedMcpAccounts(owner, userId, [provider])).find(
    (row) => row.id === credentialId
  )
  if (!row)
    throw new NativeSearchError(
      'reconnect',
      `Your ${label} OAuth connection is no longer available.`
    )
  const runtime = await loadScopedManagedMcpRuntimeCredential(
    credentialId,
    resourceScopeFromOwner(row),
    userId
  ).catch((error: unknown) => {
    if (error instanceof ManagedMcpCredentialError && [401, 403, 404].includes(error.statusCode))
      throw new NativeSearchError('reconnect', `Reconnect your personal ${label} account.`)
    throw error
  })
  if (runtime.credentialType !== `mcp:${provider}`)
    throw new NativeSearchError('reconnect', `${label} connection changed.`)
  return runtime
}
