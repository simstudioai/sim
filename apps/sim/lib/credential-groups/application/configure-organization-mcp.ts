import type { OrganizationMembershipContext } from '@/lib/core/application/organization-authorization'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { defineOrganizationAccountsUseCase } from '@/lib/credential-groups/application/organization-accounts'
import { loadScopedAccountsCredentialListContext } from '@/lib/credential-groups/credentials'
import { updateManagedMcpConnector } from '@/lib/credential-groups/managed-mcp-service'
import { clearCredentialGroupMcpOAuthAttempts } from '@/lib/credential-groups/mcp-oauth-state'
import { evictMcpServerConnections } from '@/lib/mcp/connection-pool'

export const configureOrganizationMcpOperation = defineOrganizationOperation({
  id: 'organization_accounts.mcp.configure',
  minimumRole: 'admin',
  principalKinds: ['session'],
  capability: 'integrations.manage',
})

export interface ConfigureOrganizationMcpInput {
  organizationId: string
  url: string
  oauthClientId: string
  oauthClientSecret?: string | null
  name?: string
}

export const configureOrganizationMcp = defineOrganizationAccountsUseCase({
  operation: configureOrganizationMcpOperation,
  async execute({
    input,
    context,
  }: {
    input: ConfigureOrganizationMcpInput
    context: OrganizationMembershipContext
  }) {
    const group = await loadScopedAccountsCredentialListContext({
      kind: 'organization',
      organizationId: context.organizationId,
    })
    if (!group)
      throw new OrchestrationError(
        'not_found',
        'Organization connected accounts are not configured'
      )
    const result = await updateManagedMcpConnector({
      organizationId: context.organizationId,
      credentialGroupId: group.credentialGroupId,
      connectorId: 'databricks',
      input: {
        url: input.url,
        oauthClientId: input.oauthClientId,
        oauthClientSecret: input.oauthClientSecret,
        name: input.name,
      },
    })
    return { ...result, credentialGroupId: group.credentialGroupId }
  },
  projectAudit: ({ credentialGroupId }) => ({
    resourceId: credentialGroupId,
    resourceName: 'Connected accounts',
    description: 'Configured the organization Databricks provider',
  }),
  async afterSuccess({ result }) {
    await clearCredentialGroupMcpOAuthAttempts(result.resetMcpServerIds)
    await Promise.all(
      [...result.resetMcpServerIds, ...result.retiredMcpConnectionIds].map((id) =>
        evictMcpServerConnections(id, 'organization MCP configuration changed')
      )
    )
  },
})
