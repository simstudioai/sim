import { AuditAction, AuditResourceType } from '@sim/audit'
import type { Principal } from '@sim/auth/principal'
import { recordProjectedUseCaseAuditEntries } from '@/lib/core/application'
import { authorizeOrganizationOperation } from '@/lib/core/application/organization-authorization'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { getBlockVisibility } from '@/lib/core/config/block-visibility'
import { isLiveEnterpriseSearchEnabled } from '@/lib/core/config/env-flags'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  isManagedCredentialGroupBindingLive,
  loadManagedCredentialGroupBinding,
} from '@/lib/credential-groups/credentials'
import { resolveManagedOAuthToken } from '@/lib/credentials/managed-oauth'
import { projectIntegrationToolsForViewer } from '@/lib/integrations/tool-projection'
import { listPersonalSearchIntegrations } from '@/lib/knowledge/application/personal-search-integrations'
import { requireOrganizationSearchApproval } from '@/lib/knowledge/search/integration-policy'
import { providerIdsForService } from '@/lib/oauth/utils'
import { getUserPermissionConfigForOrganization } from '@/lib/permission-groups/resolve.server'
import { SEARCH_CONNECTORS } from '@/lib/sim-search/connectors'
import { listLiveAccounts } from '@/lib/sim-search/live/accounts'

/** Search's organization delegation can use only the member's currently available personal grant. */
export const organizationPersonalCredentialOperation = defineOrganizationOperation({
  id: 'credentials.organization.personal.use',
  minimumRole: 'member',
  principalKinds: ['organization_delegated'],
  delegatedServices: ['copilot'],
  delegationAudience: 'sim:knowledge',
  capability: 'integrations.manage',
})

export interface ResolveOrganizationPersonalTokenInput {
  organizationId: string
  credentialId: string
  expectedProviderId: string
  requiredScopes: string[]
  toolId: string
}

/** Reauthorizes ownership, organization policy and enrollment immediately before token resolution. */
export const resolveOrganizationPersonalToken = {
  operation: organizationPersonalCredentialOperation,
  async execute({
    principal,
    input,
  }: {
    principal: Principal
    input: ResolveOrganizationPersonalTokenInput
  }) {
    const context = await authorizeOrganizationOperation(
      principal,
      organizationPersonalCredentialOperation,
      input
    )
    const binding = await loadManagedCredentialGroupBinding(input.credentialId)
    if (
      !binding ||
      binding.organizationId !== context.organizationId ||
      binding.workspaceId ||
      !isManagedCredentialGroupBindingLive(binding) ||
      !providerIdsForService(input.expectedProviderId).includes(binding.providerId)
    ) {
      throw new OrchestrationError(
        'forbidden',
        'Select your own active connected account for this integration.'
      )
    }
    const connector = SEARCH_CONNECTORS.find((entry) =>
      providerIdsForService(entry.providerId).includes(binding.providerId)
    )
    if (!connector)
      throw new OrchestrationError('forbidden', 'This integration is unavailable in Search.')
    await requireOrganizationSearchApproval(context.organizationId, connector.type)
    const [visibility, config] = await Promise.all([
      getBlockVisibility({ userId: context.userId, orgId: context.organizationId }),
      getUserPermissionConfigForOrganization(context.organizationId),
    ])
    if (
      !projectIntegrationToolsForViewer(visibility, config).tools.some(
        (tool) => tool.toolId === input.toolId
      )
    ) {
      throw new OrchestrationError('forbidden', 'This integration operation is unavailable.')
    }
    let cursor: string | undefined
    let owned = false
    const seen = new Set<string>()
    for (let page = 0; page < 100; page++) {
      const inventory = await listPersonalSearchIntegrations.execute({
        principal,
        input: {
          organizationId: context.organizationId,
          connectorType: connector.type,
          ...(cursor ? { cursor } : {}),
        },
      })
      owned = inventory.connections.some((connection) =>
        connection.accounts.some(
          (account) => account.credentialId === input.credentialId && account.status === 'connected'
        )
      )
      if (owned || inventory.nextCursor === null) break
      if (seen.has(inventory.nextCursor))
        throw new Error('Personal account pagination did not advance')
      seen.add(inventory.nextCursor)
      cursor = inventory.nextCursor
    }
    if (!owned)
      throw new OrchestrationError(
        'forbidden',
        'Assistant can only use your own connected account for this integration.'
      )
    const token = await resolveManagedOAuthToken({
      ...input,
      expectedProviderId: binding.providerId,
    })
    recordProjectedUseCaseAuditEntries(
      organizationPersonalCredentialOperation,
      null,
      principal,
      undefined,
      [
        {
          action: AuditAction.CREDENTIAL_ACCESSED,
          resourceType: AuditResourceType.CREDENTIAL,
          resourceId: input.credentialId,
          description: `Accessed personal organization credential for ${binding.providerId}`,
          metadata: {
            provider: binding.providerId,
            toolId: input.toolId,
            credentialType: 'managed_oauth',
          },
        },
      ],
      context.organizationId
    )
    return { ...token, credentialType: 'managed_oauth' as const }
  },
}

