import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  credentialGroupDelegationPolicy,
  requireCredentialGroupEnrollmentAccess,
} from '@/lib/credential-groups/application/authorization'
import {
  requireCredentialGroupsAvailable,
  resolveCredentialGroupContext,
} from '@/lib/credential-groups/application/context'
import { credentialGroupOperations } from '@/lib/credential-groups/application/operations'
import {
  CredentialGroupCredentialCursorNotFoundError,
  type CredentialGroupCredentialReference,
  listCredentialGroupCredentialReferences,
  MAX_CREDENTIAL_GROUP_CREDENTIAL_PAGE_SIZE,
} from '@/lib/credential-groups/credentials'
import {
  getCredentialGroupProviderId,
  isCredentialGroupProvider,
} from '@/lib/credential-groups/providers'

export interface ListCredentialGroupCredentialsInput {
  credentialGroupId: string
  limit: number
  cursor?: string
  credentialProviderIds?: string[]
}

export interface ListCredentialGroupCredentialsResult {
  credentials: CredentialGroupCredentialReference[]
  count: number
  hasMore: boolean
  nextCursor: string | null
}

export const listCredentialGroupCredentials = defineAuthorizedWorkspaceUseCase({
  operation: credentialGroupOperations.listCredentials,
  resolveContext: ({ input }: { input: ListCredentialGroupCredentialsInput }) =>
    resolveCredentialGroupContext(input.credentialGroupId),
  authorizationOptions: { delegation: credentialGroupDelegationPolicy },
  async authorizeResource({ principal, context }) {
    context.enrollmentAccess = await requireCredentialGroupEnrollmentAccess(
      principal,
      context.credentialGroupId
    )
  },
  execute: async ({ input, context }): Promise<ListCredentialGroupCredentialsResult> => {
    if (
      !Number.isInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > MAX_CREDENTIAL_GROUP_CREDENTIAL_PAGE_SIZE
    ) {
      throw new OrchestrationError(
        'validation',
        `Limit must be an integer between 1 and ${MAX_CREDENTIAL_GROUP_CREDENTIAL_PAGE_SIZE}`
      )
    }
    if (context.status !== 'active') {
      throw new OrchestrationError('conflict', 'Credential group is disabled')
    }

    const credentialProviderIds = [...new Set(input.credentialProviderIds ?? [])]
    if (credentialProviderIds.some((providerId) => !providerId.trim())) {
      throw new OrchestrationError('validation', 'Credential provider IDs must not be empty')
    }
    const activeOptions = context.options.filter((option) => option.status === 'active')
    const activeProviderIds = new Set(
      activeOptions.map((option) => {
        if (!isCredentialGroupProvider(option.provider)) {
          throw new Error(`Credential Group provider is not registered: ${option.provider}`)
        }
        return getCredentialGroupProviderId(option.provider)
      })
    )
    const invalidProviderIds = credentialProviderIds.filter(
      (providerId) => !activeProviderIds.has(providerId)
    )
    if (invalidProviderIds.length > 0) {
      throw new OrchestrationError(
        'validation',
        `Credential providers are not active in this group: ${invalidProviderIds.join(', ')}`
      )
    }

    await requireCredentialGroupsAvailable(context.workspaceId)
    if (!context.enrollmentAccess) {
      throw new Error('Credential Group credential listing executed without enrollment access')
    }

    let page
    try {
      page = await listCredentialGroupCredentialReferences({
        workspaceId: context.workspaceId,
        credentialGroupId: context.credentialGroupId,
        credentialGroupOptionIds: activeOptions.map((option) => option.id),
        limit: input.limit,
        cursor: input.cursor,
        credentialGroupEnrollmentId: context.enrollmentAccess.enrollmentId,
        credentialProviderIds: credentialProviderIds.length > 0 ? credentialProviderIds : undefined,
      })
    } catch (error) {
      if (error instanceof CredentialGroupCredentialCursorNotFoundError) {
        throw new OrchestrationError('validation', error.message)
      }
      throw error
    }

    return {
      credentials: page.credentials,
      count: page.credentials.length,
      hasMore: page.nextCursor !== null,
      nextCursor: page.nextCursor,
    }
  },
})
