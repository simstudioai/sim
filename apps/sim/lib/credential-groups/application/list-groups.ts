import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { credentialGroupWorkspaceDelegationPolicy } from '@/lib/credential-groups/application/authorization'
import {
  requireCredentialGroupsAvailable,
  resolveCredentialGroupWorkspaceContext,
} from '@/lib/credential-groups/application/context'
import { credentialGroupOperations } from '@/lib/credential-groups/application/operations'
import {
  CredentialGroupCursorNotFoundError,
  type CredentialGroupSummary,
  listCredentialGroupSummaries,
  MAX_CREDENTIAL_GROUP_PAGE_SIZE,
} from '@/lib/credential-groups/groups'

export interface ListCredentialGroupsInput {
  workspaceId: string
  limit: number
  cursor?: string
}

export interface ListCredentialGroupsResult {
  credentialGroups: CredentialGroupSummary[]
  count: number
  hasMore: boolean
  nextCursor: string | null
}

export const listCredentialGroupsForWorkflow = defineAuthorizedWorkspaceUseCase({
  operation: credentialGroupOperations.listGroups,
  resolveContext: ({ input }: { input: ListCredentialGroupsInput }) =>
    resolveCredentialGroupWorkspaceContext(input.workspaceId),
  authorizationOptions: { delegation: credentialGroupWorkspaceDelegationPolicy },
  execute: async ({ input, context }): Promise<ListCredentialGroupsResult> => {
    if (
      !Number.isInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > MAX_CREDENTIAL_GROUP_PAGE_SIZE
    ) {
      throw new OrchestrationError(
        'validation',
        `Limit must be an integer between 1 and ${MAX_CREDENTIAL_GROUP_PAGE_SIZE}`
      )
    }
    await requireCredentialGroupsAvailable(context.workspaceId)

    let page
    try {
      page = await listCredentialGroupSummaries({
        workspaceId: context.workspaceId,
        limit: input.limit,
        cursor: input.cursor,
      })
    } catch (error) {
      if (error instanceof CredentialGroupCursorNotFoundError) {
        throw new OrchestrationError('validation', error.message)
      }
      throw error
    }

    return {
      credentialGroups: page.credentialGroups,
      count: page.credentialGroups.length,
      hasMore: page.nextCursor !== null,
      nextCursor: page.nextCursor,
    }
  },
})
