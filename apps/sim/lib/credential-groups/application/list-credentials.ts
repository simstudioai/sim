import { isValidEmailSyntax, normalizeEmail } from '@sim/utils/string'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  credentialGroupDelegationPolicy,
  requireCredentialGroupWorkflowActor,
} from '@/lib/credential-groups/application/authorization'
import { credentialGroupOperations } from '@/lib/credential-groups/application/operations'
import {
  requireOrganizationAccountsWorkspaceAccess,
  resolveOrganizationAccountsWorkspaceContext,
} from '@/lib/credential-groups/application/organization-workspace-access'
import { organizationAccountPolicyAllowsWorkspace } from '@/lib/credential-groups/application/workspace-access-policy'
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
  workspaceId: string
  limit: number
  cursor?: string
  email?: string
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
    resolveOrganizationAccountsWorkspaceContext(input.workspaceId),
  authorizationOptions: { delegation: credentialGroupDelegationPolicy },
  async authorizeResource({ principal, context }) {
    requireCredentialGroupWorkflowActor(principal)
    context.workspaceAccessPolicy = await requireOrganizationAccountsWorkspaceAccess(context)
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

    const email = input.email ? normalizeEmail(input.email) : undefined
    if (email && !isValidEmailSyntax(email)) {
      throw new OrchestrationError('validation', 'Email must be a valid address')
    }

    const credentialProviderIds = [...new Set(input.credentialProviderIds ?? [])]
    if (credentialProviderIds.some((providerId) => !providerId.trim())) {
      throw new OrchestrationError('validation', 'Credential provider IDs must not be empty')
    }
    const policy = context.workspaceAccessPolicy
    if (!policy) throw new Error('Credential listing requires workspace policy authorization')
    const activeOptions = context.options
      .filter((option) => option.status === 'active')
      .map((option) => {
        if (!isCredentialGroupProvider(option.provider))
          throw new Error(`Unsupported credential provider: ${option.provider}`)
        return { ...option, provider: option.provider }
      })
    const activeProviderIds = new Set(
      activeOptions.map((option) => getCredentialGroupProviderId(option.provider))
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

    const allowedOptions = activeOptions.filter((option) =>
      organizationAccountPolicyAllowsWorkspace(
        policy,
        context.workspaceId,
        `oauth:${option.provider}`
      )
    )
    const allowedProviders = new Set(
      allowedOptions.map((option) => getCredentialGroupProviderId(option.provider))
    )
    if (credentialProviderIds.some((providerId) => !allowedProviders.has(providerId))) {
      throw new OrchestrationError(
        'forbidden',
        'This workspace is not allowed to use the requested credential provider'
      )
    }

    let page
    try {
      page = await listCredentialGroupCredentialReferences({
        organizationId: context.organizationId,
        credentialGroupId: context.credentialGroupId,
        credentialGroupOptionIds: allowedOptions.map((option) => option.id),
        limit: input.limit,
        cursor: input.cursor,
        email,
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
