import { db } from '@sim/db'
import { mcpServers, member, organization } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { defineAuthorizedWorkspaceUseCase, defineWorkspaceOperation } from '@/lib/core/application'
import { resolveCredentialGroupWorkspaceContext } from '@/lib/credential-groups/application/context'
import {
  organizationAccountAccessPolicyCodec,
  organizationAccountPolicyAllowsWorkspace,
} from '@/lib/credential-groups/application/workspace-access-policy'
import { loadScopedAccountsCredentialListContext } from '@/lib/credential-groups/credentials'
import { getManagedMcpConnector } from '@/lib/credential-groups/managed-mcp-connectors'
import {
  getCredentialGroupProviderService,
  isCredentialGroupProvider,
} from '@/lib/credential-groups/providers'
import { isScopedCredentialGroupsAvailable } from '@/lib/credential-groups/scoped-availability'
import { requireResourcePolicy } from '@/lib/resource-policies/repository'

/**
 * permission-group-exempt: Workspace readers can see sharing status and provider labels; credential use is authorized separately.
 */
export const workspaceOrganizationAccountsOperation = defineWorkspaceOperation({
  id: 'organization_accounts.workspace_status.read',
  minimumRole: 'read',
  workspaceApiKey: 'deny',
  capability: 'none',
  principalKinds: ['session'],
})

/** Read-only workspace projection; provider configuration and people remain organization resources. */
export const getWorkspaceOrganizationAccounts = defineAuthorizedWorkspaceUseCase({
  operation: workspaceOrganizationAccountsOperation,
  resolveContext: ({ input }: { input: { workspaceId: string } }) =>
    resolveCredentialGroupWorkspaceContext(input.workspaceId),
  authorizationOptions: {},
  execute: async ({ principal, context }) => {
    const organizationId = context.workspaceOrganizationId
    const result = {
      organizationId,
      organizationName: null as string | null,
      available: false,
      allowed: false,
      canManage: false,
      providers: [] as Array<{ id: string; label: string }>,
      mcpProviders: [] as Array<{ id: string; label: string }>,
    }
    if (!organizationId) return result
    const [org] = await db
      .select({ name: organization.name })
      .from(organization)
      .where(eq(organization.id, organizationId))
      .limit(1)
    if (!org) throw new Error('Workspace organization no longer exists')
    result.organizationName = org.name
    const [membership] = await db
      .select({ role: member.role })
      .from(member)
      .where(and(eq(member.organizationId, organizationId), eq(member.userId, principal.userId)))
      .limit(1)
    result.canManage = membership?.role === 'admin' || membership?.role === 'owner'
    result.available = await isScopedCredentialGroupsAvailable({
      kind: 'organization',
      organizationId,
    })
    if (!result.available) return result
    const group = await loadScopedAccountsCredentialListContext({
      kind: 'organization',
      organizationId,
    })
    if (!group || group.status !== 'active') return result
    const policy = await requireResourcePolicy({
      organizationId,
      resourceType: 'credential_group',
      resourceId: group.credentialGroupId,
      codec: organizationAccountAccessPolicyCodec,
    })
    result.allowed = organizationAccountPolicyAllowsWorkspace(policy.document, context.workspaceId)
    if (!result.allowed) return result
    result.providers = group.options
      .filter((option) => option.status === 'active')
      .map((option) => {
        if (!isCredentialGroupProvider(option.provider))
          throw new Error(`Unsupported organization provider: ${option.provider}`)
        const service = getCredentialGroupProviderService(option.provider)
        return { id: service.providerId, label: service.name }
      })
    const servers = await db
      .select({ connectorId: mcpServers.managedConnectorId })
      .from(mcpServers)
      .where(
        and(
          eq(mcpServers.organizationId, organizationId),
          eq(mcpServers.credentialGroupId, group.credentialGroupId),
          eq(mcpServers.enabled, true),
          isNull(mcpServers.deletedAt)
        )
      )
    result.mcpProviders = servers.map((server) => {
      if (!server.connectorId)
        throw new Error('Organization MCP provider is missing its connector ID')
      const connector = getManagedMcpConnector(server.connectorId)
      return { id: connector.id, label: connector.name }
    })
    return result
  },
})
