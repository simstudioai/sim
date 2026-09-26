import { AuditAction, AuditResourceType } from '@sim/audit'
import type { Principal } from '@sim/auth/principal'
import { recordProjectedUseCaseAuditEntries } from '@/lib/core/application'
import { authorizeOrganizationOperation } from '@/lib/core/application/organization-authorization'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { getBlockVisibility } from '@/lib/core/config/block-visibility'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  isManagedCredentialGroupBindingLive,
  loadManagedCredentialGroupBinding,
} from '@/lib/credential-groups/credentials'
import { resolveManagedOAuthToken } from '@/lib/credentials/managed-oauth'
import { projectIntegrationToolsForViewer } from '@/lib/integrations/tool-projection'
import { personalSearchIntegrationPages } from '@/lib/knowledge/application/personal-search-integration-pages'
import { requireOrganizationSearchApproval } from '@/lib/knowledge/search/integration-policy'
import { providerIdsForService } from '@/lib/oauth/utils'
import { getUserPermissionConfigForOrganization } from '@/lib/permission-groups/resolve.server'
import { SEARCH_CONNECTORS } from '@/lib/sim-search/connectors'
import { isIndexedOrgSearchEnabled } from '@/lib/sim-search/indexed/gate'
import { listLiveAccounts } from '@/lib/sim-search/live/accounts'
import { requiresScopedRetrieval } from '@/lib/sim-search/live/policy-schema'
import { livePolicyFor, loadLiveSearchPolicies } from '@/lib/sim-search/live/policy-store'

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
    const indexed = isIndexedOrgSearchEnabled()
    /** Loaded lazily: this resolver is on the executor's credential path, which never needs it otherwise. */
    const owned = indexed
      ? await (await import('@/lib/sim-search/indexed')).ownsIndexedPersonalSearchAccount(
          principal,
          {
            organizationId: context.organizationId,
            connectorType: connector.type,
            credentialId: input.credentialId,
          }
        )
      : (await listLiveAccounts({ organizationId: context.organizationId }, context.userId)).some(
          (account) =>
            account.id === input.credentialId &&
            account.type === 'managed_oauth' &&
            account.providerId === binding.providerId
        )
    if (!owned)
      throw new OrchestrationError(
        'forbidden',
        'Assistant can only use your own connected account for this integration.'
      )
    if (!indexed) {
      const policies = await loadLiveSearchPolicies({ organizationId: context.organizationId })
      if (requiresScopedRetrieval(connector.type, livePolicyFor(policies, connector.type)))
        throw new OrchestrationError(
          'forbidden',
          'This organization restricts search scope for this app. Use search_workspace with nativeQueries and read_document so those restrictions are enforced.'
        )
    }
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
    for await (const inventory of personalSearchIntegrationPages({
      principal,
      input: { organizationId: context.organizationId, connectorType: connector.type },
    })) {
      const target = input.credentialId
        ? inventory.connections
            .flatMap((connection) => connection.accounts)
            .find((account) => account.credentialId === input.credentialId)?.action
        : inventory.available[0]?.target
      if (target) return { provider: connector.meta.name, providerId: connector.providerId, target }
    }
    throw new OrchestrationError(
      'validation',
      'No connection action is currently available. Check your integration connection status.'
    )
  },
}
