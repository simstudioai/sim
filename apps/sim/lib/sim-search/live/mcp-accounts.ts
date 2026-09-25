import { db } from '@sim/db'
import { credential, credentialGroup, credentialGroupEnrollment, mcpServers } from '@sim/db/schema'
import { and, eq, inArray, isNull, or } from 'drizzle-orm'
import { type ResourceOwner, resourceScopeFromOwner } from '@/lib/core/resource-scope'
import {
  resourceScopeCondition,
  sameResourceScopeCondition,
} from '@/lib/core/resource-scope.server'
import { requireOrganizationAccountsWorkspaceAccess } from '@/lib/credential-groups/application/organization-workspace-access'
import {
  loadScopedManagedMcpRuntimeCredential,
  ManagedMcpCredentialError,
} from '@/lib/credentials/managed-mcp'
import { resolveKnowledgeWorkspaceContext } from '@/lib/knowledge/application/contexts'
import { NativeSearchError } from '@/lib/sim-search/live/http'
import type { LiveAccount } from '@/lib/sim-search/live/types'

/** Only the caller's Coda grant is eligible; org grants also obey current workspace sharing policy. */
export async function listOwnCodaMcpAccounts(owner: ResourceOwner, userId: string) {
  const scope = resourceScopeFromOwner(owner)
  const workspace =
    scope.kind === 'workspace'
      ? await resolveKnowledgeWorkspaceContext({ workspaceId: scope.workspaceId })
      : undefined
  const orgId = workspace?.workspaceOrganizationId
  const rows = await db
    .select({
      id: credential.id,
      displayName: credential.displayName,
      workspaceId: credential.workspaceId,
      organizationId: credential.organizationId,
      groupId: credentialGroup.id,
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
        eq(mcpServers.managedConnectorId, 'coda'),
        eq(mcpServers.url, 'https://docs.superhuman.com/apis/mcp'),
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
    if (workspace && row.organizationId) {
      try {
        await requireOrganizationAccountsWorkspaceAccess(
          {
            ...workspace,
            organizationId: row.organizationId,
            credentialGroupId: row.groupId,
          },
          'mcp:coda'
        )
      } catch {
        continue
      }
    }
    visible.push(row)
  }
  return visible
}

export async function listCodaMcpSearchAccounts(
  owner: ResourceOwner,
  userId: string
): Promise<LiveAccount[]> {
  return (await listOwnCodaMcpAccounts(owner, userId)).map((row) => ({
    id: row.id,
    displayName: row.displayName,
    provider: 'coda',
    providerId: 'mcp:coda',
    type: 'managed_mcp',
    scopes: [],
  }))
}

export async function loadOwnCodaMcpRuntime(
  owner: ResourceOwner,
  userId: string,
  credentialId: string
) {
  const row = (await listOwnCodaMcpAccounts(owner, userId)).find((row) => row.id === credentialId)
  if (!row)
    throw new NativeSearchError('reconnect', 'Your Coda OAuth connection is no longer available.')
  const runtime = await loadScopedManagedMcpRuntimeCredential(
    credentialId,
    resourceScopeFromOwner(row),
    userId
  ).catch((error: unknown) => {
    if (error instanceof ManagedMcpCredentialError && [401, 403, 404].includes(error.statusCode))
      throw new NativeSearchError('reconnect', 'Reconnect your personal Coda account.')
    throw error
  })
  if (runtime.credentialType !== 'mcp:coda')
    throw new NativeSearchError('reconnect', 'Coda connection changed.')
  return runtime
}
