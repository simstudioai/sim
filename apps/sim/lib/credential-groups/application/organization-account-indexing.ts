import type { OrganizationMembershipContext } from '@/lib/core/application/organization-authorization'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { defineOrganizationAccountsUseCase } from '@/lib/credential-groups/application/organization-accounts'
import { loadScopedAccountsCredentialListContext } from '@/lib/credential-groups/credentials'
import { requireKnowledgeMemberAccessAvailable } from '@/lib/knowledge/access/availability'
import { dispatchMemberSyncsForCredentialOption } from '@/lib/knowledge/connectors/member-queue'
import { setOrganizationAccountIndexing } from '@/lib/knowledge/connectors/organization-account-indexing'

export const updateOrganizationAccountIndexingOperation = defineOrganizationOperation({
  id: 'organization_accounts.indexing.update',
  minimumRole: 'admin',
  principalKinds: ['session'],
  capability: 'knowledge.use',
})

export const updateOrganizationAccountIndexing = defineOrganizationAccountsUseCase({
  operation: updateOrganizationAccountIndexingOperation,
  async execute({
    input,
    context,
  }: {
    input: { organizationId: string; optionId: string; enabled: boolean }
    context: OrganizationMembershipContext
  }) {
    if (input.enabled)
      await requireKnowledgeMemberAccessAvailable({ organizationId: context.organizationId })
    const group = await loadScopedAccountsCredentialListContext({
      kind: 'organization',
      organizationId: context.organizationId,
    })
    if (!group)
      throw new OrchestrationError(
        'not_found',
        'Organization connected accounts are not configured'
      )
    const result = await setOrganizationAccountIndexing({
      organizationId: context.organizationId,
      credentialGroupId: group.credentialGroupId,
      optionId: input.optionId,
      enabled: input.enabled,
    })
    return { ...result, credentialGroupId: group.credentialGroupId, optionId: input.optionId }
  },
  projectAudit: (result) =>
    result.changed
      ? {
          resourceId: result.credentialGroupId,
          resourceName: 'Connected accounts',
          description: `${result.enabled ? 'Enabled' : 'Paused'} ${result.providerName} indexing`,
        }
      : null,
  async afterSuccess({ context, result }) {
    if (result.enabled && result.changed)
      await dispatchMemberSyncsForCredentialOption({
        organizationId: context.organizationId,
        credentialGroupOptionId: result.optionId,
      })
  },
})