export const organizationPersonalConnectionOperation = defineOrganizationOperation({
  id: 'credentials.organization.personal.prepareConnection',
  minimumRole: 'member',
  principalKinds: ['organization_delegated'],
  delegatedServices: ['copilot'],
  delegationAudience: 'sim:knowledge',
  capability: 'integrations.manage',
})

/** Resolves an exact currently eligible connection control, including reconnects on later pages. */
export const prepareOrganizationPersonalConnection = {
  operation: organizationPersonalConnectionOperation,
  async execute({
    principal,
    input,
  }: {
    principal: Principal
    input: { organizationId: string; providerName: string; credentialId?: string }
  }) {
    const context = await authorizeOrganizationOperation(
      principal,
      organizationPersonalConnectionOperation,
      input
    )
    if (isLiveEnterpriseSearchEnabled) {
      if (input.credentialId) {
        const accounts = await listLiveAccounts(
          { organizationId: context.organizationId },
          context.userId
        )
        if (!accounts.some((account) => account.id === input.credentialId))
          throw new OrchestrationError('not_found', 'Personal account not found')
      }
      return {
        provider: input.providerName,
        providerId: input.providerName,
        settingsPath: `/o/${encodeURIComponent(context.organizationId)}/integrations`,
      }
    }
    const requested = input.providerName.toLowerCase().trim()
    const connector = SEARCH_CONNECTORS.find((entry) =>
      [
        entry.providerId,
        entry.type,
        entry.meta.name,
        ...providerIdsForService(entry.providerId),
      ].some((name) => name.toLowerCase() === requested)
    )
    if (!connector)
      throw new OrchestrationError('validation', 'This integration is unavailable in Search.')
    let cursor: string | undefined
    const seen = new Set<string>()
    for (let page = 0; page < 100; page++) {
      const inventory = await listPersonalSearchIntegrations.execute({
        principal,
        input: {
          organizationId: context.organizationId,
          connectorType: connector.type,
          ...(cursor ? { cursor } : {}),
        },
      })
      const target = input.credentialId
        ? inventory.connections
            .flatMap((connection) => connection.accounts)
            .find((account) => account.credentialId === input.credentialId)?.action
        : inventory.available[0]?.target
      if (target) return { provider: connector.meta.name, providerId: connector.providerId, target }
      if (inventory.nextCursor === null) break
      if (seen.has(inventory.nextCursor))
        throw new Error('Personal account pagination did not advance')
      seen.add(inventory.nextCursor)
      cursor = inventory.nextCursor
    }
    throw new OrchestrationError(
      'validation',
      'No connection action is currently available. Check your integration connection status.'
    )
  },
}
