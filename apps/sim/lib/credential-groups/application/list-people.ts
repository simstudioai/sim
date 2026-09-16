import { isValidEmailSyntax, normalizeEmail } from '@sim/utils/string'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  credentialGroupDelegationPolicy,
  requireCredentialGroupWorkflowActor,
} from '@/lib/credential-groups/application/authorization'
import {
  requireCredentialGroupsAvailable,
  resolveWorkspaceAccountsContext,
} from '@/lib/credential-groups/application/context'
import { credentialGroupOperations } from '@/lib/credential-groups/application/operations'
import {
  CredentialGroupEnrollmentError,
  type CredentialGroupEnrollmentStatus,
  listCredentialGroupEnrollments,
} from '@/lib/credential-groups/enrollments'

export const CREDENTIAL_GROUP_PEOPLE_STATUSES = [
  'invited',
  'delivery_failed',
  'in_progress',
  'completed',
  'revoked',
] as const satisfies readonly CredentialGroupEnrollmentStatus[]

export interface ListCredentialGroupPeopleInput {
  workspaceId: string
  limit: number
  cursor?: string
  email?: string
  statuses?: CredentialGroupEnrollmentStatus[]
}

export const listCredentialGroupPeople = defineAuthorizedWorkspaceUseCase({
  operation: credentialGroupOperations.listPeople,
  resolveContext: ({ input }: { input: ListCredentialGroupPeopleInput }) =>
    resolveWorkspaceAccountsContext(input.workspaceId),
  authorizationOptions: { delegation: credentialGroupDelegationPolicy },
  authorizeResource({ principal }) {
    requireCredentialGroupWorkflowActor(principal)
  },
  execute: async ({ input, context }) => {
    if (context.status !== 'active') {
      throw new OrchestrationError('conflict', 'Credential group is disabled')
    }
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
      throw new OrchestrationError('validation', 'Limit must be an integer between 1 and 100')
    }
    const email = input.email ? normalizeEmail(input.email) : undefined
    if (email && !isValidEmailSyntax(email)) {
      throw new OrchestrationError('validation', 'Email must be a valid address')
    }
    const statuses = [...new Set(input.statuses ?? [])]
    const allowedStatuses = new Set<string>(CREDENTIAL_GROUP_PEOPLE_STATUSES)
    if (statuses.some((status) => !allowedStatuses.has(status))) {
      throw new OrchestrationError('validation', 'People status filter is invalid')
    }
    await requireCredentialGroupsAvailable(context.workspaceId)

    try {
      const page = await listCredentialGroupEnrollments(
        context.workspaceId,
        context.credentialGroupId,
        input.limit,
        input.cursor,
        { email, statuses: statuses.length > 0 ? statuses : undefined }
      )
      return {
        people: page.enrollments,
        count: page.enrollments.length,
        hasMore: page.nextCursor !== null,
        nextCursor: page.nextCursor,
      }
    } catch (error) {
      if (error instanceof CredentialGroupEnrollmentError) {
        throw new OrchestrationError(
          error.status === 400 || error.status === 404
            ? 'validation'
            : error.status === 409
              ? 'conflict'
              : 'internal',
          error.message
        )
      }
      throw error
    }
  },
})
