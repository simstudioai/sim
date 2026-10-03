import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { defineOrganizationAccountsUseCase } from '@/lib/credential-groups/application/organization-accounts'
import { loadScopedAccountsCredentialListContext } from '@/lib/credential-groups/credentials'
import { loadOrganizationDatabricksSetup } from '@/lib/credential-groups/managed-mcp-service'

export const getOrganizationDatabricksSetupOperation = defineOrganizationOperation({
  id: 'organization_accounts.mcp.setup.read',
  minimumRole: 'admin',
  principalKinds: ['session'],
  capability: 'integrations.manage',
})

export const getOrganizationDatabricksSetup = defineOrganizationAccountsUseCase({
  operation: getOrganizationDatabricksSetupOperation,
  async execute({ context }) {
    const group = await loadScopedAccountsCredentialListContext({
      kind: 'organization',
      organizationId: context.organizationId,
    })
    if (!group)
      throw new OrchestrationError(
        'not_found',
        'Organization connected accounts are not configured'
      )
    const server = await loadOrganizationDatabricksSetup(
      context.organizationId,
      group.credentialGroupId
    )
    return { server }
  },
})
